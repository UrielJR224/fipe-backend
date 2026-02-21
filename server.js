require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Pool } = require("pg");
const mercadopago = require("mercadopago");

const app = express();

app.use(cors());
app.use(express.json());

/* =============================
   MERCADO PAGO CONFIG
============================= */

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
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

    const preference = {
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
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({ id: response.body.id });

  } catch (error) {
    console.log(error.message);
    res.status(500).json({ erro: "Erro ao criar pagamento" });
  }

});

/* =============================
   WEBHOOK MERCADO PAGO
============================= */

app.post("/api/webhook-mercadopago", async (req, res) => {

  try {

    const paymentId = req.body.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const payment = await mercadopago.payment.findById(paymentId);

    if (payment.body.status !== "approved")
      return res.sendStatus(200);

    const userId = payment.body.metadata.userId;
    const valorPago = Number(payment.body.metadata.valor);

    const jaProcessado = await pool.query(
      "SELECT * FROM pagamentos WHERE payment_id = $1",
      [paymentId]
    );

    if (jaProcessado.rows.length > 0)
      return res.sendStatus(200);

    await pool.query(
      "UPDATE usuarios SET saldo = saldo + $1 WHERE id = $2",
      [valorPago, userId]
    );

    await pool.query(
      "INSERT INTO pagamentos (usuario_id, payment_id, valor) VALUES ($1,$2,$3)",
      [userId, paymentId, valorPago]
    );

    console.log("Pagamento aprovado. Saldo atualizado.");

    res.sendStatus(200);

  } catch (error) {
    console.log(error.message);
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