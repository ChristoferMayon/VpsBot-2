// Lógica de login movida para arquivo externo para compatibilidade com CSP
(function() {
  const apiBase = (window.API_BASE || (window.location.port === '3002' ? 'https://127.0.0.1:3001' : window.location.origin)).replace(/\/$/, '');

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
    const username = (usernameEl?.value || '').trim();
    const password = (passwordEl?.value || '').trim();
    setStatus('Entrando...');
    try {
      console.debug('[LoginDebug] apiBase:', apiBase, 'location:', window.location.href);
      const res = await authFetch(apiBase + '/login', {
        method: 'POST',
        body: { username, password }
      });
      console.debug('[LoginDebug] response:', { ok: res.ok, status: res.status, statusText: res.statusText });
      let data;
      try { data = await res.json(); } catch (_) { throw new Error('Resposta inválida do servidor (sem JSON).'); }
      console.debug('[LoginDebug] payload:', data);
      if (!res.ok) throw new Error(data.error || 'Falha no login');
      // Com cookie-based auth, não armazenamos token. Guardamos apenas metadados úteis.
      localStorage.setItem('authRole', (data.user?.role || 'user'));
      localStorage.setItem('authUser', (data.user?.username || username));
      if (typeof data.user?.credits !== 'undefined') {
        try { localStorage.setItem('authCredits', String(Number(data.user.credits || 0))); } catch (_) {}
      }
      setStatus('Conectado: ' + (data.user?.username || username));
      // Redireciona para a página de envio (aba do Carrossel)
      const target = '/index.html?tab=carousel';
      setTimeout(() => { window.location.href = target; }, 650);
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
      setTimeout(() => { window.location.href = '/index.html'; }, 800);
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