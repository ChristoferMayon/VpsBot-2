// Externalized QR page logic for CSP compliance
(function(){
  const byId = (id) => document.getElementById(id);
  const logsEl = byId('logs');
  const qrImage = byId('qr-image');
  const qrPlaceholder = byId('qr-placeholder');
  const pairInput = byId('paircodeDisplay');
  const statusEl = byId('qr-status');
  const forceEl = byId('force');
  const phoneEl = byId('phone');
  const instanceNameInput = byId('instanceNameInput');
  const createdNameEl = byId('createdName');
  const createdTokenEl = byId('createdToken');

  let qrRendered = false;
  let qrVisible = false;
  let redirectOnConnect = false;
  let waitForQrGoneTimer = null;
  let connectedAlertShown = false;
  let pollTimer = null;

  // SSE state
  let sseSource = null;
  let sseTimer = null;
  let sseExpectedInstance = '';
  let sseActive = false;
  let sseConnected = false;
  // Socket state
  let socket = null;
  let socketReady = false;
  let webhookConnected = false;
  let currentUserId = null;

  function log(title, data) {
    if (!logsEl) return;
    const ts = new Date().toISOString();
    const pretty = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    logsEl.textContent = `[${ts}] ${title}\n${pretty}\n\n` + logsEl.textContent;
  }

  function asJson(resp) {
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp.text().then(t => ({ raw: t }));
  }

  // Helpers: normalização e validação de nome de instância (alinhado ao backend)
  function normalizeInstanceName(raw) {
    const s = String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 32);
  }
  function isValidInstanceName(name) {
    return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(String(name || ''));
  }

  function isQrGone() {
    try {
      if (!qrImage) return true;
      const disp = (typeof getComputedStyle === 'function') ? getComputedStyle(qrImage).display : qrImage.style.display;
      const hidden = disp === 'none' || !qrImage.src;
      return !qrVisible || hidden;
    } catch (_) { return !qrVisible; }
  }

  (async function prefillInstanceNameFromUser(){
    try {
      if (!instanceNameInput || (instanceNameInput.value && instanceNameInput.value.trim())) return;
      const r = await authFetch('/me');
      const j = await r.json().catch(() => ({}));
      const username = (j && j.user && j.user.username) ? String(j.user.username).trim() : '';
      const normalized = normalizeInstanceName(username);
      if (normalized && isValidInstanceName(normalized)) instanceNameInput.value = normalized;
    } catch (_) {}
  })();

  function stopInstanceSse() {
    try { if (sseSource) sseSource.close(); } catch (_) {}
    sseSource = null;
    if (sseTimer) { clearTimeout(sseTimer); sseTimer = null; }
    if (waitForQrGoneTimer) { clearTimeout(waitForQrGoneTimer); waitForQrGoneTimer = null; }
    sseExpectedInstance = '';
    sseActive = false;
    sseConnected = false;
  }

  async function showConnectionSuccessWithDetails(instName) {
    if (connectedAlertShown) return;
    const userInitiated = (() => {
      try { return redirectOnConnect || (localStorage.getItem('redirectOnConnect') === '1'); } catch (_) { return redirectOnConnect; }
    })();
    try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.success_triggered', { source: 'qr.js', userInitiated, instName }); } catch (_) {}
    if (!userInitiated) { try { if (statusEl) statusEl.textContent = '✅ WhatsApp conectado.'; } catch (_) {} return; }
    if (!isQrGone()) {
      try { if (statusEl) statusEl.textContent = '✅ Conectado. Aguarde o QR desaparecer...'; } catch (_) {}
      try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.wait_qr_gone', { source: 'qr.js', instName }); } catch (_) {}
      if (waitForQrGoneTimer) clearTimeout(waitForQrGoneTimer);
      waitForQrGoneTimer = setTimeout(() => showConnectionSuccessWithDetails(instName), 800);
      return;
    }
    webhookConnected = true;
    let detailsText = '';
    try {
      const st = await authFetch('/user/instance-status');
      const stData = await st.json().catch(() => ({}));
      const dName = stData?.deviceName || stData?.status?.deviceName || '';
      const phone = stData?.phoneNumber || stData?.status?.phoneNumber || '';
      const parts = [];
      if (instName) parts.push(`Instância: ${instName}`);
      if (dName) parts.push(`Dispositivo: ${dName}`);
      if (phone) parts.push(`Número: ${phone}`);
      detailsText = parts.join(' • ');
    } catch (_) {}
    const go = () => {
      try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.redirect_start', { source: 'qr.js', target: '/index.html?tab=carousel', instName }); } catch (_) {}
      window.location.href = '/index.html?tab=carousel';
    };
    try {
      connectedAlertShown = true;
      try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.pre_alert', { source: 'qr.js', instName, details_len: (detailsText || '').length }); } catch (_) {}
      if (window.Swal && typeof Swal.fire === 'function') {
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sweetalert_called', { source: 'qr.js', type: 'success', instName }); } catch (_) {}
        Swal.fire({ icon: 'success', title: 'Conectado ao WhatsApp', text: detailsText || 'Conectado ao WhatsApp. Redirecionando...', timer: 1200, showConfirmButton: false, customClass: { popup: 'swal-red-custom' } }).then(go);
      } else {
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sweetalert_missing', { source: 'qr.js', fallback: 'alert', instName }); } catch (_) {}
        alert(detailsText || 'Conectado com sucesso.');
        go();
      }
    } catch (_) { go(); }
  }

  function startInstanceSse({ instance, token, mode = 'named', timeoutMs = 120000 }) {
    try { stopInstanceSse(); } catch (_) {}
    if (!instance) return;
    sseExpectedInstance = instance;
    const qs = new URLSearchParams({ instance });
    if (token) qs.set('token', token);
    const url = `/qr-events?${qs.toString()}`;
    try {
      sseSource = new EventSource(url);
      sseActive = true;
      sseConnected = false;
      sseSource.addEventListener('open', () => { log('SSE aberto', { instance }); try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_open', { source: 'qr.js', instance }); } catch (_) {} });
      sseSource.addEventListener('status', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (!data || (data.instance && data.instance !== sseExpectedInstance)) return;
          try { renderQrFromPayload({ status: { qrcode: data.qrcode, paircode: data.paircode } }); } catch (_) {}
          const connected = Boolean(data.connected || ['connected', 'ready'].includes(String(data.state || '').toLowerCase()));
          if (connected) {
            sseConnected = true;
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_status_connected', { source: 'qr.js', instance }); } catch (_) {}
            try {
              if (!connectedAlertShown) {
                if (isQrGone()) { showConnectionSuccessWithDetails(sseExpectedInstance || instance); }
                else {
                  if (waitForQrGoneTimer) clearTimeout(waitForQrGoneTimer);
                  waitForQrGoneTimer = setTimeout(() => showConnectionSuccessWithDetails(sseExpectedInstance || instance), 800);
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      });
      sseSource.addEventListener('connected', async (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (!data || (data.instance && data.instance !== sseExpectedInstance)) return;
          sseConnected = true;
          log('SSE sinalizou conectado, aguardando webhook em tempo real...');
          try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_connected_event', { source: 'qr.js', instance }); } catch (_) {}
          try {
            if (!connectedAlertShown) {
              if (isQrGone()) { showConnectionSuccessWithDetails(sseExpectedInstance || instance); }
              else {
                if (waitForQrGoneTimer) clearTimeout(waitForQrGoneTimer);
                waitForQrGoneTimer = setTimeout(() => showConnectionSuccessWithDetails(sseExpectedInstance || instance), 800);
              }
            }
          } catch (_) {}
        } catch (_) {}
      });
      sseSource.addEventListener('error', (ev) => { log('SSE erro', ev?.message || String(ev)); try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_error', { source: 'qr.js', instance, error: ev?.message || String(ev) }); } catch (_) {} });
      sseTimer = setTimeout(() => {
        if (sseConnected) return;
        stopInstanceSse();
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.sse_timeout_no_confirm', { source: 'qr.js', instance, timeoutMs }); } catch (_) {}
        try {
          if (window.Swal && typeof Swal.fire === 'function') {
            Swal.fire({ icon: 'error', title: 'Conexão não confirmada', text: 'Tempo esgotado aguardando confirmação da Uazapi. Deseja gerar um novo QR? ', showCancelButton: true, confirmButtonText: 'Gerar novo QR', cancelButtonText: 'Fechar' })
              .then((r) => { /* user decides next action in UI */ });
          } else { alert('Tempo esgotado aguardando conexão.'); }
        } catch (_) {}
      }, timeoutMs);
    } catch (e) { log('Falha ao iniciar SSE', e?.message || String(e)); }
  }

  async function disconnectUserInstance() {
    try {
      const hasUser = !!(localStorage.getItem('authUser') || '').trim();
      if (!hasUser) { if (statusEl) statusEl.textContent = 'Faça login para desconectar.'; return; }
      if (statusEl) statusEl.textContent = 'Desconectando instância...';
      let instanceName = '';
      try {
        const stResp = await authFetch('/user/instance-status');
        const stData = await stResp.json().catch(() => ({}));
        instanceName = stData?.instance_name || stData?.instanceName || stData?.instance || '';
      } catch (_) {}
      if (!instanceName) { if (statusEl) statusEl.textContent = 'Não foi possível identificar a instância do usuário.'; return; }
      const resp = await authFetch('/disconnect-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: instanceName } });
      const data = await asJson(resp);
      log(`POST /disconnect-instance (${resp.status})`, data);
      if (resp.ok && data && data.success) {
        if (statusEl) statusEl.textContent = '🔌 Instância desconectada com sucesso.';
        try { if (qrImage) { qrImage.src = ''; qrImage.style.display = 'none'; } if (qrPlaceholder) qrPlaceholder.style.display = ''; if (pairInput) pairInput.value = ''; } catch (_) {}
      } else {
        if (statusEl) statusEl.textContent = 'Falha ao desconectar. Verifique logs.';
      }
    } catch (e) {
      log('Erro ao desconectar', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Erro ao desconectar instância.';
    }
  }

  async function bindInstanceToUser(name, token) {
    try {
      if (!name) return;
      const norm = normalizeInstanceName(name);
      if (!isValidInstanceName(norm)) { if (statusEl) statusEl.textContent = 'Nome da instância inválido para vínculo.'; return; }
      const payload = token ? { instance: norm, token } : { instance: norm };
      const resp = await authFetch('/user/bind-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
      const data = await asJson(resp);
      log(`POST /user/bind-instance (${resp.status})`, data);
      if (!resp.ok) { if (statusEl) statusEl.textContent = `❌ Falha ao vincular instância: ${data?.error || 'Erro'}`; }
    } catch (e) { log('Erro em bindInstanceToUser', e?.message || String(e)); }
  }

  function renderQrFromPayload(payload) {
    try {
      let qr = '';
      if (typeof payload?.format === 'string') {
        const fmt = payload.format.toLowerCase();
        if (fmt === 'url' && typeof payload?.url === 'string' && payload.url.trim()) { qr = payload.url.trim(); }
        else if ((fmt === 'base64' || fmt === 'dataurl') && typeof payload?.qr === 'string' && payload.qr.trim()) { qr = payload.qr.trim(); }
      }
      if (!qr) {
        const info = payload?.info || {};
        const status = payload?.status || {};
        const candidates = [
          // Comuns
          payload?.qrCode, payload?.qrcode, payload?.qr, payload?.base64,
          info?.qrCode, info?.qrcode, info?.qr, info?.base64,
          status?.qrCode, status?.qrcode, status?.qr, status?.base64,
          // URLs
          payload?.url, payload?.qr_url, info?.url, status?.url, status?.qr_url,
          // Campos de imagem
          status?.qr_image, status?.qr_image_base64,
          // Variedades em raw
          payload?.raw?.instance?.qrcode, payload?.raw?.instance?.qr_image,
          payload?.raw?.status?.qrcode, payload?.raw?.status?.qr_image,
          payload?.raw?.qrcode,
          payload?.raw?.data?.qrCode, payload?.raw?.data?.qrcode, payload?.raw?.data?.qr, payload?.raw?.data?.base64,
          payload?.raw?.data?.url, payload?.raw?.data?.qr_image, payload?.raw?.data?.qr_image_base64
        ].filter((v) => typeof v === 'string' && v.trim());
        qr = candidates.length ? candidates[0] : '';
      }
      const pairCandidates = [ payload?.paircode, payload?.status?.paircode, payload?.instance?.paircode, payload?.raw?.instance?.paircode, payload?.raw?.paircode ].filter((v) => typeof v === 'string' && v.trim());
      const pair = pairCandidates.length ? pairCandidates[0] : '';
      if (pair && pairInput) { pairInput.value = pair; }
      if (qr) {
        let src = qr;
        if (typeof src === 'string' && !src.startsWith('data:image') && !src.startsWith('http')) { src = `data:image/png;base64,${src}`; }
        if (qrImage) {
          qrImage.src = src;
          qrImage.onload = () => { log('QR: imagem carregada'); };
          qrImage.onerror = (e) => { log('QR: falha ao carregar', e?.message || 'erro'); };
          try { qrImage.classList.remove('is-hidden'); } catch (_) {}
          qrImage.style.display = 'block';
        }
        qrVisible = true;
        if (qrPlaceholder) qrPlaceholder.style.display = 'none';
        if (statusEl) statusEl.textContent = 'QR atualizado. Escaneie no WhatsApp para parear.';
        qrRendered = true;
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.qr_shown', { source: 'qr.js', had_qr: true }); } catch (_) {}
      } else {
        if (qrImage) {
          try { qrImage.classList.add('is-hidden'); } catch (_) {}
          qrImage.style.display = 'none';
        }
        qrVisible = false;
        if (qrPlaceholder) qrPlaceholder.style.display = '';
        if (statusEl) statusEl.textContent = 'QR não encontrado no payload. Tente gerar novamente.';
        try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.qr_hidden', { source: 'qr.js', reason: 'no_qr_in_payload', payload_keys: Object.keys(payload || {}) }); } catch (_) {}
      }
    } catch (e) { log('Erro ao renderizar QR', e?.message || String(e)); }
  }

  async function generateUserQr() {
    try { redirectOnConnect = true; localStorage.setItem('redirectOnConnect','1'); } catch (_) { redirectOnConnect = true; }
    let generationInProgress = Boolean(window.__GEN_IN_PROGRESS);
    if (generationInProgress) return;
    window.__GEN_IN_PROGRESS = true;
    try {
      let expectedInstanceName = '';
      try {
        const ensureResp = await authFetch('/user/ensure-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: {} });
        const ensureData = await asJson(ensureResp);
        log(`POST /user/ensure-instance (${ensureResp.status})`, ensureData);
        try {
          const ensuredName = ensureData?.instance_name || ensureData?.instance || ensureData?.name || '';
          if (ensuredName) expectedInstanceName = ensuredName;
          if (ensuredName) {
            const bindResp0 = await authFetch('/user/bind-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: ensuredName } });
            const bindData0 = await asJson(bindResp0);
            log(`EARLY POST /user/bind-instance (${bindResp0.status})`, bindData0);
          }
        } catch (_) {}
      } catch (e) { log('Erro ensure-instance', e?.message || String(e)); }

      const phone = (phoneEl && phoneEl.value ? phoneEl.value : '').trim();
      const connResp = await authFetch('/user/connect-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { phone: phone ? phone.replace(/\D/g, '') : undefined } });
      const connData = await asJson(connResp);
      log(`POST /user/connect-instance (${connResp.status})`, connData);
      try {
        const nameFromConn = connData?.instance || connData?.name || '';
        if (nameFromConn) expectedInstanceName = nameFromConn;
        if (nameFromConn) {
          const bindResp = await authFetch('/user/bind-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: nameFromConn } });
          const bindData = await asJson(bindResp);
          log(`POST /user/bind-instance (${bindResp.status})`, bindData);
        }
      } catch (e) { log('Erro bind-instance', e?.message || String(e)); }
      renderQrFromPayload(connData);
      try { renderInstanceInfo(connData); } catch (_) {}

      const qrUrl = new URL('/user/get-qr-code', window.location.origin);
      qrUrl.searchParams.set('force', 'true');
      const qrResp = await authFetch(qrUrl.toString(), { method: 'GET' });
      const qrData = await asJson(qrResp);
      log(`GET /user/get-qr-code (${qrResp.status})`, qrData);
      renderQrFromPayload(qrData);
      try { renderInstanceInfo(qrData); } catch (_) {}
      if (statusEl) statusEl.textContent = '📲 Escaneie o QR no WhatsApp para conectar';

      if (!expectedInstanceName) {
        try {
          const st0 = await authFetch('/user/instance-status');
          const st0Data = await asJson(st0);
          expectedInstanceName = st0Data?.instance_name || st0Data?.instance || '';
        } catch (_) {}
      }
      if (expectedInstanceName) { startInstanceSse({ instance: expectedInstanceName, mode: 'user' }); }

      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const stResp = await authFetch('/user/instance-status', { method: 'GET' });
          const stData = await asJson(stResp);
          log(`GET /user/instance-status (${stResp.status})`, stData);
          try { renderQrFromPayload(stData); } catch (_) {}
          try { renderInstanceInfo(stData); } catch (_) {}
          const connected = !!(stData?.connected || stData?.ready || stData?.loggedIn || stData?.status?.connected || stData?.status === 'connected');
          if (stResp.ok && connected) {
            clearInterval(poll);
            if (statusEl) statusEl.textContent = '✅ WhatsApp conectado. Você pode enviar mensagens.';
            const goBtn = byId('btnGoSend');
            if (goBtn) { goBtn.style.display = ''; goBtn.onclick = () => { window.location.href = '/index.html'; }; }
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_connected', { source: 'qr.js', tries }); } catch (_) {}
            if (!connectedAlertShown) handleAuthSuccessRedirect();
          }
        } catch (_) {}
        if (tries > 30) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_stopped_no_connect', { source: 'qr.js', tries }); } catch (_) {} ; clearInterval(poll); }
      }, 2000);
    } catch (e) {
      log('Erro em generateUserQr', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Falha ao gerar QR. Tente novamente.';
    } finally { window.__GEN_IN_PROGRESS = false; }
  }

  async function createNamedInstance() {
    try {
      const raw = (instanceNameInput?.value || '').trim();
      const name = normalizeInstanceName(raw);
      if (!name) { if (statusEl) statusEl.textContent = 'Informe um nome de instância.'; return; }
      if (!isValidInstanceName(name)) { if (statusEl) statusEl.textContent = 'Nome da instância inválido. Use 3–32 caracteres [a-z0-9-], sem começar/terminar com hífen.'; return; }
      if (statusEl) statusEl.textContent = 'Criando instância...';
      const resp = await authFetch('/create-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: name } });
      const data = await asJson(resp);
      log(`POST /create-instance (${resp.status})`, data);
      if (!resp.ok) { if (statusEl) statusEl.textContent = `❌ Falha ao criar instância: ${data?.error || 'Erro'}`; return; }
      if (createdNameEl) createdNameEl.value = name;
      const tokenCandidates = [ data?.raw?.token, data?.raw?.instance?.token, data?.raw?.data?.token, data?.raw?.result?.token, data?.token ].filter(v => typeof v === 'string' && v.trim());
      if (tokenCandidates.length && createdTokenEl) { createdTokenEl.value = tokenCandidates[0]; }
      try { localStorage.setItem('selectedInstanceName', name); if (createdTokenEl?.value) localStorage.setItem('selectedInstanceToken', createdTokenEl.value.trim()); } catch (_) {}
      try { await bindInstanceToUser(name, createdTokenEl?.value?.trim() || ''); } catch (_) {}
      try { renderQrFromPayload(data); } catch (_) {}
      if (statusEl) statusEl.textContent = 'Instância criada. Você pode gerar QR ou Paircode.';
    } catch (e) {
      log('Erro em createNamedInstance', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Falha ao criar instância.';
    }
  }

  async function generateQrForInstance() {
    try {
      const name = normalizeInstanceName((createdNameEl?.value || instanceNameInput?.value || '').trim());
      const token = (createdTokenEl?.value || '').trim();
      if (!name) { if (statusEl) statusEl.textContent = 'Informe/Crie a instância primeiro.'; return; }
      if (!isValidInstanceName(name)) { if (statusEl) statusEl.textContent = 'Nome da instância inválido para QR.'; return; }
      if (statusEl) statusEl.textContent = 'Solicitando QR da instância...';
      let url = `/get-qr-code?instance=${encodeURIComponent(name)}&force=true`;
      if (token) url += `&token=${encodeURIComponent(token)}`;
      const resp = await fetch(url);
      const data = await asJson(resp);
      log(`GET /get-qr-code (${resp.status})`, data);
      if (!resp.ok) { if (statusEl) statusEl.textContent = `❌ Erro ao obter QR: ${data?.error || 'Falha'}`; return; }
      renderQrFromPayload(data);
      if (statusEl) statusEl.textContent = '📲 Escaneie o QR no WhatsApp para conectar';
      startInstanceSse({ instance: name, token, mode: 'named' });
    } catch (e) {
      log('Erro em generateQrForInstance', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Falha ao obter QR da instância.';
    }
  }

  async function connectInstanceNamed() {
    try { redirectOnConnect = true; localStorage.setItem('redirectOnConnect','1'); } catch (_) { redirectOnConnect = true; }
    try {
      const name = normalizeInstanceName((createdNameEl?.value || instanceNameInput?.value || '').trim());
      const token = (createdTokenEl?.value || '').trim();
      const phone = (phoneEl?.value || '').replace(/\D/g, '');
      if (!name) { if (statusEl) statusEl.textContent = 'Informe/Crie a instância primeiro.'; return; }
      if (!isValidInstanceName(name)) { if (statusEl) statusEl.textContent = 'Nome da instância inválido para conexão.'; return; }
      if (statusEl) statusEl.textContent = 'Conectando instância...';
      try { localStorage.setItem('selectedInstanceName', name); if (token) localStorage.setItem('selectedInstanceToken', token); } catch (_) {}
      try { await bindInstanceToUser(name, token); } catch (_) {}
      // Verifica existência prévia e cria se necessário
      try {
        const sUrl0 = `/instance-status?instance=${encodeURIComponent(name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
        const s0 = await authFetch(sUrl0);
        if (!s0.ok) {
          const cResp = await authFetch('/create-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: name } });
          const cData = await asJson(cResp);
          log(`PRE CONNECT create-instance (${cResp.status})`, cData);
          if (!cResp.ok) { if (statusEl) statusEl.textContent = `❌ Falha ao preparar instância: ${cData?.error || 'Erro'}`; return; }
          const tokCandidates = [ cData?.raw?.token, cData?.raw?.instance?.token, cData?.token ].filter(v => typeof v === 'string' && v.trim());
          if (tokCandidates.length && createdTokenEl) { createdTokenEl.value = tokCandidates[0]; }
          try { await bindInstanceToUser(name, createdTokenEl?.value?.trim() || token); } catch (_) {}
        }
      } catch (e) { log('Pré-checagem/Criação da instância falhou', e?.message || String(e)); }
      const body = { instance: name };
      if (token) body.token = token;
      if (phone) body.phone = phone;
      const resp = await authFetch('/connect-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await asJson(resp);
      log(`POST /connect-instance (${resp.status})`, data);
      if (!resp.ok) { if (statusEl) statusEl.textContent = `❌ Falha ao conectar: ${data?.error || 'Erro'}`; return; }
      try { renderQrFromPayload(data); } catch (_) {}
      const pairSection = byId('paircode-section');
      if (pairSection) pairSection.style.display = '';
      // Caso o payload de conexão não traga QR/Pair, força a obtenção de um novo QR
      try {
        const hadQr = (() => { try { return !!(qrImage && getComputedStyle(qrImage).display !== 'none' && qrImage.src); } catch (_) { return !!(qrImage && qrImage.src); } })();
        if (!hadQr) {
          if (statusEl) statusEl.textContent = 'Gerando QR após conexão...';
          let url = `/get-qr-code?instance=${encodeURIComponent(name)}&force=true`;
          if (token) url += `&token=${encodeURIComponent(token)}`;
          const qresp = await fetch(url);
          const qdata = await asJson(qresp);
          log(`GET /get-qr-code (${qresp.status})`, qdata);
          if (qresp.ok) {
            renderQrFromPayload(qdata);
            if (statusEl) statusEl.textContent = '📲 QR disponível. Escaneie para conectar.';
          } else {
            if (statusEl) statusEl.textContent = `❌ Erro ao obter QR: ${qdata?.error || 'Falha'}`;
          }
        }
      } catch (e) { log('Falha ao forçar QR pós-conexão', e?.message || String(e)); }
      startInstanceSse({ instance: name, token, mode: 'named' });
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const sUrl = `/instance-status?instance=${encodeURIComponent(name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
          const sresp = await authFetch(sUrl);
          const sdata = await asJson(sresp);
          log(`GET /instance-status (${sresp.status})`, sdata);
          try { renderQrFromPayload(sdata); } catch (_) {}
          const connected = !!(sdata?.connected || sdata?.ready || sdata?.loggedIn || sdata?.status?.connected || sdata?.status === 'connected');
          if (connected) {
            if (statusEl) statusEl.textContent = '✅ WhatsApp conectado.';
            clearInterval(poll);
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_connected_named', { source: 'qr.js', tries, instance: name }); } catch (_) {}
            if (!connectedAlertShown) handleAuthSuccessRedirect();
            return;
          }
          const pairVal = (pairInput?.value || '').trim();
          if (pairVal) { if (statusEl) statusEl.textContent = '✅ Paircode disponível. Finalize no WhatsApp.'; }
          if (qrImage && qrImage.style.display !== 'none' && qrImage.src) { if (statusEl) statusEl.textContent = '📲 QR disponível. Escaneie para conectar.'; }
          if (tries > 60) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_timeout_named', { source: 'qr.js', tries, instance: name }); } catch (_) {} ; clearInterval(poll); }
        } catch (_) { if (tries > 60) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_timeout_named', { source: 'qr.js', tries, instance: name, reason: 'exception' }); } catch (_) {} ; clearInterval(poll); } }
      }, 2000);
    } catch (e) {
      log('Erro em connectInstanceNamed', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Falha ao conectar instância.';
    }
  }

  async function generatePaircodeForInstance() {
    try { redirectOnConnect = true; localStorage.setItem('redirectOnConnect','1'); } catch (_) { redirectOnConnect = true; }
    try {
      const name = normalizeInstanceName((createdNameEl?.value || instanceNameInput?.value || '').trim());
      const token = (createdTokenEl?.value || '').trim();
      const phone = (phoneEl?.value || '').replace(/\D/g, '');
      if (!name) { if (statusEl) statusEl.textContent = 'Informe/Crie a instância primeiro.'; return; }
      if (!isValidInstanceName(name)) { if (statusEl) statusEl.textContent = 'Nome da instância inválido para paircode.'; return; }
      if (!phone) { if (statusEl) statusEl.textContent = 'Informe o telefone (E.164) para gerar paircode.'; return; }
      if (statusEl) statusEl.textContent = 'Solicitando pareamento (paircode)...';
      try { localStorage.setItem('selectedInstanceName', name); if (token) localStorage.setItem('selectedInstanceToken', token); } catch (_) {}
      try { await bindInstanceToUser(name, token); } catch (_) {}
      const resp = await authFetch('/connect-instance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { instance: name, token, phone } });
      const data = await asJson(resp);
      log(`POST /connect-instance (${resp.status})`, data);
      if (!resp.ok) { if (statusEl) statusEl.textContent = `❌ Falha ao gerar paircode: ${data?.error || 'Erro'}`; return; }
      const pairSection = byId('paircode-section');
      if (pairSection) pairSection.style.display = '';
      startInstanceSse({ instance: name, token, mode: 'named' });
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const sUrl = `/instance-status?instance=${encodeURIComponent(name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
          const sresp = await authFetch(sUrl);
          const sdata = await asJson(sresp);
          log(`GET /instance-status (${sresp.status})`, sdata);
          try { renderQrFromPayload(sdata); } catch (_) {}
          const connected = !!(sdata?.connected || sdata?.ready || sdata?.loggedIn || sdata?.status?.connected || sdata?.status === 'connected');
          if (connected) {
            if (statusEl) statusEl.textContent = '✅ WhatsApp conectado.';
            clearInterval(poll);
            try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_connected_paircode', { source: 'qr.js', tries, instance: name }); } catch (_) {}
            if (!connectedAlertShown) handleAuthSuccessRedirect();
            return;
          }
          const val = (pairInput?.value || '').trim();
          if (val) { if (statusEl) statusEl.textContent = '✅ Paircode gerado. Conclua no WhatsApp.'; }
          if (tries > 60) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_timeout_paircode', { source: 'qr.js', tries, instance: name }); } catch (_) {} ; clearInterval(poll); }
        } catch (_) { if (tries > 60) { try { if (window.qrFlowLog) window.qrFlowLog('qr.flow.poll_timeout_paircode', { source: 'qr.js', tries, instance: name, reason: 'exception' }); } catch (_) {} ; clearInterval(poll); } }
      }, 2000);
    } catch (e) {
      log('Erro em generatePaircodeForInstance', e?.message || String(e));
      if (statusEl) statusEl.textContent = '❌ Falha ao gerar paircode.';
    }
  }

  function copyTokenToClipboard() {
    try {
      const val = (createdTokenEl?.value || '').trim();
      if (!val) { log('Copiar', 'Token vazio'); return; }
      navigator.clipboard.writeText(val).then(() => log('Copiar', 'Token copiado!')).catch((e) => log('Erro ao copiar token', e?.message || String(e)));
    } catch (e) { log('Erro copiar token', e?.message || String(e)); }
  }

  function renderInstanceInfo(payload) {
    try {
      const container = document.getElementById('instance-info');
      const el = (id) => document.getElementById(id);
      if (!container) return;
      const sources = [ payload, payload?.status, payload?.data, payload?.raw, payload?.raw?.status, payload?.raw?.data ];
      const first = (paths) => {
        for (const p of paths) {
          try {
            const v = p.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), payload);
            if (typeof v === 'string' && v.trim()) return v;
            if (typeof v === 'number') return String(v);
            if (typeof v === 'boolean') return v ? 'true' : 'false';
          } catch (_) {}
        }
        for (const src of sources) {
          if (src && typeof src === 'object') {
            for (const key of paths) {
              if (src[key] !== undefined) {
                const v = src[key];
                if (typeof v === 'string' && v.trim()) return v;
                if (typeof v === 'number') return String(v);
                if (typeof v === 'boolean') return v ? 'true' : 'false';
              }
            }
          }
        }
        return '';
      };
      const id = first(['id', 'instanceId']);
      const name = first(['name', 'instance', 'instanceName', 'instance_name']);
      const profileName = first(['profileName']);
      const profilePicUrl = first(['profilePicUrl', 'profilePicURL']);
      const isBusiness = first(['isBusiness']);
      const platform = first(['plataform', 'platform']);
      const systemName = first(['systemName']);
      const owner = first(['owner']);
      const created = first(['created', 'createdAt']);
      const updated = first(['updated', 'updatedAt']);
      const lastDisconnect = first(['lastDisconnect']);
      const lastDisconnectReason = first(['lastDisconnectReason']);
      const statusStr = first(['status', 'connection_status', 'state']);
      const delayMin = first(['msg_delay_min', 'delayMin']);
      const delayMax = first(['msg_delay_max', 'delayMax']);
      const sEl = el('info-status');
      const nEl = el('info-name');
      const pnEl = el('info-profileName');
      const picEl = el('info-profilePic');
      const bizEl = el('info-business');
      const pfEl = el('info-platform');
      const owEl = el('info-owner');
      const idEl = el('info-id');
      const ldEl = el('info-lastDisconnect');
      const crEl = el('info-created');
      const upEl = el('info-updated');
      const dlEl = el('info-delays');
      if (sEl) sEl.textContent = statusStr ? `Status: ${statusStr}` : '';
      if (nEl) nEl.textContent = name ? `Nome: ${name}` : '';
      if (pnEl) pnEl.textContent = profileName ? `Perfil: ${profileName}` : '';
      if (bizEl) bizEl.textContent = isBusiness ? `Business: ${isBusiness}` : '';
      const platText = [platform, systemName].filter(Boolean).join(' / ');
      if (pfEl) pfEl.textContent = platText ? `Plataforma: ${platText}` : '';
      if (owEl) owEl.textContent = owner ? `Dono: ${owner}` : '';
      if (idEl) idEl.textContent = id ? `ID: ${id}` : '';
      const ldText = [lastDisconnect, lastDisconnectReason].filter(Boolean).join(' — ');
      if (ldEl) ldEl.textContent = ldText ? `Última desconexão: ${ldText}` : '';
      if (crEl) crEl.textContent = created ? `Criado: ${created}` : '';
      if (upEl) upEl.textContent = updated ? `Atualizado: ${updated}` : '';
      const delayText = (delayMin || delayMax) ? `Delays: ${delayMin || '?'}s - ${delayMax || '?'}s` : '';
      if (dlEl) dlEl.textContent = delayText;
      if (picEl) { if (profilePicUrl) { picEl.src = profilePicUrl.replace(/`/g, ''); picEl.style.display = ''; } else { picEl.style.display = 'none'; } }
      const hasAny = [statusStr, name, profileName, profilePicUrl, isBusiness, platform, systemName, owner, id, created, updated].some(Boolean);
      container.style.display = hasAny ? '' : 'none';
    } catch (e) { try { log('Erro renderInstanceInfo', e?.message || String(e)); } catch (_) {} }
  }

  function initBindings(){
    try { localStorage.removeItem('redirectOnConnect'); } catch (_) {}
    const goBtn = byId('btnGoSend');
    if (goBtn) {
      goBtn.style.display = 'none';
      goBtn.addEventListener('click', () => { try { stopInstanceSse(); } catch (_) {} window.location.href = '/index.html'; });
    }
    const bind = (id, fn) => { const el = byId(id); if (el) el.addEventListener('click', fn); };
    bind('btnGenerateQr', generateUserQr);
    bind('btnDisconnect', disconnectUserInstance);
    bind('btnCreateInstance', createNamedInstance);
    bind('btnInstanceQr', connectInstanceNamed);
    bind('btnInstancePaircode', generatePaircodeForInstance);
    bind('btnCopyToken', copyTokenToClipboard);
    const copyPair = () => { const txt = (pairInput?.value || '').trim(); if (!txt) { log('Copiar', 'Paircode vazio'); return; } navigator.clipboard.writeText(txt).then(() => log('Copiar', 'Paircode copiado!')).catch((e) => log('Erro ao copiar', e?.message || String(e))); };
    bind('btnCopyPaircode', copyPair);
    try {
      const tabs = document.querySelectorAll('#main-tabs .tab-btn');
      tabs.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const tab = btn.getAttribute('data-tab');
          if (tab === 'qr') return;
          e.preventDefault();
          window.location.href = '/index.html';
        });
      });
    } catch (_) {}
  }

  async function initRealtimeWebhookListener(){
    try {
      let uid = null;
      try { const r = await authFetch('/me'); const j = await r.json().catch(() => ({})); uid = j?.user?.id || null; } catch (_) {}
      if (!uid) { console.warn('[Socket.IO] user_id não disponível; mantendo apenas SSE/polling.'); return; }
      try {
        socket = window.io ? window.io() : null;
        if (!socket) { console.warn('[Socket.IO] indisponível no frontend'); return; }
        socketReady = true;
        currentUserId = uid;
        try { socket.emit('register', { user_id: uid }); } catch (_) {}
        const evt = `instance_connected:${uid}`;
        const handleConnected = async (payload) => {
          try { webhookConnected = true; stopInstanceSse(); const instName = (payload && (payload.instance_id || payload.instanceName || payload.instance)) || sseExpectedInstance || ''; await showConnectionSuccessWithDetails(instName); } catch (e) { try { handleAuthSuccessRedirect(); } catch (_) {} }
        };
        socket.on(evt, handleConnected);
        socket.on('instance_connected', handleConnected);
        console.log('[Socket.IO] ouvindo', evt);
      } catch (e) { console.warn('[Socket.IO] indisponível:', e?.message || String(e)); }
    } catch (e) { console.warn('[Socket.IO:init] falhou:', e?.message || String(e)); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initBindings();
    try { initRealtimeWebhookListener(); } catch (_) {}
  });
})();