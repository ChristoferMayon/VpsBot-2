// Externalized index page logic for CSP compliance
// Tailwind CDN config (optional); moving from inline <script>
try {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = {
    theme: {
      extend: {
        fontFamily: { inter: ['Inter', 'system-ui', 'sans-serif'] },
        colors: {
          brand: {
            50: '#E6F1FF', 100: '#CCE3FF', 200: '#99C6FF', 300: '#66A8FF', 400: '#338BFF', 500: '#006DFF',
            600: '#0058CC', 700: '#004399', 800: '#002E66', 900: '#001933'
          }
        }
      }
    }
  };
} catch (_) {}

// Tabs and section activation
(() => {
  const tabs = document.querySelectorAll('#main-tabs .tab-btn');
  const sections = {
    carousel: document.getElementById('tab-carousel'),
    text: document.getElementById('tab-text'),
    qr: document.getElementById('tab-qr'),
  };
  function activateTab(name) {
    tabs.forEach(btn => {
      const isActive = btn.dataset.tab === name;
      try {
        btn.classList.remove('bg-white/10','bg-white/5','bg-emerald-500/20','bg-emerald-500/30');
        btn.classList.add(isActive ? 'bg-emerald-500/30' : 'bg-emerald-500/20');
      } catch (_) {
        const base = btn.className.replace(/\b(bg-(white|emerald)-\d+\/\d+|bg-white\/(5|10))\b/g,'').trim();
        btn.className = base + ' ' + (isActive ? 'bg-emerald-500/30' : 'bg-emerald-500/20');
      }
    });
    Object.entries(sections).forEach(([k, el]) => {
      if (el) el.classList.toggle('hidden', k !== name);
    });
    if (name === 'qr') {
      try { if (typeof window.initUserInstanceQrTab === 'function') window.initUserInstanceQrTab(); } catch (_) {}
    }
  }
  // expose for other scripts (e.g., realtime banner)
  window.activateTab = activateTab;

  tabs.forEach(btn => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
  try {
    const params = new URLSearchParams(window.location.search);
    const fromParam = (params.get('tab') || '').trim();
    const valid = ['carousel','text','qr'];
    const initial = valid.includes(fromParam) ? fromParam : 'carousel';
    activateTab(initial);
  } catch (_) {
    activateTab('carousel');
  }
})();

// Admin tab visibility and redirect
(() => {
  const btnAdmin = document.getElementById('admin-tab-btn');
  if (!btnAdmin) return;
  const isAdmin = Boolean(localStorage.getItem('adminToken')) || (localStorage.getItem('authRole') === 'admin');
  btnAdmin.style.display = isAdmin ? 'inline-flex' : 'none';
  btnAdmin.addEventListener('click', () => {
    window.location.href = '/admin.html';
  });
})();

// Logout button visibility and behavior
(() => {
  const btnLogout = document.getElementById('logout-btn');
  if (!btnLogout) return;
  const hasSession = Boolean(localStorage.getItem('adminToken')) || Boolean(localStorage.getItem('authRole'));
  btnLogout.style.display = hasSession ? 'inline-flex' : 'none';
  btnLogout.addEventListener('click', () => {
    try {
      localStorage.removeItem('authToken');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('authRole');
      localStorage.removeItem('authUser');
    } catch (e) {}
    try { window.authFetch('/logout', { method: 'POST' }); } catch (_) {}
    window.location.href = '/login.html';
  });
})();

// Attach handlers for buttons previously using inline onclick
(() => {
  const byId = (id) => document.getElementById(id);
  const bind = (id, fnName) => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('click', () => {
      try {
        const fn = window[fnName];
        if (typeof fn === 'function') return fn();
        console.warn(`[index.js] função não encontrada: ${fnName}`);
      } catch (e) {
        console.warn(`[index.js] erro ao chamar ${fnName}:`, e?.message || String(e));
      }
    });
  };
  bind('add-carousel-card-btn', 'addCarouselCard');
  bind('send-carousel-btn', 'enviarCarrossel');
  bind('send-text-btn', 'sendSimpleText');
  bind('qr-create-btn', 'qrCreateInstance');
  // Use connect-then-force QR for mais consistência
  bind('qr-connect-btn', 'qrConnectThenForceQr');
  bind('qr-status-btn', 'qrGetStatus');
  bind('qr-copy-btn', 'qrCopyPaircode');
})();

// Bind change event for carouselTemplate (removes inline onchange)
(() => {
  const sel = document.getElementById('carouselTemplate');
  if (!sel) return;
  sel.addEventListener('change', () => {
    try {
      if (typeof window.loadCarouselTemplate === 'function') window.loadCarouselTemplate();
    } catch (_) {}
  });
})();

// Prefill instance name from logged-in user
(() => {
  (async function prefillInstanceNameFromUser(){
    try {
      const input = document.getElementById('qr-instance');
      if (!input) return;
      if (input.value && input.value.trim()) return;
      const r = await window.authFetch('/me', { method: 'GET' });
      const j = await r.json().catch(() => ({}));
      const username = (j && j.user && j.user.username) ? String(j.user.username).trim() : '';
      try {
        const norm = (typeof window.normalizeInstanceName === 'function') ? window.normalizeInstanceName(username) : String(username).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,32);
        if (norm) input.value = norm;
      } catch(_) {
        if (username) input.value = username;
      }
    } catch (_) {}
  })();
})();

// Realtime banner using Socket.IO
(() => {
  const el = (id) => document.getElementById(id);
  const banner = el('rt-banner');
  const textEl = el('rt-banner-text');
  const subEl = el('rt-banner-sub');
  const btnClose = el('rt-banner-close');
  const btnGo = el('rt-banner-go');

  function showBanner(msg, sub){
    if (textEl) textEl.textContent = msg || 'Conectado com sucesso';
    if (subEl) subEl.textContent = sub || '';
    if (banner) banner.style.display = '';
  }
  function hideBanner(){ if (banner) banner.style.display = 'none'; }

  if (btnClose) btnClose.addEventListener('click', hideBanner);
  if (btnGo) btnGo.addEventListener('click', function(){
    try { if (typeof window.activateTab === 'function') return window.activateTab('text'); } catch(_) {}
    window.location.href = '/painel/envio';
  });

  (async function connectSocket(){
    try {
      const authToken = 'cookie';
      let uid = null;
      try {
        const r = await window.authFetch('/me', { method: 'GET' });
        const j = await r.json().catch(() => ({}));
        uid = j?.user?.id || null;
      } catch (_) {}
      if (!uid) return;

      let ioClient = null;
      try { ioClient = window.io ? window.io() : null; } catch (e) { console.warn('[Socket.IO] indisponível no frontend:', e?.message || String(e)); return; }
      if (!ioClient) return;
      try { ioClient.emit('register', { user_id: uid }); } catch (_) {}

      const evt = `instance_connected:${uid}`;
      const handleConnected = async () => {
        try {
          const details = { instance: '', deviceName: '', phone: '' };
          try {
            const s = await window.authFetch('/user/instance-status', { method: 'GET' });
            const d = await s.json().catch(() => ({}));
            details.instance = (d?.instance_name || d?.instance || '');
            details.deviceName = (d?.deviceName || d?.status?.deviceName || '');
            details.phone = (d?.phoneNumber || d?.status?.phoneNumber || '');
          } catch (_) {}
          const parts = [];
          if (details.instance) parts.push(`Instância: ${details.instance}`);
          if (details.deviceName) parts.push(`Dispositivo: ${details.deviceName}`);
          if (details.phone) parts.push(`Número: ${details.phone}`);
          showBanner('WhatsApp conectado', parts.join(' • '));
        } catch (e) {
          showBanner('WhatsApp conectado', 'Conexão confirmada.');
        }
      };
      ioClient.on(evt, handleConnected);
      ioClient.on('instance_connected', handleConnected);
      console.log('[Socket.IO] ouvindo', evt);
    } catch (e) {
      console.warn('[RealtimeBanner] falhou:', e?.message || String(e));
    }
  })();
})();

// ---- Validations and API config (moved from inline) ----
(function(){
  function isUrlLike(value) {
    if (!value) return false;
    const v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return true;
    if (/^www\./i.test(v)) return true;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return true;
    return false;
  }
  window.isUrlLike = isUrlLike;

  const __api = window.APP_API || null;
  const __base = (__api && __api.proxyBaseUrl) ? __api.proxyBaseUrl : window.location.origin;
  const __sendTextUrl = (__api && __api.urls && __api.urls.sendText) ? __api.urls.sendText : `${__base}/send-simple-text`;
  const __configureWebhookUrl = (__api && __api.urls && __api.urls.configureWebhook) ? __api.urls.configureWebhook : `${__base}/configure-webhook`;
  const __getQrUrl = `${__base}/get-qr-code`;
  window.__APP_API_BASE = { __api, __base, __sendTextUrl, __configureWebhookUrl, __getQrUrl };

  const validateBtn = document.getElementById('ai-validate');
  if (validateBtn) validateBtn.addEventListener('click', () => {
    const issues = [];
    const cardEditors = document.querySelectorAll('.card-editor');
    cardEditors.forEach(cardEditor => {
      const cardId = cardEditor.getAttribute('data-card-id');
      const img = document.getElementById(`card-image-${cardId}`)?.value?.trim() || '';
      if (!img || !isUrlLike(img)) {
        issues.push(`Cartão #${cardId}: imagem deve ser um link válido (pode ser sem https).`);
      }
      const buttonEditors = cardEditor.querySelectorAll('.button-editor');
      buttonEditors.forEach((_, i) => {
        const type = document.getElementById(`button-type-${cardId}-${i}`)?.value || '';
        const label = document.getElementById(`button-label-${cardId}-${i}`)?.value?.trim() || '';
        if (!label) issues.push(`Cartão #${cardId} Botão #${i+1}: falta label.`);
        if (type === 'URL') {
          const url = document.getElementById(`button-url-${cardId}-${i}`)?.value?.trim() || '';
          if (!url || !isUrlLike(url)) {
            issues.push(`Cartão #${cardId} Botão #${i+1}: informe um link válido (pode ser sem https).`);
          }
        } else if (type === 'CALL') {
          const phone = document.getElementById(`button-phone-${cardId}-${i}`)?.value?.trim() || '';
          if (!phone || !/^\d{10,15}$/.test(phone)) {
            issues.push(`Cartão #${cardId} Botão #${i+1}: informe um telefone válido com DDI (somente dígitos).`);
          }
        } else if (type === 'COPY') {
          const copyText = document.getElementById(`button-copy-${cardId}-${i}`)?.value?.trim() || '';
          if (!copyText) {
            issues.push(`Cartão #${cardId} Botão #${i+1}: informe o texto para copiar (ex: CUPOM20).`);
          }
        }
      });
    });
    const log = document.getElementById('log');
    if (!log) return;
    if (issues.length === 0) {
      log.innerText = '✅ Validação Inteligente: nenhum problema encontrado.';
    } else {
      log.innerText = '⚠️ Validação Inteligente encontrou itens:\n' + issues.map(i => '- ' + i).join('\n');
    }
  });
})();

// ---- Credits badge and series navigation ----
(function(){
(async function setupCreditsBadge() {
  const badge = document.getElementById('credits-badge');
  if (!badge) return;
  const authRole = localStorage.getItem('authRole') || '';
  const hasSession = Boolean(authRole);
  if (!hasSession) {
    badge.style.display = 'none';
    return;
  }
  const cached = Number(localStorage.getItem('authCredits') || 0);
  if (!Number.isNaN(cached)) {
    badge.textContent = 'Créditos: ' + cached;
    badge.style.display = 'inline-flex';
  }
  try {
    const apiBase = (window.APP_API && window.APP_API.proxyBaseUrl) ? window.APP_API.proxyBaseUrl : window.location.origin;
    const res = await window.authFetch(apiBase.replace(/\/$/, '') + '/me', { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json();
    const credits = Number(data?.user?.credits || 0);
    badge.textContent = 'Créditos: ' + credits;
    try { localStorage.setItem('authCredits', String(credits)); } catch (_) {}
    badge.style.display = 'inline-flex';
  } catch (_) {
    if (!cached) {
      badge.textContent = 'Créditos: 0';
      badge.style.display = 'inline-flex';
    }
  }
})();

// ---- Expiry badge (dias restantes) ----
(function(){
(async function setupExpiryBadge() {
  const badge = document.getElementById('expiry-badge');
  if (!badge) return;
  const role = localStorage.getItem('authRole') || '';
  const hasSession = Boolean(role);
  if (!hasSession) { badge.style.display = 'none'; return; }

  function setBadgeStyleDanger() {
    try {
      badge.classList.remove('border-amber-400/50','bg-amber-500/10','text-amber-300');
      badge.classList.add('border-red-400/40','bg-red-500/20','text-red-200');
    } catch (_) {}
  }
  function setBadgeStyleWarn() {
    try {
      badge.classList.remove('border-red-400/40','bg-red-500/20','text-red-200');
      badge.classList.add('border-amber-400/50','bg-amber-500/10','text-amber-300');
    } catch (_) {}
  }

  // Oculta para administradores (sem prazo de expiração)
  if (role === 'admin') { badge.style.display = 'none'; return; }

  try {
    const apiBase = (window.APP_API && window.APP_API.proxyBaseUrl) ? window.APP_API.proxyBaseUrl : window.location.origin;
    const res = await window.authFetch(apiBase.replace(/\/$/, '') + '/me', { method: 'GET' });
    if (!res.ok) { badge.textContent = 'Dias restantes: --'; badge.style.display = 'inline-flex'; return; }
    const data = await res.json();
    const expTs = Number(data?.user?.expires_at || 0);
    if (!expTs) { badge.textContent = 'Dias restantes: --'; setBadgeStyleWarn(); badge.style.display = 'inline-flex'; return; }
    const diff = expTs - Date.now();
    if (diff <= 0) {
      badge.textContent = 'Acesso expirado';
      setBadgeStyleDanger();
      badge.style.display = 'inline-flex';
      return;
    }
    const days = Math.ceil(diff / (24*60*60*1000));
    badge.textContent = 'Dias restantes: ' + days;
    setBadgeStyleWarn();
    badge.style.display = 'inline-flex';
  } catch (_) {
    badge.textContent = 'Dias restantes: --';
    setBadgeStyleWarn();
    badge.style.display = 'inline-flex';
  }
})();
})();

  function renderSeriesNav() {
    const container = document.getElementById('series-nav');
    if (!container || !window.carouselTemplates) return;
    container.innerHTML = '';
    window.carouselTemplates.forEach(t => {
      const chip = document.createElement('button');
      chip.className = 'px-3 py-1 rounded-none border border-white/20 bg-white/5 hover:bg-white/10 text-sm';
      chip.textContent = t.name;
      chip.addEventListener('click', () => {
        const sel = document.getElementById('carouselTemplate');
        if (sel) sel.value = t.id;
        try { if (typeof window.loadCarouselTemplate === 'function') window.loadCarouselTemplate(); } catch (_) {}
      });
      container.appendChild(chip);
    });
  }
  document.addEventListener('DOMContentLoaded', renderSeriesNav);
})();

// ---- QR tab logic and message/webhook functions ----
(function(){
  // --- Instance name helpers (shared with QR tab) ---
  function normalizeInstanceName(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    let out = s.replace(/\s+/g, '-').replace(/_/g, '-');
    out = out.replace(/[^a-z0-9-]/g, '-');
    out = out.replace(/-+/g, '-');
    out = out.replace(/^-+|-+$/g, '');
    if (out.length > 32) out = out.slice(0, 32);
    return out;
  }
  function isValidInstanceName(name) {
    const s = String(name || '');
    if (s.length < 3 || s.length > 32) return false;
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
  }
  window.normalizeInstanceName = normalizeInstanceName;
  window.isValidInstanceName = isValidInstanceName;

  const { __base, __sendTextUrl, __configureWebhookUrl } = (window.__APP_API_BASE || {});

  async function initUserInstanceQrTab() {
    try {
      const authToken = 'cookie';
      const instInput = document.getElementById('qr-instance');
      const statusEl = document.getElementById('qr-status');
      const meResp = await window.authFetch(`${__base}/me`, { method: 'GET' });
      const meData = await meResp.json().catch(() => ({}));
      if (meResp.ok && meData && meData.user) {
        const name = meData.user.instance_name || '';
        if (name && instInput) instInput.value = name;
      }
      const st = await window.authFetch(`${__base}/user/instance-status`, { method: 'GET' });
      const stData = await st.json().catch(() => ({}));
      if (st.ok && stData && stData.status) {
        const connected = Boolean(stData.status.connected);
        const img = document.getElementById('qr-image');
        const placeholderEl = document.getElementById('qr-placeholder');
        if (connected) {
          if (statusEl) statusEl.textContent = '✅ WhatsApp conectado. Você pode enviar mensagens agora.';
          if (img) img.style.display = 'none';
          if (placeholderEl) placeholderEl.style.display = '';
        } else {
          if (statusEl) statusEl.textContent = 'Aguardando conexão. Gere o QR e escaneie no WhatsApp.';
        }
      }
    } catch (e) {
      console.warn('[initUserInstanceQrTab] falha:', e);
    }
  }
  window.initUserInstanceQrTab = initUserInstanceQrTab;

  async function sendSimpleText() {
    const phone = document.getElementById('textPhone')?.value?.trim() || '';
    const message = document.getElementById('textMessage')?.value?.trim() || '';
    const log = document.getElementById('textLog');
    if (!log) return;
    if (!phone || !message) { log.innerText = '❌ Informe telefone e mensagem.'; return; }
    try {
      log.innerText = 'Enviando texto simples...';
      const authToken = localStorage.getItem('authToken');
      const response = await fetch(__sendTextUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ phone, message })
      });
      const contentType = response.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        log.innerText = '⚠️ Resposta não-JSON recebida do proxy.\n' +
          `Status: ${response.status} ${response.statusText}\n` +
          `Content-Type: ${contentType}\n` +
          `Corpo bruto:\n${rawText}`;
        console.warn('Resposta não-JSON do proxy (texto):', { status: response.status, contentType, rawText });
        return;
      }
      if (response.ok) {
        log.innerText = '✅ Sua mensagem foi enviada com sucesso — Unlock Center agradece';
        try { Swal.fire({ icon: 'success', title: 'Mensagem enviada!', text: 'Seu texto foi enviado com sucesso.', confirmButtonText: 'Ok', customClass: { popup: 'swal-red-custom' } }); } catch (_) {}
      } else {
        log.innerText = '❌ Erro ao enviar texto:\n' + JSON.stringify(data, null, 2);
      }
    } catch (error) {
      log.innerText = '❌ Erro de conexão com o proxy:\n' + error.message;
    }
  }
  window.sendSimpleText = sendSimpleText;

  async function configureWebhook() {
    const publicUrl = document.getElementById('publicUrl')?.value?.trim() || '';
    const log = document.getElementById('webhookLog');
    if (!log) return;
    if (!publicUrl) { log.innerText = '❌ Informe a URL pública.'; return; }
    try {
      log.innerText = 'Configurando webhook...';
      const response = await fetch(__configureWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicUrl }) });
      const contentType = response.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        log.innerText = '⚠️ Resposta não-JSON recebida do proxy.\n' +
          `Status: ${response.status} ${response.statusText}\n` +
          `Content-Type: ${contentType}\n` +
          `Corpo bruto:\n${rawText}`;
        console.warn('Resposta não-JSON do proxy (webhook):', { status: response.status, contentType, rawText });
        return;
      }
      if (response.ok) {
        log.innerText = '✅ Webhook configurado:\n' + JSON.stringify(data, null, 2);
      } else {
        log.innerText = '❌ Erro ao configurar webhook:\n' + JSON.stringify(data, null, 2);
      }
    } catch (error) {
      log.innerText = '❌ Erro de conexão com o proxy:\n' + error.message;
    }
  }
  window.configureWebhook = configureWebhook;

  function qrLog(msg) {
    const logEl = document.getElementById('qr-log');
    if (!logEl) return;
    const ts = new Date().toISOString();
    logEl.textContent += `\n[${ts}] ${msg}`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  window.qrLog = qrLog;

  function extractTokenFromPayload(data) {
    const candidates = [data?.token, data?.raw?.token, data?.raw?.data?.token, data?.raw?.instance?.token, data?.instance?.token, data?.status?.token].filter((v) => typeof v === 'string' && v.trim());
    return candidates.length ? candidates[0] : '';
  }
  window.extractTokenFromPayload = extractTokenFromPayload;

  function extractQrFromPayload(data) {
    const info = data?.info || {};
    const status = data?.status || {};
    const candidates = [
      data?.qrCode, data?.qrcode, data?.qr, data?.base64,
      info?.qrCode, info?.qrcode, info?.qr, info?.base64,
      status?.qrCode, status?.qrcode, status?.qr, status?.base64,
      data?.url, info?.url, status?.url, status?.qr_url,
      status?.qr_image, status?.qr_image_base64,
      data?.raw?.instance?.qrcode,
      data?.raw?.instance?.qr_image,
      data?.raw?.status?.qrcode,
      data?.raw?.status?.qr_image,
      data?.raw?.qrcode,
      data?.raw?.data?.qrCode,
      data?.raw?.data?.qrcode,
      data?.raw?.data?.qr,
      data?.raw?.data?.base64,
      data?.raw?.data?.url,
      data?.raw?.data?.qr_image,
      data?.raw?.data?.qr_image_base64
    ].filter((v) => typeof v === 'string' && v.trim());
    return candidates.length ? candidates[0] : '';
  }
  window.extractQrFromPayload = extractQrFromPayload;

  function extractPaircodeFromPayload(data) {
    const status = data?.status || {};
    const candidates = [data?.paircode, status?.paircode, data?.instance?.paircode, data?.raw?.instance?.paircode, data?.raw?.paircode].filter((v) => typeof v === 'string' && v.trim());
    return candidates.length ? candidates[0] : '';
  }
  window.extractPaircodeFromPayload = extractPaircodeFromPayload;

  function renderQrFromPayload(payload) {
    try {
      let qr = '';
      if (typeof payload?.format === 'string') {
        const fmt = payload.format.toLowerCase();
        if (fmt === 'url' && typeof payload?.url === 'string' && payload.url.trim()) {
          qr = payload.url.trim();
        } else if ((fmt === 'base64' || fmt === 'dataurl') && typeof payload?.qr === 'string' && payload.qr.trim()) {
          qr = payload.qr.trim();
        }
      }
      if (!qr) { qr = extractQrFromPayload(payload); }
      const pair = extractPaircodeFromPayload(payload);
      const img = document.getElementById('qr-image');
      const statusEl = document.getElementById('qr-status');
      const placeholderEl = document.getElementById('qr-placeholder');
      const pairEl = document.getElementById('paircodeDisplay');
      let openLink = document.getElementById('qr-open-link');
      if (pair && pairEl) { pairEl.value = pair; }
      if (qr) {
        let src = qr;
        if (typeof src === 'string' && !src.startsWith('data:image') && !src.startsWith('http')) {
          src = `data:image/png;base64,${src}`;
        }
        if (img) {
          img.src = src;
          img.onload = () => { qrLog('Imagem de QR carregada com sucesso.'); };
          img.onerror = (e) => { qrLog(`Falha ao carregar imagem do QR: ${e?.message || 'erro desconhecido'}`); };
          img.style.display = '';
        }
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.qr_shown', { page: 'index.js', is_http_url: typeof qr === 'string' && qr.startsWith('http') }); } catch (_) {}
        // Se for URL http(s), oferecer abertura em nova aba para contornar bloqueios
        const isHttpUrl = typeof qr === 'string' && qr.startsWith('http');
        if (isHttpUrl) {
          if (!openLink) {
            openLink = document.createElement('a');
            openLink.id = 'qr-open-link';
            openLink.textContent = 'Abrir QR em nova aba';
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
            openLink.className = 'underline text-emerald-300 ml-2';
            const anchorParent = document.getElementById('paircode-section') || document.getElementById('qr-status') || (img && img.parentNode);
            try { if (anchorParent && anchorParent.parentNode) anchorParent.parentNode.insertBefore(openLink, anchorParent.nextSibling); } catch (_) {}
          }
          try { openLink.href = qr; openLink.style.display = ''; } catch (_) {}
        } else {
          if (openLink) { try { openLink.style.display = 'none'; } catch (_) {} }
        }
        if (placeholderEl) placeholderEl.style.display = 'none';
        if (statusEl) statusEl.textContent = 'QR atualizado. Escaneie no WhatsApp para parear.';
        try { qrLog('Payload recebido para QR: ' + JSON.stringify(payload)); } catch (_) {}
      } else {
        if (img) img.style.display = 'none';
        if (openLink) { try { openLink.style.display = 'none'; } catch (_) {} }
        if (placeholderEl) placeholderEl.style.display = '';
        if (statusEl) statusEl.textContent = 'QR não encontrado no payload. Use Status ou Forçar QR.';
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.qr_hidden', { page: 'index.js', reason: 'no_qr_in_payload', payload_keys: Object.keys(payload || {}) }); } catch (_) {}
        try { qrLog('Payload sem QR detectável: ' + JSON.stringify(payload)); } catch (_) {}
      }
    } catch (e) {
      qrLog(`Erro ao renderizar QR: ${e.message}`);
    }
  }
  window.renderQrFromPayload = renderQrFromPayload;

  async function qrCreateInstance() {
    const raw = document.getElementById('qr-instance')?.value?.trim() || '';
    const name = normalizeInstanceName(raw);
    if (!name) { qrLog('Informe o nome da instância.'); return; }
    if (!isValidInstanceName(name)) {
      qrLog('Nome inválido. Use 3–32 caracteres: letras, números e hífen (sem hífen nas extremidades).');
      return;
    }
    try {
      const response = await fetch(`${__base}/create-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 400) {
          const msg = (data?.error || data?.message || 'Nome de instância inválido ou já existente.');
          qrLog(`Erro 400 ao criar: ${msg}`);
          return;
        }
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      const token = extractTokenFromPayload(data);
      const tokenEl = document.getElementById('qr-token');
      if (token && tokenEl) { tokenEl.value = token; qrLog('Instância criada e token preenchido.'); } else { qrLog('Instância criada, mas token não retornado. Verifique o backend.'); }
      try { renderQrFromPayload(data); await qrGetQr(true); qrLog('QR solicitado automaticamente após criação. Escaneie para conectar.'); } catch (e) { qrLog(`Aviso: falha ao gerar QR automaticamente: ${e.message}. Use os botões abaixo.`); }
    } catch (e) { qrLog(`Erro ao criar instância: ${e.message}`); }
  }
  window.qrCreateInstance = qrCreateInstance;

  async function qrConnectInstance() {
    const phone = document.getElementById('qr-phone')?.value?.trim() || '';
    const hasUser = !!(localStorage.getItem('authUser') || '').trim();
    if (!hasUser) { qrLog('Faça login para conectar sua instância.'); return; }
    try {
      const response = await window.authFetch(`${__base}/user/connect-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { phone } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      qrLog('Conexão iniciada. Renderizando QR/Paircode do retorno...');
      renderQrFromPayload(data);
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const st = await window.authFetch(`${__base}/user/instance-status`, { method: 'GET' });
          const sdata = await st.json().catch(() => ({}));
          const connected = Boolean(sdata?.connected || sdata?.ready || sdata?.loggedIn || sdata?.status?.connected || sdata?.status === 'connected');
          if (connected) {
            clearInterval(poll);
            qrLog('Instância conectada. Você já pode enviar mensagens.');
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_connected', { page: 'index.js', tries }); } catch (_) {}
          } else if (tries >= 8) {
            clearInterval(poll);
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_stopped_no_connect', { page: 'index.js', tries }); } catch (_) {}
            try { await qrGetQr(true); } catch (_) {}
          }
        } catch (_) {}
      }, 1000);
    } catch (e) {
      qrLog(`Erro ao conectar: ${e.message}`);
    }
  }
  window.qrConnectInstance = qrConnectInstance;

  async function qrGetQr(force) {
    const url = new URL(`${__base}/user/get-qr-code`);
    url.searchParams.set('force', force ? 'true' : 'false');
    try {
      const response = await window.authFetch(url.toString(), { method: 'GET' });
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json().catch(() => ({})) : {};
      if (response.ok) {
        qrLog(force ? 'Novo QR solicitado (force=true).' : 'QR solicitado.');
        renderQrFromPayload(data);
        return;
      }
      if (response.status === 400) {
        const errMsg = data?.error || data?.message || 'Requisição inválida (400).';
        if (/manual/i.test(errMsg) || /MANUAL_INSTANCE_MODE/i.test(errMsg)) {
          qrLog('Modo manual ativo: informe nome da instância, crie e vincule token antes de conectar.');
        } else if (/token/i.test(errMsg) || /PROV_TOKEN/i.test(errMsg)) {
          qrLog('Token da instância ausente/ inválido. Preencha o campo "Token" ou crie a instância para obter automaticamente.');
        } else {
          try { qrLog('Erro 400 ao obter QR: ' + JSON.stringify(data, null, 2)); } catch (_) { qrLog(errMsg); }
        }
      } else {
        const msg = data?.error || data?.message || `HTTP ${response.status}`;
        qrLog(`Erro ao obter QR: ${msg}`);
      }
    } catch (e) {
      qrLog(`Erro de conexão ao obter QR: ${e.message}`);
    }
  }
  window.qrGetQr = qrGetQr;
 
  async function qrGetStatus() {
    const hasUser = !!(localStorage.getItem('authUser') || '').trim();
    if (!hasUser) { qrLog('Faça login para obter o status.'); return; }
    try {
      const response = await window.authFetch(`${__base}/user/instance-status`, { method: 'GET' });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const connected = Boolean(data?.status?.connected);
        const statusEl = document.getElementById('qr-status');
        if (statusEl) statusEl.textContent = connected ? '✅ WhatsApp conectado.' : '❌ Instância não conectada.';
        try { qrLog('Status da instância:\n' + JSON.stringify(data, null, 2)); } catch (_) {}
        // Se o payload tiver QR/paircode úteis, renderiza
        try { renderQrFromPayload(data); } catch (_) {}
      } else {
        qrLog('❌ Erro ao obter status:\n' + JSON.stringify(data, null, 2));
      }
    } catch (e) {
      qrLog('❌ Erro de conexão ao obter status:\n' + e.message);
    }
  }
  window.qrGetStatus = qrGetStatus;

  function qrCopyPaircode() {
    const val = document.getElementById('paircodeDisplay')?.value || '';
    if (!val) { qrLog('Nenhum paircode para copiar.'); return; }
    navigator.clipboard.writeText(val).then(() => { qrLog('Paircode copiado para área de transferência.'); }).catch((e) => qrLog(`Falha ao copiar: ${e.message}`));
  }
  window.qrCopyPaircode = qrCopyPaircode;

  async function disconnectInstance() {
    const statusEl = document.getElementById('qr-status');
    const imgEl = document.getElementById('qr-image');
    const placeholderEl = document.getElementById('qr-placeholder');
    const log = document.getElementById('qr-log');
    const rawName = document.getElementById('qr-instance')?.value?.trim() || '';
    const instance = normalizeInstanceName(rawName);
    if (!isValidInstanceName(instance)) { if (statusEl) statusEl.textContent = 'Informe um nome válido (3–32, letras/números/hífen).'; return; }
    if (!instance) { if (statusEl) statusEl.textContent = 'Informe o nome da instância para desconectar.'; return; }
    if (statusEl) statusEl.textContent = `Desconectando instância "${instance}"...`;
    if (imgEl) imgEl.style.display = 'none';
    if (placeholderEl) placeholderEl.style.display = '';
    if (log) log.textContent = '';
    try {
      const response = await window.authFetch(`${__base}/disconnect-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance } });
      const contentType = response.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        if (log) log.textContent = '⚠️ Resposta não-JSON recebida do proxy.\n' + `Status: ${response.status} ${response.statusText}\n` + `Content-Type: ${contentType}\n` + `Corpo bruto:\n${rawText}`;
        if (statusEl) statusEl.textContent = 'Falha ao desconectar instância';
        if (statusEl) statusEl.textContent = 'Tentando reconectar e forçar novo QR...';
        await qrConnectThenForceQr();
        return;
      }
      if (response.ok && data) {
        const ok = Boolean(data.success || data.status === 'disconnected' || data.reason);
        if (ok) {
          if (statusEl) statusEl.textContent = 'Instância desconectada (ou já sem conexão) — reconectando e forçando novo QR...';
          await qrConnectThenForceQr();
        } else {
          if (statusEl) statusEl.textContent = 'Falha ao desconectar instância — tentando reconectar e forçar novo QR...';
          if (log) log.textContent = JSON.stringify(data, null, 2);
          await qrConnectThenForceQr();
        }
      } else {
        if (response.status === 400 && data) {
          const msg = (data?.error || data?.message || 'Parâmetros inválidos ao desconectar.');
          if (statusEl) statusEl.textContent = `Erro 400 ao desconectar: ${msg}`;
          return;
        }
        if (statusEl) statusEl.textContent = `Erro ao desconectar (HTTP ${response.status}) — tentando reconectar e forçar novo QR...`;
        if (log) log.textContent = JSON.stringify(data || {}, null, 2);
        await qrConnectThenForceQr();
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = 'Erro de conexão ao desconectar — tentando reconectar e forçar novo QR...';
      if (log) log.textContent = '❌ Erro de conexão com o proxy:\n' + error.message;
      await qrConnectThenForceQr();
    }
  }
  window.disconnectInstance = disconnectInstance;

  async function qrConnectThenForceQr() {
    const phone = document.getElementById('qr-phone')?.value?.trim() || '';
    const hasUser = !!(localStorage.getItem('authUser') || '').trim();
    if (!hasUser) { qrLog('Faça login para conectar sua instância.'); return; }
    // Passo 0: garantir instância do usuário; se modo manual, criar/vincular pelo campo
    try {
      const ensureResp = await window.authFetch(`${__base}/user/ensure-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: {} });
      const ensureData = await ensureResp.json().catch(() => ({}));
      if (ensureResp.ok) {
        const ensuredName = ensureData?.instance_name || ensureData?.instance || ensureData?.name || '';
        if (ensuredName) {
          try {
            const bindResp = await window.authFetch(`${__base}/user/bind-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: ensuredName } });
            await bindResp.json().catch(() => ({}));
            qrLog(`Instância garantida para o usuário: ${ensuredName}`);
          } catch (_) {}
        } else {
          const rawName = document.getElementById('qr-instance')?.value?.trim() || '';
          const name = normalizeInstanceName(rawName);
          if (!name) {
            qrLog('Informe o nome da instância (campo acima) para criar e vincular.');
          } else if (!isValidInstanceName(name)) {
            qrLog('Nome inválido. Use 3–32 caracteres: letras, números e hífen (sem hífen nas extremidades).');
          } else {
            try {
              qrLog(`Criando instância manualmente: ${name} ...`);
              const createResp = await window.authFetch(`${__base}/create-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { name } });
              const createData = await createResp.json().catch(() => ({}));
              if (!createResp.ok) {
                const msg = createData?.error || createData?.message || `HTTP ${createResp.status}`;
                qrLog(`Falha ao criar instância: ${msg}`);
              } else {
                const token = extractTokenFromPayload(createData);
                const tokenEl = document.getElementById('qr-token');
                if (token && tokenEl) tokenEl.value = token;
                try {
                  const bindResp2 = await window.authFetch(`${__base}/user/bind-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: name, token } });
                  await bindResp2.json().catch(() => ({}));
                  qrLog(`Instância criada e vinculada ao usuário: ${name}`);
                } catch (e) {
                  qrLog(`Instância criada, mas falhou vincular ao usuário: ${e?.message || 'erro'}`);
                }
              }
            } catch (e) {
              qrLog(`Erro ao criar instância manualmente: ${e.message}`);
            }
          }
        }
      }
    } catch (_) {}
    // Passo 1: tentar conectar; se falhar por token ausente, seguir para forçar QR
    try {
      const response = await window.authFetch(`${__base}/user/connect-instance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { phone } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      qrLog('Conexão solicitada. Tentando forçar QR...');
      renderQrFromPayload(data);
      try {
        const instName = data?.instance || data?.name || document.getElementById('qr-instance')?.value?.trim() || '';
        const tokenEl = document.getElementById('qr-token');
        const token = tokenEl && tokenEl.value ? String(tokenEl.value).trim() : '';
        if (instName) startInstanceSse({ instance: instName, timeoutMs: 120000 });
      } catch (_) {}
    } catch (e) {
      qrLog(`Aviso: conexão não concluída imediatamente: ${e.message}. Prosseguindo com force QR.`);
    }
    // Passo 2: forçar QR com pequenas re-tentativas
    try { await qrGetQr(true); } catch (_) {}
    try { await new Promise(r => setTimeout(r, 2000)); await qrGetQr(true); } catch (_) {}
    try { await new Promise(r => setTimeout(r, 3000)); await qrGetQr(true); } catch (_) {}
  }
  window.qrConnectThenForceQr = qrConnectThenForceQr;

  // --- SSE para atualizar QR em tempo real ---
  let sseSource = null;
  let sseTimer = null;
  function stopInstanceSse(){
    try { if (sseTimer) { clearTimeout(sseTimer); sseTimer = null; } } catch (_) {}
    try { if (sseSource) { sseSource.close(); sseSource = null; } } catch (_) {}
  }
  function startInstanceSse({ instance, timeoutMs = 120000 }) {
    try { stopInstanceSse(); } catch (_) {}
    if (!instance) return;
    const qs = new URLSearchParams({ instance });
    const url = `/qr-events?${qs.toString()}`;
    try {
      sseSource = new EventSource(url);
      sseSource.addEventListener('open', () => { qrLog(`SSE aberto para ${instance}`); try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_open', { page: 'index.js', instance }); } catch (_) {} });
      sseSource.addEventListener('status', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          try { renderQrFromPayload({ status: { qrcode: data.qrcode, paircode: data.paircode } }); } catch (_) {}
          const connected = Boolean(data.connected || ['connected', 'ready'].includes(String(data.state || '').toLowerCase()));
          if (connected) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_status_connected', { page: 'index.js', instance }); } catch (_) {} }
        } catch (_) {}
      });
      sseSource.addEventListener('connected', () => { try { qrLog('SSE: instância conectada.'); } catch (_) {} ; try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_connected_event', { page: 'index.js', instance }); } catch (_) {} });
      sseSource.addEventListener('error', (ev) => { qrLog(`SSE erro: ${ev?.message || 'desconhecido'}`); try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_error', { page: 'index.js', instance, error: ev?.message || 'desconhecido' }); } catch (_) {} });
      sseTimer = setTimeout(() => { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_timeout_no_confirm', { page: 'index.js', instance, timeoutMs }); } catch (_) {} ; stopInstanceSse(); }, timeoutMs);
    } catch (e) { qrLog(`Falha ao iniciar SSE: ${e.message}`); }
  }
  window.__stopInstanceSse = stopInstanceSse;

  // Bind QR-related buttons
  const genBtn = document.getElementById('btn-generate-qr');
  const forceBtn = document.getElementById('btn-force-qr');
  const discBtn = document.getElementById('btn-disconnect-instance');
  if (genBtn) genBtn.addEventListener('click', () => qrConnectThenForceQr());
  if (forceBtn) forceBtn.addEventListener('click', () => qrGetQr(true));
  if (discBtn) discBtn.addEventListener('click', () => disconnectInstance());
})();