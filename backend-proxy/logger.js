const fs = require('fs');
const path = require('path');

// Diretório de logs
const LOG_DIR = path.join(__dirname, 'logs');
// Log de instância/usuário (existente)
const LOG_FILE = path.join(LOG_DIR, 'user-instance.log');
// Novo: Log de autenticação
const AUTH_LOG_FILE = path.join(LOG_DIR, 'auth.log');
// Novo: Log de UI (eventos do frontend)
const UI_LOG_FILE = path.join(LOG_DIR, 'ui.log');
// Novo: Log de conexão de instância (diagnóstico de QR)
const CONNECT_LOG_FILE = path.join(LOG_DIR, 'connect-instance.log');
// Novo: Log dedicado ao fluxo de QR/SweetAlert/redirect
const QR_FLOW_LOG_FILE = path.join(LOG_DIR, 'qr-flow.log');
// Novo: Log de desconexão de instância
const DISCONNECT_LOG_FILE = path.join(LOG_DIR, 'disconnect-instance.log');

function ensureFile(filePath) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
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
    ensureFile(LOG_FILE);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(details)}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

function sanitizeAuthDetails(details = {}) {
  try {
    const safe = { ...details };
    if (safe && typeof safe === 'object') {
      if (safe.body && typeof safe.body === 'object') {
        const sb = { ...safe.body };
        if (typeof sb.password !== 'undefined') sb.password = '***';
        safe.body = sb;
      }
      if (typeof safe.password !== 'undefined') safe.password = '***';
      if (typeof safe.token !== 'undefined') safe.token = '***';
      if (safe.headers && typeof safe.headers === 'object') {
        const sh = { ...safe.headers };
        if (typeof sh.authorization !== 'undefined') sh.authorization = '***';
        safe.headers = sh;
      }
    }
    return safe;
  } catch (_) {
    return details;
  }
}

function logAuth(event, details = {}) {
  try {
    ensureFile(AUTH_LOG_FILE);
    const safe = sanitizeAuthDetails(details);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(safe)}\n`;
    fs.appendFileSync(AUTH_LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

function logUi(event, details = {}) {
  try {
    ensureFile(UI_LOG_FILE);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(details)}\n`;
    fs.appendFileSync(UI_LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

function sanitizeConnectDetails(details = {}) {
  try {
    const safe = { ...details };
    if (safe && typeof safe === 'object') {
      if (typeof safe.token !== 'undefined') safe.token = '***';
      if (typeof safe.instance_token !== 'undefined') safe.instance_token = '***';
      if (typeof safe.providedToken !== 'undefined') safe.providedToken = safe.providedToken ? true : false;
      if (typeof safe.phone === 'string') {
        const p = String(safe.phone).replace(/\D/g, '');
        safe.phone = p.length > 4 ? `${p.slice(0, p.length - 4)}****` : '****';
      }
      if (safe.headers && typeof safe.headers === 'object') {
        const sh = { ...safe.headers };
        if (typeof sh.authorization !== 'undefined') sh.authorization = '***';
        if (typeof sh['Client-Token'] !== 'undefined') sh['Client-Token'] = '***';
        if (typeof sh.token !== 'undefined') sh.token = '***';
        safe.headers = sh;
      }
    }
    return safe;
  } catch (_) {
    return details;
  }
}

function logConnect(event, details = {}) {
  try {
    ensureFile(CONNECT_LOG_FILE);
    const safe = sanitizeConnectDetails(details);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(safe)}\n`;
    fs.appendFileSync(CONNECT_LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

function logQrFlow(event, details = {}) {
  try {
    ensureFile(QR_FLOW_LOG_FILE);
    const safe = sanitizeAuthDetails(details);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(safe)}\n`;
    fs.appendFileSync(QR_FLOW_LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

function sanitizeDisconnectDetails(details = {}) {
  try {
    const safe = { ...details };
    if (safe && typeof safe === 'object') {
      if (typeof safe.token !== 'undefined') safe.token = '***';
      if (typeof safe.instance_token !== 'undefined') safe.instance_token = '***';
      if (safe.headers && typeof safe.headers === 'object') {
        const sh = { ...safe.headers };
        if (typeof sh.authorization !== 'undefined') sh.authorization = '***';
        if (typeof sh['Client-Token'] !== 'undefined') sh['Client-Token'] = '***';
        if (typeof sh.token !== 'undefined') sh.token = '***';
        safe.headers = sh;
      }
      // Normaliza mensagem/erro longo para evitar logs gigantes
      if (typeof safe.message === 'string' && safe.message.length > 500) {
        safe.message = safe.message.slice(0, 500) + '...';
      }
    }
    return safe;
  } catch (_) {
    return details;
  }
}

function logDisconnect(event, details = {}) {
  try {
    ensureFile(DISCONNECT_LOG_FILE);
    const safe = sanitizeDisconnectDetails(details);
    const line = `[${new Date().toISOString()}] ${event} ${fmt(safe)}\n`;
    fs.appendFileSync(DISCONNECT_LOG_FILE, line);
  } catch (_) {
    // Ignora erros de log
  }
}

module.exports = { logUserInstance, LOG_FILE, logAuth, AUTH_LOG_FILE, logUi, UI_LOG_FILE, logConnect, CONNECT_LOG_FILE, logQrFlow, QR_FLOW_LOG_FILE, logDisconnect, DISCONNECT_LOG_FILE };

// Garante arquivos de log criados no carregamento do módulo
try { ensureFile(LOG_FILE); ensureFile(AUTH_LOG_FILE); ensureFile(UI_LOG_FILE); ensureFile(CONNECT_LOG_FILE); ensureFile(QR_FLOW_LOG_FILE); ensureFile(DISCONNECT_LOG_FILE); } catch (_) {}