const fs = require('fs');
const path = require('path');

let state = null;
function getDbPath() {
  const file = process.env.DB_FILE || 'data.json';
  return path.join(__dirname, file);
}
function load() {
  const p = getDbPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      state = JSON.parse(raw);
    } else {
      state = { users: [], seq: 0 };
      fs.writeFileSync(p, JSON.stringify(state, null, 2));
    }
  } catch (e) {
    state = { users: [], seq: 0 };
  }
}
function save() {
  const p = getDbPath();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

function init() {
  load();
  const hasAdmin = state.users.some(u => u.role === 'admin');
  if (!hasAdmin) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin';
    const bcrypt = require('bcryptjs');
    const password_hash = bcrypt.hashSync(String(password), 10);
    const now = Date.now();
    const expires_at = null; // Admin sem expiração
    const id = ++state.seq;
    state.users.push({ id, username, password_hash, role: 'admin', expires_at, message_count: 0, credits: 0, active: 1, created_at: now, updated_at: now });
    save();
    console.log(`[db] Admin semeado: ${username} (expiração indeterminada)`);
  }
}

function createUser({ username, password_hash, role = 'user', expires_at, credits = 0, active = 1 }) {
  const now = Date.now();
  if (state.users.some(u => u.username === username)) throw new Error('Usuário já existe');
  const id = ++state.seq;
  state.users.push({ id, username: String(username), password_hash: String(password_hash), role: String(role), expires_at: expires_at || null, message_count: 0, credits: Number(credits) || 0, active: Number(active ? 1 : 0), created_at: now, updated_at: now });
  save();
  return id;
}
function listUsers() {
  return state.users.map(u => ({ ...u }));
}
function findUserByUsername(username) {
  return state.users.find(u => u.username === String(username)) || null;
}
function findUserById(id) {
  return state.users.find(u => u.id === Number(id)) || null;
}
function updateUser(id, fields) {
  const u = findUserById(id);
  if (!u) return null;
  const now = Date.now();
  if (typeof fields.username === 'string') u.username = fields.username;
  if (typeof fields.password_hash === 'string') u.password_hash = fields.password_hash;
  if (typeof fields.role === 'string') u.role = fields.role;
  if (typeof fields.expires_at !== 'undefined') u.expires_at = fields.expires_at || null;
  if (typeof fields.active !== 'undefined') u.active = Number(fields.active ? 1 : 0);
  // Suporte a campos de instância utilizados pelo servidor
  if (typeof fields.instance_name === 'string') u.instance_name = fields.instance_name;
  if (typeof fields.instance_token === 'string') u.instance_token = fields.instance_token;
  if (typeof fields.credits !== 'undefined') {
    const val = Math.max(0, Number(fields.credits));
    u.credits = val;
  }
  u.updated_at = now;
  save();
  return { ...u };
}
function deleteUser(id) {
  const idx = state.users.findIndex(u => u.id === Number(id));
  if (idx >= 0) { state.users.splice(idx, 1); save(); }
}
function incrementMessageCount(id, delta) {
  const u = findUserById(id);
  if (!u) return;
  u.message_count = Number(u.message_count || 0) + Number(delta || 1);
  u.updated_at = Date.now();
  save();
}
function getCredits(id) {
  const u = findUserById(id);
  return Number(u?.credits || 0);
}
function addCredits(id, delta) {
  const u = findUserById(id);
  if (!u) return null;
  const curr = Number(u.credits || 0);
  const next = Math.max(0, curr + Number(delta || 0));
  u.credits = next;
  u.updated_at = Date.now();
  save();
  return next;
}
function consumeCredit(id) {
  const u = findUserById(id);
  if (!u) return false;
  const curr = Number(u.credits || 0);
  if (curr <= 0) return false;
  u.credits = curr - 1;
  u.updated_at = Date.now();
  save();
  return true;
}
function isExpired(user) {
  if (String(user?.role) === 'admin') return false; // Admin nunca expira
  const exp = Number(user?.expires_at || 0);
  if (!exp) return false;
  return Date.now() > exp;
}

module.exports = { init, createUser, listUsers, findUserByUsername, findUserById, updateUser, deleteUser, incrementMessageCount, isExpired, getCredits, addCredits, consumeCredit };