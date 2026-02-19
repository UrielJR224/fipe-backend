require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

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
   CADASTRO (GANHA 3 CRÉDITOS)
============================= */

app.post("/api/cadastro", async (req, res) => {
  const { nome, sobrenome, telefone, email, senha, confirmarSenha } = req.body;

  if (!nome || !sobrenome || !telefone || !email || !senha || !confirmarSenha) {
    return res.status(400).json({ erro: "Preencha todos os campos" });
  }

  if (senha !== confirmarSenha) {
    return res.status(400).json({ erro: "As senhas não coincidem" });
  }

  try {
    const usuarioExistente = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ erro: "Email já cadastrado" });
    }

    const novoUsuario = await pool.query(
      `INSERT INTO usuarios 
      (nome, sobrenome, telefone, email, senha, saldo) 
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING id, nome, sobrenome, email, saldo`,
      [nome, sobrenome, telefone, email, senha, 3] // 🎁 bônus automático
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

  if (!email || !senha) {
    return res.status(400).json({ erro: "Preencha email e senha" });
  }

  try {
    const usuario = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (usuario.rows.length === 0) {
      return res.status(400).json({ erro: "Usuário não encontrado" });
    }

    if (usuario.rows[0].senha !== senha) {
      return res.status(400).json({ erro: "Senha incorreta" });
    }

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
   CONSULTA FIPE (GRÁTIS)
============================= */

app.get("/api/placafipe/:placa/:usuario_id?", async (req, res) => {

  const { placa, usuario_id } = req.params;
  const placaFormatada = placa.toUpperCase().replace(/[^A-Z0-9]/g, "");

  try {

    const response = await axios.get(
      `https://api.placafipe.com.br/getplacafipe/${placaFormatada}/${process.env.FIPE_API_TOKEN}`
    );

    // 🔥 SALVA CONSULTA GRATUITA SE ESTIVER LOGADO
    if (usuario_id) {
      await pool.query(
        "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1, $2, $3)",
        [usuario_id, placaFormatada, 0]
      );
    }

    res.json(response.data);

  } catch (error) {
    res.status(500).json({
      erro: "Erro ao consultar placa",
      detalhe: error.message
    });
  }
});

/* =============================
   SERVIÇO PAGO EXEMPLO (VERIFICAÇÃO)
============================= */

app.post("/api/verificacao/:placa", async (req, res) => {

  const { placa } = req.params;
  const { usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({ erro: "Usuário obrigatório" });
  }

  try {

    const usuario = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1",
      [usuario_id]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    if (usuario.rows[0].saldo <= 0) {
      return res.status(403).json({ erro: "Saldo insuficiente" });
    }

    // Aqui você colocaria API real do serviço pago

    await pool.query(
      "UPDATE usuarios SET saldo = saldo - 1 WHERE id = $1",
      [usuario_id]
    );

    await pool.query(
      "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1, $2, $3)",
      [usuario_id, placa, 1]
    );

    res.json({
      mensagem: "Consulta realizada com sucesso",
      saldo_restante: usuario.rows[0].saldo - 1
    });

  } catch (error) {
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});


/* =============================
   ROTA HISTÓRICO CONSULTAS
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
    console.error("Erro ao buscar histórico:", error.message);
    res.status(500).json({ erro: "Erro ao buscar histórico" });
  }
});


/* =============================
   SERVIDOR
============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

