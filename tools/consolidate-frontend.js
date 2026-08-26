const fs = require('fs');
const vm = require('vm');

const appSource = fs.readFileSync('app.js', 'utf8');
const loaderOriginal = fs.readFileSync('app.v112.loader.js', 'utf8');
const capturedStyles = [];

global.window = globalThis;
global.document = {
  head: {
    appendChild(el) {
      capturedStyles.push({ id: el.id || '', css: String(el.textContent || '') });
    }
  },
  createElement() { return { id: '', textContent: '' }; },
  getElementById() { return null; }
};

global.fetch = async function(url) {
  const clean = String(url).split('?')[0];
  if (clean === 'app.v112.loader.js') {
    const needle = '(0,eval)(source);';
    const count = loaderOriginal.split(needle).length - 1;
    if (count !== 1) throw new Error('FINAL_EVAL_POINT_' + count);
    const loader = loaderOriginal.replace(
      needle,
      'globalThis.__FINAL_SOURCE__=source;globalThis.__V112_CSS__=css;'
    );
    return new Response(loader, { status: 200, headers: { 'content-type': 'text/javascript' } });
  }
  if (!fs.existsSync(clean)) return new Response('not found', { status: 404 });
  return new Response(fs.readFileSync(clean, 'utf8'), { status: 200 });
};

vm.runInThisContext(appSource, { filename: 'app.js' });

(async () => {
  for (let i = 0; i < 200 && !global.__FINAL_SOURCE__; i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!global.__FINAL_SOURCE__) throw new Error('FINAL_SOURCE_NOT_CAPTURED');
  if (!global.__V112_CSS__) throw new Error('V112_CSS_NOT_CAPTURED');
  const v113 = capturedStyles.find(x => x.id === 'v113-release-style');
  if (!v113 || !v113.css) throw new Error('V113_CSS_NOT_CAPTURED');

  const finalSource = String(global.__FINAL_SOURCE__).trimEnd() + '\n';
  const required = [
    "const VERSION = 'V1.1.3';",
    'applicabilityMode',
    'drivePreviewUrl',
    'data-pdf-url',
    'clearForceCompletePackage',
    'loadStudentSubmission'
  ];
  for (const token of required) {
    if (!finalSource.includes(token)) throw new Error('MISSING_RUNTIME_TOKEN_' + token);
  }
  const forbidden = ['app.v112.loader.js', 'app.bundle.001', 'patch113(source)', 'DecompressionStream'];
  for (const token of forbidden) {
    if (finalSource.includes(token)) throw new Error('LEGACY_RUNTIME_TOKEN_' + token);
  }

  fs.writeFileSync('app.js', finalSource, 'utf8');
  const baseCss = fs.readFileSync('styles.css', 'utf8').trimEnd();
  const mergedCss = baseCss
    + '\n\n/* Consolidated V1.1.2 runtime overrides */\n'
    + String(global.__V112_CSS__).trim()
    + '\n\n/* Consolidated V1.1.3 runtime overrides */\n'
    + v113.css.trim()
    + '\n';
  fs.writeFileSync('styles.css', mergedCss, 'utf8');

  for (const file of ['app.v112.loader.js','app.bundle.001','app.bundle.002','app.bundle.003','app.bundle.004']) {
    fs.rmSync(file, { force: true });
  }

  console.log('Consolidated app.js bytes:', Buffer.byteLength(finalSource));
  console.log('Consolidated styles.css bytes:', Buffer.byteLength(mergedCss));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
