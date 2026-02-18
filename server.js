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
