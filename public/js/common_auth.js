// Common auth/CSRF helpers for cookie-based authentication
(function(){
  function getCookie(name) {
    try {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
      return '';
    } catch (_) { return ''; }
  }

  function getCsrfToken() {
    return getCookie('XSRF-TOKEN') || getCookie('xsrf-token') || getCookie('csrf_token');
  }

  async function authFetch(url, options) {
    const opts = { ...(options || {}) };
    // Default credentials for same-origin requests
    if (!opts.credentials) opts.credentials = 'same-origin';
    // Headers object (tolerate Headers instance)
    const baseHeaders = (() => {
      try {
        if (opts.headers && typeof opts.headers === 'object' && typeof opts.headers.forEach === 'function' && typeof opts.headers.entries === 'function') {
          return Object.fromEntries(opts.headers.entries());
        }
      } catch (_) {}
      return { ...(opts.headers || {}) };
    })();
    const headers = { ...baseHeaders };
    if (!headers['Accept']) headers['Accept'] = 'application/json';
    const method = String(opts.method || 'GET').toUpperCase();
    // Avoid body on GET/HEAD
    if ((method === 'GET' || method === 'HEAD') && 'body' in opts) {
      try { delete opts.body; } catch (_) { opts.body = undefined; }
    }
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      let csrf = getCsrfToken();
      // If no CSRF cookie, request one from the server
      if (!csrf) {
        try { await fetch('/csrf-token', { credentials: 'same-origin' }); } catch (_) {}
        csrf = getCsrfToken();
      }
      if (csrf) headers['X-CSRF-Token'] = csrf;
      // Content-Type default for JSON bodies
      const isSerializableObject = opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && !(opts.body instanceof URLSearchParams);
      if (isSerializableObject) {
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        if (String(headers['Content-Type']).toLowerCase().includes('application/json')) {
          opts.body = JSON.stringify(opts.body);
        }
      }
      if (!headers['X-Requested-With']) headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    opts.headers = headers;
    return window.fetch(url, opts);
  }

  window.getCsrfToken = getCsrfToken;
  window.authFetch = authFetch;
  async function qrFlowLog(event, details) {
    try {
      const payload = { event, details };
      await authFetch('/ui/qr-flow-log', { method: 'POST', body: payload, keepalive: true });
    } catch (_) { /* silencia erros de log no cliente */ }
  }
  window.qrFlowLog = qrFlowLog;
})();