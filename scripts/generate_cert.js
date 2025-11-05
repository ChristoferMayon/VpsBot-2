const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

async function main() {
  const certsDir = path.join(__dirname, '..', 'public', 'certs');
  ensureDir(certsDir);
  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath = path.join(certsDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('Certificados já existem em', certsDir);
    return;
  }

  let selfsigned;
  try {
    selfsigned = require('selfsigned');
  } catch (e) {
    console.error('Pacote selfsigned não encontrado. Instale com: npm i -D selfsigned');
    process.exit(1);
  }

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const opts = {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  };

  const pems = selfsigned.generate(attrs, opts);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
  console.log('Gerado cert.pem e key.pem em', certsDir);
}

main().catch(err => {
  console.error('Falha ao gerar certificados:', err);
  process.exit(1);
});