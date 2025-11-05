const path = require('path');
try { process.chdir(path.join(__dirname, '..')); } catch {}

const db = require('../db');
const bcrypt = require('bcryptjs');

function parseArgs() {
  const [usernameArg, passwordArg] = process.argv.slice(2);
  const username = (usernameArg || process.env.RESET_USERNAME || '').trim();
  const password = (passwordArg || process.env.RESET_PASSWORD || '').trim();
  if (!username || !password) {
    console.error('Uso: node scripts/reset_password.js <username> <new_password>');
    process.exit(1);
  }
  return { username, password };
}

function main() {
  db.init();
  const { username, password } = parseArgs();
  const user = db.findUserByUsername(username);
  if (!user) {
    console.error(JSON.stringify({ success: false, error: 'Usuário não encontrado', username }, null, 2));
    process.exit(2);
  }
  const password_hash = bcrypt.hashSync(String(password), 10);
  const updated = db.updateUser(user.id, { password_hash });
  console.log(JSON.stringify({ success: true, id: updated.id, username: updated.username }, null, 2));
}

main();