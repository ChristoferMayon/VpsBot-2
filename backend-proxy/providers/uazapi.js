const axios = require('axios');

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Credenciais ausentes: ${missing.join(', ')}`);
  }
}

function getBaseUrl() {
  const base = process.env.PROV_BASE_URL;
  if (!base) throw new Error('PROV_BASE_URL não configurado no .env');
  return base.replace(/\/$/, '');
}

function authHeaders(options = {}) {
  const defaultToken = String(process.env.PROV_TOKEN || '').trim();
  const adminToken = String(process.env.PROV_ADMIN_TOKEN || '').trim();
  const useAdmin = Boolean(options && options.admin);
  const overrideToken = String(options && options.tokenOverride || '').trim();

  // Seleciona o token a ser enviado no header 'token'
  // Prioridade: overrideToken > defaultToken > (adminToken quando admin)
  const tokenForHeader = overrideToken || defaultToken || (useAdmin ? adminToken : '');

  // Validação flexível: somente exige PROV_TOKEN quando necessário
  // - Se for admin e houver adminToken, permite seguir sem PROV_TOKEN
  // - Se não for admin e não houver overrideToken nem PROV_TOKEN, falha
  if (!tokenForHeader) {
    if (useAdmin && adminToken) {
      // ok, seguimos só com adminToken
    } else {
      throw new Error('Credenciais ausentes: defina PROV_TOKEN ou informe tokenOverride');
    }
  }

  const headers = {
    token: tokenForHeader,
    'Content-Type': 'application/json',
  };

  // Authorization: usa admin quando solicitado e disponível; caso contrário usa o token selecionado
  if (useAdmin && adminToken) {
    headers['admintoken'] = adminToken;
    headers['Authorization'] = `Bearer ${adminToken}`;
  } else {
    headers['Authorization'] = `Bearer ${tokenForHeader}`;
  }

  return headers;
}

// Helpers para overrides configuráveis via .env
function expandPathWithInstance(path, name) {
  const n = String(name || '').trim();
  let p = String(path || '');
  if (!p) return p;
  // Substitui placeholders comuns
  p = p.replace(/:name/g, encodeURIComponent(n));
  p = p.replace(/\{name\}/g, encodeURIComponent(n));
  return p;
}

function getKeysEnv(envName, fallbackKeys) {
  const raw = String(process.env[envName] || '').trim();
  if (!raw) return fallbackKeys;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).length ? raw.split(',').map((s) => s.trim()).filter(Boolean) : fallbackKeys;
}

// Tenta resolver o token de uma instância pelo nome usando rotas administrativas comuns.
async function resolveInstanceToken(instanceName) {
  const base = getBaseUrl();
  const headers = authHeaders({ admin: true });
  const name = String(instanceName || '').trim();
  if (!name) return null;
  const listCandidates = [
    '/admin/instances',
    '/admin/sessions',
    '/admin/list',
    '/admin/instances/list',
    '/instances',
    '/sessions',
    '/list'
  ];
  const detailCandidates = [
    '/admin/instance/:name',
    '/admin/instances/:name',
    '/admin/session/:name',
    '/admin/sessions/:name'
  ];

  function extractTokenFromItem(item) {
    if (!item || typeof item !== 'object') return null;
    const possibleKeys = [
      'token', 'instance_token', 'session_token', 'bearer_token', 'api_token',
      'accessToken', 'access_token'
    ];
    for (const key of possibleKeys) {
      const v = item[key];
      if (typeof v === 'string' && v.trim()) return String(v).trim();
    }
    return null;
  }

  function matchesName(item) {
    const keys = ['name', 'instance', 'session', 'sessionId', 'instanceName'];
    const target = name.toLowerCase();
    for (const k of keys) {
      const v = item?.[k];
      if (typeof v === 'string' && v.toLowerCase() === target) return true;
    }
    return false;
  }

  let lastError;
  // 1) Tenta listar todas e encontrar a instância pelo nome
  for (const path of listCandidates) {
    try {
      const url = `${base}${path}`;
      const res = await axios.get(url, { headers });
      const data = res.data;
      const arrays = [];
      // agrega possíveis arrays
      if (Array.isArray(data)) arrays.push(data);
      if (Array.isArray(data?.instances)) arrays.push(data.instances);
      if (Array.isArray(data?.sessions)) arrays.push(data.sessions);
      if (Array.isArray(data?.list)) arrays.push(data.list);
      if (Array.isArray(data?.data)) arrays.push(data.data);
      if (Array.isArray(data?.result)) arrays.push(data.result);
      for (const arr of arrays) {
        for (const item of arr) {
          if (matchesName(item)) {
            const token = extractTokenFromItem(item);
            if (token) return token;
          }
        }
      }
    } catch (err) {
      lastError = err;
      // segue para próximo candidato
    }
  }

  // 2) Tenta rotas de detalhe da instância específica
  for (const tmpl of detailCandidates) {
    try {
      const path = tmpl.replace(':name', encodeURIComponent(name));
      const url = `${base}${path}`;
      const res = await axios.get(url, { headers });
      const token = extractTokenFromItem(res.data) || extractTokenFromItem(res.data?.data);
      if (token) return token;
    } catch (err) {
      lastError = err;
    }
  }

  return null; // não encontrado
}

async function sendSimpleText({ phone, message, tokenOverride }) {
  const url = `${getBaseUrl()}/send/text`;
  const payload = { number: phone, text: message };
  const response = await axios.post(url, payload, { headers: authHeaders({ admin: false, tokenOverride }) });
  return response.data;
}

async function sendCarouselMessage({ phone, elements, message, delayMessage, tokenOverride }) {
  const url = `${getBaseUrl()}/send/carousel`;
  const carousel = (elements || []).map((el) => ({
    text: el.text,
    image: el.media,
    buttons: (el.buttons || []).map((b) => {
      const type = String(b.type || '').toUpperCase();
      const out = { text: b.text, type: type || 'REPLY', id: '' };
      switch (out.type) {
        case 'URL':
          out.id = b.url || b.text || '';
          break;
        case 'CALL':
          out.id = b.phone || '';
          break;
        case 'COPY':
          out.id = b.copyText || b.text || '';
          break;
        case 'REPLY':
        default:
          out.id = b.id || b.text || '';
          break;
      }
      return out;
    }),
  }));

  const payload = {
    number: phone,
    text: message || '',
    carousel,
    delay: delayMessage ? Number(delayMessage) * 1000 : 0,
    readchat: true,
  };

  const response = await axios.post(url, payload, { headers: authHeaders({ admin: false, tokenOverride }) });
  return response.data;
}

async function configureWebhook(publicBaseUrl) {
  // Sem documentação oficial do endpoint de webhook da UAZAPI.
  // Retorna a URL calculada para que o painel registre a informação.
  const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/webhook/message-status`;
  return { webhookUrl, providerResponse: { note: 'configureWebhook não implementado para UAZAPI' } };
}

async function disconnectInstance({ instance }) {
  const base = getBaseUrl();
  const adminHeaders = authHeaders({ admin: true });
  const name = String(instance || '').trim();
  // Resolve token da instância para tentar rotas não-admin que exigem header 'token'
  let instToken = '';
  try {
    instToken = await resolveInstanceToken(name);
  } catch (_) {
    // fallback opcional ao PROV_TOKEN quando resolução falhar e não estiver desativado
    const disableGlobalFallback = String(process.env.UAZAPI_DISABLE_GLOBAL_FALLBACK || '').toLowerCase() === 'true';
    if (!disableGlobalFallback) {
      instToken = String(process.env.PROV_TOKEN || '').trim();
    }
  }
  const instanceHeaders = authHeaders({ admin: false, tokenOverride: instToken });
  // Overrides via .env (prioridade antes dos candidatos padrão)
  const ovPath = process.env.UAZAPI_ADMIN_DISCONNECT_PATH || process.env.UAZAPI_DISCONNECT_PATH;
  const ovMethod = String(process.env.UAZAPI_ADMIN_DISCONNECT_METHOD || process.env.UAZAPI_DISCONNECT_METHOD || 'POST').toUpperCase();
  const ovKeys = getKeysEnv('UAZAPI_ADMIN_DISCONNECT_KEYS', ['instance', 'name', 'session', 'sessionId', 'instanceName']);
  if (ovPath) {
    try {
      let path = expandPathWithInstance(ovPath, name);
      let url = `${base}${path}`;
      const useAdminOverride = Boolean(process.env.UAZAPI_ADMIN_DISCONNECT_PATH);
      const headers = useAdminOverride ? adminHeaders : instanceHeaders;
      const preferredOrder = ovMethod === 'GET' ? ['GET','POST','DELETE'] : ovMethod === 'DELETE' ? ['DELETE','POST','GET'] : ['POST','GET','DELETE'];
      let lastErr;
      for (const method of preferredOrder) {
        try {
          if (method === 'GET' || method === 'DELETE') {
            let tryUrl = url;
            const params = new URLSearchParams();
            for (const k of ovKeys) {
              if (name) params.set(k, name);
            }
            params.set('action', 'logout');
            const qs = params.toString();
            if (qs) tryUrl += (tryUrl.includes('?') ? '&' : '?') + qs;
            const response = method === 'GET' ? await axios.get(tryUrl, { headers }) : await axios.delete(tryUrl, { headers });
            return response.data;
          } else {
            const payload = { action: 'logout' };
            for (const k of ovKeys) {
              if (name) payload[k] = name;
            }
            const response = await axios.post(url, payload, { headers });
            return response.data;
          }
        } catch (e) {
          lastErr = e;
          // Continua tentando próximos métodos em caso de 405/404 ou outros
        }
      }
      if (lastErr) throw lastErr;
    } catch (errOv) {
      // segue para candidatos padrão se override falhar
    }
  }
  const rawCandidates = [
    // sem nome na rota
    '/session/logout',
    '/instance/logout',
    '/disconnect',
    '/session/reset',
    '/instance/reset',
    '/logout',
    '/sessions/logout',
    '/sessions/reset',
    '/sessions/disconnect',
    // com nome na rota
    '/instance/:name/logout',
    '/instances/:name/logout',
    '/session/:name/logout',
    '/sessions/:name/logout',
    '/disconnect/:name',
    '/logout/:name',
    '/instance/:name/reset',
    '/session/:name/reset',
    '/instances/:name/reset',
    '/session/:name/disconnect',
    '/sessions/:name/disconnect',
    '/instance/:name/disconnect',
    '/instances/:name/disconnect',
    '/session/:name/delete',
    '/instance/:name/delete',
    '/sessions/:name/delete',
    '/instances/:name/delete'
  ];
  // caminhos administrativos comuns
  const adminCandidates = [
    '/admin/instance/:name/logout',
    '/admin/instances/:name/logout',
    '/admin/session/:name/logout',
    '/admin/sessions/:name/logout',
    '/admin/instance/:name/reset',
    '/admin/instances/:name/reset',
    '/admin/disconnect/:name',
    '/admin/logout/:name',
    '/admin/disconnect',
    '/admin/logout',
    '/admin/session/:name/disconnect',
    '/admin/sessions/:name/disconnect',
    '/admin/instance/:name/disconnect',
    '/admin/instances/:name/disconnect',
    '/admin/session/:name/delete',
    '/admin/sessions/:name/delete',
    '/admin/instance/:name/delete',
    '/admin/instances/:name/delete',
    '/admin/sessions/disconnect',
    '/admin/sessions/logout'
  ];
  const bodyKeys = ['instance', 'name', 'session', 'sessionId', 'instanceName', 'session_id'];
  const queryKeys = ['instance', 'name', 'session', 'sessionId', 'instanceName', 'session_id'];
  let lastError;
  const allCandidates = [...rawCandidates, ...adminCandidates];
  for (const pathTmpl of allCandidates) {
    const path = pathTmpl.includes(':name') ? pathTmpl.replace(':name', encodeURIComponent(name)) : pathTmpl;
    const url = `${base}${path}`;
    try {
      // tenta múltiplas chaves no corpo
      let response;
      for (const key of bodyKeys) {
        const payload = name ? { [key]: name, action: 'logout' } : { action: 'logout' };
        try {
          // Usa headers admin para rotas que começam com /admin, caso contrário usa token da instância
          const headers = path.startsWith('/admin') ? adminHeaders : instanceHeaders;
          response = await axios.post(url, payload, { headers });
          break;
        } catch (errPostVariant) {
          lastError = errPostVariant;
        }
      }
      if (!response) throw lastError || new Error('POST falhou em todas variantes');
      return response.data;
    } catch (errPost) {
      lastError = errPost;
      // tentativa GET com querystring
      try {
        // tenta múltiplas chaves na query
        let response;
        for (const qk of queryKeys) {
          const params = new URLSearchParams();
          if (name) params.set(qk, name);
          params.set('action', 'logout');
          try {
            const headers = path.startsWith('/admin') ? adminHeaders : instanceHeaders;
            response = await axios.get(`${url}?${params.toString()}`, { headers });
            break;
          } catch (errGetVariant) {
            lastError = errGetVariant;
          }
        }
        if (!response) throw lastError || new Error('GET falhou em todas variantes');
        return response.data;
      } catch (errGet) {
        lastError = errGet;
        // tentativa DELETE com querystring
        try {
          let response;
          for (const qk of queryKeys) {
            const params = new URLSearchParams();
            if (name) params.set(qk, name);
            params.set('action', 'logout');
            try {
              const headers = path.startsWith('/admin') ? adminHeaders : instanceHeaders;
              response = await axios.delete(`${url}?${params.toString()}`, { headers });
              break;
            } catch (errDelVariant) {
              lastError = errDelVariant;
            }
          }
          if (!response) throw lastError || new Error('DELETE falhou em todas variantes');
          return response.data;
        } catch (errDel) {
          lastError = errDel;
          // segue para próximo candidato
        }
      }
    }
  }
  throw new Error(`Falha ao desconectar instância da UAZAPI: ${lastError?.response?.data?.message || lastError?.message || 'erro desconhecido'}`);
}

module.exports = {
  name: 'uazapi',
  // Expor resolução de token por instância para uso pelo backend
  resolveInstanceToken,
  sendSimpleText,
  sendCarouselMessage,
  configureWebhook,
  disconnectInstance,
  // Conecta uma instância ao WhatsApp usando o token da própria instância
  async connectInstance({ instance, phone, tokenOverride }) {
    const base = getBaseUrl();
    const name = String(instance || '').trim();
    if (!name) throw new Error('Nome da instância não informado para conexão');
    // Resolve o token específico da instância
    let token = String(tokenOverride || '').trim();
    if (!token) {
      token = await resolveInstanceToken(name);
    }
    // Controle de fallback global via .env
    const disableGlobalFallback = String(process.env.UAZAPI_DISABLE_GLOBAL_FALLBACK || '').toLowerCase() === 'true';
    // Fallback explícito para PROV_TOKEN quando não houver token resolvido (se não desativado)
    if (!token) {
      if (disableGlobalFallback) {
        throw new Error('Token da instância não resolvido. Crie a instância e use o token específico.');
      }
      token = String(process.env.PROV_TOKEN || '').trim();
    }
    // Fallback: usa PROV_TOKEN do .env quando não encontrar token da instância
    // Isso atende servidores que vinculam sessão apenas ao PROV_TOKEN (sem nome).
    const headers = authHeaders({ admin: false, tokenOverride: token });
    // Pré-checagem: se já está conectado, retorna status e evita erro 500
    try {
      const statusResp = await axios.get(`${base}/instance/status`, { headers });
      const s = statusResp.data?.status || statusResp.data;
      const connected = Boolean(s?.connected || statusResp.data?.connected);
      if (connected) {
        return statusResp.data;
      }
    } catch (_) {
      // Ignora falha de status e prossegue para tentar conectar
    }
    const url = `${base}/instance/connect`;
    const payload = {};
    if (phone) payload.phone = String(phone).replace(/\D/g, '');
    const response = await axios.post(url, payload, { headers });
    return response.data;
  },
  // Obtém o status detalhado de uma instância (inclui QR/paircode quando conectando)
  async getInstanceStatus({ instance, tokenOverride }) {
    const base = getBaseUrl();
    const name = String(instance || '').trim();
    if (!name) throw new Error('Nome da instância não informado para status');
    let token = String(tokenOverride || '').trim();
    if (!token) {
      token = await resolveInstanceToken(name);
    }
    // Controle de fallback global via .env
    const disableGlobalFallback = String(process.env.UAZAPI_DISABLE_GLOBAL_FALLBACK || '').toLowerCase() === 'true';
    // Fallback: usa PROV_TOKEN do .env quando não encontrar token da instância (se não desativado)
    if (!token) {
      if (disableGlobalFallback) {
        throw new Error('Token da instância não resolvido. Crie a instância e use o token específico.');
      }
      token = String(process.env.PROV_TOKEN || '').trim();
    }
    const headers = authHeaders({ admin: false, tokenOverride: token });
    const url = `${base}/instance/status`;
    const response = await axios.get(url, { headers });
    return response.data;
  },
  async createInstance({ instance, options = {} }) {
    const base = getBaseUrl();
    const headers = authHeaders({ admin: true });
    const name = String(instance || '').trim();
    const extra = options || {};

    // Overrides via .env têm prioridade
    const ovPath = process.env.UAZAPI_ADMIN_CREATE_PATH || process.env.UAZAPI_CREATE_PATH;
    const ovMethod = String(process.env.UAZAPI_ADMIN_CREATE_METHOD || process.env.UAZAPI_CREATE_METHOD || 'POST').toUpperCase();
    const ovKeys = getKeysEnv('UAZAPI_ADMIN_CREATE_KEYS', ['name', 'instance', 'session', 'sessionId', 'instanceName']);
    if (ovPath) {
      try {
        let path = expandPathWithInstance(ovPath, name);
        let url = `${base}${path}`;
        if (ovMethod === 'GET') {
          const params = new URLSearchParams();
          for (const k of ovKeys) if (name) params.set(k, name);
          // inclui campos extras opcionais
          Object.entries(extra).forEach(([k, v]) => { if (v != null) params.set(k, String(v)); });
          const qs = params.toString();
          if (qs) url += (url.includes('?') ? '&' : '?') + qs;
          const response = await axios.get(url, { headers });
          return response.data;
        } else {
          const payload = {};
          for (const k of ovKeys) if (name) payload[k] = name;
          Object.assign(payload, extra);
          const response = await axios.post(url, payload, { headers });
          return response.data;
        }
      } catch (errOv) {
        // cai para candidatos padrão
      }
    }

    // Candidatos padrão comuns
    const candidates = [
      '/instance/init',
      '/admin/instance/create',
      '/admin/instances/create',
      '/admin/session/create',
      '/admin/sessions/create',
      '/admin/create/instance',
      '/admin/create/session',
      '/instance/create',
      '/session/create',
      '/create/instance',
      '/create/session'
    ];
    const bodyKeys = ['name', 'instance', 'session', 'sessionId', 'instanceName'];

    let lastError;
    for (const path of candidates) {
      const url = `${base}${expandPathWithInstance(path, name)}`;
      // tenta POST com várias chaves
      try {
        let response;
        for (const key of bodyKeys) {
          const payload = { ...extra };
          if (name) payload[key] = name;
          try {
            response = await axios.post(url, payload, { headers });
            break;
          } catch (errPostVariant) {
            lastError = errPostVariant;
          }
        }
        if (!response) throw lastError || new Error('POST falhou em todas variantes');
        return response.data;
      } catch (errPost) {
        lastError = errPost;
        // tenta GET com query
        try {
          const params = new URLSearchParams();
          for (const key of bodyKeys) if (name) params.set(key, name);
          Object.entries(extra).forEach(([k, v]) => { if (v != null) params.set(k, String(v)); });
          const response = await axios.get(`${url}?${params.toString()}`, { headers });
          return response.data;
        } catch (errGet) {
          lastError = errGet;
        }
      }
    }
    throw new Error(`Falha ao criar instância na UAZAPI: ${lastError?.response?.data?.message || lastError?.message || 'erro desconhecido'}`);
  },
  async getQrCode(options = {}) {
    const base = getBaseUrl();
    const useAdmin = Boolean(options.instance);
    let tokenOverride = String(options.tokenOverride || '').trim();
    // Se só foi informado o nome da instância, tentar resolver o token via rotas admin
    if (!tokenOverride && options.instance) {
      try {
        const resolved = await resolveInstanceToken(options.instance);
        if (resolved) tokenOverride = resolved;
      } catch (e) {
        // silencia erro de resolução, seguirá com admin paths
      }
    }
    const headers = authHeaders({ admin: useAdmin, tokenOverride });
    const normalCandidates = [
      '/qrcode',
      '/whatsapp/qr',
      '/status/qrcode',
      '/instance/qr',
      '/connect/qr',
      '/status/instance',
      '/status',
      '/instance/status',
      '/get/qr',
      '/qr'
    ];
    const adminCandidates = [
      '/admin/status/instance',
      '/admin/instance/status',
      '/admin/instance/qr',
      '/admin/status/qrcode',
      '/admin/get/qr',
      '/admin/qr'
    ];
  const candidates = useAdmin ? [...adminCandidates, ...normalCandidates] : normalCandidates;
  let lastError;
  let lastTriedUrl = '';
    // Overrides via .env para QR (tentativa preferencial)
    const ovQrPath = useAdmin ? (process.env.UAZAPI_ADMIN_QR_PATH || process.env.UAZAPI_QR_PATH) : process.env.UAZAPI_QR_PATH;
    const ovQrMethod = String(process.env.UAZAPI_ADMIN_QR_METHOD || process.env.UAZAPI_QR_METHOD || 'GET').toUpperCase();
    const ovQrKeys = getKeysEnv('UAZAPI_ADMIN_QR_KEYS', ['instance', 'name', 'session', 'sessionId', 'instanceName', 'keys']);
    const ovQrForce = String(process.env.UAZAPI_ADMIN_QR_FORCE || process.env.UAZAPI_QR_FORCE || '').toLowerCase() === 'true';
    if (ovQrPath) {
      try {
        let path = expandPathWithInstance(ovQrPath, options.instance);
        let url = `${base}${path}`;
        if (ovQrMethod === 'GET') {
          const params = new URLSearchParams();
          if (options.force || ovQrForce) params.set('force', 'true');
          if (options.instance) {
            for (const k of ovQrKeys) params.set(k, options.instance);
          }
          const qs = params.toString();
          if (qs) url += (url.includes('?') ? '&' : '?') + qs;
          lastTriedUrl = url;
          console.log('[uazapi.getQrCode] Override GET:', url, 'admin=', useAdmin);
          const response = await axios.get(url, { headers });
          console.log('[uazapi.getQrCode] Override GET sucesso:', url, 'admin=', useAdmin);
          return response.data;
        } else {
          const payload = {};
          if (options.force || ovQrForce) payload.force = true;
          if (options.instance) {
            for (const k of ovQrKeys) payload[k] = options.instance;
          }
          lastTriedUrl = `${url} [OVERRIDE ${ovQrMethod}]`;
          console.log('[uazapi.getQrCode] Override', ovQrMethod, url, 'admin=', useAdmin);
          const response = await axios.post(url, payload, { headers });
          console.log('[uazapi.getQrCode] Override sucesso', ovQrMethod, url, 'admin=', useAdmin);
          return response.data;
        }
      } catch (errOvQr) {
        lastError = errOvQr;
        if (errOvQr.response) {
          console.error('[uazapi.getQrCode] Falha override:', lastTriedUrl, { status: errOvQr.response.status, data: errOvQr.response.data });
        } else {
          console.error('[uazapi.getQrCode] Erro de rede override:', lastTriedUrl, errOvQr.message);
        }
        // prossegue para candidatos padrão
      }
    }
  for (const path of candidates) {
      try {
        const url = `${base}${path}`;
        // 1) GET: inclui múltiplas chaves de query para instância
        const params = new URLSearchParams();
        if (options.force) params.set('force', 'true');
        if (options.instance) {
          for (const qk of ['instance', 'name', 'session', 'sessionId', 'instanceName', 'keys']) {
            params.set(qk, options.instance);
          }
        }
        const qs = params.toString();
        const getUrl = qs ? `${url}?${qs}` : url;
        lastTriedUrl = getUrl;
        console.log('[uazapi.getQrCode] Tentando GET:', getUrl, 'admin=', useAdmin);
        const response = await axios.get(getUrl, { headers });
        console.log('[uazapi.getQrCode] Sucesso GET:', getUrl, 'admin=', useAdmin);
        return response.data;
      } catch (err) {
        lastError = err;
        if (err.response) {
          console.error('[uazapi.getQrCode] Falha GET:', lastTriedUrl, { status: err.response.status, data: err.response.data });
        } else {
          console.error('[uazapi.getQrCode] Erro de rede GET:', lastTriedUrl, err.message);
        }
        // 2) POST: se instância foi informada, tenta variações de chave no corpo
        if (options.instance) {
          const url = `${base}${path}`;
          for (const key of ['instance', 'name', 'session', 'sessionId', 'instanceName', 'keys']) {
            try {
              const payload = {};
              if (options.force) payload.force = true;
              payload[key] = options.instance;
              lastTriedUrl = `${url} [POST bodyKey=${key}]`;
              console.log('[uazapi.getQrCode] Tentando POST:', url, 'bodyKey=', key, 'admin=', useAdmin);
              const response = await axios.post(url, payload, { headers });
              console.log('[uazapi.getQrCode] Sucesso POST:', url, 'bodyKey=', key, 'admin=', useAdmin);
              return response.data;
            } catch (errPost) {
              lastError = errPost;
              if (errPost.response) {
                console.error('[uazapi.getQrCode] Falha POST:', lastTriedUrl, { status: errPost.response.status, data: errPost.response.data });
              } else {
                console.error('[uazapi.getQrCode] Erro de rede POST:', lastTriedUrl, errPost.message);
              }
            }
          }
        }
        // segue para próximo candidato
      }
    }
    const msg = lastError?.response?.data?.message || lastError?.message || 'erro desconhecido';
    throw new Error(`Falha ao obter QR Code: ${msg} (última URL: ${lastTriedUrl || 'N/A'})`);
  },
};