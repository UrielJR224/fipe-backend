require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Pool } = require("pg");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app = express();

app.use(cors());
app.use(express.json());

/* =============================
   MERCADO PAGO CONFIG
============================= */

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

/* =============================
   BANCO POSTGRES
============================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =============================
   TESTE BANCO
============================= */

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
});

/* =============================
   CADASTRO
============================= */

app.post("/api/cadastro", async (req, res) => {
  const { nome, sobrenome, telefone, email, senha, confirmarSenha } = req.body;

  if (!nome || !sobrenome || !telefone || !email || !senha || !confirmarSenha)
    return res.status(400).json({ erro: "Preencha todos os campos" });

  if (senha !== confirmarSenha)
    return res.status(400).json({ erro: "As senhas não coincidem" });

  try {

    const usuarioExistente = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (usuarioExistente.rows.length > 0)
      return res.status(400).json({ erro: "Email já cadastrado" });

    const novoUsuario = await pool.query(
      `INSERT INTO usuarios 
       (nome, sobrenome, telefone, email, senha, saldo)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nome, sobrenome, email, saldo`,
      [nome, sobrenome, telefone, email, senha, 0]
    );

    res.json(novoUsuario.rows[0]);

  } catch (error) {
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});

/* =============================
   LOGIN
============================= */

app.post("/api/login", async (req, res) => {

  const { email, senha } = req.body;

  try {

    const usuario = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (usuario.rows.length === 0)
      return res.status(400).json({ erro: "Usuário não encontrado" });

    if (usuario.rows[0].senha !== senha)
      return res.status(400).json({ erro: "Senha incorreta" });

    res.json({
      id: usuario.rows[0].id,
      nome: usuario.rows[0].nome,
      sobrenome: usuario.rows[0].sobrenome,
      email: usuario.rows[0].email,
      saldo: usuario.rows[0].saldo
    });

  } catch (error) {
    res.status(500).json({ erro: "Erro interno do servidor" });
  }

});

/* =============================
   CRIAR PAGAMENTO
============================= */

app.post("/api/criar-pagamento", async (req, res) => {

  try {

    const { valor, userId } = req.body;

    if (!valor || !userId)
      return res.status(400).json({ erro: "Dados inválidos" });

    const preference = new Preference(client);

    const response = await preference.create({
      body: {
        items: [
          {
            title: "Recarga de Créditos - Fipe Total",
            quantity: 1,
            currency_id: "BRL",
            unit_price: Number(valor)
          }
        ],
        metadata: {
          userId: userId,
          valor: valor
        },
        notification_url: "https://fip-total-backend.onrender.com/api/webhook-mercadopago",
        back_urls: {
          success: "https://engemafer.com.br/sucesso.html",
          failure: "https://engemafer.com.br/erro.html",
          pending: "https://engemafer.com.br/pendente.html"
        },
        auto_return: "approved"
      }
    });

    res.json({ id: response.id });

  } catch (error) {
    console.log(error);
    res.status(500).json({ erro: "Erro ao criar pagamento" });
  }

});

/* =============================
   WEBHOOK MERCADO PAGO
============================= */

app.post("/api/webhook-mercadopago", async (req, res) => {

  console.log("===================================");
  console.log("Webhook chamado!");
  console.log("Body recebido:", req.body);
  console.log("===================================");

  try {

    const paymentClient = new Payment(client);

    let paymentId;

    // 🔥 SE VIER MERCHANT ORDER
    if (req.body.topic === "merchant_order") {

      const orderUrl = req.body.resource;

      const orderResponse = await axios.get(orderUrl, {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      });

      const order = orderResponse.data;

      if (!order.payments || order.payments.length === 0) {
        console.log("Order sem pagamento ainda.");
        return res.sendStatus(200);
      }

      paymentId = order.payments[0].id;

      console.log("Payment ID vindo da order:", paymentId);

    } else {

      paymentId =
        req.body?.data?.id ||
        req.body?.id;

    }

    if (!paymentId) {
      console.log("Nenhum paymentId encontrado.");
      return res.sendStatus(200);
    }

    const payment = await paymentClient.get({ id: paymentId });

    console.log("Status do pagamento:", payment.status);

    if (payment.status !== "approved") {
      console.log("Pagamento ainda não aprovado.");
      return res.sendStatus(200);
    }

    const userId = payment.metadata?.userId;
    const valorPago = Number(payment.metadata?.valor);

    if (!userId || !valorPago) {
      console.log("Metadata inválida:", payment.metadata);
      return res.sendStatus(200);
    }

    const jaProcessado = await pool.query(
      "SELECT * FROM pagamentos WHERE payment_id = $1",
      [paymentId]
    );

    if (jaProcessado.rows.length > 0) {
      console.log("Pagamento já processado.");
      return res.sendStatus(200);
    }

    await pool.query(
      "UPDATE usuarios SET saldo = saldo + $1 WHERE id = $2",
      [valorPago, userId]
    );

    await pool.query(
      "INSERT INTO pagamentos (usuario_id, payment_id, valor) VALUES ($1,$2,$3)",
      [userId, paymentId, valorPago]
    );

    console.log("Saldo atualizado com sucesso!");

    res.sendStatus(200);

  } catch (error) {
    console.log("Erro geral no webhook:", error);
    res.sendStatus(200);
  }

});

/* =============================
   CONSULTA PROPRIETÁRIO (R$11,99)
============================= */

app.post("/api/proprietario-atual", async (req, res) => {

  try {

    const { placa, userId } = req.body;
    const VALOR = 11.99;

    const usuario = await pool.query(
      "SELECT saldo FROM usuarios WHERE id = $1",
      [userId]
    );

    if (!usuario.rows.length)
      return res.status(404).json({ erro: "Usuário não encontrado" });

    const saldo = Number(usuario.rows[0].saldo);

    if (saldo < VALOR)
      return res.status(403).json({ erro: "Saldo insuficiente" });

    const response = await axios.post(
      "https://ws2.checkpro.com.br/servicejson.asmx/ConsultaProprietarioAtualPorPlaca",
      new URLSearchParams({
        cpfUsuario: process.env.CHECKPRO_CPF,
        senhaUsuario: process.env.CHECKPRO_SENHA,
        placa: placa
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = response.data;

    if (data.StatusRetorno !== "1")
      return res.json({ erro: data.MensagemRetorno });

    await pool.query(
      "UPDATE usuarios SET saldo = saldo - $1 WHERE id = $2",
      [VALOR, userId]
    );

    await pool.query(
      "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1,$2,$3)",
      [userId, placa, VALOR]
    );

    res.json({
      sucesso: true,
      dados: data,
      novoSaldo: saldo - VALOR
    });

  } catch (error) {
    res.status(500).json({ erro: "Erro interno do servidor" });
  }

});

/* =============================
   CONSULTA COMPLETA (R$54,90)
============================= */

app.post("/api/consulta-completa", async (req, res) => {

  try {

    const { placa, userId } = req.body;
    const VALOR = 54.90;

    const usuario = await pool.query(
      "SELECT saldo FROM usuarios WHERE id = $1",
      [userId]
    );

    if (!usuario.rows.length)
      return res.status(404).json({ erro: "Usuário não encontrado" });

    const saldo = Number(usuario.rows[0].saldo);

    if (saldo < VALOR)
      return res.status(403).json({ erro: "Saldo insuficiente" });

    const response = await axios.post(
      "https://ws2.checkpro.com.br/servicejson.asmx/ConsultaPacoteCompletoPorPlaca",
      new URLSearchParams({
        cpfUsuario: process.env.CHECKPRO_CPF,
        senhaUsuario: process.env.CHECKPRO_SENHA,
        placa: placa
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = response.data;

    if (data.StatusRetorno !== "1")
      return res.json({ erro: data.MensagemRetorno });

    await pool.query(
      "UPDATE usuarios SET saldo = saldo - $1 WHERE id = $2",
      [VALOR, userId]
    );

    await pool.query(
      "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1,$2,$3)",
      [userId, placa, VALOR]
    );

    res.json({
      sucesso: true,
      dados: data,
      novoSaldo: saldo - VALOR
    });

  } catch (error) {
    res.status(500).json({ erro: "Erro interno do servidor" });
  }

});

/* =============================
   CONSULTA FIPE (GRÁTIS)
============================= */

app.get("/api/placafipe/:placa/:usuario_id?", async (req, res) => {

  try {

    const { placa, usuario_id } = req.params;

    const placaFormatada = placa
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    const response = await axios.get(
      `https://api.placafipe.com.br/getplacafipe/${placaFormatada}/${process.env.FIPE_API_TOKEN}`
    );

    // Se tiver usuário logado salva no histórico
    if (usuario_id) {
      await pool.query(
        "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1,$2,$3)",
        [usuario_id, placaFormatada, 0]
      );
    }

    res.json(response.data);

  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao consultar placa"
    });
  }

});

/* =============================
   HISTÓRICO
============================= */

app.get("/api/historico/:usuario_id", async (req, res) => {

  const { usuario_id } = req.params;

  try {

    const consultas = await pool.query(
      `SELECT placa, valor_pago, criado_em
       FROM consultas
       WHERE usuario_id = $1
       ORDER BY criado_em DESC`,
      [usuario_id]
    );

    res.json(consultas.rows);

  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar histórico" });
  }

});

/* =============================
   SERVIDOR
============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});