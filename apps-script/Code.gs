const APP = Object.freeze({
  SPREADSHEET_ID: '1JRLlGxbxgy3VolwulN3dSfq_ETgn0HrKiOnLhyEYT10',
  TZ: 'Asia/Taipei',
  VERSION: 'V1.0',
  BUILD: 'UX-STABILITY-V1-20260924',
  SESSION_TTL_SECONDS: 21600,
  SESSION_PROP_PREFIX: 'learning-session-v11-',
  STATIC_CACHE_SECONDS: 60,
  SHEETS: Object.freeze({
    SETTINGS: '系統設定',
    EMPLOYEES: '員工主檔',
    PACKAGES: '母課程',
    LESSONS: '子課程',
    CONTENT: '教材內容',
    ASSIGNMENTS: '課程指派',
    PROGRESS: '學習紀錄',
    LOGIN_LOG: '登入紀錄',
    SUBMISSIONS: '作業回傳'
  })
});

let RUNTIME_ = null;
const STATIC_TABLES_ = Object.freeze([
  '系統設定', '員工主檔', '母課程', '子課程', '教材內容', '課程指派'
]);

// V1.1.4: shared server-side cache. These are safety TTLs, not refresh intervals.
// Web-app writes update/invalidate the cache immediately; TTL mainly protects against stale
// data when someone edits the Sheet directly. Keep values conservative.
const TABLE_CACHE_SECONDS_ = Object.freeze({
  '系統設定': 300,
  '員工主檔': 360,
  '母課程': 300,
  '子課程': 300,
  '教材內容': 300,
  '課程指派': 60
});
const STUDENT_PACKAGES_CACHE_SECONDS_ = 45;
const STUDENT_HOME_CACHE_SECONDS_ = 360;
const ADMIN_OVERVIEW_CACHE_SECONDS_ = 15;
const ADMIN_TRACKING_CACHE_SECONDS_ = 60;
const ADMIN_TRACKING_DETAIL_CACHE_SECONDS_ = 30;
const SUBMISSION_SNAPSHOT_CACHE_SECONDS_ = 45;
const PROGRESS_SNAPSHOT_CACHE_SECONDS_ = 45;
const PROGRESS_EMPLOYEE_CACHE_SECONDS_ = 300;
const ADMIN_CATALOG_CACHE_SECONDS_ = 60;
const LOGIN_RESULT_CACHE_SECONDS_ = 120;
const LOGIN_PROCESSING_CACHE_SECONDS_ = 40;
const LOGIN_REFRESH_COOLDOWN_SECONDS_ = 20;
const CACHE_JSON_SAFE_BYTES_ = 90000;
const FAST_START_VERSION_ = 'V2';

function featureFlags_() {
  return { adminBasics: true, persistentSession: true, submissions: true, forceComplete: true, lessonApplicability: true, overdueContinue: true, flatSubmissionFolders: true, cleanFast: true, lazyDataV114: true, cacheServiceV2: true, batchUploadV114: true, contentFileUploadV116: true, packageDirectSubmissionV116: true, contentMoveV1: true, courseReuseV1: true, fastPathV1: true, loginRetryV1: true, splitReadV1: true, warmSnapshotV1: true, stabilityCoreV1: true, idleLogoutV1: true, progressFastWriteV1: true, loginReliabilityV2: true, employeeWarmCacheV1: true, authWarmV1: true, loginStatusV1: true, progressSnapshotV1: true, adminTrackingFastV1: true, areaManagerTrackingV1: true, fastStartV2: true, loginFastPathV3: true, trackingSubmissionStatusV1: true, trackingDetailFastV2: true, uxStabilityV1: true };
}

function cacheJsonGet_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function cacheJsonPut_(key, value, seconds) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > CACHE_JSON_SAFE_BYTES_) return false;
    CacheService.getScriptCache().put(key, raw, Math.max(1, Math.round(number_(seconds) || 1)));
    return true;
  } catch (e) { return false; }
}

function cachedCatalogRevision_() {
  try { return CacheService.getScriptCache().get('learning-v1-catalog-rev') || ''; }
  catch (e) { return ''; }
}

function studentHomeCacheKeyForRevision_(revision, employeeId) {
  return revision ? 'learning-v1-student-home-' + revision + '-' + clean_(employeeId) : '';
}

function adminTrackingCacheKeyForRevision_(revision) {
  return revision ? 'learning-v1-admin-tracking-' + revision : '';
}

function cachedStudentHomeOnly_(employeeId) {
  const revision = cachedCatalogRevision_();
  const key = studentHomeCacheKeyForRevision_(revision, employeeId);
  if (!key) return null;
  const cached = cacheJsonGet_(key);
  return cached && Array.isArray(cached.packages) ? cached.packages : null;
}

function cachedAdminTrackingOnly_(session) {
  const revision = cachedCatalogRevision_();
  const key = adminTrackingCacheKeyForRevision_(revision);
  if (!key) return null;
  const cached = cacheJsonGet_(key);
  if (!cached || !Array.isArray(cached.overview)) return null;
  return scopeTrackingOverview_(session, cached.overview);
}

function initialViewHint_(session, payload) {
  const hint = clean_(payload && payload.viewHint).toLowerCase();
  if (session && session.roleKey === 'area_manager') return hint === 'student' ? 'student' : 'tracking';
  return session && session.roleKey === 'admin' ? 'tracking' : 'student';
}

function attachCachedFirstScreen_(session, payload, bootstrap) {
  bootstrap = bootstrap || {};
  const initialView = initialViewHint_(session, payload);
  bootstrap.initialView = initialView;
  bootstrap.fastStart = { version: FAST_START_VERSION_, source: 'none' };
  if (initialView === 'student' && isLearnerSession_(session)) {
    const packages = cachedStudentHomeOnly_(session.employeeId);
    if (packages) {
      bootstrap.packages = packages;
      bootstrap.fastStart = { version: FAST_START_VERSION_, source: 'studentHomeCache' };
    }
  } else if (initialView === 'tracking' && isTrackingViewerSession_(session)) {
    const overview = cachedAdminTrackingOnly_(session);
    if (overview) {
      bootstrap.overview = overview;
      bootstrap.fastStart = { version: FAST_START_VERSION_, source: 'adminTrackingCache' };
    }
  }
  return bootstrap;
}

function tableCacheSeconds_(sheetName) {
  return TABLE_CACHE_SECONDS_[sheetName] || APP.STATIC_CACHE_SECONDS;
}

function catalogRevision_() {
  const cacheKey = 'learning-v1-catalog-rev';
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return cached;
  } catch (e) {}
  let value = '0';
  try { value = PropertiesService.getScriptProperties().getProperty('learning-v114-catalog-rev') || '0'; } catch (e) {}
  try { CacheService.getScriptCache().put(cacheKey, value, 21600); } catch (e) {}
  return value;
}
function bumpCatalogRevision_() {
  const value = String(Date.now());
  try { PropertiesService.getScriptProperties().setProperty('learning-v114-catalog-rev', value); } catch (e) {}
  try { CacheService.getScriptCache().put('learning-v1-catalog-rev', value, 21600); } catch (e) {}
  return value;
}
function studentPackagesCacheKey_(employeeId) { return 'learning-v114-student-packages-' + catalogRevision_() + '-' + clean_(employeeId); }
function studentHomeCacheKey_(employeeId) { return 'learning-v1-student-home-' + catalogRevision_() + '-' + clean_(employeeId); }
function adminOverviewCacheKey_() { return 'learning-v114-admin-overview-' + catalogRevision_(); }
function adminTrackingCacheKey_() { return 'learning-v1-admin-tracking-' + catalogRevision_(); }
function adminTrackingDetailCacheKey_(employeeId, packageId) { return 'learning-v1-admin-tracking-detail-' + catalogRevision_() + '-' + clean_(employeeId) + '-' + clean_(packageId); }
function submissionSnapshotCacheKey_() { return 'learning-v1-submission-snapshot'; }
function adminCatalogCacheKey_() { return 'learning-v114-admin-catalog-' + catalogRevision_(); }
function invalidateStudentPackages_(employeeId) { try { const cache=CacheService.getScriptCache(); cache.remove(studentPackagesCacheKey_(employeeId)); cache.remove(studentHomeCacheKey_(employeeId)); } catch (e) {} }
function invalidateAdminOverview_() { try { const cache=CacheService.getScriptCache(); cache.remove(adminOverviewCacheKey_()); cache.remove(adminTrackingCacheKey_()); } catch (e) {} }
function invalidateAdminTrackingDetail_(employeeId, packageId) { try { CacheService.getScriptCache().remove(adminTrackingDetailCacheKey_(employeeId, packageId)); } catch (e) {} }
function invalidateSubmissionSnapshot_() {
  try { CacheService.getScriptCache().remove(submissionSnapshotCacheKey_()); } catch (e) {}
  delete runtime_().submissionSnapshotRows;
  invalidateAdminOverview_();
}
function invalidateAdminCatalog_() { try { CacheService.getScriptCache().remove(adminCatalogCacheKey_()); } catch (e) {} }

function resetRuntime_() {
  RUNTIME_ = { ss: null, sheets: {}, tables: {} };
}

function runtime_() {
  if (!RUNTIME_) resetRuntime_();
  return RUNTIME_;
}

function staticCacheKey_(sheetName) {
  return 'learning-v11-table-' + sheetName;
}

function isStaticTable_(sheetName) {
  return STATIC_TABLES_.indexOf(sheetName) >= 0;
}

function cacheTable_(sheetName, table) {
  if (!isStaticTable_(sheetName)) return;
  cacheJsonPut_(staticCacheKey_(sheetName), table, tableCacheSeconds_(sheetName));
}

function invalidateTable_(sheetName) {
  const rt = runtime_();
  delete rt.tables[sheetName];
  if (isStaticTable_(sheetName)) {
    try { CacheService.getScriptCache().remove(staticCacheKey_(sheetName)); } catch (e) {}
    bumpCatalogRevision_();
    invalidateAdminCatalog_();
    invalidateAdminOverview_();
  }
}

function doGet() {
  resetRuntime_();
  return json_({ success: true, service: 'ReserveCadreLearningBackup', version: APP.VERSION, time: now_() });
}

function doPost(e) {
  resetRuntime_();
  try {
    const body = parseBody_(e);
    const action = clean_(body.action);
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const token = clean_(body.sessionToken);

    switch (action) {
      case 'health': return json_({ success: true, data: health_() });
      case 'authWarm': return json_({ success: true, data: authWarm_() });
      case 'loginStatus': return json_({ success: true, data: loginStatus_(payload) });
      case 'login': return json_({ success: true, data: login_(payload) });
      case 'logout': return json_({ success: true, data: logout_(token) });
      case 'bootstrap': return json_({ success: true, data: bootstrap_(requireSession_(token), payload) });
      case 'studentPackages': return json_({ success: true, data: studentPackagesAction_(requireSession_(token)) });
      case 'studentHome': return json_({ success: true, data: studentHomeAction_(requireSession_(token)) });
      case 'studentLesson': return json_({ success: true, data: studentLessonAction_(requireSession_(token), payload) });
      case 'adminOverview': return json_({ success: true, data: adminOverview_(requireTrackingViewer_(token)) });
      case 'adminTracking': return json_({ success: true, data: adminTracking_(requireTrackingViewer_(token)) });
      case 'adminTrackingDetail': return json_({ success: true, data: adminTrackingDetail_(requireTrackingViewer_(token), payload) });
      case 'adminCatalog': return json_({ success: true, data: adminCatalog_(requireAdmin_(token)) });
      case 'savePackage': return json_({ success: true, data: savePackage_(requireAdmin_(token), payload) });
      case 'saveLesson': return json_({ success: true, data: saveLesson_(requireAdmin_(token), payload) });
      case 'saveContent': return json_({ success: true, data: saveContent_(requireAdmin_(token), payload) });
      case 'saveAssignment': return json_({ success: true, data: saveAssignment_(requireAdmin_(token), payload) });
      case 'saveAssignmentsBatch': return json_({ success: true, data: saveAssignmentsBatch_(requireAdmin_(token), payload) });
      case 'setPackageState': return json_({ success: true, data: setPackageState_(requireAdmin_(token), payload) });
      case 'deletePackage': return json_({ success: true, data: deletePackage_(requireAdmin_(token), payload) });
      case 'deleteLesson': return json_({ success: true, data: deleteLesson_(requireAdmin_(token), payload) });
      case 'deleteContent': return json_({ success: true, data: deleteContent_(requireAdmin_(token), payload) });
      case 'moveLesson': return json_({ success: true, data: moveLesson_(requireAdmin_(token), payload) });
      case 'moveContent': return json_({ success: true, data: moveContent_(requireAdmin_(token), payload) });
      case 'moveContentsToLesson': return json_({ success: true, data: moveContentsToLesson_(requireAdmin_(token), payload) });
      case 'reuseContents': return json_({ success: true, data: reuseContents_(requireAdmin_(token), payload) });
      case 'copyLesson': return json_({ success: true, data: copyLesson_(requireAdmin_(token), payload) });
      case 'copyPackage': return json_({ success: true, data: copyPackage_(requireAdmin_(token), payload) });
      case 'exportProgress': return json_({ success: true, data: exportProgress_(requireAdmin_(token)) });
      case 'saveProgress': return json_({ success: true, data: saveProgress_(requireSession_(token), payload) });
      case 'completeLesson': return json_({ success: true, data: completeLesson_(requireSession_(token), payload) });
      case 'getPdfContent': return json_({ success: true, data: getPdfContent_(requireSession_(token), payload) });
      case 'getSubmission': return json_({ success: true, data: getSubmission_(requireSession_(token), payload) });
      case 'uploadSubmissionFile': return json_({ success: true, data: uploadSubmissionFile_(requireSession_(token), payload) });
      case 'uploadSubmissionFilesBatch': return json_({ success: true, data: uploadSubmissionFilesBatch_(requireSession_(token), payload) });
      case 'removeSubmissionFile': return json_({ success: true, data: removeSubmissionFile_(requireSession_(token), payload) });
      case 'submitSubmission': return json_({ success: true, data: submitSubmission_(requireSession_(token), payload) });
      case 'adminSubmissions': return json_({ success: true, data: adminSubmissions_(requireAdmin_(token)) });
      case 'reviewSubmission': return json_({ success: true, data: reviewSubmission_(requireAdmin_(token), payload) });
      case 'forceCompletePackage': return json_({ success: true, data: forceCompletePackage_(requireAdmin_(token), payload) });
      case 'clearForceCompletePackage': return json_({ success: true, data: clearForceCompletePackage_(requireAdmin_(token), payload) });
      default: throw apiError_('UNKNOWN_ACTION', '不支援的操作。');
    }
  } catch (err) {
    const code = err && err.code ? err.code : 'SERVER_ERROR';
    const message = err && err.message ? err.message : '系統處理失敗。';
    return json_({ success: false, error: { code: code, message: message } });
  }
}

// V1.0 Warm-up: optional time trigger to reduce long-idle/cold-start latency.
// Run installSystemWarmUpTrigger() ONCE from the Apps Script editor after deployment.
// It creates one 5-minute trigger. The warm-up is deliberately lightweight: it
// does not scan progress/submissions/Drive and does not extend employee credential
// cache lifetime, so password/account-status changes keep the existing freshness.
function systemWarmUp() {
  const startedAt = Date.now();
  resetRuntime_();
  try { CacheService.getScriptCache().put('learning-v116-warm-heartbeat', String(startedAt), 600); } catch (e) {}

  // V1.0 Stability Core: keep warm-up intentionally light.
  // Do NOT scan progress/submissions/Drive and do NOT pre-build every learner dashboard.
  // Static course structure stays warm; personal progress is fetched on demand by employee.
  try {
    [APP.SHEETS.SETTINGS, APP.SHEETS.EMPLOYEES, APP.SHEETS.PACKAGES, APP.SHEETS.LESSONS, APP.SHEETS.CONTENT, APP.SHEETS.ASSIGNMENTS]
      .forEach(name => table_(name, true));
    const signature = [
      rows_(APP.SHEETS.EMPLOYEES).length,
      rows_(APP.SHEETS.PACKAGES).length,
      rows_(APP.SHEETS.LESSONS).length,
      rows_(APP.SHEETS.CONTENT).length,
      rows_(APP.SHEETS.ASSIGNMENTS).length
    ].join(':');
    try { CacheService.getScriptCache().put('learning-v1-warm-snapshot', signature, 600); } catch (e) {}
    cleanupExpiredSessions_();
    return { ok: true, time: now_(), elapsedMs: Date.now() - startedAt, snapshot: signature, mode: 'auth-and-static' };
  } catch (e) {
    try { console.warn('[SYSTEM_WARMUP_FAILED]', String(e && e.message || e)); } catch (_) {}
    return { ok: false, time: now_(), elapsedMs: Date.now() - startedAt };
  }
}

function installSystemWarmUpTrigger() {
  const handler = 'systemWarmUp';
  // Idempotent: remove duplicates/older warm-up triggers first.
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handler)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(5)
    .create();

  // Run once immediately so deployment does not wait for the first scheduled tick.
  const firstRun = systemWarmUp();
  return { installed: true, everyMinutes: 5, firstRun: firstRun };
}

function removeSystemWarmUpTrigger() {
  const handler = 'systemWarmUp';
  let removed = 0;
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handler)
    .forEach(trigger => { ScriptApp.deleteTrigger(trigger); removed += 1; });
  return { removed: removed };
}

function health_() {
  // V1.0: connectivity probe only. Never open Spreadsheet/Drive here.
  // A health request must stay fast even after a long idle/cold start; actual
  // data integrity is validated by the action that uses the corresponding sheet.
  return {
    ok: true,
    version: APP.VERSION,
    build: APP.BUILD,
    spreadsheetId: APP.SPREADSHEET_ID,
    missingSheets: [],
    features: featureFlags_(),
    time: now_()
  };
}

function authWarm_() {
  // Login-page preflight. Warm only the employee master; no progress/submission/Drive work.
  // Course structure is handled by the existing lightweight 5-minute systemWarmUp trigger.
  const employees = rows_(APP.SHEETS.EMPLOYEES);
  return { ok: true, employeeCount: employees.length, features: featureFlags_(), time: now_() };
}

function loginRequestKey_(payload) {
  payload = payload || {};
  const employeeKey = clean_(payload.employeeId).toUpperCase();
  const requestId = clean_(payload.requestId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return requestId && employeeKey ? 'learning-v1-login-result-' + requestId + '-' + employeeKey : '';
}

function loginStatus_(payload) {
  const requestKey = loginRequestKey_(payload);
  if (!requestKey) return { status: 'missing' };
  const result = cacheJsonGet_(requestKey);
  if (result && result.sessionToken && result.bootstrap) return { status: 'done', login: result };
  let marker = null;
  try { marker = JSON.parse(CacheService.getScriptCache().get(loginProcessingKey_(requestKey)) || 'null'); } catch (e) { marker = null; }
  if (marker && marker.startedAt && Date.now() - Number(marker.startedAt) < 30000) return { status: 'processing' };
  return { status: 'missing' };
}


function loginProcessingKey_(requestKey) { return requestKey ? requestKey + '-processing' : ''; }

function claimLoginRequest_(requestKey) {
  if (!requestKey) return { owner: true };
  const existing = cacheJsonGet_(requestKey);
  if (existing && existing.sessionToken && existing.bootstrap) return { owner: false, result: existing };
  let lock = null, locked = false;
  try { lock = LockService.getScriptLock(); locked = lock.tryLock(1200); } catch (e) {}
  if (!locked) return { owner: false, processing: true };
  try {
    const again = cacheJsonGet_(requestKey);
    if (again && again.sessionToken && again.bootstrap) return { owner: false, result: again };
    const cache = CacheService.getScriptCache();
    const processingKey = loginProcessingKey_(requestKey);
    let marker = null;
    try { marker = JSON.parse(cache.get(processingKey) || 'null'); } catch (e) { marker = null; }
    const age = marker && marker.startedAt ? Date.now() - Number(marker.startedAt) : Number.MAX_SAFE_INTEGER;
    if (marker && age < 28000) return { owner: false, processing: true };
    cache.put(processingKey, JSON.stringify({ startedAt: Date.now() }), LOGIN_PROCESSING_CACHE_SECONDS_);
    return { owner: true };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

function waitLoginResult_(requestKey, waitMs) {
  const end = Date.now() + Math.max(0, number_(waitMs));
  while (Date.now() < end) {
    Utilities.sleep(250);
    const result = cacheJsonGet_(requestKey);
    if (result && result.sessionToken && result.bootstrap) return result;
  }
  return null;
}

function releaseLoginClaim_(requestKey) {
  if (!requestKey) return;
  try { CacheService.getScriptCache().remove(loginProcessingKey_(requestKey)); } catch (e) {}
}

function login_(payload) {
  const startedAt = Date.now();
  const inputEmployeeId = clean_(payload.employeeId);
  const employeeKey = inputEmployeeId.toUpperCase();
  const password = clean_(payload.password);
  const requestId = clean_(payload.requestId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!inputEmployeeId || !password) throw apiError_('LOGIN_REQUIRED', '請輸入帳號與密碼。');
  const requestKey = requestId ? 'learning-v1-login-result-' + requestId + '-' + employeeKey : '';
  const claim = claimLoginRequest_(requestKey);
  if (claim.result) return claim.result;
  if (claim.processing) {
    throw apiError_('LOGIN_IN_PROGRESS', '登入仍在處理中，系統會自動確認結果。');
  }

  try {
    let employees = rows_(APP.SHEETS.EMPLOYEES);
    let user = employees.find(r => clean_(r['工號']).toUpperCase() === employeeKey) || null;
    const cache = CacheService.getScriptCache();
    const refreshKey = 'learning-v1-login-refresh-' + employeeKey;
    const needsRefresh = !user || clean_(user['帳號狀態']) !== '啟用' || clean_(user['密碼']) !== password;
    if (needsRefresh) {
      let canRefresh = true;
      try { canRefresh = !cache.get(refreshKey); } catch (e) {}
      if (canRefresh) {
        try { cache.put(refreshKey, '1', LOGIN_REFRESH_COOLDOWN_SECONDS_); } catch (e) {}
        employees = table_(APP.SHEETS.EMPLOYEES, true).rows;
        user = employees.find(r => clean_(r['工號']).toUpperCase() === employeeKey) || null;
      }
    }
    if (!user || clean_(user['密碼']) !== password) {
      safeWriteLoginLog_(inputEmployeeId, user ? clean_(user['姓名']) : '', '失敗');
      throw apiError_('LOGIN_FAILED', '帳號或密碼錯誤。');
    }
    if (clean_(user['帳號狀態']) !== '啟用') {
      safeWriteLoginLog_(clean_(user['工號']), clean_(user['姓名']), '停用');
      throw apiError_('ACCOUNT_DISABLED', '此帳號目前停用，請洽教育中心。');
    }
    const employeeId = clean_(user['工號']);
    const role = clean_(user['系統角色']);
  const session = {
    employeeId: employeeId,
    name: clean_(user['姓名']),
    role: role,
    roleKey: role === '教育中心' ? 'admin' : (role === '區主管' ? 'area_manager' : 'student'),
    area: clean_(user['區域']),
    store: clean_(user['店別']),
    loginAt: now_()
  };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const stored = {
    session: session,
    expiresAt: Date.now() + APP.SESSION_TTL_SECONDS * 1000
  };
  const raw = JSON.stringify(stored);
  try { CacheService.getScriptCache().put(sessionKey_(token), raw, APP.SESSION_TTL_SECONDS); } catch (e) {}

  // Publish the completed login result BEFORE persistent session storage. If
  // PropertiesService is temporarily slow, loginStatus can already recover this token
  // and the browser can continue because the session is valid in ScriptCache.
  const bootstrap = bootstrap_(session, payload);
  const result = { sessionToken: token, user: session, expiresIn: APP.SESSION_TTL_SECONDS, bootstrap: bootstrap, timing: { totalMs: Date.now() - startedAt, fastStartSource: bootstrap.fastStart && bootstrap.fastStart.source || 'none' } };
  if (requestKey) cacheJsonPut_(requestKey, result, LOGIN_RESULT_CACHE_SECONDS_);

  // Persistent fallback remains best-effort for session resilience, but it is no longer
  // a prerequisite for login recovery. A slow write must not force the user to log in again.
  try { PropertiesService.getScriptProperties().setProperty(sessionPropKey_(token), raw); } catch (e) {
    try { console.warn('[SESSION_PERSIST_FAILED]', employeeId, String(e && e.message || e)); } catch (_) {}
  }
  safeWriteLoginLog_(employeeId, session.name, '成功');
  result.timing.totalMs = Date.now() - startedAt;
  return result;
  } finally {
    releaseLoginClaim_(requestKey);
  }
}

function logout_(token) {
  if (token) {
    try { CacheService.getScriptCache().remove(sessionKey_(token)); } catch (e) {}
    try { PropertiesService.getScriptProperties().deleteProperty(sessionPropKey_(token)); } catch (e) {}
  }
  return { loggedOut: true };
}

function bootstrap_(session, payload) {
  const startedAt = Date.now();
  // Fast Start V2 Login R2: bootstrap must stay Sheet-free on the login critical path.
  // Upload limits are loaded by submission APIs only when the user actually opens a submission flow.
  // A cache miss must never open Sheets merely to make bootstrap/login look complete.
  const bootstrap = { user: session, mode: session.roleKey === 'admin' ? 'admin' : (session.roleKey === 'area_manager' ? 'area_manager' : 'student'), features: featureFlags_(), lazyData: true };
  attachCachedFirstScreen_(session, payload || {}, bootstrap);
  bootstrap.timing = { totalMs: Date.now() - startedAt, fastStartSource: bootstrap.fastStart && bootstrap.fastStart.source || 'none' };
  return bootstrap;
}

function isLearnerSession_(session) {
  return !!session && (session.roleKey === 'student' || session.roleKey === 'area_manager');
}

function isTrackingViewerSession_(session) {
  return !!session && (session.roleKey === 'admin' || session.roleKey === 'area_manager');
}

function trackingArea_(session) {
  return session && session.roleKey === 'area_manager' ? clean_(session.area) : '';
}

function scopeTrackingOverview_(session, overview) {
  overview = Array.isArray(overview) ? overview : [];
  if (!session || session.roleKey === 'admin') return overview;
  const area = trackingArea_(session);
  if (!area) return [];
  return overview.filter(person => clean_(person.area) === area);
}

function studentPackagesAction_(session) {
  if (!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY', '只有學員帳號可以讀取自己的課程。');
  return { user: session, packages: studentPackages_(session.employeeId) };
}

function adminOverview_(session) {
  const cached = cacheJsonGet_(adminOverviewCacheKey_());
  if (cached && Array.isArray(cached.overview)) return { user: session, overview: scopeTrackingOverview_(session, cached.overview), cached: true };
  const overview = adminOverviewData_(dataBundle_());
  cacheJsonPut_(adminOverviewCacheKey_(), { overview: overview }, ADMIN_OVERVIEW_CACHE_SECONDS_);
  return { user: session, overview: scopeTrackingOverview_(session, overview), cached: false };
}

function adminCatalog_(session) {
  const cached = cacheJsonGet_(adminCatalogCacheKey_());
  if (cached && cached.catalog) return { user: session, catalog: cached.catalog, cached: true };
  const catalog = adminCatalogData_(catalogBundle_());
  cacheJsonPut_(adminCatalogCacheKey_(), { catalog: catalog }, ADMIN_CATALOG_CACHE_SECONDS_);
  return { user: session, catalog: catalog, cached: false };
}

function lessonSummaryDto_(lessonRow, contentRows, progressRows) {
  const lessonId = clean_(lessonRow['子課程ID']);
  const p = progressRows.find(r => clean_(r['子課程ID']) === lessonId) || {};
  const ownContents = contentRows.filter(r => clean_(r['子課程ID']) === lessonId && clean_(r['啟用']) !== '否');
  const types = [];
  ownContents.forEach(r => { const type = clean_(r['類型']).toUpperCase(); if (type && types.indexOf(type) < 0) types.push(type); });
  return {
    id: lessonId,
    packageId: clean_(lessonRow['母課程ID']),
    title: clean_(lessonRow['子課程名稱']),
    required: clean_(lessonRow['必修']) === '是',
    status: clean_(p['狀態']) || 'not_started',
    videoSeconds: number_(p['影片秒數']),
    pdfSeconds: number_(p['PDF秒數']),
    startedAt: clean_(p['開始時間']),
    completedAt: clean_(p['完成時間']),
    updatedAt: clean_(p['更新時間']),
    videoPassPercent: nullableNumber_(lessonRow['影片最低完成率']),
    submissionMode: clean_(lessonRow['作業回傳模式']) || '不需要',
    contentTypes: types,
    contentCount: ownContents.length,
    detailLoaded: false
  };
}

function pushIndexedRow_(map, key, row) {
  key = clean_(key);
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}

function learningReadIndex_(data) {
  const packageRows = data.packages.filter(r => clean_(r['啟用']) === '是' && packagePublished_(r));
  const packageById = new Map();
  packageRows.forEach(r => { const id = clean_(r['母課程ID']); if (id) packageById.set(id, r); });

  const contentRows = data.contents.filter(r => clean_(r['啟用']) === '是');
  const contentsByLesson = new Map();
  contentRows.forEach(r => pushIndexedRow_(contentsByLesson, r['子課程ID'], r));
  contentsByLesson.forEach(rows => rows.sort((a,b) => number_(a['排序']) - number_(b['排序'])));

  const lessonsByPackage = new Map();
  data.lessons.forEach(r => {
    if (clean_(r['啟用']) !== '是') return;
    const lessonId = clean_(r['子課程ID']);
    const packageId = clean_(r['母課程ID']);
    if (!lessonId || !packageId) return;
    if (clean_(r['子課程名稱']) === '__PACKAGE_DIRECT__') {
      const hasContent = (contentsByLesson.get(lessonId) || []).length > 0;
      const hasSubmission = (clean_(r['作業回傳模式']) || '不需要') !== '不需要';
      if (!hasContent && !hasSubmission) return;
    }
    pushIndexedRow_(lessonsByPackage, packageId, r);
  });
  lessonsByPackage.forEach(rows => rows.sort((a,b) => number_(a['排序']) - number_(b['排序'])));

  const assignmentsByEmployee = new Map();
  data.assignments.forEach(r => {
    if (!assignmentEnabled_(r)) return;
    pushIndexedRow_(assignmentsByEmployee, r['工號'], r);
  });

  const progressByEmployee = new Map();
  (data.progress || []).forEach(r => pushIndexedRow_(progressByEmployee, r['工號'], r));

  return {
    packageRows: packageRows,
    packageById: packageById,
    contentsByLesson: contentsByLesson,
    lessonsByPackage: lessonsByPackage,
    assignmentsByEmployee: assignmentsByEmployee,
    progressByEmployee: progressByEmployee
  };
}

function lessonSummaryDtoIndexed_(lessonRow, index, progressByLesson) {
  const lessonId = clean_(lessonRow['子課程ID']);
  const p = progressByLesson.get(lessonId) || {};
  const ownContents = index.contentsByLesson.get(lessonId) || [];
  const types = [];
  ownContents.forEach(r => { const type = clean_(r['類型']).toUpperCase(); if (type && types.indexOf(type) < 0) types.push(type); });
  return {
    id: lessonId,
    packageId: clean_(lessonRow['母課程ID']),
    title: clean_(lessonRow['子課程名稱']),
    required: clean_(lessonRow['必修']) === '是',
    status: clean_(p['狀態']) || 'not_started',
    videoSeconds: number_(p['影片秒數']),
    pdfSeconds: number_(p['PDF秒數']),
    startedAt: clean_(p['開始時間']),
    completedAt: clean_(p['完成時間']),
    updatedAt: clean_(p['更新時間']),
    videoPassPercent: nullableNumber_(lessonRow['影片最低完成率']),
    submissionMode: clean_(lessonRow['作業回傳模式']) || '不需要',
    contentTypes: types,
    contentCount: ownContents.length,
    detailLoaded: false
  };
}

function studentHomeFromData_(employeeId, data, index) {
  employeeId = clean_(employeeId);
  index = index || learningReadIndex_(data);
  const assignments = index.assignmentsByEmployee.get(employeeId) || [];
  const progressRows = index.progressByEmployee.get(employeeId) || [];
  const progressByLesson = new Map();
  progressRows.forEach(r => { const lessonId = clean_(r['子課程ID']); if (lessonId) progressByLesson.set(lessonId, r); });

  return assignments.map(a => {
    const packageId = clean_(a['母課程ID']);
    const pkg = index.packageById.get(packageId);
    if (!pkg) return null;
    const packageLessonRows = index.lessonsByPackage.get(packageId) || [];
    const lessons = packageLessonRows
      .filter(r => lessonApplicableToEmployee_(employeeId, r, packageLessonRows))
      .map(r => lessonSummaryDtoIndexed_(r, index, progressByLesson));
    const completionRule = normalizeCompletionRule_(pkg['完成規則']);
    const summary = packageSummary_(lessons, completionRule);
    const forced = clean_(a['強制通過']) === '是';
    return {
      id: packageId,
      title: clean_(pkg['母課程名稱']),
      description: clean_(pkg['說明']),
      completionRule: completionRule,
      assignedAt: clean_(a['指派日期']),
      dueAt: clean_(a['截止日期']),
      status: forced ? 'complete' : summary.status,
      percent: forced ? 100 : summary.percent,
      requiredDone: summary.done,
      requiredTotal: summary.total,
      forcedComplete: forced,
      forcedAt: clean_(a['強制通過時間']),
      forcedBy: clean_(a['強制通過人']),
      forcedNote: clean_(a['強制通過備註']),
      lessons: lessons,
      _sort: number_(pkg['排序'])
    };
  }).filter(Boolean).sort((a,b) => number_(a._sort) - number_(b._sort)).map(pkg => {
    delete pkg._sort;
    return pkg;
  });
}

function studentDataBundle_(employeeId) {
  // Student home never needs the full employee master. Static course tables come from
  // ScriptCache/Warm-up, while progress is fetched only for this employee.
  return {
    assignments: rows_(APP.SHEETS.ASSIGNMENTS),
    packages: rows_(APP.SHEETS.PACKAGES),
    lessons: rows_(APP.SHEETS.LESSONS),
    contents: rows_(APP.SHEETS.CONTENT),
    progress: progressRowsForEmployee_(employeeId)
  };
}

function studentHome_(employeeId) {
  const key = studentHomeCacheKey_(employeeId);
  const cached = cacheJsonGet_(key);
  if (cached && Array.isArray(cached.packages)) return cached.packages;
  const packages = studentHomeFromData_(employeeId, studentDataBundle_(employeeId));
  cacheJsonPut_(key, { packages: packages }, STUDENT_HOME_CACHE_SECONDS_);
  return packages;
}

function studentHomeAction_(session) {
  const startedAt = Date.now();
  if (!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY', '只有學員帳號可以讀取自己的課程。');
  const before = cachedStudentHomeOnly_(session.employeeId);
  const packages = before || studentHome_(session.employeeId);
  return { user: session, packages: packages, split: true, timing: { totalMs: Date.now() - startedAt, cacheHit: !!before } };
}

function studentLessonAction_(session, payload) {
  if (!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY', '只有學員帳號可以讀取自己的教材。');
  const lessonRow = assignedLesson_(session.employeeId, payload.lessonId);
  const lessonId = clean_(lessonRow['子課程ID']);
  const contentRows = rows_(APP.SHEETS.CONTENT).filter(r => clean_(r['啟用']) === '是' && clean_(r['子課程ID']) === lessonId);
  const progressRows = progressRowsForEmployee_(session.employeeId).filter(r => clean_(r['子課程ID']) === lessonId);
  const dto = lessonDto_(lessonRow, contentRows, progressRows);
  dto.submissionMode = clean_(lessonRow['作業回傳模式']) || '不需要';
  dto.submissionNote = clean_(lessonRow['作業說明']);
  dto.applicabilityMode = normalizeApplicabilityMode_(lessonRow['適用對象模式']);
  dto.applicableIds = parseApplicableIds_(lessonRow['適用帳號']);
  dto.detailLoaded = true;
  return { packageId: clean_(lessonRow['母課程ID']), lesson: dto };
}

function submissionRowsSnapshot_() {
  const rt = runtime_();
  if (Array.isArray(rt.submissionSnapshotRows)) return rt.submissionSnapshotRows;
  const cached = cacheJsonGet_(submissionSnapshotCacheKey_());
  if (cached && Array.isArray(cached.rows)) { rt.submissionSnapshotRows = cached.rows; return cached.rows; }
  const rows = rows_(APP.SHEETS.SUBMISSIONS);
  rt.submissionSnapshotRows = rows;
  cacheJsonPut_(submissionSnapshotCacheKey_(), { rows: rows }, SUBMISSION_SNAPSHOT_CACHE_SECONDS_);
  return rows;
}

function latestSubmissionTrackingIndex_(sourceRows) {
  const latest = new Map();
  (sourceRows || []).forEach((row, order) => {
    const employeeId = clean_(row['工號']), lessonId = clean_(row['子課程ID']);
    if (!employeeId || !lessonId) return;
    const key = employeeId + '|' + lessonId;
    const version = number_(row['版本']);
    const current = latest.get(key);
    if (!current || version > current.version || (version === current.version && order > current.order)) latest.set(key, { row: row, version: version, order: order });
  });
  const out = new Map();
  latest.forEach((value, key) => out.set(key, value.row));
  return out;
}

function trackingSubmissionStatus_(employeeId, lesson, submissionIndex) {
  const mode = clean_(lesson && lesson.submissionMode) || '不需要';
  if (mode === '不需要') return '';
  const row = submissionIndex && submissionIndex.get(clean_(employeeId) + '|' + clean_(lesson.id));
  return row ? (clean_(row['狀態']) || '未送審') : '未上傳';
}

function annotateTrackingSubmissions_(employeeId, pkg, submissionIndex) {
  // Package-level warnings represent REQUIRED submissions only. Optional submissions
  // are still shown in lesson detail, but an unfilled optional task must never make the
  // course look incomplete or require follow-up.
  const summary = { total: 0, requiredTotal: 0, missing: 0, draft: 0, pending: 0, rejected: 0, passed: 0, optional: 0 };
  (pkg.lessons || []).forEach(lesson => {
    const mode = clean_(lesson.submissionMode) || '不需要';
    lesson.submissionMode = mode;
    lesson.submissionRequired = mode === '必繳審核';
    if (mode === '不需要') { lesson.submissionStatus = ''; return; }
    const status = trackingSubmissionStatus_(employeeId, lesson, submissionIndex);
    lesson.submissionStatus = status;
    if (!lesson.submissionRequired) { summary.optional += 1; return; }
    summary.total += 1;
    summary.requiredTotal += 1;
    if (status === '已通過') summary.passed += 1;
    else if (status === '待審核') summary.pending += 1;
    else if (status === '已退件') summary.rejected += 1;
    else if (status === '未送審') summary.draft += 1;
    else summary.missing += 1;
  });
  pkg.submissionSummary = summary;
  return pkg;
}

function adminTrackingData_(data) {
  data = data || trackingDataBundle_();
  const index = learningReadIndex_(data);
  const submissionIndex = latestSubmissionTrackingIndex_(data.submissions || []);
  return data.employees
    .filter(r => clean_(r['系統角色']) !== '教育中心' && clean_(r['帳號狀態']) === '啟用')
    .map(emp => {
      const employeeId = clean_(emp['工號']);
      const packages = studentHomeFromData_(employeeId, data, index).map(pkg => {
        annotateTrackingSubmissions_(employeeId, pkg, submissionIndex);
        return {
          id: pkg.id, title: pkg.title, description: pkg.description, completionRule: pkg.completionRule,
          assignedAt: pkg.assignedAt, dueAt: pkg.dueAt, status: pkg.status, percent: pkg.percent,
          requiredDone: pkg.requiredDone, requiredTotal: pkg.requiredTotal, forcedComplete: pkg.forcedComplete,
          forcedAt: pkg.forcedAt, forcedBy: pkg.forcedBy, forcedNote: pkg.forcedNote,
          submissionSummary: pkg.submissionSummary
        };
      });
      return { employeeId: employeeId, name: clean_(emp['姓名']), area: clean_(emp['區域']), store: clean_(emp['店別']), role: clean_(emp['系統角色']), packages: packages };
    });
}

function adminTracking_(session) {
  const startedAt = Date.now();
  const cached = cacheJsonGet_(adminTrackingCacheKey_());
  if (cached && Array.isArray(cached.overview)) return { user: session, overview: scopeTrackingOverview_(session, cached.overview), cached: true, split: true, timing: { totalMs: Date.now() - startedAt, cacheHit: true } };
  const overview = adminTrackingData_(trackingDataBundle_());
  cacheJsonPut_(adminTrackingCacheKey_(), { overview: overview }, ADMIN_TRACKING_CACHE_SECONDS_);
  return { user: session, overview: scopeTrackingOverview_(session, overview), cached: false, split: true, timing: { totalMs: Date.now() - startedAt, cacheHit: false } };
}

function adminTrackingDetailFastPackage_(employeeId, packageId) {
  const assignment = rows_(APP.SHEETS.ASSIGNMENTS).find(r => clean_(r['工號']) === employeeId && clean_(r['母課程ID']) === packageId && assignmentEnabled_(r));
  if (!assignment) throw apiError_('ASSIGNMENT_NOT_FOUND', '找不到該人員的課程指派。');
  const packageRow = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === packageId && clean_(r['啟用']) === '是' && packagePublished_(r));
  if (!packageRow) throw apiError_('PACKAGE_NOT_FOUND', '找不到課程。');

  const packageLessonRows = rows_(APP.SHEETS.LESSONS)
    .filter(r => clean_(r['母課程ID']) === packageId && clean_(r['啟用']) === '是');
  const progressByLesson = new Map();
  progressRowsForEmployee_(employeeId).forEach(r => {
    const lessonId = clean_(r['子課程ID']);
    if (lessonId) progressByLesson.set(lessonId, r);
  });

  const lessons = packageLessonRows
    .filter(r => lessonApplicableToEmployee_(employeeId, r, packageLessonRows))
    .sort((a,b) => number_(a['排序']) - number_(b['排序']))
    .map(r => {
      const lessonId = clean_(r['子課程ID']);
      const progress = progressByLesson.get(lessonId) || {};
      return {
        id: lessonId,
        packageId: packageId,
        title: clean_(r['子課程名稱']),
        required: clean_(r['必修']) === '是',
        status: clean_(progress['狀態']) || 'not_started',
        videoSeconds: number_(progress['影片秒數']),
        pdfSeconds: number_(progress['PDF秒數']),
        startedAt: clean_(progress['開始時間']),
        completedAt: clean_(progress['完成時間']),
        updatedAt: clean_(progress['更新時間']),
        submissionMode: clean_(r['作業回傳模式']) || '不需要',
        detailLoaded: false
      };
    });

  const completionRule = normalizeCompletionRule_(packageRow['完成規則']);
  const summary = packageSummary_(lessons, completionRule);
  const forced = clean_(assignment['強制通過']) === '是';
  const pkg = {
    id: packageId,
    title: clean_(packageRow['母課程名稱']),
    description: clean_(packageRow['說明']),
    completionRule: completionRule,
    assignedAt: clean_(assignment['指派日期']),
    dueAt: clean_(assignment['截止日期']),
    status: forced ? 'complete' : summary.status,
    percent: forced ? 100 : summary.percent,
    requiredDone: summary.done,
    requiredTotal: summary.total,
    forcedComplete: forced,
    forcedAt: clean_(assignment['強制通過時間']),
    forcedBy: clean_(assignment['強制通過人']),
    forcedNote: clean_(assignment['強制通過備註']),
    lessons: lessons
  };
  annotateTrackingSubmissions_(employeeId, pkg, latestSubmissionTrackingIndex_(submissionRowsSnapshot_()));
  return pkg;
}

function adminTrackingDetail_(session, payload) {
  const startedAt = Date.now();
  const employeeId = clean_(payload.employeeId), packageId = clean_(payload.packageId);
  if (!employeeId || !packageId) throw apiError_('TRACKING_DETAIL_REQUIRED', '缺少人員或課程資料。');
  const emp = rows_(APP.SHEETS.EMPLOYEES).find(r => clean_(r['工號']) === employeeId && clean_(r['帳號狀態']) === '啟用' && clean_(r['系統角色']) !== '教育中心');
  if (!emp) throw apiError_('EMPLOYEE_NOT_FOUND', '找不到人員。');
  if (session.roleKey === 'area_manager' && clean_(emp['區域']) !== trackingArea_(session)) throw apiError_('AREA_ACCESS_DENIED', '只能查看自己轄區的人員學習狀況。');

  const cacheKey = adminTrackingDetailCacheKey_(employeeId, packageId);
  const cached = cacheJsonGet_(cacheKey);
  if (cached && cached.package) return { employeeId: employeeId, package: cached.package, cached: true, timing: { totalMs: Date.now() - startedAt, cacheHit: true } };

  const pkg = adminTrackingDetailFastPackage_(employeeId, packageId);
  cacheJsonPut_(cacheKey, { package: pkg }, ADMIN_TRACKING_DETAIL_CACHE_SECONDS_);
  return { employeeId: employeeId, package: pkg, cached: false, timing: { totalMs: Date.now() - startedAt, cacheHit: false } };
}

function studentPackages_(employeeId) {
  const key = studentPackagesCacheKey_(employeeId);
  const cached = cacheJsonGet_(key);
  if (cached && Array.isArray(cached.packages)) return cached.packages;
  const data = studentDataBundle_(employeeId);
  const packages = studentPackagesFromData_(employeeId, data);
  cacheJsonPut_(key, { packages: packages }, STUDENT_PACKAGES_CACHE_SECONDS_);
  return packages;
}


function studentPackagesFromData_(employeeId, data) {
  employeeId = clean_(employeeId);
  const index = learningReadIndex_(data);
  const assignments = index.assignmentsByEmployee.get(employeeId) || [];
  const progressRows = index.progressByEmployee.get(employeeId) || [];
  const progressByLesson = new Map();
  progressRows.forEach(r => { const lessonId = clean_(r['子課程ID']); if (lessonId) progressByLesson.set(lessonId, r); });

  return assignments.map(a => {
    const packageId = clean_(a['母課程ID']);
    const pkg = index.packageById.get(packageId);
    if (!pkg) return null;
    const packageLessonRows = index.lessonsByPackage.get(packageId) || [];
    const lessons = packageLessonRows
      .filter(r => lessonApplicableToEmployee_(employeeId, r, packageLessonRows))
      .map(l => {
        const lessonId = clean_(l['子課程ID']);
        const progress = progressByLesson.get(lessonId);
        const dto = lessonDto_(l, index.contentsByLesson.get(lessonId) || [], progress ? [progress] : []);
        dto.submissionMode = clean_(l['作業回傳模式']) || '不需要';
        dto.submissionNote = clean_(l['作業說明']);
        dto.applicabilityMode = normalizeApplicabilityMode_(l['適用對象模式']);
        dto.applicableIds = parseApplicableIds_(l['適用帳號']);
        return dto;
      });
    const completionRule = normalizeCompletionRule_(pkg['完成規則']);
    const summary = packageSummary_(lessons, completionRule);
    const forced = clean_(a['強制通過']) === '是';
    return {
      id: packageId,
      title: clean_(pkg['母課程名稱']),
      description: clean_(pkg['說明']),
      completionRule: completionRule,
      assignedAt: clean_(a['指派日期']),
      dueAt: clean_(a['截止日期']),
      status: forced ? 'complete' : summary.status,
      percent: forced ? 100 : summary.percent,
      requiredDone: summary.done,
      requiredTotal: summary.total,
      forcedComplete: forced,
      forcedAt: clean_(a['強制通過時間']),
      forcedBy: clean_(a['強制通過人']),
      forcedNote: clean_(a['強制通過備註']),
      lessons: lessons,
      _sort: number_(pkg['排序'])
    };
  }).filter(Boolean).sort((a,b) => number_(a._sort) - number_(b._sort)).map(pkg => {
    delete pkg._sort;
    return pkg;
  });
}

function lessonDto_(lessonRow, contentRows, progressRows) {
  const lessonId = clean_(lessonRow['子課程ID']);
  const p = progressRows.find(r => clean_(r['子課程ID']) === lessonId) || {};
  const contents = contentRows.filter(r => clean_(r['子課程ID']) === lessonId)
    .sort((a, b) => number_(a['排序']) - number_(b['排序']))
    .map(r => ({ id: clean_(r['內容ID']), type: clean_(r['類型']), title: clean_(r['標題']), url: clean_(r['URL']), text: clean_(r['文字內容']), enabled: clean_(r['啟用']) !== '否' }));
  const progress = parseContentProgress_(p['教材進度JSON']);
  const dto = {
    id: lessonId, packageId: clean_(lessonRow['母課程ID']), title: clean_(lessonRow['子課程名稱']),
    required: clean_(lessonRow['必修']) === '是', passRule: clean_(lessonRow['通過規則']),
    videoPassPercent: nullableNumber_(lessonRow['影片最低完成率']), status: clean_(p['狀態']) || 'not_started',
    videoSeconds: number_(p['影片秒數']), pdfSeconds: number_(p['PDF秒數']),
    startedAt: clean_(p['開始時間']), completedAt: clean_(p['完成時間']), updatedAt: clean_(p['更新時間']),
    videoTotalSeconds: number_(p['影片總秒數']),
    applicabilityMode: normalizeApplicabilityMode_(lessonRow['適用對象模式']),
    applicableIds: parseApplicableIds_(lessonRow['適用帳號']),
    contentProgress: progress, contents: contents
  };
  dto.criteria = lessonCriteria_(dto);
  return dto;
}

function lessonCriteria_(lesson) {
  const videos = (lesson.contents || []).filter(c => clean_(c.type).toUpperCase() === 'VIDEO' && c.enabled !== false);
  const cp = lesson.contentProgress || {};
  const hasVideoRequirement = lesson.videoPassPercent !== null;
  let videoPassed = !hasVideoRequirement;
  let videoPercent = 0;
  if (hasVideoRequirement) {
    const hasAllVideoDetail = videos.length > 0 && videos.every(v => cp[v.id] && number_(cp[v.id].duration) > 0);
    if (hasAllVideoDetail) {
      const percents = videos.map(v => { const x = cp[v.id] || {}; return Math.min(100, Math.floor(number_(x.seconds) * 100 / number_(x.duration))); });
      videoPercent = percents.length ? Math.min.apply(null, percents) : 0;
      videoPassed = percents.every(x => x >= lesson.videoPassPercent);
    } else {
      videoPercent = lesson.videoTotalSeconds > 0 ? Math.min(100, Math.floor(lesson.videoSeconds * 100 / lesson.videoTotalSeconds)) : 0;
      videoPassed = lesson.videoTotalSeconds > 0 && videoPercent >= lesson.videoPassPercent;
    }
  }
  return { videoRequired: hasVideoRequirement, videoPercent: videoPercent, videoPassed: videoPassed, allPassed: videoPassed };
}

function normalizeApplicabilityMode_(value) {
  const mode = clean_(value);
  return ['全部適用','指定帳號','其餘未指定'].indexOf(mode) >= 0 ? mode : '全部適用';
}

function parseApplicableIds_(value) {
  let raw;
  if (Array.isArray(value)) raw = value;
  else {
    const text = clean_(value);
    if (!text) raw = [];
    else if (text.charAt(0) === '[') {
      try { const parsed = JSON.parse(text); raw = Array.isArray(parsed) ? parsed : []; }
      catch (e) { raw = text.split(/[\s,，;；]+/); }
    } else raw = text.split(/[\s,，;；]+/);
  }
  const out = [];
  raw.forEach(v => { const id = clean_(v); if (id && out.indexOf(id) < 0) out.push(id); });
  return out;
}
function serializeApplicableIds_(value) {
  const ids = parseApplicableIds_(value);
  return ids.length ? JSON.stringify(ids) : '';
}

function lessonApplicableToEmployee_(employeeId, lessonRow, siblingRows) {
  if (!lessonRow) return false;
  if (clean_(lessonRow['子課程名稱']) === '__PACKAGE_DIRECT__') return true;
  const mode = normalizeApplicabilityMode_(lessonRow['適用對象模式']);
  if (mode === '全部適用') return true;
  const own = parseApplicableIds_(lessonRow['適用帳號']);
  if (mode === '指定帳號') return own.indexOf(clean_(employeeId)) >= 0;
  const specified = [];
  (siblingRows || []).forEach(row => {
    if (clean_(row['啟用']) === '否' || clean_(row['子課程名稱']) === '__PACKAGE_DIRECT__') return;
    if (normalizeApplicabilityMode_(row['適用對象模式']) !== '指定帳號') return;
    parseApplicableIds_(row['適用帳號']).forEach(id => { if (specified.indexOf(id) < 0) specified.push(id); });
  });
  return specified.indexOf(clean_(employeeId)) < 0;
}

function normalizeCompletionRule_(value) {
  const rule = clean_(value);
  return rule === '任一必修子課程完成' ? rule : '所有必修子課程完成';
}

function packageSummary_(lessons, completionRule) {
  const required = lessons.filter(l => l.required);
  const completedCount = required.filter(l => l.status === 'complete').length;
  const rule = normalizeCompletionRule_(completionRule);
  const started = completedCount > 0 || lessons.some(l => l.status === 'in_progress');
  if (rule === '任一必修子課程完成') {
    const total = required.length ? 1 : 0;
    const done = completedCount > 0 ? 1 : 0;
    return { done: done, total: total, percent: done ? 100 : 0, status: done ? 'complete' : started ? 'in_progress' : 'not_started', completedCount: completedCount };
  }
  const total = required.length;
  const done = completedCount;
  const percent = total ? Math.round(done * 100 / total) : 0;
  const status = total > 0 && done === total ? 'complete' : started ? 'in_progress' : 'not_started';
  return { done: done, total: total, percent: percent, status: status, completedCount: completedCount };
}

function adminOverviewData_(data) {
  data = data || dataBundle_();
  const employees = data.employees.filter(r => clean_(r['系統角色']) !== '教育中心' && clean_(r['帳號狀態']) === '啟用');
  return employees.map(emp => {
    const employeeId = clean_(emp['工號']);
    return {
      employeeId: employeeId,
      name: clean_(emp['姓名']),
      area: clean_(emp['區域']),
      store: clean_(emp['店別']),
      role: clean_(emp['系統角色']),
      packages: studentPackagesFromData_(employeeId, data)
    };
  });
}


function catalogBundle_() {
  return {
    employees: rows_(APP.SHEETS.EMPLOYEES),
    assignments: rows_(APP.SHEETS.ASSIGNMENTS),
    packages: rows_(APP.SHEETS.PACKAGES),
    lessons: rows_(APP.SHEETS.LESSONS),
    contents: rows_(APP.SHEETS.CONTENT)
  };
}

function adminCatalogData_(data) {
  data = data || dataBundle_();
  const packageRows = data.packages.filter(r => clean_(r['母課程ID']));
  const lessonRows = data.lessons.filter(r => clean_(r['子課程ID']));
  const contentRows = data.contents.filter(r => clean_(r['內容ID']));
  const assignmentRows = data.assignments.filter(r => clean_(r['指派ID']));
  const learners = data.employees
    .filter(r => clean_(r['系統角色']) !== '教育中心' && clean_(r['帳號狀態']) === '啟用')
    .map(r => ({ employeeId: clean_(r['工號']), name: clean_(r['姓名']), role: clean_(r['系統角色']), area: clean_(r['區域']), store: clean_(r['店別']) }));
  const packages = packageRows.map(p => {
    const packageId = clean_(p['母課程ID']);
    const lessons = lessonRows.filter(l => clean_(l['母課程ID']) === packageId).sort((a,b) => number_(a['排序']) - number_(b['排序'])).map(l => {
      const lessonId = clean_(l['子課程ID']);
      return {
        id: lessonId,
        packageId: packageId,
        title: clean_(l['子課程名稱']),
        required: clean_(l['必修']) === '是',
        sort: number_(l['排序']),
        passRule: clean_(l['通過規則']),
        videoPassPercent: nullableNumber_(l['影片最低完成率']),
        submissionMode: clean_(l['作業回傳模式']) || '不需要',
        submissionNote: clean_(l['作業說明']),
        applicabilityMode: normalizeApplicabilityMode_(l['適用對象模式']),
        applicableIds: parseApplicableIds_(l['適用帳號']),
        enabled: clean_(l['啟用']) !== '否',
        contents: contentRows.filter(c => clean_(c['子課程ID']) === lessonId).sort((a,b) => number_(a['排序']) - number_(b['排序'])).map(c => ({
          id: clean_(c['內容ID']), lessonId: lessonId, type: clean_(c['類型']), title: clean_(c['標題']),
          url: clean_(c['URL']), text: clean_(c['文字內容']), sort: number_(c['排序']), enabled: clean_(c['啟用']) !== '否'
        }))
      };
    });
    return {
      id: packageId, title: clean_(p['母課程名稱']), description: clean_(p['說明']), enabled: clean_(p['啟用']) !== '否',
      publishState: clean_(p['發佈狀態']) || '草稿', sort: number_(p['排序']), completionRule: normalizeCompletionRule_(p['完成規則']), lessons: lessons
    };
  }).sort((a,b) => a.sort - b.sort);
  const assignments = assignmentRows.map(a => ({
    id: clean_(a['指派ID']), employeeId: clean_(a['工號']), packageId: clean_(a['母課程ID']),
    assignedAt: clean_(a['指派日期']), dueAt: clean_(a['截止日期']), enabled: assignmentEnabled_(a)
  }));
  return { packages: packages, learners: learners, assignments: assignments };
}


function catalogPackageDto_(packageId) {
  const id = clean_(packageId);
  if (!id) return null;
  const pkg = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === id);
  if (!pkg) return null;
  const lessonRows = rows_(APP.SHEETS.LESSONS).filter(r => clean_(r['母課程ID']) === id);
  const lessonIds = new Set(lessonRows.map(r => clean_(r['子課程ID'])).filter(Boolean));
  const contentRows = rows_(APP.SHEETS.CONTENT).filter(r => lessonIds.has(clean_(r['子課程ID'])));
  const mini = adminCatalogData_({ employees: [], assignments: [], packages: [pkg], lessons: lessonRows, contents: contentRows });
  return mini.packages[0] || null;
}

function catalogAssignmentsForPackage_(packageId) {
  const id = clean_(packageId);
  return rows_(APP.SHEETS.ASSIGNMENTS).filter(r => clean_(r['母課程ID']) === id).map(a => ({
    id: clean_(a['指派ID']), employeeId: clean_(a['工號']), packageId: id,
    assignedAt: clean_(a['指派日期']), dueAt: clean_(a['截止日期']), enabled: assignmentEnabled_(a)
  }));
}

function adminPackageResult_(session, packageId, message, extra) {
  invalidateAdminCatalog_();
  invalidateAdminOverview_();
  return Object.assign({
    user: session,
    fastWrite: true,
    packageId: clean_(packageId),
    package: catalogPackageDto_(packageId),
    message: clean_(message) || '已儲存'
  }, extra || {});
}

function adminAssignmentResult_(session, packageId, message, extra) {
  invalidateAdminCatalog_();
  invalidateAdminOverview_();
  return Object.assign({
    user: session,
    fastWrite: true,
    packageId: clean_(packageId),
    assignmentsForPackage: catalogAssignmentsForPackage_(packageId),
    message: clean_(message) || '指派已更新'
  }, extra || {});
}

function savePackage_(session, payload) {
  const title = clean_(payload.title); if (!title) throw apiError_('PACKAGE_TITLE_REQUIRED', '請輸入母課程名稱。');
  const id = clean_(payload.id) || makeId_('PKG');
  const existing = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === id);
  const publishState = clean_(payload.publishState) || (existing ? (clean_(existing['發佈狀態']) || '已發布') : '草稿');
  const completionRule = normalizeCompletionRule_(payload.completionRule || (existing && existing['完成規則']));
  upsertByKey_(APP.SHEETS.PACKAGES, '母課程ID', id, {'母課程ID':id,'母課程名稱':title,'說明':clean_(payload.description),'啟用':payload.enabled===false?'否':'是','排序':Math.max(1,Math.round(number_(payload.sort)||1)),'完成規則':completionRule,'發佈狀態':publishState});
  return adminPackageResult_(session, id, existing ? '課程已更新。' : '課程已建立。');
}

function saveLesson_(session, payload) {
  const packageId=clean_(payload.packageId), title=clean_(payload.title);
  if(!packageId || !rows_(APP.SHEETS.PACKAGES).some(r=>clean_(r['母課程ID'])===packageId)) throw apiError_('PACKAGE_NOT_FOUND','找不到母課程。');
  if(!title) throw apiError_('LESSON_TITLE_REQUIRED','請輸入子課程名稱。');
  const video=nullableNumber_(payload.videoPassPercent);
  if(video!==null && (video<1 || video>100)) throw apiError_('VIDEO_PERCENT_INVALID','影片完成比例需為 1～100。');
  const id=clean_(payload.id)||makeId_('L');
  const existingLesson=rows_(APP.SHEETS.LESSONS).find(r=>clean_(r['子課程ID'])===id)||{};
  const submissionMode=clean_(payload.submissionMode)||clean_(existingLesson['作業回傳模式'])||'不需要';
  const submissionNote=payload.submissionNote===undefined?clean_(existingLesson['作業說明']):clean_(payload.submissionNote);
  const applicabilityMode=normalizeApplicabilityMode_(payload.applicabilityMode===undefined?existingLesson['適用對象模式']:payload.applicabilityMode);
  const applicableIds=applicabilityMode==='指定帳號'?parseApplicableIds_(payload.applicableIds===undefined?existingLesson['適用帳號']:payload.applicableIds):[];
  upsertByKey_(APP.SHEETS.LESSONS,'子課程ID',id,{'子課程ID':id,'母課程ID':packageId,'子課程名稱':title,'必修':payload.required===false?'否':'是','排序':Math.max(1,Math.round(number_(payload.sort)||1)),'通過規則':video===null?'完成確認':'影片達 '+video+'%','影片最低完成率':video===null?'':video,'啟用':payload.enabled===false?'否':'是','作業回傳模式':submissionMode,'作業說明':submissionNote,'適用對象模式':applicabilityMode,'適用帳號':serializeApplicableIds_(applicableIds)});
  return adminPackageResult_(session, packageId, clean_(payload.id) ? '子課程已更新。' : '子課程已建立。', { createdLessonId: clean_(payload.id) ? '' : id });
}

function ensureDirectLesson_(packageId) {
  const pkg = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === packageId);
  if (!pkg) throw apiError_('PACKAGE_NOT_FOUND', '找不到課程。');
  const existing = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['母課程ID']) === packageId && clean_(r['子課程名稱']) === '__PACKAGE_DIRECT__');
  if (existing) return clean_(existing['子課程ID']);
  const id = makeId_('L');
  upsertByKey_(APP.SHEETS.LESSONS, '子課程ID', id, {
    '子課程ID': id, '母課程ID': packageId, '子課程名稱': '__PACKAGE_DIRECT__', '必修': '是', '排序': 0,
    '通過規則': '完成確認', '影片最低完成率': '', '啟用': '是',
    '作業回傳模式': '不需要', '作業說明': '', '適用對象模式': '全部適用', '適用帳號': ''
  });
  return id;
}

function contentUploadRoot_() {
  const props = PropertiesService.getScriptProperties();
  const propKey = 'learning-content-root-folder-id';
  const saved = clean_(props.getProperty(propKey));
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (e) {} }
  const root = DriveApp.getRootFolder();
  const name = '教育中心備援學習平台_教材檔案';
  const found = root.getFoldersByName(name);
  const folder = found.hasNext() ? found.next() : root.createFolder(name);
  props.setProperty(propKey, folder.getId());
  return folder;
}
function contentUploadFolder_(lessonId) {
  const lesson = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['子課程ID']) === clean_(lessonId));
  if (!lesson) throw apiError_('LESSON_NOT_FOUND','找不到子課程。');
  const packageId = clean_(lesson['母課程ID']);
  const pkg = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === packageId) || {};
  let folder = childFolder_(contentUploadRoot_(), clean_(pkg['母課程名稱']) || packageId);
  const lessonName = clean_(lesson['子課程名稱']) === '__PACKAGE_DIRECT__' ? '課程教材' : (clean_(lesson['子課程名稱']) || clean_(lesson['子課程ID']));
  return childFolder_(folder, lessonName);
}
function driveIdFromUrl_(url) {
  const raw = clean_(url); let m = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (!m) m = raw.match(/[?&]id=([^&#]+)/i);
  return m ? m[1] : '';
}
function maybeTrashManagedContentFile_(url) {
  const raw = clean_(url); if (!raw) return;
  // Quick-build reuse may let several course content rows point at the same managed
  // Drive file. Never trash that file while another row still references its URL.
  if (rows_(APP.SHEETS.CONTENT).some(r => clean_(r['URL']) === raw)) return;
  const id = driveIdFromUrl_(raw); if (!id) return;
  try { const file = DriveApp.getFileById(id); if (clean_(file.getDescription()).indexOf('RESERVE_COURSE_CONTENT|') === 0) file.setTrashed(true); } catch (e) {}
}
function saveContent_(session, payload) {
  let lessonId=clean_(payload.lessonId);
  if (!lessonId && clean_(payload.packageId)) lessonId = ensureDirectLesson_(clean_(payload.packageId));
  const type=clean_(payload.type).toUpperCase(), title=clean_(payload.title), text=clean_(payload.text);
  let url=clean_(payload.url);
  if(!rows_(APP.SHEETS.LESSONS).some(r=>clean_(r['子課程ID'])===lessonId)) throw apiError_('LESSON_NOT_FOUND','找不到子課程。');
  if(!['VIDEO','PDF','TEXT','FILE'].includes(type)) throw apiError_('CONTENT_TYPE_INVALID','教材類型不正確。');
  if(!title) throw apiError_('CONTENT_TITLE_REQUIRED','請輸入教材標題。');
  if(type==='VIDEO' && !isYouTubeUrl_(url)) throw apiError_('VIDEO_URL_INVALID','請使用有效的 YouTube 連結。');
  if(type==='TEXT' && !text) throw apiError_('CONTENT_TEXT_REQUIRED','請輸入文字教材內容。');

  const id=clean_(payload.id)||makeId_('C');
  const old = rows_(APP.SHEETS.CONTENT).find(r=>clean_(r['內容ID'])===id) || {};
  const b64=clean_(payload.fileBase64), fileName=clean_(payload.fileName);
  let newManagedUrl='';
  if (b64 || fileName) {
    if (!['PDF','FILE'].includes(type)) throw apiError_('CONTENT_FILE_TYPE_INVALID','只有 PDF 或下載檔可直接上傳。');
    if (!b64 || !fileName) throw apiError_('CONTENT_FILE_REQUIRED','上傳檔案資料不完整。');
    const config=publicUploadConfig_(), name=cleanFileName_(fileName), ext=(name.includes('.')?name.split('.').pop():'').toLowerCase();
    if(type==='PDF' && ext!=='pdf') throw apiError_('PDF_FILE_REQUIRED','PDF 教材請選擇 .pdf 檔案。');
    if(type==='FILE' && config.allowedExtensions.length && !config.allowedExtensions.includes(ext)) throw apiError_('FILE_TYPE_NOT_ALLOWED','不支援此檔案格式：'+ext);
    let bytes; try { bytes=Utilities.base64Decode(b64); } catch(e) { throw apiError_('FILE_DATA_INVALID','教材檔案內容格式錯誤。'); }
    if(bytes.length>config.maxMb*1024*1024) throw apiError_('FILE_TOO_LARGE','單一教材檔案不可超過 '+config.maxMb+' MB。');
    const mime=clean_(payload.mimeType)||'application/octet-stream';
    const folder=contentUploadFolder_(lessonId);
    const file=folder.createFile(Utilities.newBlob(bytes,mime,name));
    file.setDescription('RESERVE_COURSE_CONTENT|'+id);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
    url='https://drive.google.com/file/d/'+file.getId()+'/view';
    newManagedUrl=url;
  }

  if(['PDF','FILE'].includes(type) && !url) throw apiError_('CONTENT_URL_REQUIRED','請貼上教材連結或直接選擇檔案上傳。');
  if(type==='PDF' && !isHttpUrl_(url)) { if(newManagedUrl) maybeTrashManagedContentFile_(newManagedUrl); throw apiError_('PDF_URL_INVALID','PDF 網址格式不正確。'); }
  if(type==='FILE' && !isHttpUrl_(url)) { if(newManagedUrl) maybeTrashManagedContentFile_(newManagedUrl); throw apiError_('FILE_URL_INVALID','下載檔網址格式不正確。'); }
  try {
    upsertByKey_(APP.SHEETS.CONTENT,'內容ID',id,{'內容ID':id,'子課程ID':lessonId,'類型':type,'標題':title,'URL':url,'文字內容':text,'排序':Math.max(1,Math.round(number_(payload.sort)||1)),'啟用':payload.enabled===false?'否':'是'});
  } catch(e) { if(newManagedUrl) maybeTrashManagedContentFile_(newManagedUrl); throw e; }
  if(newManagedUrl && clean_(old['URL']) && clean_(old['URL'])!==newManagedUrl) maybeTrashManagedContentFile_(old['URL']);
  const lessonRow = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['子課程ID']) === lessonId) || {};
  return adminPackageResult_(session, clean_(lessonRow['母課程ID']), clean_(payload.id) ? '教材已更新。' : '教材已建立。', { contentId: id, lessonId: lessonId });
}


function cloneContentRow_(source, targetLessonId, sort) {
  const id = makeId_('C');
  upsertByKey_(APP.SHEETS.CONTENT, '內容ID', id, {
    '內容ID': id,
    '子課程ID': targetLessonId,
    '類型': clean_(source['類型']),
    '標題': clean_(source['標題']),
    'URL': clean_(source['URL']),
    '文字內容': clean_(source['文字內容']),
    '排序': Math.max(1, Math.round(number_(sort) || 1)),
    '啟用': clean_(source['啟用']) === '否' ? '否' : '是'
  });
  return id;
}

function contentReuseKey_(row) {
  const type = clean_(row['類型']).toUpperCase();
  const url = clean_(row['URL']).toLowerCase();
  if (url) return type + '|URL|' + url;
  return type + '|TEXT|' + clean_(row['標題']).toLowerCase() + '|' + clean_(row['文字內容']);
}

function reuseContents_(session, payload) {
  const ids = Array.from(new Set((Array.isArray(payload.contentIds) ? payload.contentIds : [payload.contentId]).map(clean_).filter(Boolean)));
  if (!ids.length) throw apiError_('CONTENT_REQUIRED', '請至少選擇一筆既有教材。');
  let targetLessonId = clean_(payload.targetLessonId);
  const targetPackageId = clean_(payload.targetPackageId);
  if (!targetLessonId && targetPackageId) targetLessonId = ensureDirectLesson_(targetPackageId);
  if (!targetLessonId) throw apiError_('TARGET_LESSON_REQUIRED', '請選擇要加入教材的課程。');

  const targetLesson = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['子課程ID']) === targetLessonId);
  if (!targetLesson) throw apiError_('LESSON_NOT_FOUND', '找不到目標課程。');
  if (clean_(targetLesson['啟用']) === '否') throw apiError_('TARGET_LESSON_DISABLED', '目標課程目前停用。');

  const contentRows = rows_(APP.SHEETS.CONTENT);
  const selected = ids.map(id => {
    const row = contentRows.find(r => clean_(r['內容ID']) === id && clean_(r['啟用']) !== '否');
    if (!row) throw apiError_('CONTENT_NOT_FOUND', '找不到可使用的教材：' + id);
    return row;
  });
  const targetRows = contentRows.filter(r => clean_(r['子課程ID']) === targetLessonId && clean_(r['啟用']) !== '否');
  const existingKeys = new Set(targetRows.map(contentReuseKey_));
  let nextSort = targetRows.reduce((max, r) => Math.max(max, number_(r['排序'])), 0);
  const createdIds = [], skippedIds = [];
  selected.forEach(source => {
    const key = contentReuseKey_(source);
    if (existingKeys.has(key)) { skippedIds.push(clean_(source['內容ID'])); return; }
    nextSort += 1;
    createdIds.push(cloneContentRow_(source, targetLessonId, nextSort));
    existingKeys.add(key);
  });
  return adminPackageResult_(session, clean_(targetLesson['母課程ID']), createdIds.length ? '已加入 ' + createdIds.length + ' 筆既有教材' + (skippedIds.length ? '；另有 ' + skippedIds.length + ' 筆重複教材已略過。' : '。') : '選取的教材已存在於目標課程，沒有重複加入。', { createdContentIds: createdIds, targetLessonId: targetLessonId });
}

function cloneLessonIntoPackage_(sourceLesson, targetPackageId, options, contentRows) {
  options = options || {};
  const title = clean_(options.title) || clean_(sourceLesson['子課程名稱']);
  if (!title || title === '__PACKAGE_DIRECT__') throw apiError_('LESSON_TITLE_REQUIRED', '請輸入有效的子課程名稱。');
  const id = makeId_('L');
  upsertByKey_(APP.SHEETS.LESSONS, '子課程ID', id, {
    '子課程ID': id,
    '母課程ID': targetPackageId,
    '子課程名稱': title,
    '必修': clean_(sourceLesson['必修']) === '否' ? '否' : '是',
    '排序': Math.max(1, Math.round(number_(options.sort) || number_(sourceLesson['排序']) || 1)),
    '通過規則': clean_(sourceLesson['通過規則']) || '完成確認',
    '影片最低完成率': sourceLesson['影片最低完成率'] === undefined ? '' : sourceLesson['影片最低完成率'],
    '啟用': clean_(sourceLesson['啟用']) === '否' ? '否' : '是',
    '作業回傳模式': clean_(sourceLesson['作業回傳模式']) || '不需要',
    '作業說明': clean_(sourceLesson['作業說明']),
    '適用對象模式': normalizeApplicabilityMode_(sourceLesson['適用對象模式']),
    '適用帳號': serializeApplicableIds_(sourceLesson['適用帳號'])
  });
  (contentRows || []).filter(r => clean_(r['子課程ID']) === clean_(sourceLesson['子課程ID'])).sort((a,b) => number_(a['排序']) - number_(b['排序'])).forEach((row, index) => cloneContentRow_(row, id, number_(row['排序']) || index + 1));
  return id;
}

function copyLesson_(session, payload) {
  const sourceLessonId = clean_(payload.sourceLessonId);
  const targetPackageId = clean_(payload.targetPackageId);
  if (!sourceLessonId || !targetPackageId) throw apiError_('COPY_LESSON_REQUIRED', '請選擇來源子課程與目標母課程。');
  const packages = rows_(APP.SHEETS.PACKAGES);
  if (!packages.some(r => clean_(r['母課程ID']) === targetPackageId)) throw apiError_('PACKAGE_NOT_FOUND', '找不到目標母課程。');
  const lessons = rows_(APP.SHEETS.LESSONS);
  const source = lessons.find(r => clean_(r['子課程ID']) === sourceLessonId);
  if (!source || clean_(source['子課程名稱']) === '__PACKAGE_DIRECT__') throw apiError_('LESSON_NOT_FOUND', '找不到可複製的子課程。');
  const title = clean_(payload.title) || (clean_(source['子課程名稱']) + ' 複本');
  const duplicate = lessons.some(r => clean_(r['母課程ID']) === targetPackageId && clean_(r['子課程名稱']).toLowerCase() === title.toLowerCase());
  if (duplicate) throw apiError_('LESSON_TITLE_DUPLICATE', '目標母課程已有同名子課程，請換一個名稱。');
  const siblings = lessons.filter(r => clean_(r['母課程ID']) === targetPackageId && clean_(r['子課程名稱']) !== '__PACKAGE_DIRECT__');
  const sort = Math.max(1, siblings.reduce((max, r) => Math.max(max, number_(r['排序'])), 0) + 1);
  const createdLessonId = cloneLessonIntoPackage_(source, targetPackageId, { title: title, sort: sort }, rows_(APP.SHEETS.CONTENT));
  return adminPackageResult_(session, targetPackageId, '子課程已複製；教材沿用原檔案，學習與作業紀錄沒有複製。', { createdLessonId: createdLessonId });
}

function copyPackage_(session, payload) {
  const sourcePackageId = clean_(payload.sourcePackageId);
  const title = clean_(payload.title);
  if (!sourcePackageId) throw apiError_('SOURCE_PACKAGE_REQUIRED', '請選擇要複製的母課程。');
  if (!title) throw apiError_('PACKAGE_TITLE_REQUIRED', '請輸入新課程名稱。');
  const packages = rows_(APP.SHEETS.PACKAGES);
  const sourcePackage = packages.find(r => clean_(r['母課程ID']) === sourcePackageId);
  if (!sourcePackage) throw apiError_('PACKAGE_NOT_FOUND', '找不到來源母課程。');
  if (packages.some(r => clean_(r['母課程名稱']).toLowerCase() === title.toLowerCase())) throw apiError_('PACKAGE_TITLE_DUPLICATE', '已有同名母課程，請換一個名稱。');

  const createdPackageId = makeId_('PKG');
  const nextSort = packages.reduce((max, r) => Math.max(max, number_(r['排序'])), 0) + 1;
  upsertByKey_(APP.SHEETS.PACKAGES, '母課程ID', createdPackageId, {
    '母課程ID': createdPackageId,
    '母課程名稱': title,
    '說明': payload.description === undefined ? clean_(sourcePackage['說明']) : clean_(payload.description),
    '啟用': '是',
    '排序': nextSort,
    '完成規則': normalizeCompletionRule_(sourcePackage['完成規則']),
    '發佈狀態': '草稿'
  });

  const sourceLessons = rows_(APP.SHEETS.LESSONS).filter(r => clean_(r['母課程ID']) === sourcePackageId).sort((a,b) => number_(a['排序']) - number_(b['排序']));
  const sourceContents = rows_(APP.SHEETS.CONTENT);
  const createdLessonIds = [];
  sourceLessons.forEach(sourceLesson => {
    const direct = clean_(sourceLesson['子課程名稱']) === '__PACKAGE_DIRECT__';
    if (direct) {
      const hasContent = sourceContents.some(r => clean_(r['子課程ID']) === clean_(sourceLesson['子課程ID']) && clean_(r['啟用']) !== '否');
      const hasSubmission = (clean_(sourceLesson['作業回傳模式']) || '不需要') !== '不需要';
      if (!hasContent && !hasSubmission) return;
      const newDirectId = makeId_('L');
      upsertByKey_(APP.SHEETS.LESSONS, '子課程ID', newDirectId, {
        '子課程ID': newDirectId, '母課程ID': createdPackageId, '子課程名稱': '__PACKAGE_DIRECT__', '必修': '是', '排序': 0,
        '通過規則': clean_(sourceLesson['通過規則']) || '完成確認', '影片最低完成率': sourceLesson['影片最低完成率'] || '', '啟用': '是',
        '作業回傳模式': clean_(sourceLesson['作業回傳模式']) || '不需要', '作業說明': clean_(sourceLesson['作業說明']), '適用對象模式': '全部適用', '適用帳號': ''
      });
      sourceContents.filter(r => clean_(r['子課程ID']) === clean_(sourceLesson['子課程ID'])).sort((a,b) => number_(a['排序']) - number_(b['排序'])).forEach((row,index) => cloneContentRow_(row, newDirectId, number_(row['排序']) || index + 1));
      createdLessonIds.push(newDirectId);
      return;
    }
    createdLessonIds.push(cloneLessonIntoPackage_(sourceLesson, createdPackageId, { title: clean_(sourceLesson['子課程名稱']), sort: number_(sourceLesson['排序']) || 1 }, sourceContents));
  });
  return adminPackageResult_(session, createdPackageId, '整門課程已複製為草稿；教材沿用原檔案，沒有複製指派、學習進度、作業附件或審核結果。', { createdPackageId: createdPackageId, createdLessonIds: createdLessonIds });
}

function saveAssignment_(session, payload) {
  const employeeId = clean_(payload.employeeId);
  const packageId = clean_(payload.packageId);
  const employees = rows_(APP.SHEETS.EMPLOYEES);
  if (!employees.some(r => clean_(r['工號']) === employeeId && clean_(r['系統角色']) !== '教育中心' && clean_(r['帳號狀態']) === '啟用')) throw apiError_('LEARNER_NOT_FOUND', '找不到可指派的學員。');
  if (!rows_(APP.SHEETS.PACKAGES).some(r => clean_(r['母課程ID']) === packageId)) throw apiError_('PACKAGE_NOT_FOUND', '找不到母課程。');
  const existing = rows_(APP.SHEETS.ASSIGNMENTS).find(r => clean_(r['工號']) === employeeId && clean_(r['母課程ID']) === packageId);
  const id = clean_(payload.id) || (existing ? clean_(existing['指派ID']) : makeId_('A'));
  upsertByKey_(APP.SHEETS.ASSIGNMENTS, '指派ID', id, {
    '指派ID': id,
    '工號': employeeId,
    '母課程ID': packageId,
    '指派日期': existing ? (clean_(existing['指派日期']) || today_()) : today_(),
    '截止日期': clean_(payload.dueAt),
    '指派狀態': payload.enabled === false ? '停用' : '啟用'
  });
  return adminAssignmentResult_(session, packageId, payload.enabled === false ? '已取消指派。' : '指派已更新。');
}

function saveAssignmentsBatch_(session, payload) {
  const ids = Array.isArray(payload.employeeIds) ? Array.from(new Set(payload.employeeIds.map(clean_).filter(Boolean))) : [];
  const packageId = clean_(payload.packageId);
  if (!packageId) throw apiError_('PACKAGE_REQUIRED', '缺少課程。');
  const validLearners = new Set(rows_(APP.SHEETS.EMPLOYEES).filter(r => clean_(r['系統角色']) !== '教育中心' && clean_(r['帳號狀態']) === '啟用').map(r => clean_(r['工號'])));
  if (!rows_(APP.SHEETS.PACKAGES).some(r => clean_(r['母課程ID']) === packageId)) throw apiError_('PACKAGE_NOT_FOUND', '找不到課程。');

  const table = table_(APP.SHEETS.ASSIGNMENTS);
  const byPair = new Map(table.rows.map(r => [clean_(r['工號']) + '|' + clean_(r['母課程ID']), r]));
  const targets = new Set(ids.filter(id => validLearners.has(id)));
  const dueAt = clean_(payload.dueAt);

  // 批次指派採「同步」語意：勾選者啟用，原本已指派但取消勾選者停用。
  table.rows.forEach(row => {
    if (clean_(row['母課程ID']) !== packageId) return;
    const employeeId = clean_(row['工號']);
    if (!targets.has(employeeId)) row['指派狀態'] = '停用';
  });
  targets.forEach(employeeId => {
    const key = employeeId + '|' + packageId;
    const old = byPair.get(key);
    if (old) {
      old['截止日期'] = dueAt;
      old['指派狀態'] = '啟用';
      if (!clean_(old['指派日期'])) old['指派日期'] = today_();
    } else {
      const row = { _row: 0, '指派ID': makeId_('A'), '工號': employeeId, '母課程ID': packageId, '指派日期': today_(), '截止日期': dueAt, '指派狀態': '啟用' };
      table.rows.push(row);
      byPair.set(key, row);
    }
  });

  const matrix = table.rows.map(r => table.headers.map(h => r[h] === undefined ? '' : r[h]));
  const sheet = sheet_(APP.SHEETS.ASSIGNMENTS);
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    if (matrix.length) sheet.getRange(2, 1, matrix.length, table.headers.length).setValues(matrix);
    const last = sheet.getLastRow();
    if (last > matrix.length + 1) sheet.getRange(matrix.length + 2, 1, last - matrix.length - 1, table.headers.length).clearContent();
  } finally { lock.releaseLock(); }
  invalidateTable_(APP.SHEETS.ASSIGNMENTS);
  return adminAssignmentResult_(session, packageId, '批次指派已更新。');
}


function validatePackage_(packageId) {
  const id = clean_(packageId);
  const pkg = rows_(APP.SHEETS.PACKAGES).find(r => clean_(r['母課程ID']) === id);
  if (!pkg) return ['找不到課程'];
  const allLessons = rows_(APP.SHEETS.LESSONS).filter(r => clean_(r['母課程ID']) === id && clean_(r['啟用']) !== '否');
  const allContents = rows_(APP.SHEETS.CONTENT).filter(r => clean_(r['啟用']) !== '否');
  const direct = allLessons.find(r => clean_(r['子課程名稱']) === '__PACKAGE_DIRECT__');
  const directContents = direct ? allContents.filter(c => clean_(c['子課程ID']) === clean_(direct['子課程ID'])) : [];
  const directSubmission = direct && (clean_(direct['作業回傳模式']) || '不需要') !== '不需要';
  const lessons = allLessons.filter(r => clean_(r['子課程名稱']) !== '__PACKAGE_DIRECT__');
  const errors = [];
  if (!directContents.length && !directSubmission && !lessons.length) errors.push('至少建立課程教材、課程回傳或一個子課程');
  const fallbackLessons = lessons.filter(l => normalizeApplicabilityMode_(l['適用對象模式']) === '其餘未指定');
  if (fallbackLessons.length > 1) errors.push('分流設定：同一課程只能有一個「其餘未指定」子課程');
  const validEmployeeIds = new Set(rows_(APP.SHEETS.EMPLOYEES).map(r => clean_(r['工號'])).filter(Boolean));
  const ownerByEmployee = {};
  lessons.filter(l => normalizeApplicabilityMode_(l['適用對象模式']) === '指定帳號').forEach(lesson => {
    const ids = parseApplicableIds_(lesson['適用帳號']);
    if (!ids.length) errors.push(clean_(lesson['子課程名稱']) + '：指定帳號尚未選擇對象');
    ids.forEach(employeeId => {
      if (!validEmployeeIds.has(employeeId)) errors.push(clean_(lesson['子課程名稱']) + '：找不到帳號 ' + employeeId);
      if (ownerByEmployee[employeeId] && ownerByEmployee[employeeId] !== clean_(lesson['子課程ID'])) errors.push('分流設定：帳號 ' + employeeId + ' 被重複指定到多個子課程');
      ownerByEmployee[employeeId] = clean_(lesson['子課程ID']);
    });
  });
  lessons.forEach(lesson => {
    const lessonId = clean_(lesson['子課程ID']);
    const contents = allContents.filter(c => clean_(c['子課程ID']) === lessonId);
    if (!contents.length) errors.push(clean_(lesson['子課程名稱']) + '：尚未建立教材');
    const passPercent = nullableNumber_(lesson['影片最低完成率']);
    if (passPercent !== null) {
      const validVideo = contents.some(c => clean_(c['類型']).toUpperCase() === 'VIDEO' && isYouTubeUrl_(clean_(c['URL'])));
      if (!validVideo) errors.push(clean_(lesson['子課程名稱']) + '：有影片門檻但沒有有效 YouTube');
    }
  });
  return errors;
}

function setPackageState_(session,payload) {
  const id=clean_(payload.id), state=clean_(payload.publishState);
  if(!['草稿','已發布','封存'].includes(state)) throw apiError_('PUBLISH_STATE_INVALID','發佈狀態不正確。');
  const row=rows_(APP.SHEETS.PACKAGES).find(r=>clean_(r['母課程ID'])===id); if(!row) throw apiError_('PACKAGE_NOT_FOUND','找不到母課程。');
  if(state==='已發布'){const errors=validatePackage_(id);if(errors.length)throw apiError_('PACKAGE_INCOMPLETE','無法發布：'+errors.slice(0,4).join('；'));}
  upsertByKey_(APP.SHEETS.PACKAGES,'母課程ID',id,{'發佈狀態':state,'啟用':state==='封存'?'否':(clean_(row['啟用'])||'是')});
  return adminPackageResult_(session, id, '已改為'+state);
}

function deletePackage_(session,payload) {
  const id=clean_(payload.id), pkg=rows_(APP.SHEETS.PACKAGES).find(r=>clean_(r['母課程ID'])===id); if(!pkg)throw apiError_('PACKAGE_NOT_FOUND','找不到母課程。');
  const hasAssignment=rows_(APP.SHEETS.ASSIGNMENTS).some(r=>clean_(r['母課程ID'])===id), hasProgress=rows_(APP.SHEETS.PROGRESS).some(r=>clean_(r['母課程ID'])===id);
  if(hasAssignment||hasProgress){upsertByKey_(APP.SHEETS.PACKAGES,'母課程ID',id,{'啟用':'否','發佈狀態':'封存'});return adminPackageResult_(session,id,'已有歷史紀錄，系統已安全封存，沒有刪除紀錄。');}
  const lessonIds=rows_(APP.SHEETS.LESSONS).filter(r=>clean_(r['母課程ID'])===id).map(r=>clean_(r['子課程ID']));
  deleteRowsByPredicate_(APP.SHEETS.CONTENT,r=>lessonIds.includes(clean_(r['子課程ID'])));
  deleteRowsByPredicate_(APP.SHEETS.LESSONS,r=>clean_(r['母課程ID'])===id);
  deleteRowsByPredicate_(APP.SHEETS.PACKAGES,r=>clean_(r['母課程ID'])===id);
  invalidateAdminCatalog_(); invalidateAdminOverview_();
  return { user: session, fastWrite: true, removedPackageId: id, message: '未有任何學習紀錄，已永久刪除。' };
}

function deleteLesson_(session,payload) {
  const id=clean_(payload.id);
  const lesson=rows_(APP.SHEETS.LESSONS).find(r=>clean_(r['子課程ID'])===id);
  if(!lesson) throw apiError_('LESSON_NOT_FOUND','找不到子課程。');
  if(clean_(lesson['子課程名稱'])==='__PACKAGE_DIRECT__') throw apiError_('DIRECT_LESSON_PROTECTED','母課程教材層為系統使用，請刪除教材內容，不要刪除此層。');
  const hasProgress=rows_(APP.SHEETS.PROGRESS).some(r=>clean_(r['子課程ID'])===id);
  const hasSubmission=!hasProgress&&rows_(APP.SHEETS.SUBMISSIONS).some(r=>clean_(r['子課程ID'])===id);
  const packageId = clean_(lesson['母課程ID']);
  if(hasProgress||hasSubmission){
    upsertByKey_(APP.SHEETS.LESSONS,'子課程ID',id,{'啟用':'否'});
    return adminPackageResult_(session,packageId,'已有學習或作業回傳紀錄，已安全停用子課程並保留歷史紀錄。');
  }
  deleteRowsByPredicate_(APP.SHEETS.CONTENT,r=>clean_(r['子課程ID'])===id);
  deleteRowsByPredicate_(APP.SHEETS.LESSONS,r=>clean_(r['子課程ID'])===id);
  return adminPackageResult_(session,packageId,'未有學習紀錄，子課程與其教材已永久刪除。');
}

function deleteContent_(session,payload) {
  const id=clean_(payload.id);
  const content=rows_(APP.SHEETS.CONTENT).find(r=>clean_(r['內容ID'])===id);
  if(!content) throw apiError_('CONTENT_NOT_FOUND','找不到教材。');
  const lessonId=clean_(content['子課程ID']), type=clean_(content['類型']).toUpperCase();
  const lessonRow=rows_(APP.SHEETS.LESSONS).find(r=>clean_(r['子課程ID'])===lessonId)||{};
  const packageId=clean_(lessonRow['母課程ID']);
  const hasHistory=rows_(APP.SHEETS.PROGRESS).some(r=>{
    if(clean_(r['子課程ID'])!==lessonId) return false;
    const cp=parseContentProgress_(r['教材進度JSON']);
    if(cp && Object.prototype.hasOwnProperty.call(cp,id)) return true;
    if(type==='VIDEO' && number_(r['影片秒數'])>0) return true;
    if(type==='PDF' && number_(r['PDF秒數'])>0) return true;
    return false;
  });
  if(hasHistory){
    upsertByKey_(APP.SHEETS.CONTENT,'內容ID',id,{'啟用':'否'});
    return adminPackageResult_(session,packageId,'已有觀看或閱讀紀錄，教材已安全停用並保留歷史紀錄。');
  }
  deleteRowsByPredicate_(APP.SHEETS.CONTENT,r=>clean_(r['內容ID'])===id);
  return adminPackageResult_(session,packageId,'未有觀看或閱讀紀錄，教材已永久刪除。');
}

function moveLesson_(session,payload) {
  const id=clean_(payload.id), direction=number_(payload.direction)<0?-1:1;
  const all=rows_(APP.SHEETS.LESSONS), lesson=all.find(r=>clean_(r['子課程ID'])===id);
  if(!lesson) throw apiError_('LESSON_NOT_FOUND','找不到子課程。');
  if(clean_(lesson['子課程名稱'])==='__PACKAGE_DIRECT__') throw apiError_('DIRECT_LESSON_PROTECTED','課程教材層不參與子課程排序。');
  const packageId=clean_(lesson['母課程ID']);
  const siblings=all.filter(r=>clean_(r['母課程ID'])===packageId&&clean_(r['子課程名稱'])!=='__PACKAGE_DIRECT__').sort((a,b)=>number_(a['排序'])-number_(b['排序']));
  const index=siblings.findIndex(r=>clean_(r['子課程ID'])===id), target=index+direction;
  if(index<0||target<0||target>=siblings.length){return adminPackageResult_(session,packageId,'已在最前或最後。');}
  const a=siblings[index], b=siblings[target];
  let sortA=number_(a['排序']), sortB=number_(b['排序']);
  if(sortA===sortB){sortA=index+1;sortB=target+1;}
  upsertByKey_(APP.SHEETS.LESSONS,'子課程ID',clean_(a['子課程ID']),{'排序':sortB});
  upsertByKey_(APP.SHEETS.LESSONS,'子課程ID',clean_(b['子課程ID']),{'排序':sortA});
  return adminPackageResult_(session,packageId,direction<0?'子課程已上移。':'子課程已下移。');
}

function moveContent_(session,payload) {
  const id=clean_(payload.id), direction=number_(payload.direction)<0?-1:1;
  const all=rows_(APP.SHEETS.CONTENT), content=all.find(r=>clean_(r['內容ID'])===id);
  if(!content) throw apiError_('CONTENT_NOT_FOUND','找不到教材。');
  const lessonId=clean_(content['子課程ID']);
  const lessonRow=rows_(APP.SHEETS.LESSONS).find(r=>clean_(r['子課程ID'])===lessonId)||{};
  const packageId=clean_(lessonRow['母課程ID']);
  const siblings=all.filter(r=>clean_(r['子課程ID'])===lessonId).sort((a,b)=>number_(a['排序'])-number_(b['排序']));
  const index=siblings.findIndex(r=>clean_(r['內容ID'])===id), target=index+direction;
  if(index<0||target<0||target>=siblings.length){return adminPackageResult_(session,packageId,'已在最前或最後。');}
  const a=siblings[index], b=siblings[target];
  let sortA=number_(a['排序']), sortB=number_(b['排序']);
  if(sortA===sortB){sortA=index+1;sortB=target+1;}
  upsertByKey_(APP.SHEETS.CONTENT,'內容ID',clean_(a['內容ID']),{'排序':sortB});
  upsertByKey_(APP.SHEETS.CONTENT,'內容ID',clean_(b['內容ID']),{'排序':sortA});
  return adminPackageResult_(session,packageId,direction<0?'教材已上移。':'教材已下移。');
}

function contentProgressSubset_(progress, ids) {
  const source = parseContentProgress_(progress);
  const out = {};
  const wanted = ids instanceof Set ? ids : new Set(ids || []);
  wanted.forEach(id => { if (source[id]) out[id] = JSON.parse(JSON.stringify(source[id])); });
  return out;
}

function contentProgressWithout_(progress, ids) {
  const out = JSON.parse(JSON.stringify(parseContentProgress_(progress)));
  const removing = ids instanceof Set ? ids : new Set(ids || []);
  removing.forEach(id => { delete out[id]; });
  return out;
}

function moveContentsToLesson_(session, payload) {
  const ids = Array.from(new Set((Array.isArray(payload.contentIds) ? payload.contentIds : [payload.contentId]).map(clean_).filter(Boolean)));
  const targetLessonId = clean_(payload.targetLessonId);
  const requestedSourceLessonId = clean_(payload.sourceLessonId);
  if (!ids.length) throw apiError_('CONTENT_REQUIRED', '請至少選擇一筆教材。');
  if (!targetLessonId) throw apiError_('TARGET_LESSON_REQUIRED', '請選擇目標子課程。');

  const lessons = rows_(APP.SHEETS.LESSONS);
  const targetLesson = lessons.find(r => clean_(r['子課程ID']) === targetLessonId);
  if (!targetLesson) throw apiError_('LESSON_NOT_FOUND', '找不到目標子課程。');
  if (clean_(targetLesson['子課程名稱']) === '__PACKAGE_DIRECT__') throw apiError_('TARGET_LESSON_INVALID', '目標必須是一般子課程。');
  if (clean_(targetLesson['啟用']) === '否') throw apiError_('TARGET_LESSON_DISABLED', '目標子課程目前停用，請先啟用。');

  const contentRows = rows_(APP.SHEETS.CONTENT);
  const selected = ids.map(id => {
    const row = contentRows.find(r => clean_(r['內容ID']) === id);
    if (!row) throw apiError_('CONTENT_NOT_FOUND', '找不到教材：' + id);
    return row;
  });
  const currentLessonIds = Array.from(new Set(selected.map(r => clean_(r['子課程ID']))));
  // sourceLessonId is sent by the frontend so a partially completed batch can be retried.
  // On retry, some content rows may already point at targetLessonId; that is accepted and
  // processed idempotently instead of turning the batch into an unrecoverable mixed-source state.
  const inferredSourceIds = currentLessonIds.filter(id => id !== targetLessonId);
  const sourceLessonId = requestedSourceLessonId || (inferredSourceIds.length === 1 ? inferredSourceIds[0] : '');
  if (!sourceLessonId) throw apiError_('CONTENT_SOURCE_REQUIRED', '無法確認教材原始課程，請重新整理後再試。');
  if (sourceLessonId === targetLessonId) throw apiError_('TARGET_SAME_AS_SOURCE', '來源與目標子課程不可相同。');
  if (currentLessonIds.some(id => id !== sourceLessonId && id !== targetLessonId)) throw apiError_('CONTENT_SOURCE_MIXED', '批次教材包含其他課程資料，請重新整理後再試。');
  const sourceLesson = lessons.find(r => clean_(r['子課程ID']) === sourceLessonId);
  if (!sourceLesson) throw apiError_('LESSON_NOT_FOUND', '找不到來源課程。');
  if (clean_(sourceLesson['子課程名稱']) !== '__PACKAGE_DIRECT__') throw apiError_('SOURCE_NOT_DIRECT', '目前只支援將母課程教材移至子課程。');
  const packageId = clean_(sourceLesson['母課程ID']);
  if (clean_(targetLesson['母課程ID']) !== packageId) throw apiError_('TARGET_PACKAGE_MISMATCH', '教材只能移到同一個母課程底下的子課程。');

  const movedSet = new Set(ids);
  const progressRows = rows_(APP.SHEETS.PROGRESS).filter(r => clean_(r['子課程ID']) === sourceLessonId);
  const packageLessons = lessons.filter(r => clean_(r['母課程ID']) === packageId && clean_(r['啟用']) === '是');
  const migratedEmployeeIds = new Set();
  let migratedLearners = 0;
  let migratedProgressItems = 0;

  // 先把每位學員「這些教材」的進度合併到目標子課程。這一步只複製對應
  // contentId 的進度，不搬整堂課的完成狀態、作業附件或審核結果。
  // 若目標子課程不適用該學員，舊進度留在來源作歷史，不做破壞性清除。
  progressRows.forEach(sourceProgress => {
    const employeeId = clean_(sourceProgress['工號']);
    if (!lessonApplicableToEmployee_(employeeId, targetLesson, packageLessons)) return;
    const movedProgress = contentProgressSubset_(sourceProgress['教材進度JSON'], movedSet);
    const movedIds = Object.keys(movedProgress);
    if (!movedIds.length) return;
    const targetExisting = findProgress_(employeeId, targetLessonId) || {};
    const mergedTarget = mergeContentProgress_(parseContentProgress_(targetExisting['教材進度JSON']), movedProgress);
    const sums = summarizeContentProgress_(mergedTarget);
    const targetComplete = clean_(targetExisting['狀態']) === 'complete';
    upsertProgress_(employeeId, packageId, targetLessonId, {
      status: targetComplete ? 'complete' : 'in_progress',
      videoSeconds: sums.videoSeconds,
      pdfSeconds: sums.pdfSeconds,
      startedAt: clean_(targetExisting['開始時間']) || clean_(sourceProgress['開始時間']) || now_(),
      completedAt: targetComplete ? clean_(targetExisting['完成時間']) : '',
      videoTotalSeconds: sums.videoTotalSeconds,
      contentProgress: mergedTarget,
      completionMethod: clean_(targetExisting['完成方式']),
      completionNote: clean_(targetExisting['完成備註'])
    });
    migratedEmployeeIds.add(employeeId);
    migratedLearners += 1;
    migratedProgressItems += movedIds.length;
  });

  // 教材本體不複製、不重新上傳；保留內容ID與URL，只改歸屬子課程並排在目標末端。
  const targetExistingContents = contentRows.filter(r => clean_(r['子課程ID']) === targetLessonId && !movedSet.has(clean_(r['內容ID'])));
  let nextSort = targetExistingContents.reduce((max, r) => Math.max(max, number_(r['排序'])), 0);
  selected.slice().sort((a,b) => number_(a['排序']) - number_(b['排序'])).forEach(row => {
    nextSort += 1;
    upsertByKey_(APP.SHEETS.CONTENT, '內容ID', clean_(row['內容ID']), {
      '內容ID': clean_(row['內容ID']),
      '子課程ID': targetLessonId,
      '類型': clean_(row['類型']),
      '標題': clean_(row['標題']),
      'URL': clean_(row['URL']),
      '文字內容': clean_(row['文字內容']),
      '排序': nextSort,
      '啟用': clean_(row['啟用']) || '是'
    });
  });

  // 教材已離開來源課程後，再移除來源 progress JSON 裡相同 contentId，避免同一份
  // 觀看/閱讀秒數同時被兩堂課計算。來源整堂課的 complete/完成時間保留作歷史紀錄。
  progressRows.forEach(sourceProgress => {
    const employeeId = clean_(sourceProgress['工號']);
    if (!migratedEmployeeIds.has(employeeId)) return;
    const before = parseContentProgress_(sourceProgress['教材進度JSON']);
    if (!ids.some(id => before[id])) return;
    const remaining = contentProgressWithout_(before, movedSet);
    const sums = summarizeContentProgress_(remaining);
    upsertProgress_(employeeId, packageId, sourceLessonId, {
      status: clean_(sourceProgress['狀態']) || 'in_progress',
      videoSeconds: sums.videoSeconds,
      pdfSeconds: sums.pdfSeconds,
      startedAt: clean_(sourceProgress['開始時間']),
      completedAt: clean_(sourceProgress['完成時間']),
      videoTotalSeconds: sums.videoTotalSeconds,
      contentProgress: remaining,
      completionMethod: clean_(sourceProgress['完成方式']),
      completionNote: clean_(sourceProgress['完成備註'])
    });
  });

  return adminPackageResult_(session, packageId, '已移動 ' + ids.length + ' 筆教材至「' + clean_(targetLesson['子課程名稱']) + '」；教材觀看/閱讀進度已同步搬移，作業與審核紀錄維持原課程。', { moved: { contentCount: ids.length, migratedLearners: migratedLearners, migratedProgressItems: migratedProgressItems, sourceLessonId: sourceLessonId, targetLessonId: targetLessonId } });
}

function exportProgress_(session) {
  const employees=rows_(APP.SHEETS.EMPLOYEES), packages=rows_(APP.SHEETS.PACKAGES), lessons=rows_(APP.SHEETS.LESSONS), progress=progressSnapshot_().rows, submissions=rows_(APP.SHEETS.SUBMISSIONS), contents=rows_(APP.SHEETS.CONTENT).filter(r=>clean_(r['啟用'])==='是');
  return rows_(APP.SHEETS.ASSIGNMENTS).filter(assignmentEnabled_).map(a=>{
    const employeeId=clean_(a['工號']), packageId=clean_(a['母課程ID']);
    const emp=employees.find(x=>clean_(x['工號'])===employeeId)||{}, pkg=packages.find(x=>clean_(x['母課程ID'])===packageId)||{};
    const required=lessons.filter(l=>{
      if(clean_(l['母課程ID'])!==packageId||clean_(l['啟用'])!=='是'||clean_(l['必修'])!=='是') return false;
      if(clean_(l['子課程名稱'])!=='__PACKAGE_DIRECT__') return true;
      const lessonId=clean_(l['子課程ID']);
      const hasContent=contents.some(c=>clean_(c['子課程ID'])===lessonId);
      const hasSubmission=(clean_(l['作業回傳模式'])||'不需要')!=='不需要';
      return hasContent||hasSubmission;
    });
    const progressRows=required.map(l=>progress.find(r=>clean_(r['工號'])===employeeId&&clean_(r['子課程ID'])===clean_(l['子課程ID']))||{});
    const latestSubmissions=required.map(l=>submissionForLesson_(employeeId,clean_(l['子課程ID']),submissions));
    const completedRows=progressRows.filter(r=>clean_(r['狀態'])==='complete');
    const rule=normalizeCompletionRule_(pkg['完成規則']);
    const forced=clean_(a['強制通過'])==='是';
    const completed=forced || (rule==='任一必修子課程完成' ? completedRows.length>0 : required.length>0&&completedRows.length===required.length);
    const started=completedRows.length>0||progressRows.some(r=>clean_(r['狀態'])==='in_progress')||latestSubmissions.some(Boolean);
    const pending=latestSubmissions.some(x=>x&&x.status==='待審核');
    const rejected=latestSubmissions.some(x=>x&&x.status==='已退件');
    const completionDates=completedRows.map(r=>clean_(r['完成時間'])).filter(Boolean).sort();
    let completionDate='';
    if(forced) completionDate=clean_(a['強制通過時間']);
    else if(completed&&completionDates.length) completionDate=rule==='任一必修子課程完成'?completionDates[0]:completionDates[completionDates.length-1];
    const courseStatus=completed?'已完成':pending?'待審核':rejected?'退回修改':started?'進行中':'未開始';
    return {'姓名':clean_(emp['姓名']),'人員工號':employeeId,'課程名稱':clean_(pkg['母課程名稱']),'課程報名日期':clean_(a['指派日期']),'課程狀態':courseStatus,'課程完成日期':completionDate};
  });
}

function adminRefresh_(session) {
  // Compatibility fallback only. Normal admin CRUD uses delta responses and does not rebuild
  // the full catalog in the write request.
  invalidateAdminCatalog_();
  invalidateAdminOverview_();
  return { user: session, fastWrite: true, refreshCatalog: true };
}


function saveProgressCore_(session, payload) {
  if (!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY', '只有學員帳號可以寫入學習進度。');
  const lesson = assignedLesson_(session.employeeId, payload.lessonId), lessonId=clean_(lesson['子課程ID']);
  const existing = findProgress_(session.employeeId, lessonId) || {};
  const allowedContentIds = new Set(rows_(APP.SHEETS.CONTENT).filter(r => clean_(r['子課程ID']) === lessonId).map(r => clean_(r['內容ID'])).filter(Boolean));
  const existingAllowed = contentProgressSubset_(existing['教材進度JSON'], allowedContentIds);
  const incomingAllowed = contentProgressSubset_(payload.contentProgress || {}, allowedContentIds);
  const merged=mergeContentProgress_(existingAllowed, incomingAllowed);
  const sums=summarizeContentProgress_(merged);
  const oldVideo=number_(existing['影片秒數']), oldPdf=number_(existing['PDF秒數']), oldTotal=number_(existing['影片總秒數']);
  return upsertProgress_(session.employeeId, clean_(lesson['母課程ID']), lessonId, {status:clean_(existing['狀態'])==='complete'?'complete':'in_progress',videoSeconds:Math.max(oldVideo,sums.videoSeconds),pdfSeconds:Math.max(oldPdf,sums.pdfSeconds),startedAt:clean_(existing['開始時間'])||now_(),completedAt:clean_(existing['完成時間']),videoTotalSeconds:Math.max(oldTotal,sums.videoTotalSeconds),contentProgress:merged});
}

function saveProgress_(session, payload) {
  const saved = saveProgressCore_(session, payload);
  return { saved: true, lessonId: clean_(saved['子課程ID']), status: clean_(saved['狀態']) || 'in_progress', updatedAt: clean_(saved['更新時間']) };
}


function completeLesson_(session, payload) {
  if (!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY', '只有學員帳號可以完成課程。');
  const lessonRow = assignedLesson_(session.employeeId, payload.lessonId);
  const lessonId = clean_(lessonRow['子課程ID']);
  const existing = findProgress_(session.employeeId, lessonId) || {};

  if (payload.contentProgress || payload.videoSeconds !== undefined || payload.pdfSeconds !== undefined || payload.videoTotalSeconds !== undefined) { saveProgressCore_(session, payload); }
  const refreshed = findProgress_(session.employeeId, lessonId) || existing;
  const lesson = lessonDto_(lessonRow, rows_(APP.SHEETS.CONTENT).filter(r => clean_(r['啟用']) === '是'), [refreshed]);
  const criteria = lesson.criteria;
  const submissionMode=clean_(lessonRow['作業回傳模式'])||'不需要';
  let submissionPassed=true;
  if(submissionMode==='必繳審核') {
    const latestSubmission=submissionForLesson_(session.employeeId,lessonId,rows_(APP.SHEETS.SUBMISSIONS));
    submissionPassed=!!(latestSubmission&&latestSubmission.status==='已通過');
  }
  if (!criteria.allPassed || !submissionPassed) {
    const missing = [];
    if (!criteria.videoPassed) missing.push('影片需達 ' + lesson.videoPassPercent + '%');
    if (!submissionPassed) missing.push('作業需送出並由教育中心審核通過');
    throw apiError_('PASS_CONDITION_NOT_MET', missing.join('、'));
  }

  const completedAt = clean_(refreshed['完成時間']) || now_();
  upsertProgress_(session.employeeId, clean_(lessonRow['母課程ID']), lessonId, {
    status: 'complete',
    videoSeconds: number_(refreshed['影片秒數']),
    pdfSeconds: number_(refreshed['PDF秒數']),
    startedAt: clean_(refreshed['開始時間']) || now_(),
    completedAt: completedAt,
    videoTotalSeconds: number_(refreshed['影片總秒數']),
    contentProgress: parseContentProgress_(refreshed['教材進度JSON']),
    completionMethod: clean_(refreshed['完成方式']) || '學員完成',
    completionNote: clean_(refreshed['完成備註'])
  });
  // Write-path response stays intentionally small. The browser can update the one
  // lesson immediately and refresh studentHome in the background instead of waiting
  // for a full course-tree rebuild before the completion button responds.
  return { completed: true, lessonId: lessonId, packageId: clean_(lessonRow['母課程ID']), status: 'complete', completedAt: completedAt };
}



function assignedLesson_(employeeId, lessonIdRaw) {
  const lessonId = clean_(lessonIdRaw);
  if (!lessonId) throw apiError_('LESSON_REQUIRED', '缺少子課程ID。');
  const lesson = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['子課程ID']) === lessonId && clean_(r['啟用']) === '是');
  if (!lesson) throw apiError_('LESSON_NOT_FOUND', '找不到子課程。');
  ensureAssigned_(employeeId, clean_(lesson['母課程ID']));
  const siblings = rows_(APP.SHEETS.LESSONS).filter(r => clean_(r['母課程ID']) === clean_(lesson['母課程ID']) && clean_(r['啟用']) === '是');
  if (!lessonApplicableToEmployee_(employeeId, lesson, siblings)) throw apiError_('LESSON_NOT_APPLICABLE', '此子課程不適用於目前帳號。');
  return lesson;
}

function progressSnapshotCacheKey_() { return 'learning-v1-progress-snapshot'; }
function progressEmployeeCacheKey_(employeeId) { return 'learning-v1-progress-employee-' + clean_(employeeId); }

function invalidateProgressSnapshot_(employeeId) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(progressSnapshotCacheKey_());
    if (employeeId) cache.remove(progressEmployeeCacheKey_(employeeId));
  } catch (e) {}
}

function progressSnapshot_() {
  const cached = cacheJsonGet_(progressSnapshotCacheKey_());
  if (cached && Array.isArray(cached.headers) && Array.isArray(cached.rows)) return cached;
  const table = table_(APP.SHEETS.PROGRESS);
  cacheJsonPut_(progressSnapshotCacheKey_(), table, PROGRESS_SNAPSHOT_CACHE_SECONDS_);
  return table;
}

function progressMeta_() {
  const rt = runtime_();
  if (rt.progressMeta) return rt.progressMeta;
  const sheet = sheet_(APP.SHEETS.PROGRESS);
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(clean_);
  const employeeCol = headers.indexOf('工號') + 1;
  const lessonCol = headers.indexOf('子課程ID') + 1;
  if (!employeeCol || !lessonCol) throw apiError_('HEADER_MISSING', '學習紀錄缺少工號或子課程ID欄位。');
  rt.progressMeta = { sheet: sheet, headers: headers, lastColumn: lastColumn, employeeCol: employeeCol, lessonCol: lessonCol };
  return rt.progressMeta;
}

function progressRowCacheKey_(employeeId, lessonId) {
  return 'learning-v1-progress-row-' + clean_(employeeId) + '-' + clean_(lessonId);
}

function progressRowObject_(rowNumber, meta) {
  meta = meta || progressMeta_();
  if (!rowNumber || rowNumber < 2) return null;
  try {
    const values = meta.sheet.getRange(rowNumber, 1, 1, meta.lastColumn).getDisplayValues()[0];
    const row = { _row: rowNumber };
    meta.headers.forEach((h, i) => row[h] = values[i]);
    return row;
  } catch (e) { return null; }
}

function progressRowsForEmployee_(employeeId) {
  const id = clean_(employeeId);
  if (!id) return [];
  const rt = runtime_();
  const runtimeKey = 'progressRows|' + id;
  if (rt[runtimeKey]) return rt[runtimeKey];

  const cached = cacheJsonGet_(progressEmployeeCacheKey_(id));
  if (cached && Array.isArray(cached.rows)) {
    rt[runtimeKey] = cached.rows;
    return cached.rows;
  }

  // One bounded Sheet read on snapshot miss, then filter in memory. This replaces
  // TextFinder + one getRange call per matched row (the old N+1 read pattern).
  const rows = progressSnapshot_().rows.filter(row => clean_(row['工號']) === id);
  cacheJsonPut_(progressEmployeeCacheKey_(id), { rows: rows }, PROGRESS_EMPLOYEE_CACHE_SECONDS_);
  try {
    const cache = CacheService.getScriptCache();
    rows.forEach(row => { const lessonId = clean_(row['子課程ID']); if (lessonId) cache.put(progressRowCacheKey_(id, lessonId), String(row._row), 900); });
  } catch (e) {}
  rt[runtimeKey] = rows;
  return rows;
}

function findProgress_(employeeId, lessonId) {
  const eid = clean_(employeeId), lid = clean_(lessonId);
  if (!eid || !lid) return null;
  const meta = progressMeta_();
  try {
    const cache = CacheService.getScriptCache();
    const cachedRow = Number(cache.get(progressRowCacheKey_(eid, lid)) || 0);
    if (cachedRow >= 2) {
      const row = progressRowObject_(cachedRow, meta);
      if (row && clean_(row['工號']) === eid && clean_(row['子課程ID']) === lid) return row;
      cache.remove(progressRowCacheKey_(eid, lid));
    }
  } catch (e) {}
  const rows = progressRowsForEmployee_(eid);
  return rows.find(r => clean_(r['子課程ID']) === lid) || null;
}

function upsertProgress_(employeeId, packageId, lessonId, update) {
  const eid = clean_(employeeId), lid = clean_(lessonId);
  const meta = progressMeta_();
  let existing = findProgress_(eid, lid);
  let rowNumber = existing ? existing._row : 0;
  let lock = null;
  if (!rowNumber) {
    // Only creation needs the global lock. Normal progress updates write their known row directly,
    // so dozens of learners no longer queue behind one shared ScriptLock every sync cycle.
    lock = LockService.getScriptLock();
    lock.waitLock(5000);
    delete runtime_()['progressRows|' + eid];
    existing = findProgress_(eid, lid);
    rowNumber = existing ? existing._row : Math.max(2, meta.sheet.getLastRow() + 1);
  }
  const now = now_();
  const data = {
    '紀錄ID': existing ? clean_(existing['紀錄ID']) : Utilities.getUuid(),
    '工號': eid,
    '母課程ID': packageId,
    '子課程ID': lid,
    '狀態': update.status,
    '影片秒數': Math.round(number_(update.videoSeconds)),
    'PDF秒數': Math.round(number_(update.pdfSeconds)),
    '開始時間': update.startedAt,
    '完成時間': update.completedAt,
    '更新時間': now,
    '影片總秒數': Math.round(number_(update.videoTotalSeconds)),
    '教材進度JSON': JSON.stringify(update.contentProgress || {}),
    '完成方式': update.completionMethod === undefined ? (existing ? clean_(existing['完成方式']) : '') : clean_(update.completionMethod),
    '完成備註': update.completionNote === undefined ? (existing ? clean_(existing['完成備註']) : '') : clean_(update.completionNote)
  };
  const next = existing ? Object.assign({}, existing, data, { _row: rowNumber }) : Object.assign({ _row: rowNumber }, data);
  const values = meta.headers.map(h => next[h] === undefined ? '' : next[h]);
  try { meta.sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]); }
  finally { if (lock) lock.releaseLock(); }
  try { CacheService.getScriptCache().put(progressRowCacheKey_(eid, lid), String(rowNumber), 900); } catch (e) {}
  delete runtime_()['progressRows|' + eid];
  delete runtime_().tables[APP.SHEETS.PROGRESS];
  invalidateProgressSnapshot_(eid);
  invalidateStudentPackages_(eid);
  invalidateAdminTrackingDetail_(eid, packageId);
  // Do not invalidate the global adminTracking cache on every 120-second learner sync.
  // It has a short 60-second TTL, so admin monitoring stays responsive without cache thrash.
  try { CacheService.getScriptCache().remove(adminOverviewCacheKey_()); } catch (e) {}
  return next;
}

function ensureAssigned_(employeeId, packageId) {
  const ok = rows_(APP.SHEETS.ASSIGNMENTS).some(r => clean_(r['工號']) === employeeId && clean_(r['母課程ID']) === packageId && assignmentEnabled_(r));
  if (!ok) throw apiError_('NOT_ASSIGNED', '此帳號未被指派該母課程。');
}

function requireSession_(token) {
  if (!token) throw apiError_('SESSION_REQUIRED', '請重新登入。');
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  let raw = '';
  if (cache) { try { raw = cache.get(sessionKey_(token)) || ''; } catch (e) {} }

  // V1.0: do not touch PropertiesService on the normal cache-hit path.
  // This removes one Apps Script service call from nearly every authenticated API.
  let props = null;
  if (!raw) {
    try {
      props = PropertiesService.getScriptProperties();
      raw = props.getProperty(sessionPropKey_(token)) || '';
    } catch (e) {}
  }
  if (!raw) throw apiError_('SESSION_EXPIRED', '登入已逾時，請重新登入。');

  let stored;
  try { stored = JSON.parse(raw); } catch (e) { stored = null; }
  if (!stored || !stored.session || !stored.expiresAt || Number(stored.expiresAt) <= Date.now()) {
    if (cache) { try { cache.remove(sessionKey_(token)); } catch (e) {} }
    try {
      if (!props) props = PropertiesService.getScriptProperties();
      props.deleteProperty(sessionPropKey_(token));
    } catch (e) {}
    throw apiError_('SESSION_EXPIRED', '登入已逾時，請重新登入。');
  }

  const remaining = Math.max(60, Math.min(APP.SESSION_TTL_SECONDS, Math.floor((Number(stored.expiresAt) - Date.now()) / 1000)));
  if (cache) { try { cache.put(sessionKey_(token), raw, remaining); } catch (e) {} }
  return stored.session;
}

function requireTrackingViewer_(token) {
  const session = requireSession_(token);
  if (!isTrackingViewerSession_(session)) throw apiError_('TRACKING_ONLY', '此功能僅供教育中心或區主管查看。');
  if (session.roleKey === 'area_manager' && !clean_(session.area)) throw apiError_('AREA_REQUIRED', '區主管帳號未設定區域，請洽教育中心。');
  return session;
}

function requireAdmin_(token) {
  const session = requireSession_(token);
  if (session.roleKey !== 'admin') throw apiError_('ADMIN_ONLY', '此功能僅供教育中心使用。');
  return session;
}

function assignmentEnabled_(row) {
  const status = clean_(row['指派狀態']);
  return !status || status === '啟用';
}

function upsertByKey_(sheetName, keyHeader, keyValue, data) {
  let table = table_(sheetName);
  if (table.headers.indexOf(keyHeader) < 0) throw apiError_('HEADER_MISSING', sheetName + ' 缺少欄位：' + keyHeader);
  let existing = table.rows.find(r => clean_(r[keyHeader]) === clean_(keyValue)) || null;
  let rowNumber = existing ? existing._row : 0;
  let lock = null;
  if (!rowNumber) {
    // Only appending a new row needs the shared lock. Updating an existing course/lesson/content
    // writes its known row directly, removing unnecessary serialization from normal admin edits.
    lock = LockService.getScriptLock();
    lock.waitLock(5000);
    table = table_(sheetName, true);
    existing = table.rows.find(r => clean_(r[keyHeader]) === clean_(keyValue)) || null;
    rowNumber = existing ? existing._row : table.lastRow + 1;
  }
  const next = existing ? Object.assign({}, existing, data) : Object.assign({ _row: rowNumber }, data);
  const values = table.headers.map(h => next[h] === undefined ? '' : next[h]);
  try { sheet_(sheetName).getRange(rowNumber, 1, 1, values.length).setValues([values]); }
  finally { if (lock) lock.releaseLock(); }
  next._row = rowNumber;
  if (existing) {
    const idx = table.rows.indexOf(existing);
    table.rows[idx] = next;
  } else {
    table.rows.push(next);
    table.lastRow = rowNumber;
  }
  runtime_().tables[sheetName] = table;
  cacheTable_(sheetName, table);
  if (isStaticTable_(sheetName)) { bumpCatalogRevision_(); invalidateAdminCatalog_(); invalidateAdminOverview_(); }
  if (sheetName === APP.SHEETS.SUBMISSIONS) {
    invalidateSubmissionSnapshot_();
    invalidateAdminTrackingDetail_(clean_(next['工號']), clean_(next['母課程ID']));
  }
  return next;
}


function packagePublished_(row){const s=clean_(row['發佈狀態']);return !s||s==='已發布';}
function parseContentProgress_(raw){if(raw&&typeof raw==='object')return raw;try{const x=JSON.parse(clean_(raw)||'{}');return x&&typeof x==='object'?x:{};}catch{return {};}}
function mergeContentProgress_(base,incoming){const out=JSON.parse(JSON.stringify(base||{}));Object.keys(incoming||{}).forEach(id=>{const a=out[id]||{},b=incoming[id]||{};out[id]={type:clean_(b.type)||clean_(a.type),seconds:Math.max(number_(a.seconds),number_(b.seconds)),duration:Math.max(number_(a.duration),number_(b.duration)),page:Math.max(1,number_(b.page)||number_(a.page)||1),maxPage:Math.max(number_(a.maxPage),number_(b.maxPage)),pages:Math.max(number_(a.pages),number_(b.pages)),confirmed:!!(a.confirmed||b.confirmed)};});return out;}
function summarizeContentProgress_(cp){let vs=0,vt=0,ps=0;Object.keys(cp||{}).forEach(id=>{const x=cp[id]||{},t=clean_(x.type).toUpperCase();if(t==='VIDEO'){vs+=number_(x.seconds);vt+=number_(x.duration);}if(t==='PDF')ps+=number_(x.seconds);});return {videoSeconds:vs,videoTotalSeconds:vt,pdfSeconds:ps};}
function isYouTubeUrl_(u){return /(?:youtube\.com\/(?:watch|embed|shorts|live)|youtu\.be\/)/i.test(clean_(u));}
function deleteRowsByPredicate_(sheetName, predicate) {
  const table = table_(sheetName);
  const rowsToDelete = table.rows.filter(predicate).map(r => r._row).sort((a,b) => b-a);
  if (!rowsToDelete.length) return;
  const sheet = sheet_(sheetName);
  rowsToDelete.forEach(rowNumber => sheet.deleteRow(rowNumber));
  invalidateTable_(sheetName);
  if (sheetName === APP.SHEETS.SUBMISSIONS) invalidateSubmissionSnapshot_();
}





function settingsMap_(){
  const out={};
  rows_(APP.SHEETS.SETTINGS).forEach(r=>out[clean_(r['設定鍵'])]=clean_(r['設定值']));
  return out;
}
function publicUploadConfig_(){
  const s=settingsMap_();
  return {
    enabled:(s.SUBMISSION_FEATURE||'TRUE').toUpperCase()!=='FALSE',
    maxMb:Math.max(1,number_(s.UPLOAD_MAX_MB)||20),
    maxFilesPerBatch:Math.max(1,Math.round(number_(s.UPLOAD_MAX_FILES_PER_BATCH)||5)),
    maxFilesPerSubmission:Math.max(1,Math.round(number_(s.UPLOAD_MAX_FILES_PER_SUBMISSION)||20)),
    allowedExtensions:(s.UPLOAD_ALLOWED_EXTENSIONS||'pdf,xls,xlsx,doc,docx,ppt,pptx,jpg,jpeg,png,zip,csv').split(',').map(x=>clean_(x).toLowerCase()).filter(Boolean)
  };
}
function submissionRootFolder_(){
  const id=clean_(settingsMap_().UPLOAD_ROOT_FOLDER_ID);
  if(!id) throw apiError_('UPLOAD_FOLDER_MISSING','尚未設定學員回傳資料夾。');
  try{return DriveApp.getFolderById(id);}catch(e){throw apiError_('UPLOAD_FOLDER_UNAVAILABLE','Apps Script 無法存取學員回傳資料夾，請確認資料夾權限。');}
}
function safeFolderName_(value){return clean_(value).replace(/[\/:*?"<>|]/g,'_').replace(/\s+/g,' ').slice(0,120)||'未命名';}
function childFolder_(parent,name){const safe=safeFolderName_(name),it=parent.getFoldersByName(safe);return it.hasNext()?it.next():parent.createFolder(safe);}
function submissionIdentity_(employeeId){
  const emp=rows_(APP.SHEETS.EMPLOYEES).find(r=>clean_(r['工號'])===employeeId)||{};
  return safeFolderName_(employeeId+'_'+(clean_(emp['姓名'])||clean_(emp['店別'])||'學員'));
}
function submissionMonthFolder_(lessonRow){
  // FINAL3: new submissions use only two human-friendly levels under the configured root:
  // yyyy-MM / employee_name_Vxx. Existing historical folders are left untouched.
  return childFolder_(submissionRootFolder_(),Utilities.formatDate(new Date(),APP.TZ,'yyyy-MM'));
}
function submissionVersionName_(employeeId,version,lessonRow){
  const packageId=clean_(lessonRow&&lessonRow['母課程ID']);
  const pkg=rows_(APP.SHEETS.PACKAGES).find(r=>clean_(r['母課程ID'])===packageId)||{};
  const course=clean_(pkg['母課程名稱'])||packageId||'課程';
  const rawLesson=clean_(lessonRow&&lessonRow['子課程名稱']);
  const lesson=rawLesson==='__PACKAGE_DIRECT__'?'課程回傳':(rawLesson||'子課程');
  return safeFolderName_(course+'_'+lesson+'_'+submissionIdentity_(employeeId)+'_V'+String(Math.max(1,Math.round(number_(version)||1))).padStart(2,'0'));
}
function directSubmissionStoredName_(employeeId,version,originalName,lessonRow){return safeFolderName_(submissionVersionName_(employeeId,version,lessonRow)+'_'+cleanFileName_(originalName));}
function parseSubmissionFiles_(raw){if(Array.isArray(raw))return raw;try{const x=JSON.parse(clean_(raw)||'[]');return Array.isArray(x)?x:[];}catch(e){return [];}}
function submissionDto_(row,includeLinks){
  if(!row||!clean_(row['回傳ID'])) return null;
  const files=parseSubmissionFiles_(row['檔案JSON']).map(f=>({id:clean_(f.id),name:clean_(f.name),size:number_(f.size),mimeType:clean_(f.mimeType),uploadedAt:clean_(f.uploadedAt),url:includeLinks&&clean_(f.id)?'https://drive.google.com/file/d/'+encodeURIComponent(clean_(f.id))+'/view':''}));
  return {id:clean_(row['回傳ID']),employeeId:clean_(row['工號']),packageId:clean_(row['母課程ID']),lessonId:clean_(row['子課程ID']),version:Math.max(1,Math.round(number_(row['版本'])||1)),status:clean_(row['狀態'])||'未送審',folderId:includeLinks?clean_(row['資料夾ID']):'',files:files,createdAt:clean_(row['建立時間']),submittedAt:clean_(row['送出時間']),reviewedAt:clean_(row['審核時間']),reviewer:clean_(row['審核人']),rejectReason:clean_(row['退件原因']),updatedAt:clean_(row['更新時間']),note:clean_(row['備註'])};
}
function submissionForLesson_(employeeId,lessonId,sourceRows){
  const list=(sourceRows||rows_(APP.SHEETS.SUBMISSIONS)).filter(r=>clean_(r['工號'])===employeeId&&clean_(r['子課程ID'])===lessonId).sort((a,b)=>number_(a['版本'])-number_(b['版本']));
  return list.length?submissionDto_(list[list.length-1],false):null;
}
function submissionHistory_(employeeId,lessonId,includeLinks){return rows_(APP.SHEETS.SUBMISSIONS).filter(r=>clean_(r['工號'])===employeeId&&clean_(r['子課程ID'])===lessonId).sort((a,b)=>number_(a['版本'])-number_(b['版本'])).map(r=>submissionDto_(r,includeLinks));}
function getSubmission_(session,payload){
  if(!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY','只有學員帳號可以查看自己的作業回傳。');
  const lesson=assignedLesson_(session.employeeId,payload.lessonId), mode=clean_(lesson['作業回傳模式'])||'不需要';
  return {lessonId:clean_(lesson['子課程ID']),mode:mode,note:clean_(lesson['作業說明']),latest:submissionForLesson_(session.employeeId,clean_(lesson['子課程ID'])),history:submissionHistory_(session.employeeId,clean_(lesson['子課程ID']),false),config:publicUploadConfig_()};
}
function createDraftSubmission_(employeeId,lessonRow,version){
  const id=makeId_('SUB');
  const folder=childFolder_(submissionMonthFolder_(lessonRow),submissionVersionName_(employeeId,version,lessonRow));
  const now=now_();
  upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',id,{'回傳ID':id,'工號':employeeId,'母課程ID':clean_(lessonRow['母課程ID']),'子課程ID':clean_(lessonRow['子課程ID']),'版本':version,'狀態':'未送審','資料夾ID':folder.getId(),'檔案JSON':'[]','建立時間':now,'送出時間':'','審核時間':'','審核人':'','退件原因':'','更新時間':now,'備註':'FINAL3兩層扁平化存放'});
  invalidateAdminOverview_();
  return rows_(APP.SHEETS.SUBMISSIONS).find(r=>clean_(r['回傳ID'])===id);
}
function draftForUpload_(employeeId,lessonRow){
  const list=rows_(APP.SHEETS.SUBMISSIONS).filter(r=>clean_(r['工號'])===employeeId&&clean_(r['子課程ID'])===clean_(lessonRow['子課程ID'])).sort((a,b)=>number_(a['版本'])-number_(b['版本']));
  if(!list.length) return createDraftSubmission_(employeeId,lessonRow,1);
  const latest=list[list.length-1],status=clean_(latest['狀態']);
  if(status==='未送審') return latest;
  if(status==='已退件') return createDraftSubmission_(employeeId,lessonRow,Math.max(1,number_(latest['版本']))+1);
  if(status==='待審核') throw apiError_('SUBMISSION_LOCKED','作業已送審，教育中心審核前不能再修改。');
  if(status==='已通過') throw apiError_('SUBMISSION_APPROVED','作業已通過，不需要再次上傳。');
  return createDraftSubmission_(employeeId,lessonRow,Math.max(1,number_(latest['版本']))+1);
}
function cleanFileName_(name){const raw=clean_(name).split(/[\\/]/).pop();if(!raw)throw apiError_('FILE_NAME_REQUIRED','缺少檔案名稱。');return raw.slice(0,180);}
function uploadSubmissionFile_(session,payload){
  if(!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY','只有學員帳號可以上傳作業。');
  const config=publicUploadConfig_();if(!config.enabled)throw apiError_('SUBMISSION_DISABLED','作業回傳功能目前未啟用。');
  const lesson=assignedLesson_(session.employeeId,payload.lessonId),mode=clean_(lesson['作業回傳模式'])||'不需要';if(mode==='不需要')throw apiError_('SUBMISSION_NOT_ENABLED','此子課程未開放作業回傳。');
  const name=cleanFileName_(payload.fileName),ext=(name.includes('.')?name.split('.').pop():'').toLowerCase();if(!config.allowedExtensions.includes(ext))throw apiError_('FILE_TYPE_NOT_ALLOWED','不支援此檔案格式：'+ext);
  const b64=clean_(payload.fileBase64);if(!b64)throw apiError_('FILE_DATA_REQUIRED','沒有收到檔案內容。');
  let bytes;try{bytes=Utilities.base64Decode(b64);}catch(e){throw apiError_('FILE_DATA_INVALID','檔案內容格式錯誤。');}
  if(bytes.length>config.maxMb*1024*1024)throw apiError_('FILE_TOO_LARGE','單一檔案不可超過 '+config.maxMb+' MB。');
  const draft=draftForUpload_(session.employeeId,lesson),files=parseSubmissionFiles_(draft['檔案JSON']);
  const existingSame=files.filter(f=>clean_(f.name)===name);existingSame.forEach(f=>{try{DriveApp.getFileById(clean_(f.id)).setTrashed(true);}catch(e){}});
  const kept=files.filter(f=>clean_(f.name)!==name);if(kept.length>=config.maxFilesPerSubmission)throw apiError_('TOO_MANY_FILES','每一送審版本最多 '+config.maxFilesPerSubmission+' 個附件。');
  let folder;try{folder=DriveApp.getFolderById(clean_(draft['資料夾ID']));}catch(e){throw apiError_('UPLOAD_FOLDER_UNAVAILABLE','作業存放資料夾無法存取。');}
  const version=Math.max(1,Math.round(number_(draft['版本'])||1)),versionName=submissionVersionName_(session.employeeId,version,lesson);
  let inBundle=false;try{inBundle=folder.getName()===versionName;}catch(e){}
  if(!inBundle && kept.length>=1){
    const bundle=childFolder_(folder,versionName);
    kept.forEach(meta=>{try{const oldFile=DriveApp.getFileById(clean_(meta.id));oldFile.moveTo(bundle);oldFile.setName(cleanFileName_(meta.name));}catch(e){}});
    folder=bundle;inBundle=true;
  }
  const mime=clean_(payload.mimeType)||'application/octet-stream',storedName=inBundle?name:directSubmissionStoredName_(session.employeeId,version,name,lesson),blob=Utilities.newBlob(bytes,mime,storedName),file=folder.createFile(blob),now=now_();
  kept.push({id:file.getId(),name:name,storedName:storedName,size:bytes.length,mimeType:mime,uploadedAt:now});
  upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',clean_(draft['回傳ID']),{'資料夾ID':folder.getId(),'檔案JSON':JSON.stringify(kept),'更新時間':now});
  return getSubmission_(session,{lessonId:clean_(lesson['子課程ID'])});
}
function uploadSubmissionFilesBatch_(session,payload){
  if(!isLearnerSession_(session)) throw apiError_('STUDENT_ONLY','只有學員帳號可以上傳作業。');
  const config=publicUploadConfig_();
  if(!config.enabled) throw apiError_('SUBMISSION_DISABLED','作業回傳功能目前未啟用。');
  const lesson=assignedLesson_(session.employeeId,payload.lessonId),mode=clean_(lesson['作業回傳模式'])||'不需要';
  if(mode==='不需要') throw apiError_('SUBMISSION_NOT_ENABLED','此子課程未開放作業回傳。');
  const incoming=Array.isArray(payload.files)?payload.files:[];
  if(!incoming.length) throw apiError_('FILE_DATA_REQUIRED','沒有收到檔案。');
  if(incoming.length>config.maxFilesPerBatch) throw apiError_('TOO_MANY_FILES_BATCH','一次最多上傳 '+config.maxFilesPerBatch+' 個檔案。');

  // Validate/decode all files before touching Drive or Sheet so a bad file cannot leave a half-written batch.
  const decoded=incoming.map(item=>{
    const name=cleanFileName_(item.fileName),ext=(name.includes('.')?name.split('.').pop():'').toLowerCase();
    if(!config.allowedExtensions.includes(ext)) throw apiError_('FILE_TYPE_NOT_ALLOWED','不支援此檔案格式：'+ext);
    const b64=clean_(item.fileBase64); if(!b64) throw apiError_('FILE_DATA_REQUIRED','沒有收到檔案內容：'+name);
    let bytes; try{bytes=Utilities.base64Decode(b64);}catch(e){throw apiError_('FILE_DATA_INVALID','檔案內容格式錯誤：'+name);}
    if(bytes.length>config.maxMb*1024*1024) throw apiError_('FILE_TOO_LARGE','單一檔案不可超過 '+config.maxMb+' MB：'+name);
    return {name:name,mime:clean_(item.mimeType)||'application/octet-stream',bytes:bytes};
  });

  const draft=draftForUpload_(session.employeeId,lesson);
  let files=parseSubmissionFiles_(draft['檔案JSON']);
  const incomingNames=new Set(decoded.map(x=>x.name));
  const replacing=files.filter(f=>incomingNames.has(clean_(f.name)));
  const kept=files.filter(f=>!incomingNames.has(clean_(f.name)));
  if(kept.length+decoded.length>config.maxFilesPerSubmission) throw apiError_('TOO_MANY_FILES','每一送審版本最多 '+config.maxFilesPerSubmission+' 個附件。');

  let folder; try{folder=DriveApp.getFolderById(clean_(draft['資料夾ID']));}catch(e){throw apiError_('UPLOAD_FOLDER_UNAVAILABLE','作業存放資料夾無法存取。');}
  const version=Math.max(1,Math.round(number_(draft['版本'])||1)),versionName=submissionVersionName_(session.employeeId,version,lesson);
  let inBundle=false; try{inBundle=folder.getName()===versionName;}catch(e){}
  // For a multi-file submission keep the batch in one version folder from the start.
  if(!inBundle && (kept.length+decoded.length)>1){
    const bundle=childFolder_(folder,versionName);
    kept.forEach(meta=>{try{const oldFile=DriveApp.getFileById(clean_(meta.id));oldFile.moveTo(bundle);oldFile.setName(cleanFileName_(meta.name));}catch(e){}});
    folder=bundle; inBundle=true;
  }

  // Only after all validation succeeds do we replace old same-name files.
  replacing.forEach(f=>{try{DriveApp.getFileById(clean_(f.id)).setTrashed(true);}catch(e){}});
  const now=now_(),created=[];
  try{
    decoded.forEach(item=>{
      const storedName=inBundle?item.name:directSubmissionStoredName_(session.employeeId,version,item.name,lesson);
      const file=folder.createFile(Utilities.newBlob(item.bytes,item.mime,storedName));
      const meta={id:file.getId(),name:item.name,storedName:storedName,size:item.bytes.length,mimeType:item.mime,uploadedAt:now};
      created.push(meta); kept.push(meta);
    });
    // One Sheet write for the entire batch.
    upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',clean_(draft['回傳ID']),{'資料夾ID':folder.getId(),'檔案JSON':JSON.stringify(kept),'更新時間':now});
  }catch(e){
    // Best-effort rollback of files created by this batch if Drive/Sheet fails midway.
    created.forEach(meta=>{try{DriveApp.getFileById(meta.id).setTrashed(true);}catch(_) {}});
    throw e;
  }
  return getSubmission_(session,{lessonId:clean_(lesson['子課程ID'])});
}

function removeSubmissionFile_(session,payload){
  if(!isLearnerSession_(session))throw apiError_('STUDENT_ONLY','只有學員帳號可以刪除自己的草稿附件。');
  const lesson=assignedLesson_(session.employeeId,payload.lessonId),history=rows_(APP.SHEETS.SUBMISSIONS).filter(r=>clean_(r['工號'])===session.employeeId&&clean_(r['子課程ID'])===clean_(lesson['子課程ID'])).sort((a,b)=>number_(a['版本'])-number_(b['版本']));
  if(!history.length||clean_(history[history.length-1]['狀態'])!=='未送審')throw apiError_('SUBMISSION_LOCKED','目前沒有可修改的未送審版本。');
  const row=history[history.length-1],fileId=clean_(payload.fileId),files=parseSubmissionFiles_(row['檔案JSON']),target=files.find(f=>clean_(f.id)===fileId);if(!target)throw apiError_('FILE_NOT_FOUND','找不到附件。');
  try{DriveApp.getFileById(fileId).setTrashed(true);}catch(e){}
  const next=files.filter(f=>clean_(f.id)!==fileId);upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',clean_(row['回傳ID']),{'檔案JSON':JSON.stringify(next),'更新時間':now_()});
  return getSubmission_(session,{lessonId:clean_(lesson['子課程ID'])});
}
function submitSubmission_(session,payload){
  if(!isLearnerSession_(session))throw apiError_('STUDENT_ONLY','只有學員帳號可以送出自己的作業。');
  const lesson=assignedLesson_(session.employeeId,payload.lessonId),history=rows_(APP.SHEETS.SUBMISSIONS).filter(r=>clean_(r['工號'])===session.employeeId&&clean_(r['子課程ID'])===clean_(lesson['子課程ID'])).sort((a,b)=>number_(a['版本'])-number_(b['版本']));
  if(!history.length)throw apiError_('SUBMISSION_EMPTY','請先上傳至少一個檔案。');
  const row=history[history.length-1];if(clean_(row['狀態'])!=='未送審')throw apiError_('SUBMISSION_LOCKED','目前版本已送出或已審核。');
  if(!parseSubmissionFiles_(row['檔案JSON']).length)throw apiError_('SUBMISSION_EMPTY','請先上傳至少一個檔案。');
  const now=now_();upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',clean_(row['回傳ID']),{'狀態':'待審核','送出時間':now,'更新時間':now,'退件原因':''});
  invalidateAdminOverview_();
  return getSubmission_(session,{lessonId:clean_(lesson['子課程ID'])});
}
function adminSubmissionItem_(row){
  const dto=submissionDto_(row,true);
  if(!dto)return null;
  const emp=rows_(APP.SHEETS.EMPLOYEES).find(x=>clean_(x['工號'])===dto.employeeId)||{};
  const pkg=rows_(APP.SHEETS.PACKAGES).find(x=>clean_(x['母課程ID'])===dto.packageId)||{};
  const lesson=rows_(APP.SHEETS.LESSONS).find(x=>clean_(x['子課程ID'])===dto.lessonId)||{};
  return {...dto,name:clean_(emp['姓名']),area:clean_(emp['區域']),store:clean_(emp['店別']),courseTitle:clean_(pkg['母課程名稱']),lessonTitle:clean_(lesson['子課程名稱'])==='__PACKAGE_DIRECT__'?'課程回傳':clean_(lesson['子課程名稱']),submissionMode:clean_(lesson['作業回傳模式'])||'不需要'};
}
function adminSubmissions_(session){
  const items=rows_(APP.SHEETS.SUBMISSIONS).map(adminSubmissionItem_).filter(Boolean).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return {items:items,config:publicUploadConfig_(),rootFolderUrl:'https://drive.google.com/drive/folders/'+encodeURIComponent(clean_(settingsMap_().UPLOAD_ROOT_FOLDER_ID))};
}
function maybeCompleteAfterApproval_(employeeId,lessonRow){
  const lessonId=clean_(lessonRow['子課程ID']),existing=findProgress_(employeeId,lessonId)||{},dto=lessonDto_(lessonRow,rows_(APP.SHEETS.CONTENT).filter(r=>clean_(r['啟用'])==='是'),[existing]);
  if(!dto.criteria.allPassed)return false;
  const alreadyComplete=clean_(existing['狀態'])==='complete';
  upsertProgress_(employeeId,clean_(lessonRow['母課程ID']),lessonId,{status:'complete',videoSeconds:number_(existing['影片秒數']),pdfSeconds:number_(existing['PDF秒數']),startedAt:clean_(existing['開始時間'])||now_(),completedAt:clean_(existing['完成時間'])||now_(),videoTotalSeconds:number_(existing['影片總秒數']),contentProgress:parseContentProgress_(existing['教材進度JSON']),completionMethod:alreadyComplete?(clean_(existing['完成方式'])||'學員完成'):'作業審核通過',completionNote:clean_(existing['完成備註'])});
  return !alreadyComplete;
}
function reopenProgressAfterApprovalReversal_(employeeId,lessonRow){
  const lessonId=clean_(lessonRow&&lessonRow['子課程ID']);
  if(!lessonId)return false;
  const existing=findProgress_(employeeId,lessonId);
  if(!existing||clean_(existing['狀態'])!=='complete'||clean_(existing['完成方式'])!=='作業審核通過')return false;
  upsertProgress_(employeeId,clean_(lessonRow['母課程ID']),lessonId,{status:'in_progress',videoSeconds:number_(existing['影片秒數']),pdfSeconds:number_(existing['PDF秒數']),startedAt:clean_(existing['開始時間'])||now_(),completedAt:'',videoTotalSeconds:number_(existing['影片總秒數']),contentProgress:parseContentProgress_(existing['教材進度JSON']),completionMethod:'',completionNote:clean_(existing['完成備註'])});
  return true;
}
function reviewSubmission_(session,payload){
  const id=clean_(payload.id),decision=clean_(payload.decision),reason=clean_(payload.reason),rows=rows_(APP.SHEETS.SUBMISSIONS),row=rows.find(r=>clean_(r['回傳ID'])===id);if(!row)throw apiError_('SUBMISSION_NOT_FOUND','找不到作業回傳紀錄。');
  if(!['approve','reject'].includes(decision))throw apiError_('REVIEW_DECISION_INVALID','審核動作不正確。');
  const current=clean_(row['狀態']);
  const history=rows.filter(r=>clean_(r['工號'])===clean_(row['工號'])&&clean_(r['子課程ID'])===clean_(row['子課程ID'])).sort((a,b)=>number_(a['版本'])-number_(b['版本']));
  const latest=history.length?history[history.length-1]:row;
  if(clean_(latest['回傳ID'])!==id)throw apiError_('SUBMISSION_NOT_LATEST','只能更正目前最新版本的作業。');
  if(decision==='approve'&&current!=='待審核')throw apiError_('SUBMISSION_NOT_PENDING','只有待審核作業可以設為通過。');
  if(decision==='reject'&&!['待審核','已通過','已退件'].includes(current))throw apiError_('SUBMISSION_NOT_REVIEWABLE','目前作業狀態無法退件。');
  if(decision==='reject'&&!reason)throw apiError_('REJECT_REASON_REQUIRED','退件時請填寫原因。');
  const lesson=rows_(APP.SHEETS.LESSONS).find(r=>clean_(r['子課程ID'])===clean_(row['子課程ID']));
  if(decision==='reject'&&current==='已退件'){
    if(lesson&&(clean_(lesson['作業回傳模式'])||'不需要')==='必繳審核')reopenProgressAfterApprovalReversal_(clean_(row['工號']),lesson);
    return {message:'作業目前已是退件狀態。',updated:adminSubmissionItem_(row),unchanged:true};
  }
  const now=now_(),status=decision==='approve'?'已通過':'已退件';
  const updatedRow=upsertByKey_(APP.SHEETS.SUBMISSIONS,'回傳ID',id,{'狀態':status,'審核時間':now,'審核人':session.employeeId,'退件原因':decision==='reject'?reason:'','更新時間':now});
  if(lesson&&(clean_(lesson['作業回傳模式'])||'不需要')==='必繳審核'){
    if(decision==='approve')maybeCompleteAfterApproval_(clean_(row['工號']),lesson);
    else if(current==='已通過')reopenProgressAfterApprovalReversal_(clean_(row['工號']),lesson);
  }
  invalidateAdminOverview_();
  // Return only the changed submission. Rebuilding every submission, employee,
  // course and lesson after one approval made the review button slower as data grew.
  return {message:decision==='approve'?'作業已通過。':(current==='已通過'?'已撤銷通過並改為退件。':'作業已退件。'),updated:adminSubmissionItem_(updatedRow),employeeId:clean_(row['工號']),packageId:clean_(row['母課程ID']),lessonId:clean_(row['子課程ID'])};
}

function forceCompletePackage_(session,payload){
  const employeeId=clean_(payload.employeeId),packageId=clean_(payload.packageId),reason=clean_(payload.reason)||'教育中心人工確認';
  if(!employeeId||!packageId) throw apiError_('FORCE_COMPLETE_REQUIRED','缺少人員或課程資料。');
  const assignment=rows_(APP.SHEETS.ASSIGNMENTS).find(r=>clean_(r['工號'])===employeeId&&clean_(r['母課程ID'])===packageId&&assignmentEnabled_(r));
  if(!assignment) throw apiError_('ASSIGNMENT_NOT_FOUND','找不到該人員的課程指派。');
  upsertByKey_(APP.SHEETS.ASSIGNMENTS,'指派ID',clean_(assignment['指派ID']),{'強制通過':'是','強制通過時間':now_(),'強制通過人':clean_(session.name)||clean_(session.employeeId),'強制通過備註':reason});
  invalidateTable_(APP.SHEETS.ASSIGNMENTS);
  invalidateStudentPackages_(employeeId);
  invalidateAdminOverview_();
  return {message:'已由教育中心強制通過此課程。',employeeId:employeeId,packages:studentHome_(employeeId)};
}

function clearForceCompletePackage_(session,payload){
  const employeeId=clean_(payload.employeeId),packageId=clean_(payload.packageId);
  if(!employeeId||!packageId) throw apiError_('FORCE_COMPLETE_REQUIRED','缺少人員或課程資料。');
  const assignment=rows_(APP.SHEETS.ASSIGNMENTS).find(r=>clean_(r['工號'])===employeeId&&clean_(r['母課程ID'])===packageId&&assignmentEnabled_(r));
  if(!assignment) throw apiError_('ASSIGNMENT_NOT_FOUND','找不到該人員的課程指派。');
  upsertByKey_(APP.SHEETS.ASSIGNMENTS,'指派ID',clean_(assignment['指派ID']),{'強制通過':'','強制通過時間':'','強制通過人':'','強制通過備註':''});
  invalidateTable_(APP.SHEETS.ASSIGNMENTS);
  invalidateStudentPackages_(employeeId);
  invalidateAdminOverview_();
  return {message:'已取消教育中心強制通過，恢復依實際學習進度判定。',employeeId:employeeId,packages:studentHome_(employeeId)};
}

function googleDriveFileId_(url) {
  const raw = clean_(url);
  let m = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (!m) m = raw.match(/[?&]id=([^&#]+)/i);
  if (!m) m = raw.match(/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([^/?#]+)/i);
  return m ? clean_(m[1]) : '';
}

function driveDirectDownloadUrl_(url) {
  const raw = clean_(url);
  let m = raw.match(/docs\.google\.com\/document\/d\/([^/?#]+)/i);
  if (m) return 'https://docs.google.com/document/d/' + encodeURIComponent(m[1]) + '/export?format=docx';
  m = raw.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/i);
  if (m) return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(m[1]) + '/export?format=xlsx';
  m = raw.match(/docs\.google\.com\/presentation\/d\/([^/?#]+)/i);
  if (m) return 'https://docs.google.com/presentation/d/' + encodeURIComponent(m[1]) + '/export/pptx';
  const id = googleDriveFileId_(raw);
  return id ? 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=download&confirm=t' : raw;
}

function looksLikePdf_(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
}

function fetchBlob_(url, options) {
  try {
    const response=UrlFetchApp.fetch(url,Object.assign({muteHttpExceptions:true,followRedirects:true,headers:{'User-Agent':'Mozilla/5.0','Accept':'application/pdf,*/*'}},options||{}));
    const code=response.getResponseCode();
    if(code>=200&&code<300) return response.getBlob();
  } catch(e) {}
  return null;
}

function drivePdfBlob_(driveId) {
  if(!driveId) return null;
  // 公開檔優先走 usercontent，不依賴學員 Google 登入，也不會出現 Drive 預覽工具列。
  let blob=fetchBlob_('https://drive.usercontent.google.com/download?id='+encodeURIComponent(driveId)+'&export=download&confirm=t');
  if(blob&&looksLikePdf_(blob.getBytes())) return blob;
  // 同一教育中心 Drive 的檔案可直接由 Web App 執行帳號讀取。
  try {
    blob=DriveApp.getFileById(driveId).getBlob();
    if(blob&&looksLikePdf_(blob.getBytes())) return blob;
  } catch(e) {}
  // 最後使用 Drive API + Apps Script OAuth，兼容共享雲端硬碟。
  try {
    blob=fetchBlob_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(driveId)+'?alt=media&supportsAllDrives=true',{headers:{'Authorization':'Bearer '+ScriptApp.getOAuthToken(),'Accept':'application/pdf,*/*'}});
    if(blob&&looksLikePdf_(blob.getBytes())) return blob;
  } catch(e) {}
  return null;
}

function getPdfContent_(session, payload) {
  const contentId = clean_(payload.contentId);
  const content = rows_(APP.SHEETS.CONTENT).find(r => clean_(r['內容ID']) === contentId && clean_(r['啟用']) !== '否');
  if (!content || clean_(content['類型']).toUpperCase() !== 'PDF') throw apiError_('PDF_NOT_FOUND', '找不到可閱讀的 PDF 教材。');
  const lessonId = clean_(content['子課程ID']);
  const lesson = rows_(APP.SHEETS.LESSONS).find(r => clean_(r['子課程ID']) === lessonId && clean_(r['啟用']) !== '否');
  if (!lesson) throw apiError_('LESSON_NOT_FOUND', '找不到子課程。');
  if (isLearnerSession_(session)) assignedLesson_(session.employeeId, lessonId);
  else if (session.roleKey !== 'admin') throw apiError_('PDF_ACCESS_DENIED', '沒有權限讀取此 PDF。');

  const url = clean_(content['URL']);
  if (!isHttpUrl_(url)) throw apiError_('PDF_URL_INVALID', 'PDF 網址格式不正確。');
  const driveId = googleDriveFileId_(url);
  let blob = driveId ? drivePdfBlob_(driveId) : fetchBlob_(url);
  if (!blob) throw apiError_('PDF_FETCH_FAILED', '無法讀取 PDF。請確認檔案仍存在且教育中心帳號有檢視權限。');
  const bytes = blob.getBytes();
  const maxBytes = 20 * 1024 * 1024;
  if (bytes.length > maxBytes) throw apiError_('PDF_INLINE_TOO_LARGE', '此 PDF 超過 20 MB，暫時無法使用網站內閱讀模式。');
  if (!looksLikePdf_(bytes)) throw apiError_('PDF_DATA_INVALID', '目前連結不是可直接讀取的 PDF 檔案。');
  return { contentId:contentId,fileName:clean_(blob.getName())||clean_(content['標題'])||'教材.pdf',mimeType:'application/pdf',size:bytes.length,base64:Utilities.base64Encode(bytes) };
}

function makeId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

function isHttpUrl_(value) { return /^https?:\/\//i.test(clean_(value)); }
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy/MM/dd'); }

function trackingDataBundle_() {
  const data = dataBundle_();
  data.submissions = submissionRowsSnapshot_();
  return data;
}

function dataBundle_() {
  // 一般登入／學習畫面只需要學習紀錄；作業回傳在進入有作業的子課程時才另外載入。
  return {
    employees: rows_(APP.SHEETS.EMPLOYEES),
    assignments: rows_(APP.SHEETS.ASSIGNMENTS),
    packages: rows_(APP.SHEETS.PACKAGES),
    lessons: rows_(APP.SHEETS.LESSONS),
    contents: rows_(APP.SHEETS.CONTENT),
    progress: progressSnapshot_().rows
  };
}

function table_(sheetName, forceFresh) {
  const rt = runtime_();
  if (!forceFresh && rt.tables[sheetName]) return rt.tables[sheetName];
  if (!forceFresh && isStaticTable_(sheetName)) {
    const parsed = cacheJsonGet_(staticCacheKey_(sheetName));
    if (parsed && Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
      rt.tables[sheetName] = parsed;
      return parsed;
    }
  }
  const sheet = sheet_(sheetName);
  const lastRow = Math.max(1, sheet.getLastRow());
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = (values[0] || []).map(clean_);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i].some(v => clean_(v) !== '')) continue;
    const obj = { _row: i + 1 };
    headers.forEach((h, j) => obj[h] = values[i][j]);
    rows.push(obj);
  }
  const table = { headers: headers, rows: rows, lastRow: lastRow, lastColumn: lastColumn };
  rt.tables[sheetName] = table;
  cacheTable_(sheetName, table);
  return table;
}

function rows_(sheetName) {
  return table_(sheetName).rows;
}


function writeLoginLog_(employeeId, name, result) {
  appendRow_(APP.SHEETS.LOGIN_LOG, [now_(), employeeId, name, result]);
}
function safeWriteLoginLog_(employeeId, name, result) {
  // Keep login off the Sheet/Lock critical path. Execution logs retain diagnostics
  // without delaying authentication by several seconds.
  try { console.log('[LOGIN]', now_(), employeeId, name, result); } catch (e) {}
}

function appendRow_(sheetName, values) {
  const sheet = sheet_(sheetName);
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const rowNumber = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  } finally { lock.releaseLock(); }
  invalidateTable_(sheetName);
}


function sheet_(name) {
  const rt = runtime_();
  if (rt.sheets[name]) return rt.sheets[name];
  const sheet = db_().getSheetByName(name);
  if (!sheet) throw apiError_('SHEET_MISSING', '缺少工作表：' + name);
  rt.sheets[name] = sheet;
  return sheet;
}


function db_() {
  const rt = runtime_();
  if (!rt.ss) rt.ss = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
  return rt.ss;
}


function parseBody_(e) {
  try {
    const text = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    return JSON.parse(text || '{}');
  } catch (err) { throw apiError_('INVALID_JSON', '請求格式錯誤。'); }
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function apiError_(code, message) { const err = new Error(message); err.code = code; return err; }
function clean_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function number_(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function nullableNumber_(value) { const s = clean_(value); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
function now_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy/MM/dd HH:mm:ss'); }
function sessionKey_(token) { return 'learning-session-cache-' + token; }
function sessionPropKey_(token) { return APP.SESSION_PROP_PREFIX + token; }
function cleanupExpiredSessions_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const marker = Number(props.getProperty('learning-session-cleanup-at') || 0);
    const now = Date.now();
    if (now - marker < 3600000) return;
    props.setProperty('learning-session-cleanup-at', String(now));
    const all = props.getProperties();
    Object.keys(all).forEach(key => {
      if (key.indexOf(APP.SESSION_PROP_PREFIX) !== 0) return;
      try {
        const stored = JSON.parse(all[key]);
        if (!stored || !stored.expiresAt || Number(stored.expiresAt) <= now) props.deleteProperty(key);
      } catch (e) { props.deleteProperty(key); }
    });
  } catch (e) {}
}
