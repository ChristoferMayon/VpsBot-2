const fs = require('fs');
const path = require('path');
const { logUserInstance } = require('./logger');

// Simple JSON-backed table: backend-proxy/data.instances.table.json
const TABLE_FILE = path.join(__dirname, 'data.instances.table.json');

function ensureTableFile() {
  try {
    if (!fs.existsSync(TABLE_FILE)) {
      fs.writeFileSync(TABLE_FILE, JSON.stringify({ instances: [], seq: 0 }, null, 2));
      try { logUserInstance('instances_db.ensure_table.created', { table: TABLE_FILE }); } catch (_) {}
    } else {
      const raw = fs.readFileSync(TABLE_FILE, 'utf8');
      const json = JSON.parse(raw || '{}');
      if (!json || typeof json !== 'object' || !Array.isArray(json.instances)) {
        fs.writeFileSync(TABLE_FILE, JSON.stringify({ instances: [], seq: 0 }, null, 2));
        try { logUserInstance('instances_db.ensure_table.reset', { table: TABLE_FILE }); } catch (_) {}
      }
    }
  } catch (_) {
    try { fs.writeFileSync(TABLE_FILE, JSON.stringify({ instances: [], seq: 0 }, null, 2)); } catch (_) {}
  }
}

function read() {
  ensureTableFile();
  try {
    const raw = fs.readFileSync(TABLE_FILE, 'utf8');
    const json = JSON.parse(raw || '{}');
    if (!json || typeof json !== 'object') return { instances: [], seq: 0 };
    if (!Array.isArray(json.instances)) json.instances = [];
    if (typeof json.seq !== 'number') json.seq = 0;
    return json;
  } catch (_) {
    return { instances: [], seq: 0 };
  }
}

function write(json) {
  try {
    const payload = {
      instances: Array.isArray(json.instances) ? json.instances : [],
      seq: typeof json.seq === 'number' ? json.seq : 0,
    };
    fs.writeFileSync(TABLE_FILE, JSON.stringify(payload, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

function init() {
  ensureTableFile();
}

function upsertByUserId({ user_id, instance_id, token, device_name, status, connected_at }) {
  const nowIso = new Date().toISOString();
  const db = read();
  const idx = db.instances.findIndex((r) => String(r.user_id) === String(user_id));
  const cleanStatus = status === 'connected' || status === 'disconnected' ? status : (status ? String(status) : null);
  if (idx === -1) {
    const id = ++db.seq;
    db.instances.push({
      id,
      user_id: Number(user_id),
      instance_id: instance_id || null,
      token: token || null,
      device_name: device_name || null,
      status: cleanStatus || null,
      connected_at: connected_at || nowIso,
      updated_at: nowIso,
    });
  } else {
    const rec = db.instances[idx];
    db.instances[idx] = {
      ...rec,
      instance_id: instance_id || rec.instance_id || null,
      token: token || rec.token || null,
      device_name: device_name || rec.device_name || null,
      status: cleanStatus || rec.status || null,
      connected_at: connected_at || rec.connected_at || nowIso,
      updated_at: nowIso,
    };
  }
  write(db);
  try { logUserInstance('instances_db.upsert', { user_id, instance_id, has_token: Boolean(token), status: cleanStatus }); } catch (_) {}
  return db.instances.find((r) => String(r.user_id) === String(user_id));
}

function getByUserId(user_id) {
  const db = read();
  try { logUserInstance('instances_db.get', { user_id }); } catch (_) {}
  return db.instances.find((r) => String(r.user_id) === String(user_id)) || null;
}

module.exports = { init, upsertByUserId, getByUserId, TABLE_FILE };