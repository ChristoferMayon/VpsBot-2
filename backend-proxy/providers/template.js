// Template de adapter para nova fornecedora
// Copie este arquivo e ajuste endpoints, headers e payloads segundo a documentação da fornecedora.
const axios = require('axios');

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Credenciais ausentes: ${missing.join(', ')}`);
  }
}

// Exemplo de variáveis esperadas (ajuste conforme o provedor)
// PROV_BASE_URL=https://api.exemplo.com
// PROV_TOKEN=xxxxx
// PROV_CLIENT_ID=xxxxx

async function sendSimpleText({ phone, message }) {
  requireEnv(['PROV_BASE_URL', 'PROV_TOKEN']);
  const url = `${process.env.PROV_BASE_URL.replace(/\/$/, '')}/messages/send-text`;
  const payload = { phone, message };
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${process.env.PROV_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function sendCarouselMessage({ phone, elements }) {
  requireEnv(['PROV_BASE_URL', 'PROV_TOKEN']);
  const url = `${process.env.PROV_BASE_URL.replace(/\/$/, '')}/messages/send-carousel`;
  const payload = { phone, elements };
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${process.env.PROV_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}

async function configureWebhook(publicBaseUrl) {
  requireEnv(['PROV_BASE_URL', 'PROV_TOKEN']);
  const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/webhook/message-status`;
  const url = `${process.env.PROV_BASE_URL.replace(/\/$/, '')}/webhooks`;
  const payload = { url: webhookUrl };
  const response = await axios.put(url, payload, {
    headers: {
      Authorization: `Bearer ${process.env.PROV_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  return { webhookUrl, providerResponse: response.data };
}

module.exports = {
  name: 'template',
  sendSimpleText,
  sendCarouselMessage,
  configureWebhook,
};