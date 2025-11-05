// Configurar Webhook Z-API - script externo
(() => {
  // Config de API dinâmica via APP_API
  const api = window.APP_API || null;
  const base = (api && api.proxyBaseUrl) ? api.proxyBaseUrl : window.location.origin;
  const configureWebhookUrl = (api && api.urls && api.urls.configureWebhook) ? api.urls.configureWebhook : `${base}/configure-webhook`;
  const webhookStatusUrl = `${base}/webhook/message-status`;
  console.log('[API Webhook] URLs:', { configureWebhookUrl, webhookStatusUrl });

  function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    if (!logContainer) return;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = type;
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  async function configureWebhook() {
    const input = document.getElementById('publicUrl');
    const publicUrl = input ? input.value.trim() : '';
    if (!publicUrl) {
      addLog('❌ Por favor, insira a URL pública do backend', 'error');
      return;
    }
    addLog('🔄 Configurando webhook na Z-API...', 'info');
    try {
      const response = await fetch(configureWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl })
      });
      const data = await response.json();
      if (response.ok) {
        addLog('✅ Webhook configurado com sucesso!', 'success');
        addLog(`📡 URL do webhook: ${data.webhookUrl}`, 'info');
        addLog(`📋 Resposta Z-API: ${JSON.stringify(data.zapiResponse)}`, 'info');
      } else {
        addLog(`❌ Erro: ${data.error}`, 'error');
        if (data.details) addLog(`📋 Detalhes: ${JSON.stringify(data.details)}`, 'warning');
      }
    } catch (error) {
      addLog(`❌ Erro de conexão: ${error.message}`, 'error');
    }
  }

  async function testWebhook() {
    addLog('🧪 Testando webhook...', 'info');
    try {
      const response = await fetch(webhookStatusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'SENT',
          ids: { id: 'test-123', fromMe: true },
          phone: '5541999999999',
          type: 'text',
          instanceId: 'test',
          momment: Date.now(),
          isGroup: false
        })
      });
      if (response.ok) {
        addLog('✅ Teste do webhook realizado! Verifique o terminal do servidor.', 'success');
      } else {
        addLog('❌ Erro no teste do webhook', 'error');
      }
    } catch (error) {
      addLog(`❌ Erro no teste: ${error.message}`, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Carregar URL salva
    const input = document.getElementById('publicUrl');
    if (input) {
      const savedUrl = localStorage.getItem('publicUrl');
      if (savedUrl) input.value = savedUrl;
      input.addEventListener('input', function() { localStorage.setItem('publicUrl', this.value); });
    }
    // Ligar botões
    const cfgBtn = document.getElementById('configureWebhookBtn');
    const testBtn = document.getElementById('testWebhookBtn');
    if (cfgBtn) cfgBtn.addEventListener('click', configureWebhook);
    if (testBtn) testBtn.addEventListener('click', testWebhook);
  });
})();