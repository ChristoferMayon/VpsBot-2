const fs = require('fs');
const path = require('path');

// Arquivo de log dedicado para rastrear problemas de instância/usuário
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'user-instance.log');

function ensureLogFile() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');
  } catch (_) {
    // Evitar crash do servidor por falha de log
  }
}

function fmt(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

function logUserInstance(event, details = {}) {
  try {
    ensureLogFile();
    const line = `[${new Date().toISOString()}] ${event} ${fmt(details)}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

module.exports = { logUserInstance, LOG_FILE };

// Garante arquivo de log criado no carregamento do módulo
try { ensureLogFile(); } catch (_) {}