import express from "express";
import http from "http";
import https from "https";
import cors from "cors";
import axios from "axios";
import path from "path";
import fs from "fs";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import userdb from "./db.js";
import instore from "./instance_store.js";
import dotenv from "dotenv";

dotenv.config();

// ------------------------------------------------------
// Configurações básicas
// ------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const USE_HTTPS = process.env.ENFORCE_HTTPS === "true";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DB_FILE = process.env.DB_FILE || "./data/data.json";

app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));
app.use(morgan("dev"));
if (helmet) app.use(helmet());

// ------------------------------------------------------
// Rate limit e segurança
// ------------------------------------------------------
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: "Muitas requisições, tente novamente em instantes." },
  })
);

// ------------------------------------------------------
// Rotas de exemplo (adicione as suas abaixo)
// ------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    status: "✅ Servidor ativo!",
    baseUrl: PUBLIC_BASE_URL,
  });
});

// ------------------------------------------------------
// Inicialização do servidor
// ------------------------------------------------------
if (USE_HTTPS) {
  const certDir = path.join(process.cwd(), "cert");
  const keyPath = path.join(certDir, "privkey.pem");
  const certPath = path.join(certDir, "fullchain.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    https.createServer(httpsOptions, app).listen(PORT, () => {
      console.log(`🚀 HTTPS ativo em ${PUBLIC_BASE_URL}`);
    });
  } else {
    console.error("⚠️ Certificados HTTPS não encontrados. Executando em HTTP.");
    http.createServer(app).listen(PORT, () => {
      console.log(`🚀 HTTP ativo em ${PUBLIC_BASE_URL}`);
    });
  }
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`🚀 Servidor ativo em ${PUBLIC_BASE_URL}`);
  });
}




// HTTPS opcional (se certificados existirem)
let server;
if (process.env.ENFORCE_HTTPS === "true" && fs.existsSync("cert.pem") && fs.existsSync("key.pem")) {
  const credentials = {
    key: fs.readFileSync("key.pem", "utf8"),
    cert: fs.readFileSync("cert.pem", "utf8")
  };
  server = https.createServer(credentials, app);
  console.log("[HTTPS] Certificados encontrados. Servidor iniciado em modo seguro.");
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// Initialize instance store file on startup
instore.readStore();
const dotenvPath = path.join(__dirname, '.env');
require('dotenv').config({ path: dotenvPath });


// Desabilita cabeçalho de identificação do framework
app.disable('x-powered-by');
// Confiar no proxy (para req.secure e cookies secure atrás de proxy)
app.set('trust proxy', 1);
// Aplica Helmet se disponível
if (helmet) {
// Helmet com CSP: permitir somente fontes necessárias
app.use(helmet());
// HSTS para forçar HTTPS por ~180 dias
app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true, preload: true }));
// Bloquear framing e reduzir vazamento de referência
app.use(helmet.frameguard({ action: 'deny' }));
app.use(helmet.referrerPolicy({ policy: 'no-referrer' }));
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    fontSrc: ["'self'", 'https:', 'data:'],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net'],
    // Remover inline em atributos; permitir apenas hashes para compatibilidade pontual
    // Restaurar compatibilidade com handlers inline até migração
    scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
    // Permitir estilos inline para Tailwind CDN e CSS embutido
    styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
    connectSrc: ["'self'"],
  }
}));
}

// Servir versão ofuscada do JS quando habilitado por variável de ambiente
// Isto mantém o caminho original (/js/carousel_script_new.js), mas entrega o conteúdo de public_seguro.
const USE_OBFUSCATED_JS = String(process.env.USE_OBFUSCATED_JS || '').toLowerCase() === 'true';
if (USE_OBFUSCATED_JS) {
  const obfPath = path.join(__dirname, '..', 'public_seguro', 'js', 'carousel_script_new.js');
  app.get('/js/carousel_script_new.js', (req, res, next) => {
    try {
      if (fs.existsSync(obfPath)) {
        res.type('application/javascript');
        return res.sendFile(obfPath);
      }
    } catch (_) {}
    return next();
  });
}

// Bloqueia acesso público à pasta de certificados
app.get('/certs/*', (req, res) => {
  return res.status(404).send('Not Found');
});

function loadHttpsOptionsIfAvailable() {
  try {
    const certPath = path.join(__dirname, '..', 'public', 'certs', 'cert.pem');
    const keyPath = path.join(__dirname, '..', 'public', 'certs', 'key.pem');
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      console.log('[HTTPS] Certificados encontrados. Inicializando HTTPS.');
      return { key, cert };
    }
    console.log('[HTTPS] Certificados não encontrados. Mantendo HTTP.');
    return null;
  } catch (e) {
    console.warn('[HTTPS] Falha ao carregar certificados:', e?.message || String(e));
    return null;
  }
}

const httpsOptions = loadHttpsOptionsIfAvailable();
const server = httpsOptions ? https.createServer(httpsOptions, app) : http.createServer(app);
// Socket.IO para eventos em tempo real (instance_connected:{user_id})
let io = null;
// Mapa user_id -> socket.id para emissão direcionada
const userSockets = new Map();
try {
  const { Server } = require('socket.io');
  io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
  io.on('connection', (socket) => {
    console.log('[Socket.IO] cliente conectado', socket.id);
    // Cliente pode se registrar com seu user_id para receber evento genérico
    socket.on('register', (payload) => {
      try {
        const uid = payload && (payload.user_id || payload.uid || payload.id);
        if (!uid) return;
        userSockets.set(String(uid), socket.id);
        socket.emit('registered', { ok: true, user_id: uid });
        console.log('[Socket.IO] user registrado', uid, '->', socket.id);
      } catch (e) {
        console.warn('[Socket.IO] register erro:', e?.message || String(e));
      }
    });
    socket.on('disconnect', () => console.log('[Socket.IO] cliente desconectado', socket.id));
    socket.on('disconnect', () => {
      try {
        for (const [uid, sid] of Array.from(userSockets.entries())) {
          if (sid === socket.id) userSockets.delete(uid);
        }
      } catch (_) {}
    });
  });
} catch (e) {
  console.warn('[Socket.IO] não inicializado:', e?.message || String(e));
}

const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_dev_secret';
const JWT_SECRET_OLD = process.env.JWT_SECRET_OLD || '';
const API_KEY = process.env.API_KEY || '';
const UI_LOG_API_KEY = process.env.UI_LOG_API_KEY || '';
// Inicializa banco de dados
userdb.init();

// Configuração de CORS por allowlist de origens via .env (CORS_ORIGIN)
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Validação de ambiente em produção
if (String(process.env.NODE_ENV).toLowerCase() === 'production') {
  if (!JWT_SECRET || String(JWT_SECRET).length < 24) {
    console.error('[SECURITY] JWT_SECRET ausente ou fraco. Defina um segredo forte (>=24 chars).');
    process.exit(1);
  }
  if (ALLOWED_ORIGINS.length === 0) {
    console.error('[SECURITY] CORS_ORIGIN não definido. Configure origens permitidas na .env.');
    process.exit(1);
  }
}

// Middleware para habilitar CORS (permite que seu frontend se comunique com o backend)
app.use(cors({
  origin: function(origin, callback) {
    // Permite requisições sem origem (ex.: curl, mesma origem)
    if (!origin) return callback(null, true);
    // Se não houver allowlist, libera (útil em dev)
    if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-ui-log-key']
}));

// Redireciona HTTP para HTTPS quando habilitado (atrás de proxy respeita req.secure)
app.use((req, res, next) => {
  try {
    const enforce = String(process.env.ENFORCE_HTTPS || '').toLowerCase() === 'true';
    if (!enforce) return next();
    // Se já estiver em HTTPS, segue
    const isHttps = Boolean(req.secure || (req.protocol === 'https'));
    if (isHttps) return next();
    const host = req.headers.host || '';
    const target = `https://${host}${req.url}`;
    return res.redirect(301, target);
  } catch (_) { return next(); }
});

// Limites de corpo para evitar payloads grandes
app.use(express.json({ limit: '50kb' })); // Para parsear JSON no corpo das requisições
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
// Cookies para autenticação e CSRF
app.use(cookieParser());

// Recebe logs do frontend (UI)
// Rate limits específicos
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
});
const uiLogLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 500,
  standardHeaders: true,
  legacyHeaders: false,
});
// Limite para endpoints que alteram instâncias
const instanceWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/ui/log', authRequired, uiLogLimiter, (req, res) => {
  try {
    const { event, details } = req.body || {};
    // Rejeita payloads muito grandes para logs
    try {
      const size = Buffer.byteLength(JSON.stringify({ event, details }), 'utf8');
      if (size > 5 * 1024) {
        return res.status(413).json({ error: 'Payload muito grande para log de UI' });
      }
    } catch (_) {}
    const meta = {
      ip: req.ip,
      ua: req.headers['user-agent'],
      referer: req.headers.referer,
      origin: req.headers.origin,
    };
    try { const { logUi } = require('./logger'); logUi(String(event || 'ui.event'), { ...(details || {}), ...meta }); } catch (_) {}
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao registrar log de UI', details: e?.message || String(e) });
  }
});

// Log dedicado ao fluxo de QR (desaparecimento do QR, SweetAlert, redirect)
app.post('/ui/qr-flow-log', authRequired, uiLogLimiter, (req, res) => {
  try {
    const { event, details } = req.body || {};
    // Limita payload para evitar abuso
    try {
      const size = Buffer.byteLength(JSON.stringify({ event, details }), 'utf8');
      if (size > 5 * 1024) {
        return res.status(413).json({ error: 'Payload muito grande para log QR-flow' });
      }
    } catch (_) {}
    const meta = {
      ip: req.ip,
      ua: req.headers['user-agent'],
      referer: req.headers.referer,
      origin: req.headers.origin,
      user_id: req.user?.id || null,
      username: req.user?.username || null,
    };
    try { const { logQrFlow } = require('./logger'); logQrFlow(String(event || 'qr.flow.event'), { ...(details || {}), ...meta }); } catch (_) {}
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao registrar log QR-flow', details: e?.message || String(e) });
  }
});

// Limite global de requisições com exceções para assets estáticos e health checks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 200 : 1000, // mais permissivo em dev
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const p = req.path || req.url || '';
    const isHealth = p.startsWith('/health') || p.startsWith('/readyz') || p.startsWith('/livez');
    const isSocket = p.startsWith('/socket.io/');
    const isStaticGet = req.method === 'GET' && (
      p === '/' ||
      p.endsWith('.html') ||
      p.endsWith('.ico') ||
      p.endsWith('.png') ||
      p.endsWith('.jpg') ||
      p.endsWith('.jpeg') ||
      p.startsWith('/image/') ||
      p.startsWith('/js/') ||
      p.startsWith('/config/')
    );
    return isHealth || isSocket || isStaticGet;
  }
});
app.use(limiter);

// Serve os arquivos estáticos do frontend a partir de /public, usando login.html como index
// Protege a página Admin no frontend: exige usuário autenticado com perfil admin
// Isto impede acesso direto via /admin.html ao conteúdo sem login
app.get(['/admin', '/admin.html'], authRequired, adminRequired, (req, res) => {
  const adminPath = path.join(__dirname, '..', 'public', 'admin.html');
  return res.sendFile(adminPath);
});

// Protege páginas do painel do usuário: exigem autenticação
app.get(['/index', '/index.html'], authRequired, (req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  return res.sendFile(indexPath);
});

app.get(['/qr', '/qr.html'], authRequired, (req, res) => {
  const qrPath = path.join(__dirname, '..', 'public', 'qr.html');
  return res.sendFile(qrPath);
});

// Protege a página Configure Webhook: exige autenticação (cobre variações de caminho)
app.get([
  '/configure_webhook',
  '/configure_webhook.html',
  '/configure-webhook',
  '/configure-webhook.html'
], authRequired, (req, res) => {
  const cfgPath = path.join(__dirname, '..', 'public', 'configure_webhook.html');
  return res.sendFile(cfgPath);
});
// Captura caminhos com barra final ou subpath e aplica a mesma proteção
app.get(/^\/configure[_-]webhook(?:\.html)?\/?$/, authRequired, (req, res) => {
  const cfgPath = path.join(__dirname, '..', 'public', 'configure_webhook.html');
  return res.sendFile(cfgPath);
});

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'login.html' }));
// Expõe a pasta de configuração (para api_config.json)
app.use('/config', express.static(path.join(__dirname, '..', 'config')));

app.use(morgan('combined'));

// Middleware simples para proteger rotas com uma API Key
function requireApiKey(req, res, next) {
  try {
    const headerKey = req.headers['x-api-key'] || req.headers['x-apiKey'] || req.headers['x_apikey'];
    const queryKey = req.query && (req.query.api_key || req.query.apikey || req.query.key);
    const provided = String(headerKey || queryKey || '').trim();
    if (!API_KEY) {
      // Se nenhuma API_KEY estiver configurada, não bloqueia, apenas segue
      return next();
    }
    if (!provided) {
      return res.status(401).json({ error: 'API key ausente. Envie o cabeçalho x-api-key.' });
    }
    if (provided !== API_KEY) {
      return res.status(403).json({ error: 'API key inválida.' });
    }
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Falha na verificação de API key', details: e?.message || String(e) });
  }
}

// Logger de instância/usuário e de conexão
const { logUserInstance, logConnect } = require('./logger');
const instancedb = require('./instances_db');
instancedb.init();

// Logger simples em arquivo para QR Code
const logsDir = path.join(__dirname, 'logs');
const qrLogFile = path.join(logsDir, 'qr-code.log');
try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir); } catch (_) {}
function appendQrLog(event, payload) {
  try {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${event} ${JSON.stringify(payload)}\n`;
    fs.appendFileSync(qrLogFile, line);
  } catch (err) {
    console.warn('[QR-LOG] Falha ao gravar log:', err.message);
  }
}

// Logger dedicado para vinculação/QR -> usuário
const bindLogFile = path.join(logsDir, 'binding.log');
function appendBindLog(event, payload) {
  try {
    const ts = new Date().toISOString();
    const safe = payload && typeof payload === 'object' ? { ...payload } : { payload };
    if (safe && safe.token) safe.token = '***';
    if (safe && safe.providedToken) safe.providedToken = safe.providedToken ? true : false;
    const line = `[${ts}] ${event} ${JSON.stringify(safe)}\n`;
    fs.appendFileSync(bindLogFile, line);
  } catch (err) {
    console.warn('[BIND-LOG] Falha ao gravar log:', err.message);
  }
}
// Garante criação do arquivo de log de vinculação na inicialização
try {
  if (!fs.existsSync(bindLogFile)) {
    fs.writeFileSync(bindLogFile, '');
  }
  // Escreve um evento inicial para sinalizar disponibilidade do logger
  appendBindLog('INIT', { message: 'binding log ready' });
} catch (_) {}

// Seleção de provider (multi-fornecedora)
let provider;
const providerName = (process.env.PROVIDER || 'zapi').toLowerCase();
try {
  provider = require(path.join(__dirname, 'providers', providerName));
  console.log(`[Provider] Usando adapter: ${provider.name || providerName}`);
} catch (e) {
  console.warn(`[Provider] Adapter "${providerName}" não encontrado. Fallback para Z-API.`);
  provider = require(path.join(__dirname, 'providers', 'zapi'));
}

// Modo manual: desativa criação automática de instância
const MANUAL_INSTANCE_MODE = String(process.env.MANUAL_INSTANCE_MODE || '').toLowerCase() === 'true';

// --- Auth helpers ---
function getTokenFromHeader(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
function getTokenFromCookies(req) {
  try { return req.cookies && req.cookies.auth_token ? String(req.cookies.auth_token) : null; } catch (_) { return null; }
}
function getAuthToken(req) {
  return getTokenFromHeader(req) || getTokenFromCookies(req);
}
function authRequired(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) return res.status(401).json({ error: 'Token ausente' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // Suporte a rotação: tenta validar com segredo antigo
      if (JWT_SECRET_OLD) {
        try { payload = jwt.verify(token, JWT_SECRET_OLD); } catch (_) { /* ignore */ }
      }
      if (!payload) return res.status(401).json({ error: 'Token inválido', details: e.message });
    }
    const user = userdb.findUserById(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuário inválido' });
    if (!user.active) return res.status(403).json({ error: 'Usuário inativo' });
    if (userdb.isExpired(user)) return res.status(403).json({ error: 'Acesso expirado' });
    req.user = { id: user.id, username: user.username, role: user.role };
    // Header informativo para clientes atualizarem token, se validado com segredo antigo
    try {
      if (JWT_SECRET_OLD) {
        const usingOld = (() => { try { jwt.verify(token, JWT_SECRET); return false; } catch (_) { return true; } })();
        if (usingOld) res.setHeader('X-Token-Renew', 'true');
      }
    } catch (_) {}
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido', details: e.message });
  }
}
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso de administrador necessário' });
  }
  next();
}

// --- Sanitização/validação de nomes de instância ---
function sanitizeInstanceName(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 32);
}
function isValidInstanceName(name) {
  // Deve iniciar e terminar com alfanumérico; pode conter hífens no meio; 3-32 chars
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(String(name || ''));
}

// --- Auth routes ---
app.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    try { const { logAuth } = require('./logger'); logAuth('admin.login.request', { ip: req.ip, origin: req.headers.origin, referer: req.headers.referer, protocol: req.protocol, body: { username, password } }); } catch (_) {}
    if (!username || !password) return res.status(400).json({ error: 'Informe username e password' });
    const user = userdb.findUserByUsername(String(username));
    if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Credenciais inválidas' });
    const ok = bcrypt.compareSync(String(password), user.password_hash);
    if (!ok) { try { const { logAuth } = require('./logger'); logAuth('admin.login.fail', { username, reason: 'password_mismatch' }); } catch (_) {} ; return res.status(401).json({ error: 'Credenciais inválidas' }); }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    try { const { logAuth } = require('./logger'); logAuth('admin.login.success', { id: user.id, username: user.username }); } catch (_) {}
    // Set auth cookie and CSRF cookie
    const isHttps = Boolean(req.secure || (req.protocol === 'https'));
    res.cookie('auth_token', token, { httpOnly: true, secure: isHttps, sameSite: 'strict', path: '/' });
    ensureCsrfCookie(req, res);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    try { const { logAuth } = require('./logger'); logAuth('admin.login.error', { message: error.message }); } catch (_) {}
    res.status(500).json({ error: 'Falha no login admin', details: error.message });
  }
});

app.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    try { const { logAuth } = require('./logger'); logAuth('user.login.request', { ip: req.ip, origin: req.headers.origin, referer: req.headers.referer, protocol: req.protocol, body: { username, password } }); } catch (_) {}
    if (!username || !password) return res.status(400).json({ error: 'Informe username e password' });
    const user = userdb.findUserByUsername(String(username));
    if (!user) { try { const { logAuth } = require('./logger'); logAuth('user.login.fail', { username, reason: 'user_not_found' }); } catch (_) {} ; return res.status(401).json({ error: 'Credenciais inválidas' }); }
    const ok = bcrypt.compareSync(String(password), user.password_hash);
    if (!ok) { try { const { logAuth } = require('./logger'); logAuth('user.login.fail', { username, reason: 'password_mismatch' }); } catch (_) {} ; return res.status(401).json({ error: 'Credenciais inválidas' }); }
    if (!user.active) { try { const { logAuth } = require('./logger'); logAuth('user.login.fail', { username, reason: 'user_inactive' }); } catch (_) {} ; return res.status(403).json({ error: 'Usuário inativo' }); }
    if (userdb.isExpired(user)) { try { const { logAuth } = require('./logger'); logAuth('user.login.fail', { username, reason: 'access_expired' }); } catch (_) {} ; return res.status(403).json({ error: 'Acesso expirado' }); }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    try { const { logAuth } = require('./logger'); logAuth('user.login.success', { id: user.id, username: user.username }); } catch (_) {}
    // Set auth cookie and CSRF cookie
    const isHttps = Boolean(req.secure || (req.protocol === 'https'));
    res.cookie('auth_token', token, { httpOnly: true, secure: isHttps, sameSite: 'strict', path: '/' });
    ensureCsrfCookie(req, res);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, expires_at: user.expires_at, credits: Number(user.credits || 0), instance_name: user.instance_name || null } });
  } catch (error) {
    try { const { logAuth } = require('./logger'); logAuth('user.login.error', { message: error.message }); } catch (_) {}
    res.status(500).json({ error: 'Falha no login', details: error.message });
  }
});

// Logout: limpa cookie de autenticação
app.post('/logout', authRequired, (req, res) => {
  try {
    res.clearCookie('auth_token', { path: '/' });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Falha no logout', details: e?.message || String(e) });
  }
});

// --- Admin users CRUD ---
app.get('/admin/users', authRequired, adminRequired, (req, res) => {
  const list = userdb.listUsers();
  res.json({ success: true, users: list });
});

app.post('/admin/users', authRequired, adminRequired, (req, res) => {
  try {
    const { username, password, role = 'user', days = 30, credits = 0 } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Informe username e password' });
    const roleStr = String(role);
    let expires_at = null;
    if (roleStr !== 'admin') {
      const d = Math.min(30, Math.max(1, Number(days || 30)));
      expires_at = Date.now() + d * 24 * 60 * 60 * 1000;
    }
    const password_hash = bcrypt.hashSync(String(password), 10);
    const id = userdb.createUser({ username: String(username), password_hash, role: roleStr, expires_at, credits: Number(credits) || 0 });
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao criar usuário', details: error.message });
  }
});

app.put('/admin/users/:id', authRequired, adminRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { username, password, role, days, active, credits } = req.body || {};
    const curr = userdb.findUserById(id);
    const fields = {};
    if (typeof username === 'string' && username.trim()) {
      const exists = userdb.findUserByUsername(String(username));
      if (exists && Number(exists.id) !== id) {
        return res.status(400).json({ error: 'Usuário já existe' });
      }
      fields.username = String(username);
    }
    if (typeof role === 'string') fields.role = role;
    if (typeof active !== 'undefined') fields.active = Number(Boolean(active));
    if (typeof password === 'string' && password.trim()) fields.password_hash = bcrypt.hashSync(password, 10);
    if (typeof credits !== 'undefined') fields.credits = Number(credits);
    if (typeof days !== 'undefined') {
      const effectiveRole = typeof role === 'string' ? String(role) : String(curr?.role || 'user');
      if (effectiveRole === 'admin') {
        fields.expires_at = null; // admin sem expiração
      } else {
        const d = Math.min(30, Math.max(1, Number(days)));
        fields.expires_at = Date.now() + d * 24 * 60 * 60 * 1000;
      }
    }
    const updated = userdb.updateUser(id, fields);
    res.json({ success: true, user: updated });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao atualizar usuário', details: error.message });
  }
});

// Transferência de créditos: debita do admin atual e credita no usuário alvo
app.post('/admin/users/:id/transfer-credits', authRequired, adminRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Informe um valor positivo' });
    }
    const admin = userdb.findUserById(req.user.id);
    const target = userdb.findUserById(id);
    if (!target) return res.status(404).json({ error: 'Usuário alvo não encontrado' });
    if (String(target.role) === 'admin') {
      return res.status(400).json({ error: 'Transferência não permitida para administradores' });
    }
    const adminCredits = Number(admin?.credits || 0);
    if (adminCredits < amount) {
      return res.status(402).json({ error: 'Créditos insuficientes no admin' });
    }
    // Debita do admin e credita no usuário
    userdb.updateUser(admin.id, { credits: adminCredits - amount });
    const userCredits = Number(target?.credits || 0);
    const updated = userdb.updateUser(target.id, { credits: userCredits + amount });
    res.json({ success: true, transfer: { amount }, admin: { id: admin.id, credits: adminCredits - amount }, user: { id: updated.id, credits: updated.credits } });
  } catch (error) {
    res.status(500).json({ error: 'Falha na transferência de créditos', details: error.message });
  }
});

// Adicionar dias de validade ao usuário (extensão relativa)
app.post('/admin/users/:id/add-days', authRequired, adminRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const daysReq = Number(req.body?.days || 0);
    const d = Math.min(30, Math.max(1, daysReq));
    const target = userdb.findUserById(id);
    if (!target) return res.status(404).json({ error: 'Usuário alvo não encontrado' });
    if (String(target.role) === 'admin') {
      return res.status(400).json({ error: 'Admins não possuem validade' });
    }
    const now = Date.now();
    const currentExp = Number(target.expires_at || 0);
    const base = currentExp && currentExp > now ? currentExp : now;
    const nextExp = base + d * 24 * 60 * 60 * 1000;
    const updated = userdb.updateUser(target.id, { expires_at: nextExp });
    res.json({ success: true, user: { id: updated.id, username: updated.username, expires_at: updated.expires_at } });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao adicionar dias', details: error.message });
  }
});

app.delete('/admin/users/:id', authRequired, adminRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = userdb.findUserById(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (String(target.role) === 'admin') {
      const admins = userdb.listUsers().filter(u => String(u.role) === 'admin').length;
      if (admins <= 1) {
        return res.status(400).json({ error: 'Não é permitido remover o último administrador' });
      }
      // Caso haja 2 ou mais admins, permitir a remoção
    }
    userdb.deleteUser(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao remover usuário', details: error.message });
  }
});

app.get('/admin/usage', authRequired, adminRequired, (req, res) => {
  const list = userdb.listUsers().map(u => ({ id: u.id, username: u.username, message_count: u.message_count, expires_at: u.expires_at, active: u.active }));
  res.json({ success: true, users: list });
});

// Perfil do usuário atual (inclui créditos)
app.get('/me', authRequired, (req, res) => {
  try {
    const u = userdb.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ success: true, user: { id: u.id, username: u.username, role: u.role, credits: Number(u.credits || 0), expires_at: u.expires_at, instance_name: u.instance_name || null } });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao obter perfil', details: error.message });
  }
});

// Helpers: extrair possível token da resposta do provider
function extractInstanceTokenFromProvider(data) {
  const candidates = [
    data?.token,
    data?.instance?.token,
    data?.data?.token,
    data?.raw?.token,
    data?.raw?.data?.token,
    data?.raw?.instance?.token,
    data?.session_token,
    data?.bearer_token,
    data?.api_token,
    data?.accessToken,
    data?.access_token
  ].filter((v) => typeof v === 'string' && v.trim());
  return candidates.length ? candidates[0] : '';
}

// Tenta extrair nome do dispositivo do payload do provider
function extractDeviceNameFromProvider(data) {
  const candidates = [
    data?.device_name,
    data?.instance?.device_name,
    data?.raw?.device_name,
    data?.raw?.instance?.device_name,
    data?.status?.device_name,
    data?.phone_device?.name,
    data?.instance?.device?.name,
    data?.raw?.instance?.device?.name,
    data?.deviceName,
  ].filter((v) => typeof v === 'string' && v.trim());
  return candidates.length ? candidates[0] : null;
}

// Extrai número do WhatsApp (digits only) de várias fontes comuns
function extractPhoneNumberFromProvider(data) {
  const candidates = [
    data?.phone,
    data?.instance?.phone,
    data?.status?.phone,
    data?.raw?.phone,
    data?.raw?.instance?.phone,
    data?.raw?.data?.phone,
    data?.instance?.me?.id,
    data?.raw?.instance?.me?.id,
    data?.wid,
    data?.instance?.wid,
    data?.raw?.instance?.wid,
  ].filter((v) => typeof v === 'string' && v.trim());
  if (!candidates.length) return null;
  // Normaliza: extrai apenas dígitos
  const num = candidates[0].replace(/\D/g, '');
  return num || null;
}

// Garante que o usuário tenha instância e token salvos; cria/resolve quando necessário
async function ensureUserInstanceAndToken(u) {
  if (!u) return u;
  try {
    // Em modo manual, não criar ou resolver automaticamente
    if (MANUAL_INSTANCE_MODE) {
      try { logUserInstance('ensureUserInstance.manual_mode_skip', { user_id: u.id, instance_name: u.instance_name || null }); } catch (_) {}
      return u;
    }
    let changed = false;
    let name = String(u.instance_name || '').trim();
    if (!name) {
      const base = (u.username || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      name = `wa-${base}-${u.id}`;
      if (provider.createInstance) {
        const created = await provider.createInstance({ instance: name, options: {} });
        const token = extractInstanceTokenFromProvider(created);
        const fields = { instance_name: name };
        if (token) fields.instance_token = token;
        userdb.updateUser(u.id, fields);
        instore.setForUser(u.id, { instance_name: name, instance_token: token, provider: provider.name || 'uazapi', status: created?.status || null, meta: { created_raw_keys: Object.keys(created || {}) } });
        changed = true;
        try { logUserInstance('ensureUserInstance.created', { user_id: u.id, instance_name: name, token_saved: Boolean(token), provider: provider.name || 'uazapi' }); } catch (_) {}
      } else {
        userdb.updateUser(u.id, { instance_name: name });
        instore.updateForUser(u.id, { instance_name: name, provider: provider.name || 'uazapi' });
        changed = true;
        try { logUserInstance('ensureUserInstance.no_create_support', { user_id: u.id, instance_name: name, provider: provider.name || 'uazapi' }); } catch (_) {}
      }
    }
    // Se não há token salvo, tentar resolver via provider usando rotas admin
    const current = changed ? userdb.findUserById(u.id) : u;
    if (!current.instance_token && provider.resolveInstanceToken) {
      try {
        const resolved = await provider.resolveInstanceToken(name || current.instance_name);
        if (resolved) {
          userdb.updateUser(u.id, { instance_token: resolved });
          instore.updateForUser(u.id, { instance_token: resolved, provider: provider.name || 'uazapi' });
          try { logUserInstance('ensureUserInstance.token_resolved', { user_id: u.id, instance_name: name || current.instance_name }); } catch (_) {}
          return userdb.findUserById(u.id);
        }
      } catch (_) {}
    }
    return changed ? userdb.findUserById(u.id) : u;
  } catch (e) {
    try { logUserInstance('ensureUserInstance.error', { user_id: u?.id || null, message: e.message }); } catch (_) {}
    return u;
  }
}

// Vincula/garante instância exclusiva por usuário
app.post('/user/ensure-instance', authRequired, async (req, res) => {
  try {
    const u = userdb.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    try { appendBindLog('ENSURE_INSTANCE_REQUEST', { user_id: u.id, has_instance: Boolean(u.instance_name), body_keys: Object.keys(req.body || {}) }); } catch (_) {}
    if (MANUAL_INSTANCE_MODE) {
      // Não criar automaticamente; apenas reportar estado atual
      try { logUserInstance('user.ensure_instance.manual_mode', { user_id: u.id, instance_name: u.instance_name || null, token_saved: Boolean(u.instance_token) }); } catch (_) {}
      return res.json({
        success: true,
        instance_name: u.instance_name || null,
        token_saved: Boolean(u.instance_token),
        note: 'Modo manual ativo: crie/conecte sua instância na aba QR.'
      });
    }
    let name = String(u.instance_name || '').trim();
    if (!name) {
      // Gera nome de instância determinístico por usuário
      const base = (u.username || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      name = `wa-${base}-${u.id}`;
      if (!provider.createInstance) {
        try { logUserInstance('user.ensure_instance.no_create_support', { user_id: u.id, instance_name: name, provider: provider.name || 'uazapi' }); } catch (_) {}
        return res.status(400).json({ error: 'Provider atual não suporta criação de instância' });
      }
      try { appendBindLog('ENSURE_INSTANCE_CREATE_ATTEMPT', { user_id: u.id, instance_name: name }); } catch (_) {}
      const created = await provider.createInstance({ instance: name, options: {} });
      const token = extractInstanceTokenFromProvider(created);
      const fields = { instance_name: name };
      if (token) fields.instance_token = token;
      userdb.updateUser(u.id, fields);
      instore.setForUser(u.id, { instance_name: name, instance_token: token, provider: provider.name || 'uazapi', status: created?.status || null, meta: { created_raw_keys: Object.keys(created || {}) } });
      try { appendBindLog('ENSURE_INSTANCE_CREATED', { user_id: u.id, instance_name: name, token_saved: Boolean(token) }); } catch (_) {}
      // Se não veio token no create, tenta resolver via rotas admin e persiste
      if (!token && provider.resolveInstanceToken) {
        try {
          const resolved = await provider.resolveInstanceToken(name);
          if (resolved) {
            userdb.updateUser(u.id, { instance_token: resolved });
            instore.updateForUser(u.id, { instance_token: resolved, provider: provider.name || 'uazapi' });
            try { logUserInstance('user.ensure_instance.token_resolved', { user_id: u.id, instance_name: name }); } catch (_) {}
            try { appendBindLog('ENSURE_INSTANCE_TOKEN_RESOLVED', { user_id: u.id, instance_name: name }); } catch (_) {}
          }
        } catch (_) {}
      }
      try { logUserInstance('user.ensure_instance.created', { user_id: u.id, instance_name: name, token_saved: Boolean(token) }); } catch (_) {}
      return res.json({ success: true, instance_name: name, token_saved: Boolean(token), raw: created });
    }
    // Já possui instância
    const rec = instore.updateForUser(u.id, { instance_name: name, provider: provider.name || 'uazapi' });
    // Se não há token salvo, tenta resolver e persiste imediatamente
    if (!u.instance_token && provider.resolveInstanceToken) {
      try {
        const resolved = await provider.resolveInstanceToken(name);
        if (resolved) {
          userdb.updateUser(u.id, { instance_token: resolved });
          instore.updateForUser(u.id, { instance_token: resolved, provider: provider.name || 'uazapi' });
          try { logUserInstance('user.ensure_instance.token_resolved', { user_id: u.id, instance_name: name }); } catch (_) {}
          try { appendBindLog('ENSURE_INSTANCE_TOKEN_RESOLVED', { user_id: u.id, instance_name: name }); } catch (_) {}
        }
      } catch (_) {}
    }
    try { logUserInstance('user.ensure_instance.already_has_instance', { user_id: u.id, instance_name: name, stored: Boolean(rec), token_saved: Boolean(userdb.findUserById(u.id).instance_token) }); } catch (_) {}
    return res.json({ success: true, instance_name: name, stored: Boolean(rec), token_saved: Boolean(userdb.findUserById(u.id).instance_token) });
  } catch (error) {
    try { logUserInstance('user.ensure_instance.error', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    try { appendBindLog('ENSURE_INSTANCE_ERROR', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    console.error('[user/ensure-instance] erro:', error.message);
    res.status(500).json({ error: 'Falha ao garantir instância do usuário', details: error.message });
  }
});

// Vincula uma instância existente ao usuário atual e tenta salvar o token
app.post('/user/bind-instance', authRequired, async (req, res) => {
  try {
    const u = userdb.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    const nameRaw = (req.body && (req.body.instance || req.body.name)) ? String(req.body.instance || req.body.name).trim() : '';
    const name = nameRaw.replace(/\s+/g, '');
    const providedToken = (req.body && req.body.token) ? String(req.body.token).trim() : '';
    if (!name) return res.status(400).json({ error: 'Informe o nome da instância em "instance" ou "name"' });
    // Validação de nome: letras, números, hífen e underscore; tamanho 3–64
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(name)) {
      return res.status(400).json({ error: 'Nome de instância inválido. Use apenas letras, números, "-" ou "_" (3–64 caracteres).' });
    }

    try { logUserInstance('user.bind_instance.request', { user_id: u.id, instance_name: name, provided_token: Boolean(providedToken) }); } catch (_) {}
    try { appendBindLog('BIND_REQUEST', { user_id: u.id, instance_name: name, providedToken: Boolean(providedToken) }); } catch (_) {}

    // Atualiza nome da instância vinculado ao usuário
    userdb.updateUser(u.id, { instance_name: name });
    instore.updateForUser(u.id, { instance_name: name, provider: provider.name || 'uazapi' });

    let finalToken = providedToken;
    // Se token não foi informado, tenta resolver via provider
    if (!finalToken && provider.resolveInstanceToken) {
      try {
        finalToken = await provider.resolveInstanceToken(name);
        if (finalToken) {
          try { logUserInstance('user.bind_instance.token_resolved', { user_id: u.id, instance_name: name }); } catch (_) {}
          try { appendBindLog('BIND_TOKEN_RESOLVED', { user_id: u.id, instance_name: name }); } catch (_) {}
        }
      } catch (_) {}
    }

    if (finalToken) {
      userdb.updateUser(u.id, { instance_token: finalToken });
      instore.updateForUser(u.id, { instance_token: finalToken, provider: provider.name || 'uazapi' });
    }

    const updated = userdb.findUserById(u.id);
    try { logUserInstance('user.bind_instance.updated', { user_id: u.id, instance_name: updated.instance_name, token_saved: Boolean(updated.instance_token) }); } catch (_) {}
    try { appendBindLog('BIND_UPDATED', { user_id: u.id, instance_name: updated.instance_name, token_saved: Boolean(updated.instance_token) }); } catch (_) {}
    return res.json({
      success: true,
      instance_name: updated.instance_name,
      token_saved: Boolean(updated.instance_token),
    });
  } catch (error) {
    try { logUserInstance('user.bind_instance.error', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    try { appendBindLog('BIND_ERROR', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    console.error('[user/bind-instance] erro:', error.message);
    res.status(500).json({ error: 'Falha ao vincular instância ao usuário', details: error.message });
  }
});

// Status da instância do usuário (usa token salvo quando disponível)
app.get('/user/instance-status', authRequired, async (req, res) => {
  try {
    const u = userdb.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!u.instance_name) return res.status(400).json({ error: 'Instância não vinculada ao usuário' });
    if (!provider.getInstanceStatus) {
      return res.status(400).json({ error: 'Provider atual não suporta status de instância' });
    }
    // Se não há token salvo, tentar resolver e persistir
    let token = u.instance_token || undefined;
    if (!token && provider.resolveInstanceToken) {
      try {
        const resolved = await provider.resolveInstanceToken(u.instance_name);
        if (resolved) {
          token = resolved;
          userdb.updateUser(u.id, { instance_token: resolved });
          instore.updateForUser(u.id, { instance_token: resolved, provider: provider.name || 'uazapi' });
          try { logUserInstance('user.instance_status.token_resolved', { user_id: u.id, instance_name: u.instance_name }); } catch (_) {}
        }
      } catch (_) {}
    }
    const data = await provider.getInstanceStatus({ instance: u.instance_name, tokenOverride: token });
    const status = data?.status || {};
    const info = {
      connected: Boolean(status?.connected || data?.connected),
      loggedIn: Boolean(status?.loggedIn || data?.loggedIn),
      paircode: data?.instance?.paircode || status?.paircode || data?.paircode || null,
      qrcode: data?.instance?.qrcode || status?.qrcode || data?.qrcode || null,
      deviceName: extractDeviceNameFromProvider(data),
      phoneNumber: extractPhoneNumberFromProvider(data),
      connectedAt: (status?.connected_at || data?.connected_at || null),
    };
    try { logUserInstance('user.instance_status.provider_status', { user_id: u.id, instance_name: u.instance_name, connected: info.connected, loggedIn: info.loggedIn, has_qr: Boolean(info.qrcode) }); } catch (_) {}
    // Persistir status e token (se mudou) no store
    const tokenPersist = token ? { instance_token: token } : {};
    instore.updateForUser(u.id, { instance_name: u.instance_name, provider: provider.name || 'uazapi', status: info, connected: info.connected, ...tokenPersist });

    // Persistência adicional: arquivo por usuário e "tabela" de instâncias
    try {
      const instancesDb = require(path.join(__dirname, 'instances_db'));
      instancesDb.init();
      const deviceName = extractDeviceNameFromProvider(data);
      const connectedAt = (data?.connected_at || status?.connected_at || new Date().toISOString());
      const instanceId = u.instance_name;
      const state = info.connected ? 'connected' : 'disconnected';
      try { logUserInstance('user.instance_status.persist_attempt', { user_id: u.id, instance_id: instanceId, token_saved: Boolean(token), state }); } catch (_) {}
      // Upsert em tabela JSON
      instancesDb.upsertByUserId({
        user_id: u.id,
        instance_id: instanceId,
        token: token || null,
        device_name: deviceName || null,
        status: state,
        connected_at: connectedAt,
      });
      try { logUserInstance('user.instance_status.persist_upsert_ok', { user_id: u.id }); } catch (_) {}
      // Grava arquivo /instances/{user_id}.json
      try {
        const outDir = path.join(__dirname, '..', 'instances');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const payload = {
          user_id: String(u.id),
          email: String(u.username || ''),
          instance_data: {
            instanceId: String(instanceId || ''),
            token: token || '',
            connected_at: connectedAt,
            device_name: deviceName || null,
            status: state,
          }
        };
        const outPath = path.join(outDir, `${u.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
        try { logUserInstance('user.instance_status.persist_file_ok', { user_id: u.id, out_path: outPath }); } catch (_) {}
      } catch (e) {
        console.warn('[persist-instance] falha ao gravar arquivo por usuário:', e.message);
        try { logUserInstance('user.instance_status.persist_file_error', { user_id: u.id, message: e.message }); } catch (_) {}
      }
    } catch (e) {
      // Não interrompe a resposta; apenas loga
      console.warn('[persist-instance] erro:', e.message);
      try { logUserInstance('user.instance_status.persist_error', { user_id: u.id, message: e.message }); } catch (_) {}
    }
    res.json({ success: true, instance_name: u.instance_name, status: info, raw: data });
  } catch (error) {
    try { logUserInstance('user.instance_status.error', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    console.error('[user/instance-status] erro:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao obter status da instância do usuário',
      details: error.response ? error.response.data : error.message
    });
  }
});

// --- ENDPOINTS AUTENTICADOS: Conectar instância do usuário e obter QR ---
app.post('/user/connect-instance', authRequired, async (req, res) => {
  try {
    const u = userdb.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    let name = String(u.instance_name || '').trim();
    let token = String(u.instance_token || '').trim() || undefined;
    try {
      appendBindLog('CONNECT_REQUEST', { user_id: u.id, instance_name: name || null, has_token: Boolean(token), body_keys: Object.keys(req.body || {}) });
      logConnect('CONNECT_REQUEST', { user_id: u.id, instance_name: name || null, has_token: Boolean(token), body_keys: Object.keys(req.body || {}) });
    } catch (_) {}

    // Criar instância apenas sob demanda (clique do usuário)
    if (!name) {
      if (!provider.createInstance) return res.status(400).json({ error: 'Provider atual não suporta criação de instância' });
      const base = (u.username || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      name = `wa-${base}-${u.id}`;
      try { appendBindLog('CONNECT_CREATE_ATTEMPT', { user_id: u.id, instance_name: name }); logConnect('CONNECT_CREATE_ATTEMPT', { user_id: u.id, instance_name: name }); } catch (_) {}
      const created = await provider.createInstance({ instance: name, options: {} });
      try { logConnect('CONNECT_CREATE_RESULT', { user_id: u.id, instance_name: name, created_keys: Object.keys(created || {}), status: created?.status || null }); } catch (_) {}
      token = token || extractInstanceTokenFromProvider(created) || undefined;
      const fields = { instance_name: name };
      if (token) fields.instance_token = token;
      userdb.updateUser(u.id, fields);
      instore.setForUser(u.id, { instance_name: name, instance_token: token, provider: provider.name || 'uazapi', status: created?.status || null });
      try { logUserInstance('user.connect_instance.created', { user_id: u.id, instance_name: name, token_saved: Boolean(token) }); } catch (_) {}
    } else if (!token && provider.resolveInstanceToken) {
      try {
        token = await provider.resolveInstanceToken(name) || undefined;
        if (token) {
          userdb.updateUser(u.id, { instance_token: token });
          instore.updateForUser(u.id, { instance_token: token, provider: provider.name || 'uazapi' });
          try { logUserInstance('user.connect_instance.token_resolved', { user_id: u.id, instance_name: name }); } catch (_) {}
          try { appendBindLog('CONNECT_TOKEN_RESOLVED', { user_id: u.id, instance_name: name }); logConnect('CONNECT_TOKEN_RESOLVED', { user_id: u.id, instance_name: name }); } catch (_) {}
        }
      } catch (_) {}
    }

    // Inicia conexão
    const phone = (req.body && req.body.phone) ? String(req.body.phone).replace(/\D/g, '') : undefined;
    let connectResp = null;
    if (provider.connectInstance) {
      try { logConnect('CONNECT_CALL', { user_id: u.id, instance: name, has_token: Boolean(token), phone }); } catch (_) {}
      connectResp = await provider.connectInstance({ instance: name, tokenOverride: token, phone });
      try {
        const keys = connectResp && typeof connectResp === 'object' ? Object.keys(connectResp) : [];
        logConnect('CONNECT_RESP_SUMMARY', { user_id: u.id, instance: name, resp_keys: keys });
      } catch (_) {}
    }

    // QR direto do retorno da conexão
    const qrCandidates = [
      connectResp?.qrCode, connectResp?.qrcode, connectResp?.qr, connectResp?.base64,
      connectResp?.info?.qrCode, connectResp?.info?.qrcode, connectResp?.info?.qr, connectResp?.info?.base64,
      connectResp?.status?.qrCode, connectResp?.status?.qrcode, connectResp?.status?.qr, connectResp?.status?.base64,
    ].filter(v => typeof v === 'string' && v.trim());
    const urlCandidates = [connectResp?.url, connectResp?.info?.url, connectResp?.status?.url].filter(v => typeof v === 'string' && v.trim());
    if (qrCandidates.length) { try { appendBindLog('CONNECT_QR_RETURNED', { user_id: u.id, instance: name, format: 'base64', len: qrCandidates[0]?.length || 0 }); logConnect('CONNECT_QR_RETURNED', { user_id: u.id, instance: name, format: 'base64' }); } catch (_) {} return res.json({ success: true, instance: name, format: 'base64', qr: qrCandidates[0], raw: connectResp }); }
    if (urlCandidates.length) { try { appendBindLog('CONNECT_QR_URL', { user_id: u.id, instance: name, url: urlCandidates[0] }); logConnect('CONNECT_QR_URL', { user_id: u.id, instance: name, url: urlCandidates[0] }); } catch (_) {} return res.json({ success: true, instance: name, format: 'url', url: urlCandidates[0], raw: connectResp }); }

    // Se não veio QR, tenta forçar via getQrCode
    if (provider.getQrCode) {
      try {
        try { logConnect('CONNECT_FORCE_QR_ATTEMPT', { user_id: u.id, instance: name }); } catch (_) {}
        const qrData = await provider.getQrCode({ force: true, instance: name, tokenOverride: token });
        const qrs = [qrData?.qrCode, qrData?.qrcode, qrData?.qr, qrData?.base64, qrData?.info?.qrCode, qrData?.info?.qrcode, qrData?.info?.qr, qrData?.info?.base64, qrData?.status?.qrCode, qrData?.status?.qrcode, qrData?.status?.qr, qrData?.status?.base64].filter(v => typeof v === 'string' && v.trim());
        const urls = [qrData?.url, qrData?.info?.url, qrData?.status?.url].filter(v => typeof v === 'string' && v.trim());
        if (qrs.length) { try { appendBindLog('CONNECT_QR_FORCED', { user_id: u.id, instance: name, format: 'base64', len: qrs[0]?.length || 0 }); logConnect('CONNECT_QR_FORCED', { user_id: u.id, instance: name, format: 'base64' }); } catch (_) {} return res.json({ success: true, instance: name, format: 'base64', qr: qrs[0], raw: qrData }); }
        if (urls.length) { try { appendBindLog('CONNECT_QR_FORCED_URL', { user_id: u.id, instance: name, url: urls[0] }); logConnect('CONNECT_QR_FORCED_URL', { user_id: u.id, instance: name, url: urls[0] }); } catch (_) {} return res.json({ success: true, instance: name, format: 'url', url: urls[0], raw: qrData }); }
      } catch (e) {
        try { logUserInstance('user.connect_instance.qr_force_error', { user_id: u.id, message: e.message }); } catch (_) {}
        try { appendBindLog('CONNECT_QR_FORCE_ERROR', { user_id: u.id, message: e.message }); logConnect('CONNECT_QR_FORCE_ERROR', { user_id: u.id, instance: name, message: e.message, status: e?.response?.status, data: e?.response?.data }); } catch (_) {}
        return res.json({ success: true, instance: name, message: 'Conexão iniciada. QR indisponível no momento.' });
      }
    }
    try { appendBindLog('CONNECT_STARTED_NO_QR', { user_id: u.id, instance: name }); logConnect('CONNECT_STARTED_NO_QR', { user_id: u.id, instance: name }); } catch (_) {}
    return res.json({ success: true, instance: name, message: 'Conexão iniciada.' });
  } catch (error) {
    try { logUserInstance('user.connect_instance.error', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    try { appendBindLog('CONNECT_ERROR', { user_id: req.user?.id || null, message: error.message }); logConnect('CONNECT_ERROR', { user_id: req.user?.id || null, message: error.message, status: error?.response?.status, data: error?.response?.data }); } catch (_) {}
    console.error('[user/connect-instance] erro:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({ error: 'Falha ao conectar instância do usuário', details: error.response ? error.response.data : error.message });
  }
});

app.get('/user/get-qr-code', authRequired, async (req, res) => {
  try {
    if (!provider.getQrCode) return res.status(400).json({ error: 'Provider atual não suporta QR code' });
    const u = userdb.findUserById(req.user.id);
    if (!u || !u.instance_name) return res.status(400).json({ error: 'Instância do usuário não encontrada' });
    try { appendBindLog('GET_QR_REQUEST', { user_id: u.id, instance_name: u.instance_name, force: String(req.query?.force || 'false') }); } catch (_) {}
    let token = u.instance_token || undefined;
    if (!token && provider.resolveInstanceToken) {
      try { token = await provider.resolveInstanceToken(u.instance_name); } catch (_) {}
      if (token) { userdb.updateUser(u.id, { instance_token: token }); instore.updateForUser(u.id, { instance_token: token, provider: provider.name || 'uazapi' }); }
    }
    const force = String(req.query?.force || 'false').toLowerCase() === 'true';
    const data = await provider.getQrCode({ instance: u.instance_name, tokenOverride: token, force });
    const qrs = [data?.qrCode, data?.qrcode, data?.qr, data?.base64, data?.info?.qrCode, data?.info?.qrcode, data?.info?.qr, data?.info?.base64, data?.status?.qrCode, data?.status?.qrcode, data?.status?.qr, data?.status?.base64].filter(v => typeof v === 'string' && v.trim());
    const urls = [data?.url, data?.info?.url, data?.status?.url].filter(v => typeof v === 'string' && v.trim());
    if (qrs.length) { try { appendBindLog('GET_QR_RETURNED', { user_id: u.id, instance: u.instance_name, format: 'base64', len: qrs[0]?.length || 0 }); } catch (_) {} return res.json({ success: true, format: 'base64', qr: qrs[0], raw: data }); }
    if (urls.length) { try { appendBindLog('GET_QR_URL', { user_id: u.id, instance: u.instance_name, url: urls[0] }); } catch (_) {} return res.json({ success: true, format: 'url', url: urls[0], raw: data }); }
    try { appendBindLog('GET_QR_NO_QR', { user_id: u.id, instance: u.instance_name }); } catch (_) {}
    return res.json({ success: true, message: 'Sem QR detectável', raw: data });
  } catch (error) {
    console.error('[user/get-qr-code] erro:', error.response?.data || error.message);
    try { appendBindLog('GET_QR_ERROR', { user_id: req.user?.id || null, message: error.message }); } catch (_) {}
    res.status(error.response ? error.response.status : 500).json({ error: 'Erro ao obter QR do usuário', details: error.response ? error.response.data : error.message });
  }
});

// --- NOVO ENDPOINT: Enviar Mensagem de Texto Simples ---
// Adiciona logs extras para normalização do telefone
app.post('/send-simple-text', authRequired, async (req, res) => {
  const { phone, message } = req.body;
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  // Validações básicas
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 16) {
    return res.status(400).json({ error: 'Telefone inválido. Informe somente números (10–16 dígitos).' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Mensagem inválida. Informe texto não vazio.' });
  }
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    console.log('[send-simple-text] Normalized phone:', normalizedPhone);
    console.log('[send-simple-text] Message length:', message ? message.length : 0);
    console.log('Payload recebido do frontend (Texto Simples):', JSON.stringify(req.body, null, 2));
  }
  try {
    // Créditos: somente usuários não-admin precisam ter créditos suficientes
    if (String(req.user.role) !== 'admin') {
      const credits = userdb.getCredits(req.user.id);
      if (credits < 2) {
        return res.status(402).json({ error: 'Sem créditos disponíveis (mínimo 2 por envio)' });
      }
    }
    let u = userdb.findUserById(req.user.id);
    u = await ensureUserInstanceAndToken(u);
    let tokenOverride = u?.instance_token || undefined;
    // Se não houver token salvo mas existir nome de instância, tentar resolver via provider
    if (!tokenOverride && u?.instance_name && provider.resolveInstanceToken) {
      try {
        tokenOverride = await provider.resolveInstanceToken(u.instance_name);
        if (tokenOverride) {
          userdb.updateUser(u.id, { instance_token: tokenOverride });
          instore.updateForUser(u.id, { instance_token: tokenOverride, provider: provider.name || 'uazapi' });
        }
      } catch (_) {}
    }
    // Se ainda não houver token, evitar fallback global e retornar erro claro
    if (!tokenOverride) {
      return res.status(400).json({ error: 'Token da instância não disponível. Abra a aba QR e conecte o WhatsApp para gerar o token da instância.' });
    }
    const data = await provider.sendSimpleText({ phone: normalizedPhone, message, tokenOverride });
    try {
      userdb.incrementMessageCount(req.user.id, 1);
      if (String(req.user.role) !== 'admin') userdb.addCredits(req.user.id, -2);
    } catch (_) {}
    res.json(data);
  } catch (error) {
    console.error('[send-simple-text] Erro ao enviar via provider:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao enviar texto via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});

// Endpoint para servir o logo de forma same-origin (evita bloqueios de CORP/ORB)
app.get('/assets/logo-unlock-center', async (req, res) => {
  const fallbackImg = 'https://raw.githubusercontent.com/ChristoferMayon/images/2e372f3644d8e31ebcf4af2d1a2b7c70af0ae478/WhatsApp%20Image%202025-06-27%20at%2021.56.04.jpeg';
  // Permite sobrescrever a origem via ?url=...
  const sourceUrl = (req.query.url || 'https://ibb.co/HpM9Qb7Z').toString();
  try {
    let directImgUrl = sourceUrl;
    // Se for uma página do ImgBB, extrair a imagem direta via meta og:image
    if (/^https?:\/\/ibb\.co\//i.test(sourceUrl)) {
      const page = await axios.get(sourceUrl, { responseType: 'text' });
      const html = page.data || '';
      const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (match && match[1]) {
        directImgUrl = match[1];
      } else {
        console.warn('[assets/logo-unlock-center] Não foi possível extrair og:image do ImgBB, usando fallback.');
        directImgUrl = fallbackImg;
      }
    }

    const response = await axios.get(directImgUrl, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('[assets/logo-unlock-center] Falha ao obter imagem:', err.message);
    try {
      // Último fallback
      const response = await axios.get(fallbackImg, { responseType: 'arraybuffer' });
      const contentType = response.headers['content-type'] || 'image/png';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(response.data));
    } catch (err2) {
      console.error('[assets/logo-unlock-center] Fallback também falhou:', err2.message);
      res.status(502).send('Falha ao obter logo');
    }
  }
});
// --- FIM DO NOVO ENDPOINT ---


// Endpoint para enviar mensagens de carrossel via Z-API
app.post('/send-carousel-message', authRequired, async (req, res) => {
  const { phone, message, carousel, delayMessage } = req.body;
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 16) {
    return res.status(400).json({ error: 'Telefone inválido. Informe somente números (10–16 dígitos).' });
  }
  if (!Array.isArray(carousel) || carousel.length === 0) {
    return res.status(400).json({ error: 'Carousel vazio ou inválido.' });
  }
  // Sanitização e validação de botões e URLs
  const isValidUrl = (u) => {
    try {
      const x = new URL(String(u));
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch (_) { return false; }
  };

  const elements = carousel.map(card => {
    const buttons = (card.buttons || []).map(btn => {
      const label = String(btn.label || '').trim();
      if (!label) return null;
      const out = { text: label };
      if (btn.type === 'URL') {
        const url = String(btn.url || '').trim();
        if (!isValidUrl(url)) return null;
        out.type = 'url';
        out.url = url;
      } else if (btn.type === 'REPLY') {
        out.type = 'reply';
      } else if (btn.type === 'CALL') {
        const p = String(btn.phone || '').replace(/\D/g, '');
        if (!p || p.length < 10 || p.length > 16) return null;
        out.type = 'call';
        out.phone = p;
      } else {
        return null;
      }
      return out;
    }).filter(Boolean);
    const text = String(card.text || '').trim();
    const media = String(card.image || '').trim();
    return { media, text, buttons };
  });
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    console.log('[send-carousel-message] Normalized phone:', normalizedPhone);
    console.log('[send-carousel-message] Elements count:', elements.length);
  }

  try {
    // Créditos: somente usuários não-admin precisam ter créditos suficientes
    if (String(req.user.role) !== 'admin') {
      const credits = userdb.getCredits(req.user.id);
      if (credits < 2) {
        return res.status(402).json({ error: 'Sem créditos disponíveis (mínimo 2 por envio)' });
      }
    }
    let u = userdb.findUserById(req.user.id);
    // Em modo manual, jamais criar/garantir automaticamente; usar exatamente o que está vinculado
    if (!MANUAL_INSTANCE_MODE) {
      u = await ensureUserInstanceAndToken(u);
    } else {
      try { logUserInstance('send_carousel.manual_mode', { user_id: u?.id || null, instance_name: u?.instance_name || null, token_saved: Boolean(u?.instance_token) }); } catch (_) {}
    }
    let tokenOverride = u?.instance_token || undefined;
    // Se não houver token salvo mas existir nome de instância, tentar resolver via provider
    if (!tokenOverride && u?.instance_name && provider.resolveInstanceToken) {
      try {
        tokenOverride = await provider.resolveInstanceToken(u.instance_name);
        if (tokenOverride) {
          userdb.updateUser(u.id, { instance_token: tokenOverride });
          instore.updateForUser(u.id, { instance_token: tokenOverride, provider: provider.name || 'uazapi' });
        }
      } catch (_) {}
    }
    // Se ainda não houver token, evitar fallback global e retornar erro claro
    if (!tokenOverride) {
      return res.status(400).json({ error: 'Token da instância não disponível. Abra a aba QR e conecte o WhatsApp para gerar o token da instância.' });
    }
    const data = await provider.sendCarouselMessage({ phone: normalizedPhone, elements, message, delayMessage, tokenOverride });
    try {
      userdb.incrementMessageCount(req.user.id, 1);
      if (String(req.user.role) !== 'admin') userdb.addCredits(req.user.id, -2);
    } catch (_) {}
    res.json(data);
  } catch (error) {
    console.error('[send-carousel-message] Erro via provider:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao enviar carrossel via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});

// --- NOVO: Webhook de Status de Mensagem ---
// Recebe callbacks de status da Z-API (SENT, RECEIVED, READ, etc.)
// IMPORTANTE: a Z-API precisa apontar para uma URL pública deste endpoint
app.post('/webhook/message-status', (req, res) => {
    console.log('\n[Webhook:MessageStatus] Callback recebido da Z-API:');
    console.log('Status:', req.body.status);
    console.log('IDs:', req.body.ids);
    console.log('Phone:', req.body.phone);
    console.log('Timestamp:', new Date().toISOString());
    console.log('Body completo:', JSON.stringify(req.body, null, 2));
    
    // Responder 200 OK para confirmar recebimento
    res.status(200).json({ received: true });
});

// Endpoint para configurar webhook automaticamente na Z-API
app.post('/configure-webhook', authRequired, adminRequired, async (req, res) => {
  try {
    const providedUrl = (req.body && req.body.publicUrl && String(req.body.publicUrl).trim()) || '';
    const publicBaseUrl = providedUrl || process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl || publicBaseUrl.includes('seu-dominio')) {
      return res.status(400).json({
        error: 'URL pública não informada. Preencha no painel ou configure PUBLIC_BASE_URL no .env.',
        hint: 'Exemplo: https://abc123.ngrok.io'
      });
    }

    const result = await provider.configureWebhook(publicBaseUrl);
    res.json({ success: true, usedPublicBaseUrl: publicBaseUrl, ...result });
  } catch (error) {
    console.error('[ConfigureWebhook] Erro via provider:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Erro ao configurar webhook via provider',
      details: error.response?.data || error.message
    });
  }
});
// --- FIM: Webhook de Status de Mensagem ---

// --- NOVO ENDPOINT: Desconectar Instância UAZAPI ---
app.post('/disconnect-instance', authRequired, instanceWriteLimiter, async (req, res) => {
  try {
    if (!provider.disconnectInstance) {
      return res.status(400).json({ error: 'Provider atual não suporta desconexão de instância' });
    }
    const rawInstance = (req.body && req.body.instance) ? String(req.body.instance).trim() : '';
    const instance = sanitizeInstanceName(rawInstance);
    if (!instance || !isValidInstanceName(instance)) {
      return res.status(400).json({ error: 'Nome da instância inválido. Use 3–32 chars [a-z0-9-], sem começar/terminar com hífen.' });
    }
    if (!instance) {
      return res.status(400).json({ error: 'Informe o nome da instância em "instance"' });
    }
    const data = await provider.disconnectInstance({ instance });
    const ok = Boolean(
      data?.success ||
      (typeof data?.status === 'string' && data.status.toLowerCase().includes('disconnected')) ||
      (typeof data?.message === 'string' && data.message.toLowerCase().includes('disconnect'))
    );
    return res.json({ success: ok, raw: data });
  } catch (error) {
    console.error('[disconnect-instance] Erro via provider:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao desconectar instância via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});
// --- FIM: Desconectar Instância ---

// --- HEALTH CHECKS ---
async function tryHttpGet(url, timeoutMs = 2000) {
  try {
    const r = await axios.get(url, { timeout: timeoutMs, validateStatus: () => true });
    return { ok: r.status >= 200 && r.status < 400, status: r.status, url };
  } catch (e) {
    return { ok: false, status: 0, url, error: e.message };
  }
}

function checkFile(p) {
  try { return { path: p, exists: fs.existsSync(p) }; } catch (_) { return { path: p, exists: false }; }
}

function checkWritable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return { path: dir, writable: true }; } catch (_) { return { path: dir, writable: false }; }
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, status: 'ok', uptime: process.uptime(), now: new Date().toISOString() });
});

app.get('/livez', (req, res) => {
  res.json({ ok: true, status: 'live', provider: provider?.name || 'unknown', now: new Date().toISOString() });
});

app.get('/health/frontend', async (req, res) => {
  const root = path.join(__dirname, '..');
  const checks = {
    files: [
      checkFile(path.join(root, 'public', 'index.html')),
      checkFile(path.join(root, 'public', 'qr.html')),
      checkFile(path.join(root, 'public', 'js', 'carousel_script_new.js')),
      checkFile(path.join(root, 'public', 'image', 'apple1.png')),
      checkFile(path.join(root, 'config', 'api_config.json')),
    ],
    http: []
  };
  const base = `http://127.0.0.1:${port}`;
  const urls = [`${base}/index.html`, `${base}/qr.html`, `${base}/js/carousel_script_new.js`, `${base}/image/apple1.png`, `${base}/config/api_config.json`];
  for (const u of urls) checks.http.push(await tryHttpGet(u));
  const ok = checks.files.every(f => f.exists) && checks.http.every(h => h.ok);
  res.status(ok ? 200 : 503).json({ ok, checks });
});

app.get('/health/config', (req, res) => {
  try {
    const p = path.join(__dirname, '..', 'config', 'api_config.json');
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    res.json({ ok: true, path: p, sample: { proxyBaseUrl: json.proxyBaseUrl, endpoints: Object.keys(json.endpoints || {}) } });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// --- WEBHOOK UAZAPI: confirmações de conexão ---
// Ex.: POST /webhook/uazapi/:user_id
// Opcional: header "x-webhook-token" deve bater com UAZAPI_WEBHOOK_SECRET
function normalizeConnectedPayload(body) {
  const type = String(body?.type || body?.event?.type || body?.event_type || '').toLowerCase();
  const status = String(body?.status || body?.state || body?.data?.status || body?.event?.status || '').toLowerCase();
  const instance_id = body?.instance_id || body?.instance || body?.data?.instance || body?.data?.instance_id || body?.instanceId || null;
  const deviceName = body?.deviceName || body?.device_name || body?.data?.deviceName || body?.data?.device_name || null;
  const phoneNumber = body?.phone || body?.phoneNumber || body?.data?.phone || body?.data?.phoneNumber || null;
  const at = body?.connected_at || body?.at || body?.timestamp || new Date().toISOString();
  return { type, status, instance_id, deviceName, phoneNumber, at };
}
function emitInstanceConnected(userId, payload) {
  try {
    const event = `instance_connected:${userId}`;
    if (io) {
      // Emite para todos com sufixo (compat)
      io.emit(event, payload);
      // Se o usuário estiver registrado, emite evento genérico diretamente para o socket
      const sid = userSockets.get(String(userId));
      if (sid) io.to(sid).emit('instance_connected', payload);
    }
    console.log('[Socket.IO] emit', event, { deviceName: payload?.deviceName, phoneNumber: payload?.phoneNumber });
  } catch (e) {
    console.warn('[Socket.IO] emit erro:', e?.message || String(e));
  }
}

app.post('/webhook/uazapi/:user_id', async (req, res) => {
  try {
    const userId = Number(req.params.user_id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'user_id inválido' });
    const secret = process.env.UAZAPI_WEBHOOK_SECRET || '';
    if (secret) {
      const token = String(req.headers['x-webhook-token'] || req.headers['x-signature'] || '').trim();
      if (token !== secret) return res.status(401).json({ error: 'assinatura inválida' });
    }
    const body = req.body || {};
    const n = normalizeConnectedPayload(body);
    // opcionalmente validar tipo
    if (!n.status) return res.status(200).json({ ok: true, ignored: true, reason: 'status ausente' });

    // validar instância associada ao usuário
    const rec = instore.getByUserId(userId);
    if (rec && rec.instance_name && n.instance_id && String(rec.instance_name) !== String(n.instance_id)) {
      // se nome não bater, ignore (mas logue)
      try { logUserInstance('webhook.instance_mismatch', { user_id: userId, expected: rec.instance_name, got: n.instance_id }); } catch (_) {}
      return res.status(200).json({ ok: true, ignored: true, reason: 'instance_id mismatch' });
    }

    if (n.status === 'connected' || n.status === 'ready') {
      const connected_at = n.at || new Date().toISOString();
      // persistência leve
      try { instancedb.upsertByUserId({ user_id: userId, instance_id: n.instance_id || (rec?.instance_name || null), device_name: n.deviceName || null, status: 'connected', connected_at }); } catch (_) {}
      try { instore.updateForUser(userId, { connected: true, status: { connected: true, deviceName: n.deviceName || null, phoneNumber: n.phoneNumber || null, connectedAt: connected_at } }); } catch (_) {}
      // emitir realtime
      emitInstanceConnected(userId, { user_id: userId, instance_id: n.instance_id || rec?.instance_name || null, deviceName: n.deviceName || null, phoneNumber: n.phoneNumber || null, connected_at });
      return res.status(200).json({ ok: true, accepted: true });
    }
    return res.status(200).json({ ok: true, ignored: true, status: n.status });
  } catch (e) {
    console.error('[webhook/uazapi] erro:', e?.message || String(e));
    res.status(500).json({ error: 'webhook error', details: e?.message || String(e) });
  }
});

// Fallback de polling: /api/status/:user_id
app.get('/api/status/:user_id', async (req, res) => {
  try {
    const userId = Number(req.params.user_id);
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'user_id inválido' });
    if (!provider?.getInstanceStatus) return res.status(400).json({ error: 'Provider não suporta status' });
    const rec = instore.getByUserId(userId);
    if (!rec || !rec.instance_name) return res.status(404).json({ error: 'Instância não vinculada ao usuário' });
    let token = rec.instance_token || undefined;
    try {
      if (!token && provider.resolveInstanceToken) {
        token = await provider.resolveInstanceToken(rec.instance_name);
        if (token) instore.updateForUser(userId, { instance_token: token });
      }
    } catch (_) {}
    const data = await provider.getInstanceStatus({ instance: rec.instance_name, tokenOverride: token });
    const status = data?.status || {};
    const connected = Boolean(status?.connected || data?.connected || String(status?.state || '').toLowerCase() === 'connected');
    const deviceName = extractDeviceNameFromProvider(data);
    const phoneNumber = extractPhoneNumberFromProvider(data);
    const connectedAt = status?.connected_at || data?.connected_at || null;
    // persist e possível emissão
    try { instancedb.upsertByUserId({ user_id: userId, instance_id: rec.instance_name, device_name: deviceName || null, status: connected ? 'connected' : 'disconnected', connected_at: connected ? (connectedAt || new Date().toISOString()) : null }); } catch (_) {}
    instore.updateForUser(userId, { connected, status: { connected, deviceName, phoneNumber, connectedAt } });
    if (connected) emitInstanceConnected(userId, { user_id: userId, instance_id: rec.instance_name, deviceName, phoneNumber, connected_at: connectedAt || new Date().toISOString() });
    res.json({ success: true, connected, deviceName, phoneNumber, connectedAt, raw: data });
  } catch (e) {
    console.error('[api/status/:user_id] erro:', e?.response?.data || e?.message);
    res.status(e?.response ? e.response.status : 500).json({ error: 'Falha ao obter status', details: e?.response?.data || e?.message });
  }
});

app.get('/readyz', async (req, res) => {
  const root = path.join(__dirname, '..');
  const files = [
    path.join(root, 'public', 'index.html'),
    path.join(root, 'public', 'qr.html'),
    path.join(root, 'public', 'js', 'carousel_script_new.js'),
    path.join(root, 'public', 'image', 'apple1.png'),
    path.join(root, 'config', 'api_config.json'),
    path.join(__dirname, process.env.DB_FILE || 'data.json'),
  ];
  const fileChecks = files.map(checkFile);
  const httpBase = `http://127.0.0.1:${port}`;
  const httpUrls = [`${httpBase}/index.html`, `${httpBase}/qr.html`, `${httpBase}/config/api_config.json`];
  const httpChecks = [];
  for (const u of httpUrls) httpChecks.push(await tryHttpGet(u));

  const providerChecks = {
    loaded: Boolean(provider),
    name: provider?.name || null,
    hasCreate: typeof provider?.createInstance === 'function',
    hasConnect: typeof provider?.connectInstance === 'function',
    hasStatus: typeof provider?.getInstanceStatus === 'function',
  };

  let dbCheck = { ok: false, users: 0 };
  try { const users = userdb.listUsers(); dbCheck = { ok: Array.isArray(users), users: users.length }; } catch (_) {}

  const logDirCheck = checkWritable(logsDir);

  const ok = fileChecks.every(f => f.exists) && httpChecks.every(h => h.ok) && providerChecks.loaded && providerChecks.hasStatus && dbCheck.ok && logDirCheck.writable;
  res.status(ok ? 200 : 503).json({ ok, fileChecks, httpChecks, providerChecks, dbCheck, logDirCheck, now: new Date().toISOString() });
});
// --- FIM HEALTH CHECKS ---

// --- Exemplo de rota protegida por API Key ---
// Esta rota demonstra como usar variáveis de ambiente (API_KEY) para proteger endpoints sensíveis.
// Aplique este middleware nas rotas que não devem ser acessadas sem uma credencial adicional.
app.get('/admin/secret-info', requireApiKey, (req, res) => {
  res.json({
    ok: true,
    message: 'Acesso autorizado via API Key',
    hint: 'Proteja rotas administrativas ou de manutenção usando x-api-key',
  });
});
// --- Fim exemplo ---

// --- NOVO ENDPOINT: Criar Instância UAZAPI ---
app.post('/create-instance', authRequired, instanceWriteLimiter, async (req, res) => {
  try {
    if (!provider.createInstance) {
      return res.status(400).json({ error: 'Provider atual não suporta criação de instância' });
    }
    const rawInstance = (req.body && (req.body.instance || req.body.name)) ? String(req.body.instance || req.body.name).trim() : '';
    const instance = sanitizeInstanceName(rawInstance);
    if (!instance || !isValidInstanceName(instance)) {
      return res.status(400).json({ error: 'Nome da instância inválido. Use 3–32 chars [a-z0-9-], sem começar/terminar com hífen.' });
    }
    const extra = (req.body && typeof req.body === 'object') ? req.body : {};
    if (!instance) {
      return res.status(400).json({ error: 'Informe o nome da instância em "instance" ou "name"' });
    }
    const data = await provider.createInstance({ instance, options: extra });
    const ok = Boolean(
      data?.success ||
      (typeof data?.status === 'string' && data.status.toLowerCase().includes('created')) ||
      (typeof data?.message === 'string' && /created|criada|instanciada/i.test(data.message)) ||
     data?.id || data?.instanceId || data?.name === instance
   );
    if (ok && provider.getQrCode) {
      try {
        const qrData = await provider.getQrCode({ force: true, instance, tokenOverride: data?.token });
        const qrCandidates = [
          qrData?.qrCode, qrData?.qrcode, qrData?.qr, qrData?.base64,
          qrData.info?.qrCode, qrData.info?.qrcode, qrData.info?.qr, qrData.info?.base64,
          qrData.status?.qrCode, qrData.status?.qrcode, qrData.status?.qr, qrData.status?.base64,
        ].filter(v => v);
        if (qrCandidates.length) {
          return res.json({ success: true, qr: qrCandidates[0], raw: { ...data, qr_data: qrData } });
        }
        const urlCandidates = [qrData?.url, qrData.info?.url, qrData.status?.url].filter(v => v);
        if (urlCandidates.length) {
          return res.json({ success: true, qr_url: urlCandidates[0], raw: { ...data, qr_data: qrData } });
        }
      } catch (qrErr) {
        console.error(`[create-instance] Falha ao gerar QR para "${instance}":`, qrErr.message);
        // Retorna sucesso na criação, mas com aviso sobre o QR
        return res.json({ success: ok, warning: 'Instância criada, mas falha ao gerar QR.', raw: data });
      }
    }
    return res.json({ success: ok, raw: data });
 } catch (error) {
   console.error('[create-instance] Erro via provider:', error.response?.data || error.message);
   res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao criar instância via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});
// --- FIM: Criar Instância ---

// --- NOVO ENDPOINT: Conectar Instância UAZAPI ---
app.post('/connect-instance', authRequired, instanceWriteLimiter, async (req, res) => {
  try {
    if (!provider.connectInstance) {
      return res.status(400).json({ error: 'Provider atual não suporta conexão de instância' });
    }
    const rawInstance = (req.body && (req.body.instance || req.body.name)) ? String(req.body.instance || req.body.name).trim() : '';
    const instance = sanitizeInstanceName(rawInstance);
    if (!instance || !isValidInstanceName(instance)) {
      return res.status(400).json({ error: 'Nome da instância inválido. Use 3–32 chars [a-z0-9-], sem começar/terminar com hífen.' });
    }
    const phone = req.body && req.body.phone ? String(req.body.phone).replace(/\D/g, '') : '';
    const tokenOverride = req.body && req.body.token ? String(req.body.token).trim() : undefined;
    if (!instance) {
      return res.status(400).json({ error: 'Informe o nome da instância em "instance" ou "name"' });
    }
    const data = await provider.connectInstance({ instance, phone, tokenOverride });
    const connected = Boolean(data?.connected || data?.status?.connected);
    const loggedIn = Boolean(data?.loggedIn || data?.status?.loggedIn);
    return res.json({ success: true, connected, loggedIn, raw: data });
  } catch (error) {
    console.error('[connect-instance] Erro via provider:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao conectar instância via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});
// --- FIM: Conectar Instância ---

// --- NOVO ENDPOINT: Status da Instância UAZAPI ---
app.get('/instance-status', async (req, res) => {
  try {
    if (!provider.getInstanceStatus) {
      return res.status(400).json({ error: 'Provider atual não suporta status de instância' });
    }
    const instance = req.query && (req.query.instance || req.query.name) ? String(req.query.instance || req.query.name).trim() : '';
    const tokenOverride = req.query && req.query.token ? String(req.query.token).trim() : undefined;
    if (!instance) {
      return res.status(400).json({ error: 'Informe o nome da instância em "instance" ou "name"' });
    }
    const data = await provider.getInstanceStatus({ instance, tokenOverride });
    const status = data?.status || {};
    const info = {
      connected: Boolean(status?.connected || data?.connected),
      loggedIn: Boolean(status?.loggedIn || data?.loggedIn),
      paircode: data?.instance?.paircode || status?.paircode || data?.paircode || null,
      qrcode: data?.instance?.qrcode || status?.qrcode || data?.qrcode || null,
    };
    return res.json({ success: true, status: info, raw: data });
  } catch (error) {
    console.error('[instance-status] Erro via provider:', error.response?.data || error.message);
    res.status(error.response ? error.response.status : 500).json({
      error: 'Erro ao obter status da instância via provider',
      details: error.response ? error.response.data : error.message
    });
  }
});
// --- FIM: Status da Instância ---

// --- NOVO ENDPOINT: Eventos de QR (SSE) ---
// Stream de eventos em tempo real para retorno na aba de QR.
// Faz polling do status da instância e envia:
//  - event: status => { connected, loggedIn, paircode, qrcode }
//  - event: connected => { connected: true, at }
//  - event: error => { message }
app.get('/qr-events', async (req, res) => {
  try {
    if (!provider.getInstanceStatus) {
      return res.status(400).json({ error: 'Provider atual não suporta status de instância' });
    }
    const instance = req.query && (req.query.instance || req.query.name) ? String(req.query.instance || req.query.name).trim() : '';
    const tokenOverride = req.query && req.query.token ? String(req.query.token).trim() : undefined;
    const intervalMs = (() => {
      const raw = req.query && req.query.interval ? Number(req.query.interval) : 0;
      if (!raw || Number.isNaN(raw)) return 3000;
      return Math.max(1000, Math.min(raw, 15000));
    })();
    if (!instance) {
      return res.status(400).json({ error: 'Informe o nome da instância em "instance" ou "name"' });
    }

    // Cabeçalhos SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    let lastConnected = false;
    let stopped = false;

    const sendEvent = (event, payload) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (_) {
        stopped = true;
      }
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const data = await provider.getInstanceStatus({ instance, tokenOverride });
        const status = data?.status || {};
        const connected = Boolean(status?.connected || data?.connected);
        const loggedIn = Boolean(status?.loggedIn || data?.loggedIn);
        const stateText = String(
          status?.state || data?.state || status?.connection_status || data?.connection_status || ''
        ).toLowerCase();
        // Estritamente considerar WhatsApp conectado somente quando provider reporta 'connected' ou 'ready'
        const isWhatsAppConnected = connected || ['connected', 'ready'].includes(stateText);
        const info = {
          connected: isWhatsAppConnected,
          loggedIn,
          paircode: data?.instance?.paircode || status?.paircode || data?.paircode || null,
          qrcode: data?.instance?.qrcode || status?.qrcode || data?.qrcode || null,
          state: stateText || null,
          instance,
        };
        sendEvent('status', info);
        if (isWhatsAppConnected && !lastConnected) {
          lastConnected = true;
          sendEvent('connected', { connected: true, state: stateText || null, instance, at: new Date().toISOString() });
        }
      } catch (error) {
        const message = error.response ? (error.response.data?.message || JSON.stringify(error.response.data)) : error.message;
        sendEvent('error', { message, instance });
      }
    };

    const timer = setInterval(poll, intervalMs);
    // Primeiro disparo imediato
    poll();

    req.on('close', () => {
      stopped = true;
      clearInterval(timer);
      try { res.end(); } catch (_) {}
    });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao iniciar eventos de QR', details: error.message });
  }
});
// --- FIM: Eventos de QR (SSE) ---

// --- NOVO ENDPOINT: Obter QR Code da UAZAPI ---
  app.get('/get-qr-code', async (req, res) => {
    try {
      if (!provider.getQrCode) {
        return res.status(400).json({ error: 'Provider atual não suporta QR Code' });
      }
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const instance = req.query.instance ? String(req.query.instance) : undefined;
      const tokenOverride = req.query.token ? String(req.query.token).trim() : undefined;
      appendQrLog('REQUEST', { provider: provider.name || 'unknown', force, instance });
      const data = await provider.getQrCode({ force, instance, tokenOverride });
      // Normalização: tenta encontrar campo com base64 do QR
      const info = data?.info || {};
      const status = data?.status || {};
      const qrCandidates = [
        data?.qrCode, data?.qrcode, data?.qr, data?.base64,
        info?.qrCode, info?.qrcode, info?.qr, info?.base64,
        status?.qrCode, status?.qrcode, status?.qr, status?.base64,
        status?.qr_image, status?.qr_image_base64
      ].filter((v) => typeof v === 'string' && v);
      const qr = qrCandidates.length ? qrCandidates[0] : '';
      if (typeof qr === 'string' && qr) {
        appendQrLog('SUCCESS', { format: qr.startsWith('data:image') ? 'dataurl' : 'base64', length: qr.length });
        return res.json({ success: true, format: qr.startsWith('data:image') ? 'dataurl' : 'base64', qr });
      }
      // Caso venha uma URL
      const urlCandidates = [data?.url, info?.url, status?.url, status?.qr_url].filter((v) => typeof v === 'string' && v);
      if (urlCandidates.length) {
        const url = urlCandidates[0];
        appendQrLog('SUCCESS', { format: 'url', url: data.url });
        return res.json({ success: true, format: 'url', url });
      }
      // Se vier status de instância conectada
      const checked = status?.checked_instance || status?.checked || data?.checked_instance;
      const connectionStatus = checked?.connection_status || status?.connection_status || data?.connection_status || info?.connection_status;
      const connectedFlag = [status?.connected, info?.connected, data?.connected].find((v) => typeof v === 'boolean');
      if (connectionStatus) {
        const connected = String(connectionStatus).toLowerCase() === 'connected';
        const instName = checked?.name || data?.instance_name || instance || null;
        // Se estiver conectado e não há QR, tentar desconectar e reconsultar quando force=true ou não houver QR
        if (connected && provider.disconnectInstance && instName) {
          try {
            appendQrLog('AUTO_DISCONNECT', { instance: instName, reason: 'connected_without_qr' });
            const disc = await provider.disconnectInstance({ instance: instName });
            appendQrLog('AUTO_DISCONNECT_RESULT', { success: Boolean(disc?.success), rawKeys: Object.keys(disc || {}) });
            // Sempre reconsultar com force após desconexão
            const again = await provider.getQrCode({ force: true, instance: instName, tokenOverride });
            const aInfo = again?.info || {};
            const aStatus = again?.status || {};
            const aQrCandidates = [
              again?.qrCode, again?.qrcode, again?.qr, again?.base64,
              aInfo?.qrCode, aInfo?.qrcode, aInfo?.qr, aInfo?.base64,
              aStatus?.qrCode, aStatus?.qrcode, aStatus?.qr, aStatus?.base64,
              aStatus?.qr_image, aStatus?.qr_image_base64
            ].filter((v) => typeof v === 'string' && v);
            if (aQrCandidates.length) {
              const aqr = aQrCandidates[0];
              appendQrLog('SUCCESS', { format: aqr.startsWith('data:image') ? 'dataurl' : 'base64', length: aqr.length });
              return res.json({ success: true, format: aqr.startsWith('data:image') ? 'dataurl' : 'base64', qr: aqr });
            }
            const aUrlCandidates = [again?.url, aInfo?.url, aStatus?.url, aStatus?.qr_url].filter((v) => typeof v === 'string' && v);
            if (aUrlCandidates.length) {
              const url = aUrlCandidates[0];
              appendQrLog('SUCCESS', { format: 'url', url });
              return res.json({ success: true, format: 'url', url });
            }
            appendQrLog('STATUS', { connected, instanceName: instName });
            return res.json({
              success: true,
              connected,
              instanceName: instName,
              lastCheck: aStatus?.last_check || status?.last_check || null,
              message: aStatus?.message || checked?.message || again?.message || data?.message || (connected ? 'Instance is healthy' : 'Instance not connected'),
              qrAvailable: false,
              raw: again,
            });
          } catch (autoErr) {
            appendQrLog('AUTO_DISCONNECT_ERROR', { instance: instName, details: autoErr?.response?.data || autoErr?.message });
            // Se falhar, retorna o status original
            appendQrLog('STATUS', { connected, instanceName: instName });
            return res.json({
              success: true,
              connected,
              instanceName: instName,
              lastCheck: status?.last_check || null,
              message: checked?.message || data?.message || (connected ? 'Instance is healthy' : 'Instance not connected'),
              qrAvailable: false,
              raw: data,
            });
          }
        }
        appendQrLog('STATUS', { connected, instanceName: instName });
        return res.json({
          success: true,
          connected,
          instanceName: instName,
          lastCheck: status?.last_check || null,
          message: checked?.message || data?.message || (connected ? 'Instance is healthy' : 'Instance not connected'),
          qrAvailable: false,
          raw: data,
        });
      }
      if (typeof connectedFlag === 'boolean') {
        appendQrLog('STATUS', { connected: connectedFlag, instanceName: checked?.name || data?.instance_name || null });
        return res.json({ success: true, connected: connectedFlag, qrAvailable: false, raw: data });
      }
      // Retorna bruto para depuração
      appendQrLog('RAW', { keys: Object.keys(data || {}) });
      const reason = status?.message || info?.message || data?.message || 'Resposta sem QR detectável';
      res.json({ success: true, reason, raw: data });
    } catch (error) {
      console.error('[get-qr-code] Erro via provider:', error.response?.data || error.message);
      appendQrLog('ERROR', { status: error.response?.status || 500, details: error.response?.data || error.message });
      res.status(error.response ? error.response.status : 500).json({
        error: 'Erro ao obter QR Code via provider',
        details: error.response ? error.response.data : error.message
      });
    }
  });
// --- FIM: Obter QR Code ---

// Para rotas não encontradas (fallback para a página de login)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

server.listen(port, () => {
    const proto = httpsOptions ? 'https' : 'http';
    console.log(`Proxy e frontend rodando na porta ${port} (${proto})`);
});

// Interceptores do Axios para logs detalhados
function maskToken(token) {
  if (!token) return 'N/A';
  const t = String(token);
  if (t.length <= 8) return '****';
  return `${t.slice(0,4)}****${t.slice(-4)}`;
}

axios.interceptors.request.use((config) => {
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    const safeHeaders = { ...config.headers };
    if (safeHeaders['Client-Token']) safeHeaders['Client-Token'] = maskToken(safeHeaders['Client-Token']);
    if (safeHeaders['token']) safeHeaders['token'] = maskToken(safeHeaders['token']);
    console.log('[Axios:request]', {
      method: config.method,
      url: config.url,
      headers: safeHeaders,
      data: config.data,
    });
  }
  return config;
}, (error) => {
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    console.error('[Axios:request:error]', error.message);
  }
  return Promise.reject(error);
});

axios.interceptors.response.use((response) => {
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    console.log('[Axios:response]', {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
    });
  }
  return response;
}, (error) => {
  if (String(process.env.NODE_ENV).toLowerCase() !== 'production') {
    if (error.response) {
      console.error('[Axios:response:error]', {
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error('[Axios:network:error]', error.message);
    }
  }
  return Promise.reject(error);
});
// --- CSRF (Double Submit Cookie) ---
function ensureCsrfCookie(req, res) {
  try {
    const has = req.cookies && (req.cookies['XSRF-TOKEN'] || req.cookies['xsrf-token'] || req.cookies['csrf_token']);
    if (!has) {
      const token = crypto.randomBytes(32).toString('hex');
      const isHttps = Boolean(req.secure || (req.protocol === 'https'));
      res.cookie('XSRF-TOKEN', token, { httpOnly: false, secure: isHttps, sameSite: 'lax', path: '/' });
      return token;
    }
    return has;
  } catch (_) { return null; }
}

app.get('/csrf-token', (req, res) => {
  const t = ensureCsrfCookie(req, res);
  res.json({ csrfToken: t || (req.cookies && (req.cookies['XSRF-TOKEN'] || req.cookies['xsrf-token'] || req.cookies['csrf_token']) ) || null });
});

// Aplica verificação CSRF em métodos que alteram estado
app.use((req, res, next) => {
  try {
    const method = req.method || 'GET';
    if (!['POST', 'PUT', 'DELETE'].includes(method)) return next();
    const p = req.path || req.url || '';
    const exempt = ['/login', '/admin/login'];
    if (exempt.includes(p)) return next();
    const cookieToken = req.cookies && (req.cookies['XSRF-TOKEN'] || req.cookies['xsrf-token'] || req.cookies['csrf_token']);
    const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || req.headers['csrf-token'];
    if (!cookieToken || !headerToken || String(cookieToken) !== String(headerToken)) {
      return res.status(403).json({ error: 'CSRF token inválido ou ausente' });
    }
    return next();
  } catch (e) {
    return res.status(400).json({ error: 'Falha na validação CSRF', details: e?.message || String(e) });
  }
});
