require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

/* ===== CONFIG ===== */
app.use(cors());
app.use(express.json());

/* 🔥 FORÇA UTF-8 EM TODAS RESPOSTAS */
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FIPE_API_TOKEN;

/* ===== ROTA ===== */
app.get('/api/placafipe/:placa', async (req, res) => {

  const placa = req.params.placa.toUpperCase();

  if (!placa) {
    return res.status(400).json({ erro: "Placa obrigatória" });
  }

  try {

    const response = await axios.get(
      `https://api.fipeapi.com.br/api/placafipe/${placa}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    /* 🔥 GARANTE QUE VEM UTF-8 */
    const data = JSON.parse(
      JSON.stringify(response.data)
    );

    res.json(data);

  } catch (error) {

    console.error("Erro API:", error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao consultar placa",
      detalhe: error.response?.data || error.message
    });

  }

});

/* ===== START ===== */
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
