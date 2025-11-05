const axios = require('axios');

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Credenciais ausentes: ${missing.join(', ')}`);
  }
}

async function sendSimpleText({ phone, message }) {
  requireEnv(['ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_INSTANCE_ID']);
  const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`;
  const payload = { phone, message };
  const response = await axios.post(url, payload, {
    headers: {
      'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

async function sendCarouselMessage({ phone, elements }) {
  requireEnv(['ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_INSTANCE_ID']);
  const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-carousel`;
  const payload = { phone, elements };
  const response = await axios.post(url, payload, {
    headers: {
      'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

async function configureWebhook(publicBaseUrl) {
  requireEnv(['ZAPI_TOKEN', 'ZAPI_CLIENT_TOKEN', 'ZAPI_INSTANCE_ID']);
  const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/webhook/message-status`;
  const url = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/update-every-webhooks`;
  const payload = { value: webhookUrl, notifySentByMe: true };
  const response = await axios.put(url, payload, {
    headers: {
      'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  return { webhookUrl, zapiResponse: response.data };
}

module.exports = {
  name: 'zapi',
  sendSimpleText,
  sendCarouselMessage,
  configureWebhook,
};