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
      [nome, sobrenome, telefone, email, senha, 3]
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
   CONSULTA PROPRIETÁRIO ATUAL (R$ 11,99)
============================= */

app.post("/api/proprietario-atual", async (req, res) => {

  try {

    const { placa, userId } = req.body;
    const VALOR_CONSULTA = 11.99;

    if (!placa || !userId) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    const usuario = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1",
      [userId]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const saldoAtual = parseFloat(usuario.rows[0].saldo);

    if (saldoAtual < VALOR_CONSULTA) {
      return res.status(403).json({ erro: "Saldo insuficiente" });
    }

    const response = await axios.post(
      "https://ws2.checkpro.com.br/servicejson.asmx/ConsultaProprietarioAtualPorPlaca",
      new URLSearchParams({
        cpfUsuario: process.env.CHECKPRO_CPF,
        senhaUsuario: process.env.CHECKPRO_SENHA,
        placa: placa
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const data = response.data;

    if (data.StatusRetorno === "1") {

      await pool.query(
        "UPDATE usuarios SET saldo = saldo - $1 WHERE id = $2",
        [VALOR_CONSULTA, userId]
      );

      await pool.query(
        "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1, $2, $3)",
        [userId, placa, VALOR_CONSULTA]
      );

      return res.json({
        sucesso: true,
        dados: data,
        novoSaldo: saldoAtual - VALOR_CONSULTA
      });

    } else {
      return res.json({
        erro: data.MensagemRetorno
      });
    }

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});

/* =============================
   HISTÓRICO CONSULTAS
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
   ROTA TEMPORÁRIA - ADICIONAR SALDO
============================= */

app.post("/api/admin/add-saldo", async (req, res) => {
  try {
    const { userId, valor } = req.body;

    if (!userId || !valor) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    await pool.query(
      "UPDATE usuarios SET saldo = saldo + $1 WHERE id = $2",
      [valor, userId]
    );

    const usuarioAtualizado = await pool.query(
      "SELECT saldo FROM usuarios WHERE id = $1",
      [userId]
    );

    res.json({
      sucesso: true,
      novoSaldo: usuarioAtualizado.rows[0].saldo
    });

  } catch (error) {
    res.status(500).json({ erro: "Erro ao adicionar saldo" });
  }
});

/* =============================
   SERVIDOR
============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

app.post("/api/consulta-completa", async (req, res) => {

  try {

    const { placa, userId } = req.body;
    const VALOR_CONSULTA = 54.90;

    if (!placa || !userId) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    const usuario = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1",
      [userId]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const saldoAtual = parseFloat(usuario.rows[0].saldo);

    if (saldoAtual < VALOR_CONSULTA) {
      return res.status(403).json({ erro: "Saldo insuficiente" });
    }

    const response = await axios.post(
      "https://ws2.checkpro.com.br/servicejson.asmx/ConsultaPacoteCompletoPorPlaca",
      new URLSearchParams({
        cpfUsuario: process.env.CHECKPRO_CPF,
        senhaUsuario: process.env.CHECKPRO_SENHA,
        placa: placa
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const data = response.data;

    if (data.StatusRetorno === "1") {

      await pool.query(
        "UPDATE usuarios SET saldo = saldo - $1 WHERE id = $2",
        [VALOR_CONSULTA, userId]
      );

      await pool.query(
        "INSERT INTO consultas (usuario_id, placa, valor_pago) VALUES ($1, $2, $3)",
        [userId, placa, VALOR_CONSULTA]
      );

      return res.json({
        sucesso: true,
        dados: data,
        novoSaldo: saldoAtual - VALOR_CONSULTA
      });

    } else {
      return res.json({
        erro: data.MensagemRetorno || "Erro na consulta"
      });
    }

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});