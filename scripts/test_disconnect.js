// Testa a desconexão diretamente via provider UAZAPI, usando variáveis do backend-proxy/.env
const path = require('path');
const dotenv = require('dotenv');

// Carrega .env do backend-proxy
dotenv.config({ path: path.join(__dirname, '..', 'backend-proxy', '.env') });

(async () => {
  try {
    const provider = require(path.join('..', 'backend-proxy', 'providers', 'uazapi.js'));
    const instance = process.argv[2] || 'admin';
    console.log('[test_disconnect] Tentando desconectar:', instance);
    const result = await provider.disconnectInstance({ instance });
    console.log('[test_disconnect] Resultado:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('[test_disconnect] Falha:', e.message);
    process.exit(1);
  }
})();