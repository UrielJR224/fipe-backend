require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

/* =============================
   BANCO DE DADOS POSTGRES
============================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =============================
   ROTA TESTE BANCO
============================= */

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao conectar no banco:", error.message);
    res.status(500).json({ erro: error.message });
  }
});

/* =============================
   ROTA CADASTRO USUARIO
============================= */

/* =============================
   ROTA CADASTRO USUARIO
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
      [nome, sobrenome, telefone, email, senha, 3]
    );

    res.json(novoUsuario.rows[0]);

  } catch (error) {
    console.error("Erro ao cadastrar:", error.message);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});


/* =============================
   ROTA LOGIN USUARIO
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
      email: usuario.rows[0].email,
      saldo: usuario.rows[0].saldo
    });

  } catch (error) {
    console.error("Erro no login:", error.message);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});

/* =============================
   ROTA CONSULTA FIPE COM CRÉDITO
============================= */

app.get("/api/placafipe/:placa", async (req, res) => {
  const { placa } = req.params;
  const { usuario_id } = req.query;

  if (!usuario_id) {
    return res.status(400).json({ erro: "usuario_id é obrigatório" });
  }

  const placaFormatada = placa.toUpperCase().replace(/[^A-Z0-9]/g, "");

  try {
    // 1️⃣ Buscar usuário
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

    // 2️⃣ Consultar API FIPE
    const response = await axios.get(
      `https://api.placafipe.com.br/getplacafipe/${placaFormatada}/${process.env.FIPE_API_TOKEN}`
    );

    // 3️⃣ Descontar 1 crédito
    const novoSaldo = await pool.query(
      "UPDATE usuarios SET saldo = saldo - 1 WHERE id = $1 RETURNING saldo",
      [usuario_id]
    );

    // 4️⃣ Registrar consulta
    await pool.query(
      "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1, $2, $3)",
      [usuario_id, placaFormatada, 1]
    );

    res.json({
      saldo_restante: usuario.rows[0].saldo - 1,
      dados_fipe: response.data
    });

  } catch (error) {
    console.error("Erro na consulta:", error.message);

    res.status(500).json({
      erro: "Erro ao consultar placa",
      detalhe: error.message
    });
  }
});

/* =============================
   SERVIDOR
============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
