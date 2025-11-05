const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'instances.json');

function ensureFile() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      fs.writeFileSync(FILE_PATH, JSON.stringify({ instances: [] }, null, 2));
    } else {
      // Validate structure
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      const data = JSON.parse(raw || '{}');
      if (!data || typeof data !== 'object' || !Array.isArray(data.instances)) {
        fs.writeFileSync(FILE_PATH, JSON.stringify({ instances: [] }, null, 2));
      }
    }
  } catch (_) {
    // Fallback: recreate file
    try {
      fs.writeFileSync(FILE_PATH, JSON.stringify({ instances: [] }, null, 2));
    } catch (_) {}
  }
}

function readStore() {
  ensureFile();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const data = JSON.parse(raw || '{}');
    if (!data || typeof data !== 'object') return { instances: [] };
    if (!Array.isArray(data.instances)) data.instances = [];
    return data;
  } catch (_) {
    return { instances: [] };
  }
}

function writeStore(data) {
  try {
    const payload = { instances: Array.isArray(data.instances) ? data.instances : [] };
    fs.writeFileSync(FILE_PATH, JSON.stringify(payload, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

function getByUserId(userId) {
  const data = readStore();
  return data.instances.find((it) => String(it.user_id) === String(userId));
}

function setForUser(userId, instance) {
  const now = new Date().toISOString();
  const data = readStore();
  const idx = data.instances.findIndex((it) => String(it.user_id) === String(userId));
  const record = {
    user_id: userId,
    instance_name: instance?.instance_name || instance?.name || null,
    instance_token: instance?.instance_token || instance?.token || null,
    provider: instance?.provider || 'uazapi',
    connected: typeof instance?.connected === 'boolean' ? instance.connected : null,
    status: instance?.status || null,
    created_at: idx === -1 ? now : (data.instances[idx]?.created_at || now),
    updated_at: now,
    meta: instance?.meta || null,
  };
  if (idx === -1) {
    data.instances.push(record);
  } else {
    data.instances[idx] = record;
  }
  writeStore(data);
  return record;
}

function updateForUser(userId, fields) {
  const now = new Date().toISOString();
  const data = readStore();
  const idx = data.instances.findIndex((it) => String(it.user_id) === String(userId));
  if (idx === -1) {
    // create minimal record
    const rec = {
      user_id: userId,
      instance_name: fields?.instance_name || null,
      instance_token: fields?.instance_token || null,
      provider: fields?.provider || 'uazapi',
      connected: typeof fields?.connected === 'boolean' ? fields.connected : null,
      status: fields?.status || null,
      created_at: now,
      updated_at: now,
      meta: fields?.meta || null,
    };
    data.instances.push(rec);
    writeStore(data);
    return rec;
  }
  const rec = data.instances[idx];
  const merged = {
    ...rec,
    ...fields,
    updated_at: now,
  };
  data.instances[idx] = merged;
  writeStore(data);
  return merged;
}

module.exports = {
  FILE_PATH,
  readStore,
  writeStore,
  getByUserId,
  setForUser,
  updateForUser,
};