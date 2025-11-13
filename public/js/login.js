// Lógica de login movida para arquivo externo para compatibilidade com CSP
(function() {
  const apiBase = (window.API_BASE || (window.location.port === '3002' ? 'https://127.0.0.1:3001' : window.location.origin)).replace(/\/$/, '');
  let phase = 'cred';

  function setStatus(t) {
    const el = document.getElementById('login-status');
    if (el) el.textContent = t || '';
  }

  function logoutAll() {
    (async () => {
      try {
        // Solicita ao backend limpar o cookie de autenticação
        try { await authFetch(apiBase + '/logout', { method: 'POST' }); } catch (_) {}
        // Limpa dados locais de sessão
        localStorage.removeItem('authToken');
        localStorage.removeItem('authRole');
        localStorage.removeItem('authUser');
        localStorage.removeItem('authCredits');
        localStorage.removeItem('adminToken');
        setStatus('Sessão limpa.');
      } catch (e) { setStatus('Erro ao limpar sessão: ' + e.message); }
    })();
  }

  async function doLogin() {
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const otpEl = document.getElementById('login-otp');
    const otpLabel = document.getElementById('otp-label');
    const username = (usernameEl?.value || '').trim();
    const password = (passwordEl?.value || '').trim();
    setStatus(phase === 'cred' ? 'Enviando OTP...' : 'Validando OTP...');
    try {
      console.debug('[LoginDebug] apiBase:', apiBase, 'location:', window.location.href);
      const url = phase === 'cred' ? (apiBase + '/auth/login') : (apiBase + '/auth/verify-otp');
      const body = phase === 'cred' ? { username, password } : { username, otp: (otpEl?.value || '').trim() };
      const res = await authFetch(url, { method: 'POST', body });
      console.debug('[LoginDebug] response:', { ok: res.ok, status: res.status, statusText: res.statusText });
      let data;
      try {
        const ct = String(res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          try {
            data = await res.json();
          } catch (e) {
            const raw = await res.text().catch(() => '');
            throw new Error('Resposta inválida (JSON malformado). ' + (raw ? raw.slice(0, 180) : ''));
          }
        } else {
          const raw = await res.text().catch(() => '');
          throw new Error('Resposta não JSON: ' + (raw ? raw.slice(0, 180) : 'sem corpo'));
        }
      } catch (e) {
        throw e;
      }
      console.debug('[LoginDebug] payload:', data);
      if (!res.ok) throw new Error(data.error || 'Falha no login');
      if (phase === 'cred') {
        phase = 'otp';
        if (otpLabel) otpLabel.style.display = '';
        if (otpEl) otpEl.style.display = '';
        const btn = document.getElementById('login-btn');
        if (btn) btn.textContent = 'Validar OTP';
        setStatus('OTP enviado via Telegram. Informe o código.');
        return;
      } else {
        localStorage.setItem('authRole', (data.user?.role || 'user'));
        localStorage.setItem('authUser', (data.user?.username || username));
        if (typeof data.user?.credits !== 'undefined') {
          try { localStorage.setItem('authCredits', String(Number(data.user.credits || 0))); } catch (_) {}
        }
        setStatus('Conectado: ' + (data.user?.username || username));
        const target = '/dashboard';
        setTimeout(() => { window.location.href = target; }, 650);
      }
    } catch (e) {
      console.error('[LoginDebug] error:', e);
      const hint = (window.location.protocol === 'https:' && apiBase.startsWith('http://'))
        ? 'Possível conteúdo misto: backend deve ser HTTPS.'
        : '';
      setStatus('Erro: ' + e.message + (hint ? ' ' + hint : ''));
    }
  }

  function autoRedirectIfLogged() {
    const hasRole = Boolean(localStorage.getItem('authRole'));
    if (hasRole) {
      setStatus('Sessão detectada. Redirecionando para o painel...');
  setTimeout(() => { window.location.href = '/dashboard'; }, 800);
    }
  }

  // Inicializa handlers após DOM pronto
  window.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (loginBtn) loginBtn.addEventListener('click', doLogin);
    if (logoutBtn) logoutBtn.addEventListener('click', logoutAll);
    // Removido auto redirecionamento para index ao detectar sessão,
    // mantendo o usuário na página de login conforme solicitado.
  });
})();