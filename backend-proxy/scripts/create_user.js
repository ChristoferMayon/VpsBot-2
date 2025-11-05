const path = require('path');
// Garante cwd no backend-proxy mesmo quando executado de outro diretório
try { process.chdir(path.join(__dirname, '..')); } catch {}

const db = require('../db');
const bcrypt = require('bcryptjs');

function now() { return Date.now(); }

function parseArgs() {
  const [usernameArg, passwordArg, daysArg] = process.argv.slice(2);
  const username = (usernameArg || process.env.NEW_USERNAME || 'cliente').trim();
  const password = (passwordArg || process.env.NEW_PASSWORD || 'cliente123').trim();
  const days = Number(daysArg || process.env.NEW_DAYS || 30);
  const role = (process.env.NEW_ROLE || 'user').trim();
  return { username, password, days, role };
}

function ensureUniqueUsername(base) {
  let name = base;
  let i = 1;
  while (db.findUserByUsername(name)) {
    name = `${base}${i++}`;
  }
  return name;
}

async function main() {
  db.init();
  const { username: baseUsername, password, days, role } = parseArgs();
  const username = ensureUniqueUsername(baseUsername);
  const password_hash = bcrypt.hashSync(String(password), 10);
  const expires_at = (String(role) === 'admin') ? null : (now() + (Math.max(1, Number(days)) * 24 * 60 * 60 * 1000));
  const id = db.createUser({ username, password_hash, role, expires_at, active: 1 });
  console.log(JSON.stringify({
    success: true,
    id,
    username,
    password,
    role,
    expires_at,
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }, null, 2));
  process.exit(1);
});