const fs = require('fs');
const front = fs.readFileSync('app.js', 'utf8');
const contract = JSON.parse(fs.readFileSync('apps-script/contract.json', 'utf8'));

function fail(message) { console.error(message); process.exit(1); }

const frontendVersion = (front.match(/const VERSION = '([^']+)'/) || [])[1];
if (!frontendVersion || frontendVersion !== contract.version) {
  fail(`VERSION mismatch: frontend=${frontendVersion} backend-contract=${contract.version}`);
}

const requiredActions = new Set();
for (const re of [
  /\bapi\(\s*['"]([^'"]+)['"]/g,
  /\bsaveAdminAction\(\s*['"]([^'"]+)['"]/g,
  /\bmoveItem\(\s*['"]([^'"]+)['"]/g,
  /\baction\s*=\s*['"]([^'"]+)['"]/g
]) {
  for (const match of front.matchAll(re)) requiredActions.add(match[1]);
}
const supportedActions = new Set(contract.actions || []);
const missingActions = [...requiredActions].filter(action => !supportedActions.has(action));
if (missingActions.length) fail(`Apps Script contract missing frontend actions: ${missingActions.join(', ')}`);

const referencedFeatures = new Set([...front.matchAll(/state\.features\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
const missingFeatures = [...referencedFeatures].filter(name => contract.features?.[name] !== true);
if (missingFeatures.length) fail(`Apps Script contract missing frontend feature flags: ${missingFeatures.join(', ')}`);

const criticalActions = [
  'health','login','logout','bootstrap','studentPackages','adminOverview','adminCatalog',
  'savePackage','saveLesson','saveContent','saveAssignment','saveAssignmentsBatch',
  'setPackageState','deletePackage','deleteLesson','deleteContent','moveLesson','moveContent',
  'exportProgress','saveProgress','completeLesson','getPdfContent','getSubmission',
  'uploadSubmissionFile','uploadSubmissionFilesBatch','removeSubmissionFile','submitSubmission',
  'adminSubmissions','reviewSubmission','forceCompletePackage','clearForceCompletePackage'
];
for (const action of criticalActions) {
  if (!supportedActions.has(action)) fail(`Required Apps Script action missing from contract: ${action}`);
}
for (const feature of ['lazyDataV114','batchUploadV114','contentFileUploadV116','submissions','forceComplete','packageDirectSubmissionV116']) {
  if (contract.features?.[feature] !== true) fail(`Required Apps Script feature missing from contract: ${feature}`);
}
if (contract.build !== 'V116-FINAL4-20260827') fail(`Unexpected backend build id: ${contract.build}`);

console.log(`Contract OK: ${frontendVersion}; frontend actions=${requiredActions.size}; contract actions=${supportedActions.size}; frontend features=${referencedFeatures.size}; build=${contract.build}`);
