from pathlib import Path
import re

p = Path('app.js')
s = p.read_text(encoding='utf-8')

# State: connection diagnostics and timers.
s = s.replace(
"    apiConnected: false,\n    selectedAdminContentFile: null",
"    apiConnected: false,\n    connectionFailures: 0,\n    lastApiSuccessAt: 0,\n    healthCheckTimer: null,\n    sessionRestoreInFlight: null,\n    selectedAdminContentFile: null",
1)

# Replace API transport layer with connectivity-aware, safe retry behavior.
start = s.index('  async function api(action, payload = {}, token = state.token, options = {}) {')
end = s.index('\n  function setModeBadge', start)
api_block = r'''  const SAFE_RETRY_ACTIONS = new Set(['health','bootstrap','studentPackages','adminOverview','adminCatalog','getSubmission','adminSubmissions','getPdfContent','exportProgress']);

  function actionTimeout(action) {
    if (action === 'health') return 12000;
    if (action === 'bootstrap') return 12000;
    if (action === 'login') return 18000;
    if (['studentPackages','adminOverview','adminCatalog','getSubmission','adminSubmissions','exportProgress'].includes(action)) return 12000;
    return 20000;
  }

  function markConnectionSuccess(version = '') {
    state.apiConnected = true;
    state.connectionFailures = 0;
    state.lastApiSuccessAt = Date.now();
    setModeBadge('online', version ? `後端正常｜${version}` : '後端正常');
  }

  function isSessionExpiredError(error) {
    return /SESSION_EXPIRED|SESSION_REQUIRED/.test(error?.code || '') || /登入已逾時|請重新登入/.test(error?.message || '');
  }

  async function api(action, payload = {}, token = state.token, options = {}) {
    if (!configured()) throw new Error('尚未設定 Apps Script /exec 網址。');
    const retryable = options.retry === true || (options.retry !== false && SAFE_RETRY_ACTIONS.has(action));
    const attempts = retryable ? 2 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timeout = options.timeout || actionTimeout(action);
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(window.LEARNING_CONFIG.API_URL, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ action, payload: payload || {}, sessionToken: token || '' }),
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal
        });
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); }
        catch {
          const err = new Error('後端暫時回應異常，系統會自動重試。');
          err.code = 'NON_JSON_RESPONSE'; err.retryable = true; throw err;
        }
        // Any valid JSON response proves the Apps Script endpoint is reachable, even
        // when the business result is LOGIN_FAILED/validation error.
        markConnectionSuccess(action === 'health' ? clean(result?.data?.version) : '');
        if (!response.ok) { const err = new Error(result?.error?.message || '後端連線失敗。'); err.code = result?.error?.code || 'HTTP_ERROR'; err.retryable = response.status >= 500; throw err; }
        if (!result || result.success !== true) { const err = new Error(result?.error?.message || '後端處理失敗。'); err.code = result?.error?.code || 'SERVER_ERROR'; err.retryable = false; throw err; }
        return result.data;
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError') { const err = new Error('後端回應較慢，請稍候再試。'); err.code='TIMEOUT'; err.retryable=true; lastError=err; }
        else if (error instanceof TypeError && !error.code) { const err = new Error('目前網路連線不穩定，請稍候。'); err.code='NETWORK_ERROR'; err.retryable=true; lastError=err; }
        if (!retryable || isSessionExpiredError(lastError) || lastError.retryable === false || attempt === attempts - 1) throw lastError;
        await new Promise(resolve => setTimeout(resolve, 500 + attempt * 500));
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('連線失敗。');
  }
'''
s = s[:start] + api_block + s[end:]

# Replace health logic: warning before offline, background retry, no false red from a single cold start.
start = s.index('  async function checkHealth() {')
end = s.index('\n  function captureBootstrap', start)
health_block = r'''  async function checkHealth(options = {}) {
    if (!configured()) { setModeBadge('offline', '尚未設定'); return false; }
    if (navigator.onLine === false) { setModeBadge('offline', '裝置離線'); return false; }
    if (!state.apiConnected && !options.quiet) setModeBadge('checking', '正在連線…');
    try {
      const data = await api('health', {}, '', { retry: true, timeout: 12000 });
      const backendVersion = clean(data?.version);
      if (data?.features) state.features = { ...state.features, ...data.features };
      if (data?.ok) markConnectionSuccess(backendVersion);
      else setModeBadge('checking', '後端資料檢查中');
      return !!data?.ok;
    } catch (error) {
      state.connectionFailures += 1;
      const recentlyConnected = state.lastApiSuccessAt && Date.now() - state.lastApiSuccessAt < 60000;
      if (recentlyConnected) {
        setModeBadge('online', '後端正常');
      } else if (state.connectionFailures < 2) {
        setModeBadge('checking', '連線較慢｜自動重試');
      } else {
        setModeBadge('offline', '連線異常');
      }
      return false;
    }
  }

  function startConnectionMonitor() {
    if (state.healthCheckTimer) clearInterval(state.healthCheckTimer);
    state.healthCheckTimer = setInterval(() => {
      if (document.hidden) return;
      checkHealth({ quiet: true }).catch(() => {});
    }, 60000);
    window.addEventListener('online', () => checkHealth().catch(() => {}));
    window.addEventListener('offline', () => setModeBadge('offline', '裝置離線'));
  }
'''
s = s[:start] + health_block + s[end:]

# Replace session restore: only clear a truly expired session; transient Apps Script slowness preserves the token.
start = s.index('  async function restoreSession() {')
end = s.index('\n  async function restoreSavedView()', start)
restore_block = r'''  async function restoreSession() {
    const saved = readSession();
    if (!saved?.token) return false;
    if (state.sessionRestoreInFlight) return state.sessionRestoreInFlight;
    const restoreToken = saved.token;
    state.token = restoreToken;
    const task = (async () => {
      try {
        const data = await api('bootstrap', {}, restoreToken, { retry: true, timeout: 12000 });
        if (state.token !== restoreToken && state.user) return true;
        captureBootstrap(data);
        saveSession();
        renderDashboard();
        if (state.features.lazyDataV114 && state.user?.roleKey !== 'admin') {
          ensureStudentPackages().catch(error => showToast(error.message || '課程資料稍後自動重試'));
        }
        await restoreSavedView();
        hydrateDashboardData().catch(error => showToast(error.message || '資料稍後自動重試'));
        return true;
      } catch (error) {
        if (isSessionExpiredError(error)) {
          if (state.token === restoreToken) state.token = '';
          clearSession();
          clearViewState();
        } else {
          // Keep the saved session on timeout/network/temporary server errors. The
          // user may log in manually, or the next background restore can recover.
          state.token = restoreToken;
        }
        return false;
      } finally {
        state.sessionRestoreInFlight = null;
      }
    })();
    state.sessionRestoreInFlight = task;
    return task;
  }
'''
s = s[:start] + restore_block + s[end:]

# Read endpoints: allow one safe retry without changing write semantics.
s = s.replace("api('studentPackages', {}, state.token, { retry: false, timeout: 8000 })", "api('studentPackages', {}, state.token, { retry: true, timeout: 12000 })")
s = s.replace("api('adminCatalog', {}, state.token, { retry: false, timeout: 8000 })", "api('adminCatalog', {}, state.token, { retry: true, timeout: 12000 })")
s = s.replace("api('adminOverview', {}, state.token, { retry: false, timeout: 8000 })", "api('adminOverview', {}, state.token, { retry: true, timeout: 12000 })")

# User-facing login timeout wording: no need to refresh the page.
s = s.replace(
"      catch (error) { state.token = ''; clearSession(); $('loginMessage').textContent = error.message || '登入失敗'; $('loginMessage').hidden = false; }",
"      catch (error) { state.token = ''; if (isSessionExpiredError(error)) clearSession(); $('loginMessage').textContent = error?.code === 'TIMEOUT' ? '後端正在啟動或回應較慢，請稍候再按一次登入；不需要重新整理頁面。' : (error.message || '登入失敗'); $('loginMessage').hidden = false; }",
1)

# Init: do not hold the whole page behind a long health/bootstrap wait. Returning users get a short restore window, then the login UI remains usable while recovery continues.
start = s.index('  async function init() {')
end = s.index('\n  init();', start)
init_block = r'''  async function init() {
    loadFoldState();
    bindStaticEvents();
    startConnectionMonitor();
    const healthTask = checkHealth();
    const saved = readSession();
    if (!saved?.token) {
      if ($('bootView')) $('bootView').hidden = true;
      $('loginView').hidden = false;
      $('dashboardView').hidden = true;
      healthTask.catch(() => {});
      return;
    }

    const restoreTask = restoreSession();
    const fastResult = await Promise.race([
      restoreTask,
      new Promise(resolve => setTimeout(() => resolve(null), 2500))
    ]);
    if (fastResult !== true && !state.user) {
      if ($('bootView')) $('bootView').hidden = true;
      $('loginView').hidden = false;
      $('dashboardView').hidden = true;
    }
    if (fastResult === null) {
      restoreTask.then(ok => {
        if (!ok && !state.user) {
          $('loginView').hidden = false;
          $('dashboardView').hidden = true;
        }
      }).catch(() => {});
    }
    healthTask.catch(() => {});
  }
'''
s = s[:start] + init_block + s[end:]

p.write_text(s, encoding='utf-8')
print('patched FINAL4 connectivity', len(s.encode('utf-8')), 'bytes')
