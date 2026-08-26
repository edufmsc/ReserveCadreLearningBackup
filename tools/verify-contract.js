const fs = require('fs');
const front = fs.readFileSync('app.js', 'utf8');
const back = fs.readFileSync('apps-script/code.js', 'utf8');

function fail(message) { console.error(message); process.exit(1); }

const fv = (front.match(/const VERSION = '([^']+)'/) || [])[1];
const bv = (back.match(/VERSION:\s*'([^']+)'/) || [])[1];
if (!fv || !bv || fv !== bv) fail(`VERSION mismatch: frontend=${fv} backend=${bv}`);

const required = new Set();
for (const re of [
  /\bapi\(\s*['"]([^'"]+)['"]/g,
  /\bsaveAdminAction\(\s*['"]([^'"]+)['"]/g,
  /\bmoveItem\(\s*['"]([^'"]+)['"]/g,
  /\baction\s*=\s*['"]([^'"]+)['"]/g
]) {
  for (const m of front.matchAll(re)) required.add(m[1]);
}
const supported = new Set([...back.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)].map(m => m[1]));
const missing = [...required].filter(x => !supported.has(x));
if (missing.length) fail(`Backend missing frontend actions: ${missing.join(', ')}`);

const features = new Set([...front.matchAll(/state\.features\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
const missingFeatures = [...features].filter(name => !new RegExp(`\\b${name}\\s*:\\s*true\\b`).test(back));
if (missingFeatures.length) fail(`Backend missing frontend feature flags: ${missingFeatures.join(', ')}`);

for (const action of ['health','login','logout','bootstrap','studentPackages','adminOverview','adminCatalog','savePackage','saveLesson','saveContent','saveAssignmentsBatch','saveProgress','completeLesson','getPdfContent','getSubmission','uploadSubmissionFile','uploadSubmissionFilesBatch','removeSubmissionFile','submitSubmission','adminSubmissions','reviewSubmission','forceCompletePackage','clearForceCompletePackage']) {
  if (!supported.has(action)) fail(`Required platform action missing: ${action}`);
}
for (const feature of ['lazyDataV114','batchUploadV114','contentFileUploadV116','submissions','forceComplete']) {
  if (!new RegExp(`\\b${feature}\\s*:\\s*true\\b`).test(back)) fail(`Required platform feature missing: ${feature}`);
}
if (!back.includes("BUILD: 'V116-FINAL-20260826'")) fail('Final backend build id missing');
console.log(`Contract OK: ${fv}; frontend actions=${required.size}; backend actions=${supported.size}; frontend features=${features.size}`);
