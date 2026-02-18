const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.FIPE_API_TOKEN;

app.get("/api/placafipe/:placa", async (req, res) => {
  const { placa } = req.params;

  try {
    const response = await axios.get(
      `https://api.placafipe.com.br/getplacafipe/${placa}/${TOKEN}`
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

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
