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

app.post("/api/cadastro", async (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Preencha todos os campos" });
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
      "INSERT INTO usuarios (nome, email, senha, saldo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, saldo",
      [nome, email, senha, 0]
    );

    res.json(novoUsuario.rows[0]);

  } catch (error) {
    console.error("Erro ao cadastrar:", error.message);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});


/* =============================
   ROTA CONSULTA FIPE
============================= */

app.get("/api/placafipe/:placa", async (req, res) => {
  const { placa } = req.params;

  try {
    const response = await axios.get(
      `https://api.placafipe.com.br/getplacafipe/${placa}/${process.env.FIPE_API_TOKEN}`
    );

    res.json(response.data);

  } catch (error) {
    console.error("Erro real da API:", error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao consultar placa",
      detalhe: error.response?.data || error.message
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
