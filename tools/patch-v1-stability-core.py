from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

def rep(old, new, label, count=1):
    global s
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'{label}: expected {count}, got {actual}')
    s = s.replace(old, new, count)

rep("const SYNC_INTERVAL_MS = 60000;", "const SYNC_INTERVAL_MS = 120000;\n  const IDLE_LOGOUT_MS = 15 * 60 * 1000;\n  const IDLE_WARNING_MS = 14 * 60 * 1000;\n  const IDLE_ACTIVITY_KEY = 'reserve_learning_v1_last_activity';", 'timing constants')

rep("""    adminSubmissionSearch: '',
    adminSubmissionStatus: '',
    adminSubmissionArea: ''
  };""", """    adminSubmissionSearch: '',
    adminSubmissionStatus: '',
    adminSubmissionArea: '',
    idleTimer: null,
    lastActivityAt: 0,
    lastActivityStoredAt: 0,
    idleWarned: false
  };""", 'idle state')

rep("""  function startConnectionMonitor() {
    if (state.healthCheckTimer) clearInterval(state.healthCheckTimer);
    state.healthCheckTimer = setInterval(() => {
      if (document.hidden) return;
      checkHealth({ quiet: true }).catch(() => {});
    }, 60000);
    window.addEventListener('online', () => checkHealth().catch(() => {}));
    window.addEventListener('offline', () => setModeBadge('offline', '裝置離線'));
  }
""", """  function startConnectionMonitor() {
    if (state.healthCheckTimer) { clearInterval(state.healthCheckTimer); state.healthCheckTimer = null; }
    window.addEventListener('online', () => setModeBadge('checking', state.token ? '網路已恢復' : '待登入'));
    window.addEventListener('offline', () => setModeBadge('offline', '裝置離線'));
  }
""", 'connection monitor')

marker = """  function clearSession() {
    [SESSION_KEY, ...LEGACY_SESSION_KEYS].forEach(key => sessionStorage.removeItem(key));
  }

"""
insert = """  function clearSession() {
    [SESSION_KEY, ...LEGACY_SESSION_KEYS].forEach(key => sessionStorage.removeItem(key));
  }

  function readLastActivity() {
    try { return Number(sessionStorage.getItem(IDLE_ACTIVITY_KEY) || 0); } catch { return 0; }
  }

  function clearLastActivity() {
    try { sessionStorage.removeItem(IDLE_ACTIVITY_KEY); } catch {}
    state.lastActivityAt = 0;
    state.lastActivityStoredAt = 0;
    state.idleWarned = false;
  }

  function recordActivity(force = false) {
    if (!state.token || !state.user) return;
    const now = Date.now();
    if (!force && now - state.lastActivityAt < 1000) return;
    state.lastActivityAt = now;
    state.idleWarned = false;
    if (force || now - state.lastActivityStoredAt >= 15000) {
      try { sessionStorage.setItem(IDLE_ACTIVITY_KEY, String(now)); } catch {}
      state.lastActivityStoredAt = now;
    }
  }

  function checkIdleNow() {
    if (!state.token || !state.user) return false;
    if (state.tracker && (state.tracker.playingVideos.size || state.tracker.visiblePdfs.size)) recordActivity();
    const base = state.lastActivityAt || readLastActivity() || Date.now();
    const idleMs = Date.now() - base;
    if (idleMs >= IDLE_LOGOUT_MS) {
      logout('idle');
      return true;
    }
    if (idleMs >= IDLE_WARNING_MS && !state.idleWarned) {
      state.idleWarned = true;
      showToast('已閒置 14 分鐘，1 分鐘後將自動登出');
    }
    return false;
  }

  function startIdleMonitor(reset = false) {
    if (state.idleTimer) clearInterval(state.idleTimer);
    if (reset || !readLastActivity()) recordActivity(true);
    else {
      state.lastActivityAt = readLastActivity();
      state.lastActivityStoredAt = state.lastActivityAt;
    }
    state.idleTimer = setInterval(checkIdleNow, 10000);
  }

  function stopIdleMonitor() {
    if (state.idleTimer) clearInterval(state.idleTimer);
    state.idleTimer = null;
  }

  function hydrationDelayMs() {
    if (state.user?.roleKey !== 'student') return 0;
    const value = clean(state.user?.employeeId);
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
    return hash % 1800;
  }

  function scheduleHydrateDashboardData() {
    const token = state.token;
    const delay = hydrationDelayMs();
    window.setTimeout(() => {
      if (!token || state.token !== token || !state.user) return;
      hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
    }, delay);
  }

"""
rep(marker, insert, 'idle helpers')

rep("""    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
    return true;
""", """    captureBootstrap(bootstrap);
    renderDashboard();
    recordActivity(true);
    startIdleMonitor(false);
    scheduleHydrateDashboardData();
    return true;
""", 'login hydrate')

rep("""        captureBootstrap(data);
        saveSession();
        renderDashboard();
        if (state.features.lazyDataV114 && state.user?.roleKey !== 'admin') ensureStudentPackages().catch(error => showToast(error.message || '課程資料稍後自動重試'));
        await restoreSavedView();
        hydrateDashboardData().catch(error => showToast(error.message || '資料稍後自動重試'));
        return true;
""", """        captureBootstrap(data);
        saveSession();
        renderDashboard();
        recordActivity(true);
        startIdleMonitor(false);
        await restoreSavedView();
        scheduleHydrateDashboardData();
        return true;
""", 'restore hydrate')

rep("""  function tickTracker() {
    const tracker = state.tracker;
    if (!tracker) return;
""", """  function tickTracker() {
    const tracker = state.tracker;
    if (!tracker) return;
    if (tracker.playingVideos.size || tracker.visiblePdfs.size) recordActivity();
""", 'tracker activity')

old_logout = """  function logout() {
    // FINAL4: invalidate any in-flight login/session restore before clearing UI.
    state.authGeneration += 1;
    const token = state.token;
    if (state.activeLessonId && !state.previewMode && state.tracker?.dirty) flushProgress(false).catch(() => {});
    stopTracker();
    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.submissionDeleteChains.clear(); state.selectedAdminContentFile = null; state.apiConnected = false; state.adminSubmissionsLoadedAt = 0; state.studentPackagesLoaded = false; state.adminCatalogLoaded = false; state.studentPackagesLoading = null; state.adminCatalogLoading = null; state.activePackageId = ''; state.activeLessonId = ''; state.previewMode = false; state.activeSubmission = null;
    clearSession();
    clearViewState();
    $('dashboardView').hidden = true; $('studentDashboard').hidden = true; $('adminDashboard').hidden = true; $('lessonPage').hidden = true; $('loginView').hidden = false; $('password').value = '';
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (token) api('logout', {}, token, { timeout: 10000 }).catch(() => {});
  }
"""
new_logout = """  function logout(reason = 'manual') {
    // V1.0 Stability Core: local idle logout stops all background/API activity after 15 minutes.
    state.authGeneration += 1;
    const token = state.token;
    if (state.activeLessonId && !state.previewMode && state.tracker?.dirty) flushProgress(false).catch(() => {});
    stopTracker();
    stopIdleMonitor();
    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.submissionDeleteChains.clear(); state.selectedAdminContentFile = null; state.apiConnected = false; state.adminSubmissionsLoadedAt = 0; state.studentPackagesLoaded = false; state.adminCatalogLoaded = false; state.studentPackagesLoading = null; state.adminCatalogLoading = null; state.activePackageId = ''; state.activeLessonId = ''; state.previewMode = false; state.activeSubmission = null;
    clearSession();
    clearViewState();
    clearLastActivity();
    $('dashboardView').hidden = true; $('studentDashboard').hidden = true; $('adminDashboard').hidden = true; $('lessonPage').hidden = true; $('loginView').hidden = false; $('password').value = '';
    const message = $('loginMessage');
    if (message) {
      if (reason === 'idle') { message.textContent = '已閒置 15 分鐘，為降低系統負擔已自動登出，請重新登入。'; message.hidden = false; }
      else if (reason === 'expired') { message.textContent = '登入已逾時，請重新登入。'; message.hidden = false; }
      else message.hidden = true;
    }
    setModeBadge(navigator.onLine === false ? 'offline' : 'checking', navigator.onLine === false ? '裝置離線' : '待登入');
    window.scrollTo({ top: 0, behavior: 'auto' });
    // Idle logout deliberately skips a backend logout request: clearing the client token
    // stops all future calls immediately and avoids creating a synchronized idle-logout spike.
    if (token && reason === 'manual') api('logout', {}, token, { timeout: 10000, retry: false }).catch(() => {});
  }
"""
rep(old_logout, new_logout, 'logout')

rep("$('logoutButton').onclick = logout;", "$('logoutButton').onclick = () => logout('manual');", 'logout binding')

old_events = """    $('adminSearch').oninput = renderAdminPeople;
    window.addEventListener('beforeunload', () => { saveViewState(); if (state.tracker?.dirty) flushProgress(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { saveViewState(); if (state.tracker?.dirty) flushProgress(false); } });
    let viewSaveTimer = 0;
    window.addEventListener('scroll', () => { clearTimeout(viewSaveTimer); viewSaveTimer = setTimeout(() => saveViewState(), 180); }, { passive: true });
"""
new_events = """    $('adminSearch').oninput = renderAdminPeople;
    ['pointerdown','keydown','touchstart'].forEach(name => document.addEventListener(name, () => recordActivity(), { passive: true }));
    window.addEventListener('focus', () => { if (!checkIdleNow()) recordActivity(); });
    window.addEventListener('pageshow', () => { if (!checkIdleNow()) recordActivity(); });
    window.addEventListener('beforeunload', () => { saveViewState(); if (state.tracker?.dirty) flushProgress(false); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { saveViewState(); if (state.tracker?.dirty) flushProgress(false); }
      else if (!checkIdleNow()) recordActivity();
    });
    let viewSaveTimer = 0;
    window.addEventListener('scroll', () => { recordActivity(); clearTimeout(viewSaveTimer); viewSaveTimer = setTimeout(() => saveViewState(), 180); }, { passive: true });
"""
rep(old_events, new_events, 'activity bindings')

old_init = """  async function init() {
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
"""
new_init = """  async function init() {
    loadFoldState();
    bindStaticEvents();
    startConnectionMonitor();
    setModeBadge(navigator.onLine === false ? 'offline' : 'checking', navigator.onLine === false ? '裝置離線' : '待登入');
    const saved = readSession();
    const lastActivity = readLastActivity();
    if (saved?.token && lastActivity && Date.now() - lastActivity >= IDLE_LOGOUT_MS) {
      clearSession();
      clearViewState();
      clearLastActivity();
    }
    const current = readSession();
    if (!current?.token) {
      if ($('bootView')) $('bootView').hidden = true;
      $('loginView').hidden = false;
      $('dashboardView').hidden = true;
      return;
    }

    const restoreTask = restoreSession();
"""
rep(old_init, new_init, 'init health removal')

rep("""    }
    healthTask.catch(() => {});
  }
""", """    }
  }
""", 'init trailing health')

p.write_text(s, encoding='utf-8')

ip = Path('index.html')
html = ip.read_text(encoding='utf-8')
html = html.replace('app.js?v=1.0-submission-review-20260914', 'app.js?v=1.0-stability-core-20260922', 1)
html = html.replace('<button id="loginButton" class="primary-button" type="submit">登入</button>', '<button id="loginButton" class="primary-button" type="submit">登入</button><p class="form-hint">登入後若 15 分鐘沒有操作會自動登出；觀看影片或閱讀 PDF 期間視為使用中。</p>', 1)
ip.write_text(html, encoding='utf-8')
