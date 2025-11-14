const fs = require('fs');
const path = require('path');
const terser = require('terser');

(async function(){
  const srcDir = path.join(__dirname, '..', '..', 'public', 'js');
  const outDir = path.join(__dirname, '..', '..', 'public_seguro', 'js');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const files = ['carousel_script_new.js', 'index.js', 'common_auth.js'];
  for (const f of files) {
    const srcPath = path.join(srcDir, f);
    const outPath = path.join(outDir, f);
    try {
      const code = fs.readFileSync(srcPath, 'utf8');
      const result = await terser.minify(code, { compress: true, mangle: true });
      const obf = (result && result.code) ? result.code : code;
      fs.writeFileSync(outPath, obf, 'utf8');
      process.stdout.write(`Obfuscated: ${f}\n`);
    } catch (e) {
      process.stderr.write(`Failed: ${f} -> ${e?.message || String(e)}\n`);
      process.exitCode = 1;
    }
  }
  process.stdout.write('Obfuscation bundle completed\n');
})();