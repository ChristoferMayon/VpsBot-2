// 🔐 Apple Smart Fix — cria a pasta /data automaticamente para o Railway
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

const dbPath = process.env.DB_FILE || "/data/data.json";
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`[Setup] Pasta criada: ${dataDir}`);
}

let state = null;

function getDbPath() {
  const file = process.env.DB_FILE || "data.json";
  return path.join(process.cwd(), file);
}

function load() {
  const p = getDbPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      state = JSON.parse(raw);
    } else {
      state = { users: [], seq: 0 };
      fs.writeFileSync(p, JSON.stringify(state, null, 2));
    }
  } catch {
    state = { users: [], seq: 0 };
  }
}

function save() {
  const p = getDbPath();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function init() {
  load();
  const hasAdmin = state.users.some(u => u.role === "admin");
  if (!hasAdmin) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin";
    const password_hash = bcrypt.hashSync(String(password), 10);
    const now = Date.now();
    const expires_at = null;
    const id = ++state.seq;
    state.users.push({
      id,
      username,
      password_hash,
      role: "admin",
      expires_at,
      message_count: 0,
      credits: 0,
      active: 1,
      created_at: now,
      updated_at: now,
    });
    save();
    console.log(`[db] Admin criado: ${username}`);
  }
}

export function createUser({ username, password_hash, role = "user", expires_at, credits = 0, active = 1 }) {
  const now = Date.now();
  if (state.users.some(u => u.username === username)) throw new Error("Usuário já existe");
  const id = ++state.seq;
  state.users.push({ id, username, password_hash, role, expires_at: expires_at || null, message_count: 0, credits, active, created_at: now, updated_at: now });
  save();
  return id;
}

export function listUsers() {
  return state.users.map(u => ({ ...u }));
}

export function findUserByUsername(username) {
  return state.users.find(u => u.username === String(username)) || null;
}

export function findUserById(id) {
  return state.users.find(u => u.id === Number(id)) || null;
}

export function updateUser(id, fields) {
  const u = findUserById(id);
  if (!u) return null;
  const now = Date.now();
  Object.assign(u, fields, { updated_at: now });
  save();
  return { ...u };
}

export function deleteUser(id) {
  const idx = state.users.findIndex(u => u.id === Number(id));
  if (idx >= 0) {
    state.users.splice(idx, 1);
    save();
  }
}

export function incrementMessageCount(id, delta) {
  const u = findUserById(id);
  if (!u) return;
  u.message_count = (u.message_count || 0) + (delta || 1);
  u.updated_at = Date.now();
  save();
}

export function getCredits(id) {
  const u = findUserById(id);
  return Number(u?.credits || 0);
}

export function addCredits(id, delta) {
  const u = findUserById(id);
  if (!u) return null;
  u.credits = Math.max(0, (u.credits || 0) + (delta || 0));
  u.updated_at = Date.now();
  save();
  return u.credits;
}

export function consumeCredit(id) {
  const u = findUserById(id);
  if (!u || u.credits <= 0) return false;
  u.credits -= 1;
  u.updated_at = Date.now();
  save();
  return true;
}

export function isExpired(user) {
  if (user?.role === "admin") return false;
  const exp = Number(user?.expires_at || 0);
  return exp && Date.now() > exp;
}
