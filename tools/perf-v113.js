const fs = require('fs');
const path = 'app.js';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error('Missing patch target: ' + label);
  s = s.replace(from, to);
}

replaceOnce(
  "  const SYNC_INTERVAL_MS = 60000;\n  const VIEW_KEY = 'reserve_learning_v11_view';",
  "  const SYNC_INTERVAL_MS = 60000;\n  const SUBMISSION_CACHE_MS = 120000;\n  const VIEW_KEY = 'reserve_learning_v11_view';",
  'submission cache constant'
);

replaceOnce(
  "    selectedSubmissionFiles: [],\n    activeSubmission: null,\n    adminSubmissions: { items: [], config: null, rootFolderUrl: '' }",
  "    selectedSubmissionFiles: [],\n    activeSubmission: null,\n    submissionCache: new Map(),\n    submissionInflight: new Map(),\n    adminSubmissions: { items: [], config: null, rootFolderUrl: '' },\n    adminSubmissionsLoadedAt: 0",
  'submission cache state'
);

replaceOnce(
  "  async function loadStudentSubmission(lessonId) {\n    try {\n      const data = await api('getSubmission', { lessonId });\n      if (state.activeLessonId !== lessonId) return;\n      state.activeSubmission = data;\n      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };\n      renderStudentSubmission();\n    } catch (error) { showToast(error.message || '無法載入作業狀態'); }\n  }",
  `  function cacheStudentSubmission(lessonId, data) {\n    if (!lessonId || !data) return data;\n    state.submissionCache.set(lessonId, { data, savedAt: Date.now() });\n    return data;\n  }\n\n  function cachedStudentSubmission(lessonId) {\n    const entry = state.submissionCache.get(lessonId);\n    if (!entry) return null;\n    if (Date.now() - entry.savedAt > SUBMISSION_CACHE_MS) { state.submissionCache.delete(lessonId); return null; }\n    return entry.data;\n  }\n\n  function requestStudentSubmission(lessonId, force = false) {\n    if (!force) {\n      const cached = cachedStudentSubmission(lessonId);\n      if (cached) return Promise.resolve(cached);\n      const inflight = state.submissionInflight.get(lessonId);\n      if (inflight) return inflight;\n    }\n    const task = api('getSubmission', { lessonId })\n      .then(data => cacheStudentSubmission(lessonId, data))\n      .finally(() => state.submissionInflight.delete(lessonId));\n    state.submissionInflight.set(lessonId, task);\n    return task;\n  }\n\n  async function loadStudentSubmission(lessonId, force = false) {\n    try {\n      const cached = !force ? cachedStudentSubmission(lessonId) : null;\n      if (cached && state.activeLessonId === lessonId) {\n        state.activeSubmission = cached;\n        state.uploadConfig = { ...state.uploadConfig, ...(cached.config || {}) };\n        renderStudentSubmission();\n        return;\n      }\n      const data = await requestStudentSubmission(lessonId, force);\n      if (state.activeLessonId !== lessonId) return;\n      state.activeSubmission = data;\n      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };\n      renderStudentSubmission();\n    } catch (error) { showToast(error.message || '無法載入作業狀態'); }\n  }`,
  'loadStudentSubmission'
);

replaceOnce(
  "        state.activeSubmission = await api('uploadSubmissionFile', { lessonId: lesson.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileBase64: fileBase64Value }, state.token, { timeout: 60000 });",
  "        state.activeSubmission = cacheStudentSubmission(lesson.id, await api('uploadSubmissionFile', { lessonId: lesson.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileBase64: fileBase64Value }, state.token, { timeout: 60000 }));",
  'upload cache update'
);

replaceOnce(
  "    try { state.activeSubmission = await api('removeSubmissionFile', { lessonId: lesson.id, fileId }); renderStudentSubmission(); }",
  "    try { state.activeSubmission = cacheStudentSubmission(lesson.id, await api('removeSubmissionFile', { lessonId: lesson.id, fileId })); renderStudentSubmission(); }",
  'remove cache update'
);

replaceOnce(
  "    try { state.activeSubmission = await api('submitSubmission', { lessonId: lesson.id }); renderStudentSubmission(); showToast('已送出教育中心審核'); }",
  "    try { state.activeSubmission = cacheStudentSubmission(lesson.id, await api('submitSubmission', { lessonId: lesson.id })); renderStudentSubmission(); showToast('已送出教育中心審核'); }",
  'submit cache update'
);

replaceOnce(
  "  async function loadAdminSubmissions() {\n    const body = $('submissionAdminBody');\n    if (body) body.innerHTML = '<div class=\"empty-state\"><h3>載入作業資料中…</h3></div>';\n    try {\n      const data = await api('adminSubmissions');\n      state.adminSubmissions = data;\n      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };\n      renderAdminSubmissions();\n    } catch (error) { if (body) body.innerHTML = `<div class=\"empty-state\"><h3>${escapeHtml(error.message || '無法載入')}</h3></div>`; }\n  }",
  `  async function loadAdminSubmissions(force = false) {\n    const body = $('submissionAdminBody');\n    if (!force && state.adminSubmissionsLoadedAt && Date.now() - state.adminSubmissionsLoadedAt < 30000) {\n      renderAdminSubmissions();\n      return;\n    }\n    if (body) body.innerHTML = '<div class=\"empty-state\"><h3>載入作業資料中…</h3></div>';\n    try {\n      const data = await api('adminSubmissions');\n      state.adminSubmissions = data;\n      state.adminSubmissionsLoadedAt = Date.now();\n      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };\n      renderAdminSubmissions();\n    } catch (error) { if (body) body.innerHTML = \`<div class=\"empty-state\"><h3>\${escapeHtml(error.message || '無法載入')}</h3></div>\`; }\n  }`,
  'admin submissions cache'
);

replaceOnce(
  "      state.adminSubmissions = data;\n      state.overviewDirty = true;",
  "      state.adminSubmissions = data;\n      state.adminSubmissionsLoadedAt = Date.now();\n      state.overviewDirty = true;",
  'review cache timestamp'
);

replaceOnce(
  "    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] };",
  "    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt = 0;",
  'logout cache clear'
);

replaceOnce(
  "  async function init() {\n    loadFoldState();\n    bindStaticEvents();\n    await checkHealth();\n    const restored = await restoreSession();\n    if (!restored) { if ($('bootView')) $('bootView').hidden = true; $('loginView').hidden = false; $('dashboardView').hidden = true; }\n  }",
  `  async function init() {\n    loadFoldState();\n    bindStaticEvents();\n    const healthTask = checkHealth();\n    const restored = await restoreSession();\n    if (!restored) { if ($('bootView')) $('bootView').hidden = true; $('loginView').hidden = false; $('dashboardView').hidden = true; }\n    healthTask.catch(() => {});\n  }`,
  'parallel init'
);

fs.writeFileSync(path, s, 'utf8');
console.log('Patched app.js', Buffer.byteLength(s));
// trigger workflow after main registration
