require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/placafipe/:placa', async (req, res) => {

    try {

        const { placa } = req.params;

        const response = await axios.get(
            `https://api.placafipe.com.br/getplacafipe/${placa}/${process.env.FIPE_API_TOKEN}`
        );

        res.json(response.data);

    } catch (error) {

        console.error(error.message);

        res.status(500).json({
            error: 'Erro na consulta'
        });

    }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});