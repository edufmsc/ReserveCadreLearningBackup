(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const VERSION = 'V1.1.4';
  const SESSION_KEY = 'reserve_learning_v11_session';
  const LEGACY_SESSION_KEYS = ['reserve_cadre_stage4_2_session', 'learning_backup_v1_session'];
  const SYNC_INTERVAL_MS = 60000;
  const SUBMISSION_CACHE_MS = 120000;
  const VIEW_KEY = 'reserve_learning_v11_view';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const state = {
    token: '',
    user: null,
    mode: '',
    features: {},
    uploadConfig: { enabled: false, maxMb: 20, maxFilesPerBatch: 10, maxFilesPerSubmission: 20, allowedExtensions: [] },
    packages: [],
    adminOverview: [],
    adminCatalog: { packages: [], learners: [], assignments: [] },
    overviewDirty: false,
    activePackageId: '',
    activeLessonId: '',
    previewMode: false,
    tracker: null,
    youtubePlayers: new Map(),
    youtubeApiPromise: null,
    pdfJsPromise: null,
    pdfCache: new Map(),
    mediaObserver: null,
    adminTab: 'people',
    studentTab: 'courses',
    manageOpenPackages: new Set(),
    manageOpenLessons: new Set(),
    selectedSubmissionFiles: [],
    activeSubmission: null,
    submissionCache: new Map(),
    submissionInflight: new Map(),
    adminSubmissions: { items: [], config: null, rootFolderUrl: '' },
    adminSubmissionsLoadedAt: 0,
    studentPackagesLoaded: false,
    adminCatalogLoaded: false,
    studentPackagesLoading: null,
    adminCatalogLoading: null
  };

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const clean = value => String(value ?? '').trim();
  const normalize = value => clean(value).toLowerCase();

  function configured() {
    return !!(window.LEARNING_CONFIG && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(clean(window.LEARNING_CONFIG.API_URL)));
  }

  async function api(action, payload = {}, token = state.token, options = {}) {
    if (!configured()) throw new Error('尚未設定 Apps Script /exec 網址。');
    const retryable = options.retry === true || ['health', 'bootstrap', 'adminOverview', 'studentPackages', 'adminCatalog'].includes(action);
    const attempts = retryable ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
        const response = await fetch(window.LEARNING_CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ action, payload: payload || {}, sessionToken: token || '' }),
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
        clearTimeout(timer);
        const result = await response.json();
        if (!result || result.success !== true) {
          const err = new Error(result?.error?.message || '後端處理失敗。');
          err.code = result?.error?.code || 'SERVER_ERROR';
          throw err;
        }
        return result.data;
      } catch (error) {
        lastError = error;
        const sessionExpired = /SESSION_EXPIRED|SESSION_REQUIRED/.test(error.code || '') || /登入已逾時|請重新登入/.test(error.message || '');
        if (!retryable || sessionExpired || attempt === attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error('連線失敗。');
  }

  function setModeBadge(mode, text) {
    const el = $('modeBadge');
    if (!el) return;
    el.className = `status-badge status-badge--${mode}`;
    el.textContent = text;
  }

  function showToast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  function setButtonBusy(button, busy, busyText = '處理中…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function formatSeconds(seconds = 0) {
    const s = Math.max(0, Math.floor(n(seconds)));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return `${h}時${String(m).padStart(2, '0')}分`;
    if (m) return `${m}分${String(sec).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function formatDateTime(value) {
    const text = clean(value);
    if (!text) return '—';
    if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.slice(0, 16);
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return text;
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  }

  function packageDueText(pkg) {
    const raw = clean(pkg?.dueAt);
    if (!raw) return '';
    return raw.slice(0, 10).replace(/-/g, '/');
  }

  function packageIsOverdue(pkg) {
    if (!pkg || packageSummary(pkg).status === 'complete') return false;
    const raw = clean(pkg.dueAt);
    if (!raw) return false;
    const normalized = raw.slice(0, 10).replace(/\\/g, '-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    const end = new Date(normalized + 'T23:59:59');
    return !Number.isNaN(end.getTime()) && Date.now() > end.getTime();
  }

  function statusLabel(status) {
    return status === 'complete' ? '已完成' : status === 'in_progress' ? '進行中' : '未開始';
  }

  function statusTag(status) {
    const cls = status === 'complete' ? 'tag--success' : status === 'in_progress' ? 'tag--warning' : 'tag--muted';
    return `<span class="tag ${cls}">${statusLabel(status)}</span>`;
  }

  function packageSummary(pkg) {
    if (pkg?.forcedComplete) return { done: n(pkg.requiredDone), total: n(pkg.requiredTotal), percent: 100, status: 'complete', forced: true };
    if (Number.isFinite(Number(pkg.requiredTotal)) && Number.isFinite(Number(pkg.requiredDone))) {
      return { done: n(pkg.requiredDone), total: n(pkg.requiredTotal), percent: n(pkg.percent), status: pkg.status || 'not_started', forced: false };
    }
    const required = (pkg.lessons || []).filter(l => l.required !== false);
    const completed = required.filter(l => l.status === 'complete').length;
    const anyRule = pkg?.completionRule === '任一必修子課程完成';
    const done = anyRule ? (completed ? 1 : 0) : completed;
    const total = anyRule ? (required.length ? 1 : 0) : required.length;
    const percent = total ? Math.round(done * 100 / total) : 0;
    const status = total && done === total ? 'complete' : completed || required.some(l => l.status === 'in_progress') ? 'in_progress' : 'not_started';
    return { done, total, percent, status, forced: false };
  }

  function contentTypeLabel(type) {
    return ({ VIDEO: '影片', PDF: 'PDF', FILE: '下載檔', TEXT: '文字' })[clean(type).toUpperCase()] || clean(type) || '教材';
  }

  function contentTypes(lesson) {
    const types = [...new Set((lesson.contents || []).filter(c => c.enabled !== false).map(c => contentTypeLabel(c.type)))];
    return types.join('＋') || '教材';
  }

  function visibleLessonTitle(lesson) {
    return lesson?.title === '__PACKAGE_DIRECT__' ? '課程教材' : (lesson?.title || '子課程');
  }

  function youtubeId(url) {
    const raw = clean(url);
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || '';
      if (u.searchParams.get('v')) return u.searchParams.get('v') || '';
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex(x => ['embed', 'shorts', 'live'].includes(x));
      return idx >= 0 ? parts[idx + 1] || '' : '';
    } catch { return ''; }
  }

  function isDriveUrl(url) {
    return /(?:drive|docs)\.google\.com/i.test(clean(url));
  }



  function googleFileId(url) {
    const raw = clean(url);
    let m = raw.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
    if (!m) m = raw.match(/[?&]id=([^&#]+)/i);
    if (!m) m = raw.match(/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([^/?#]+)/i);
    return m ? m[1] : '';
  }

  function drivePreviewUrl(url) {
    const id = googleFileId(url);
    return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview?embedded=true` : clean(url);
  }

  function directDownloadUrl(url) {
    const raw = clean(url);
    let m = raw.match(/docs\.google\.com\/document\/d\/([^/?#]+)/i);
    if (m) return `https://docs.google.com/document/d/${encodeURIComponent(m[1])}/export?format=docx`;
    m = raw.match(/docs\.google\.com\/spreadsheets\/d\/([^/?#]+)/i);
    if (m) return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(m[1])}/export?format=xlsx`;
    m = raw.match(/docs\.google\.com\/presentation\/d\/([^/?#]+)/i);
    if (m) return `https://docs.google.com/presentation/d/${encodeURIComponent(m[1])}/export/pptx`;
    const id = googleFileId(raw);
    return id ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t` : raw;
  }

  function saveViewState(overrides = {}) {
    if (!state.token || !state.user) return;
    const lessonVisible = $('lessonPage') && !$('lessonPage').hidden;
    const view = lessonVisible ? 'lesson' : state.user.roleKey === 'admin' ? 'admin' : 'student';
    const value = {
      view,
      activePackageId: state.activePackageId || '',
      activeLessonId: state.activeLessonId || '',
      adminTab: state.adminTab || 'people',
      studentTab: state.studentTab || 'courses',
      scrollY: Math.max(0, Math.round(window.scrollY || 0)),
      savedAt: Date.now(),
      ...overrides
    };
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(value)); } catch {}
  }

  function readViewState() {
    try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); } catch { return null; }
  }

  function clearViewState() {
    try { sessionStorage.removeItem(VIEW_KEY); } catch {}
  }

  function restoreScroll(value) {
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, n(value)), behavior: 'auto' })));
  }

  function saveSession() {
    if (!state.token) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token }));
    LEGACY_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
  }

  function readSession() {
    const keys = [SESSION_KEY, ...LEGACY_SESSION_KEYS];
    for (const key of keys) {
      try {
        const value = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (value?.token) return value;
      } catch {}
    }
    return null;
  }

  function clearSession() {
    [SESSION_KEY, ...LEGACY_SESSION_KEYS].forEach(key => sessionStorage.removeItem(key));
  }

  function saveFoldState() {
    try {
      sessionStorage.setItem('reserve_learning_v11_folds', JSON.stringify({
        packages: [...state.manageOpenPackages], lessons: [...state.manageOpenLessons]
      }));
    } catch {}
  }

  function loadFoldState() {
    try {
      const data = JSON.parse(sessionStorage.getItem('reserve_learning_v11_folds') || '{}');
      state.manageOpenPackages = new Set(Array.isArray(data.packages) ? data.packages : []);
      state.manageOpenLessons = new Set(Array.isArray(data.lessons) ? data.lessons : []);
    } catch {}
  }

  async function checkHealth() {
    if (!configured()) { setModeBadge('offline', '尚未設定'); return false; }
    try {
      const data = await api('health', {}, '', { retry: true, timeout: 15000 });
      const backendVersion = clean(data?.version);
      if (data?.ok && backendVersion && backendVersion !== VERSION) setModeBadge('checking', `後端 ${backendVersion}｜待更新`);
      else setModeBadge(data?.ok ? 'online' : 'offline', data?.ok ? '後端正常' : '資料異常');
      if (data?.features) state.features = { ...state.features, ...data.features };
      return !!data?.ok;
    } catch {
      setModeBadge('offline', '連線異常');
      return false;
    }
  }

  function captureBootstrap(data) {
    state.user = data.user || state.user || null;
    state.mode = data.mode || state.mode || '';
    state.features = { ...state.features, ...(data.features || {}) };
    state.uploadConfig = { ...state.uploadConfig, ...(data.uploadConfig || {}) };
    if (data.mode === 'admin') {
      const hasOverview = Array.isArray(data.overview);
      const hasCatalog = !!data.catalog;
      state.adminOverview = hasOverview ? data.overview : [];
      state.adminCatalog = hasCatalog ? data.catalog : { packages: [], learners: [], assignments: [] };
      state.overviewDirty = !hasOverview;
      state.adminCatalogLoaded = hasCatalog;
      state.packages = [];
      state.studentPackagesLoaded = false;
    } else {
      const hasPackages = Array.isArray(data.packages);
      state.packages = hasPackages ? data.packages : [];
      state.studentPackagesLoaded = hasPackages;
      state.adminOverview = [];
      state.adminCatalog = { packages: [], learners: [], assignments: [] };
      state.overviewDirty = false;
      state.adminCatalogLoaded = false;
    }
  }

  async function ensureStudentPackages(force = false) {
    if (state.user?.roleKey === 'admin') return;
    if (!force && state.studentPackagesLoaded) return;
    if (state.studentPackagesLoading) return state.studentPackagesLoading;
    const task = api('studentPackages', {}, state.token, { retry: true })
      .then(data => {
        const packages = Array.isArray(data) ? data : (Array.isArray(data?.packages) ? data.packages : []);
        state.packages = packages;
        state.studentPackagesLoaded = true;
        renderStudent();
        return packages;
      })
      .finally(() => { state.studentPackagesLoading = null; });
    state.studentPackagesLoading = task;
    return task;
  }

  async function ensureAdminCatalog(force = false) {
    if (state.user?.roleKey !== 'admin') return;
    if (!force && state.adminCatalogLoaded) return;
    if (state.adminCatalogLoading) return state.adminCatalogLoading;
    const task = api('adminCatalog', {}, state.token, { retry: true })
      .then(data => {
        const catalog = data?.catalog || data;
        state.adminCatalog = catalog || { packages: [], learners: [], assignments: [] };
        state.adminCatalogLoaded = true;
        if (state.adminTab === 'manage') renderAdminManage();
        return state.adminCatalog;
      })
      .finally(() => { state.adminCatalogLoading = null; });
    state.adminCatalogLoading = task;
    return task;
  }

  function hydrateDashboardData() {
    if (!state.features.lazyDataV114 || !state.user) return Promise.resolve();
    if (state.user.roleKey === 'admin') {
      if (state.adminTab === 'manage') return ensureAdminCatalog();
      if (state.adminTab === 'submissions') return loadAdminSubmissions();
      return ensureAdminOverview();
    }
    return ensureStudentPackages();
  }

  async function login(account, password) {
    clearViewState();
    const data = await api('login', { employeeId: account, password }, '', { timeout: 25000 });
    state.token = data.sessionToken;
    saveSession();
    const bootstrap = data.bootstrap || await api('bootstrap', {}, state.token, { retry: true });
    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
  }

  async function restoreSession() {
    const saved = readSession();
    if (!saved?.token) return false;
    state.token = saved.token;
    try {
      const data = await api('bootstrap', {}, state.token, { retry: true });
      captureBootstrap(data);
      saveSession();
      renderDashboard();
      if (state.features.lazyDataV114 && state.user?.roleKey !== 'admin') {
        try { await ensureStudentPackages(); } catch (error) { showToast(error.message || '課程載入失敗'); }
      }
      await restoreSavedView();
      hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
      return true;
    } catch (error) {
      const expired = /SESSION_EXPIRED|SESSION_REQUIRED/.test(error.code || '') || /登入已逾時|請重新登入/.test(error.message || '');
      if (expired) {
        state.token = '';
        clearSession();
        clearViewState();
      }
      return false;
    }
  }

  async function restoreSavedView() {
    const saved = readViewState();
    if (!saved || !state.user) return;
    if (state.user.roleKey === 'admin') {
      const tab = ['people','courses','manage','submissions'].includes(saved.adminTab) ? saved.adminTab : 'people';
      state.adminTab = tab;
      await setAdminTab(tab, false, false);
      restoreScroll(saved.scrollY);
      return;
    }
    state.studentTab = saved.studentTab === 'records' ? 'records' : 'courses';
    if (saved.view === 'lesson' && saved.activePackageId && saved.activeLessonId) {
      const found = findStudentLesson(saved.activePackageId, saved.activeLessonId);
      if (found.pkg && found.lesson) {
        state.activePackageId = saved.activePackageId;
        state.activeLessonId = saved.activeLessonId;
        state.previewMode = false;
        state.activeSubmission = null;
        startTracker();
        renderLessonPage();
        if (found.lesson.submissionMode && found.lesson.submissionMode !== '不需要' && state.features.submissions) loadStudentSubmission(found.lesson.id);
        restoreScroll(saved.scrollY);
        return;
      }
    }
    setStudentTab(state.studentTab, false);
    restoreScroll(saved.scrollY);
  }

  function renderDashboard() {
    if ($('bootView')) $('bootView').hidden = true;
    $('loginView').hidden = true;
    $('dashboardView').hidden = false;
    $('lessonPage').hidden = true;
    $('userName').textContent = state.user?.name || '—';
    $('userRole').textContent = state.user?.role || '—';
    $('userMeta').textContent = `${state.user?.employeeId || '—'}｜${state.user?.area || '—'}｜${state.user?.store || '—'}`;
    if (state.user?.roleKey === 'admin') {
      $('studentDashboard').hidden = true;
      $('adminDashboard').hidden = false;
      ensureSubmissionTab();
      renderAdmin();
      setAdminTab(state.adminTab || 'people', false);
    } else {
      $('studentDashboard').hidden = false;
      $('adminDashboard').hidden = true;
      renderStudent();
    }
  }

  function renderStudent() {
    let total = 0, done = 0;
    state.packages.forEach(pkg => { const s = packageSummary(pkg); total += s.total; done += s.done; });
    const complete = state.packages.filter(pkg => packageSummary(pkg).status === 'complete').length;
    $('studentSummary').innerHTML = `
      <article class="summary-card"><span>課程</span><strong>${state.packages.length}</strong></article>
      <article class="summary-card"><span>必修完成</span><strong>${done}/${total}</strong></article>
      <article class="summary-card"><span>課程完成</span><strong>${complete}/${state.packages.length}</strong></article>`;
    $('packageList').innerHTML = state.packages.length ? state.packages.map(renderPackageCard).join('') : (state.features.lazyDataV114 && !state.studentPackagesLoaded ? '<div class="empty-state"><h3>正在載入課程…</h3></div>' : '<div class="empty-state"><h3>目前沒有指派課程</h3></div>');
    bindStudentPackageEvents();
    renderStudentRecords();
  }

  function renderPackageCard(pkg) {
    const summary = packageSummary(pkg);
    const overdue = packageIsOverdue(pkg);
    const dueText = packageDueText(pkg);
    const lessons = pkg.lessons || [];
    const next = lessons.find(l => l.status !== 'complete') || lessons[0];
    const rows = lessons.map((lesson, index) => `
      <div class="lesson-row ${lesson.status === 'complete' ? 'is-complete' : ''}">
        <div class="lesson-number">${lesson.status === 'complete' ? '✓' : index + 1}</div>
        <div class="lesson-info"><strong>${escapeHtml(visibleLessonTitle(lesson))}</strong><small>${escapeHtml(contentTypes(lesson))}${n(lesson.videoSeconds) + n(lesson.pdfSeconds) > 0 ? `｜累積 ${formatSeconds(n(lesson.videoSeconds) + n(lesson.pdfSeconds))}` : ''}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}</small></div>
        <div class="lesson-status">${statusTag(lesson.status)}<button class="course-open-button" type="button" data-open-lesson="${escapeHtml(lesson.id)}" data-package-id="${escapeHtml(pkg.id)}">${lesson.status === 'not_started' ? '開始' : '查看'}</button></div>
      </div>`).join('');
    return `<article class="package-card">
      <div class="package-header"><div class="package-topline"><div><p class="step-label">課程</p><h3 class="package-title">${escapeHtml(pkg.title)}</h3><p class="package-meta">${escapeHtml(pkg.description || '')}${pkg.completionRule === '任一必修子課程完成' ? '｜完成其中 1 個必修子課程即可' : ''}${dueText ? `｜截止 ${escapeHtml(dueText)}` : ''}${overdue ? '｜已逾期，仍可繼續完成' : ''}</p></div><div class="package-status-stack">${overdue ? '<span class="tag tag--danger">已逾期</span>' : ''}${statusTag(summary.status)}</div></div>
      <div class="progress-line"><span style="width:${summary.percent}%"></span></div><div class="progress-meta"><span>${summary.done} / ${summary.total} 個必修項目完成</span><strong>${summary.percent}%</strong></div>
      <div class="package-actions"><button class="secondary-button" type="button" data-toggle-package="${escapeHtml(pkg.id)}">展開子項目</button>${next ? `<button class="primary-button" type="button" data-open-lesson="${escapeHtml(next.id)}" data-package-id="${escapeHtml(pkg.id)}">${summary.status === 'complete' ? '再次查看' : '繼續學習'}</button>` : ''}</div></div>
      <div class="lesson-list" data-package-lessons="${escapeHtml(pkg.id)}" hidden>${rows}</div></article>`;
  }

  function bindStudentPackageEvents() {
    document.querySelectorAll('[data-toggle-package]').forEach(button => {
      button.onclick = () => {
        const list = document.querySelector(`[data-package-lessons="${CSS.escape(button.dataset.togglePackage)}"]`);
        if (!list) return;
        list.hidden = !list.hidden;
        button.textContent = list.hidden ? '展開子項目' : '收合子項目';
      };
    });
    document.querySelectorAll('[data-open-lesson]').forEach(button => {
      button.onclick = () => openLesson(button.dataset.packageId, button.dataset.openLesson);
    });
  }

  function renderStudentRecords() {
    const records = [];
    state.packages.forEach(pkg => (pkg.lessons || []).forEach(lesson => records.push({ pkg, lesson })));
    $('studentRecordsList').innerHTML = records.length ? records.map(({ pkg, lesson }) => `
      <article class="record-card"><div class="record-card__top"><div><strong>${escapeHtml(visibleLessonTitle(lesson))}</strong><p class="package-meta">${escapeHtml(pkg.title)}</p></div>${statusTag(lesson.status)}</div>
      <div class="record-grid"><div><span>影片觀看</span><strong>${n(lesson.videoSeconds) ? formatSeconds(lesson.videoSeconds) : '—'}</strong></div><div><span>PDF閱讀</span><strong>${n(lesson.pdfSeconds) ? formatSeconds(lesson.pdfSeconds) : '—'}</strong></div><div><span>課程狀態</span><strong>${statusLabel(lesson.status)}</strong></div><div><span>完成時間</span><strong>${formatDateTime(lesson.completedAt)}</strong></div></div></article>`).join('') : '<div class="empty-state"><h3>目前沒有學習紀錄</h3></div>';
  }

  function findStudentLesson(packageId, lessonId) {
    const pkg = state.packages.find(x => x.id === packageId);
    return { pkg, lesson: pkg?.lessons?.find(x => x.id === lessonId) || null };
  }

  async function openLesson(packageId, lessonId) {
    let { pkg, lesson } = findStudentLesson(packageId, lessonId);
    if (!pkg || !lesson) return;
    state.activePackageId = packageId;
    state.activeLessonId = lessonId;
    state.previewMode = false;
    state.activeSubmission = null;
    state.selectedSubmissionFiles = [];

    if (lesson.status === 'not_started') {
      lesson.status = 'in_progress';
      renderStudent();
      api('saveProgress', { lessonId: lesson.id, contentProgress: lesson.contentProgress || {} }).then(packages => {
        if (Array.isArray(packages)) state.packages = packages;
      }).catch(error => showToast(error.message || '開始紀錄寫入失敗'));
    }
    startTracker();
    renderLessonPage();
    saveViewState({ view: 'lesson', activePackageId: packageId, activeLessonId: lessonId, scrollY: 0 });
    if (lesson.submissionMode && lesson.submissionMode !== '不需要' && state.features.submissions) {
      loadStudentSubmission(lesson.id);
    }
  }

  function openAdminPreview(pkg) {
    const lessons = (pkg?.lessons || []).filter(l => l.enabled !== false && (l.title !== '__PACKAGE_DIRECT__' || (l.contents || []).some(c => c.enabled !== false)));
    const lesson = lessons[0];
    if (!lesson) { showToast('此課程尚未建立可預覽的教材'); return; }
    state.previewMode = true;
    state.activePackageId = pkg.id;
    state.activeLessonId = lesson.id;
    state.activeSubmission = null;
    renderLessonPage(true);
  }

  function activeLesson() {
    if (state.previewMode) {
      const pkg = findCatalogPackage(state.activePackageId);
      const lesson = pkg?.lessons?.find(l => l.id === state.activeLessonId);
      return { pkg, lesson };
    }
    return findStudentLesson(state.activePackageId, state.activeLessonId);
  }

  function buildCriteria(lesson) {
    const required = lesson.videoPassPercent != null;
    if (!required) return '<div class="criteria-panel"><strong>完成條件</strong><div class="criteria-list"><span class="criteria-item is-pass">✓ 無額外閱讀門檻，完成後按「完成此子課程」</span></div></div>';
    const percent = n(lesson.criteria?.videoPercent);
    const passed = !!lesson.criteria?.videoPassed;
    return `<div class="criteria-panel"><strong>完成條件</strong><div class="criteria-list"><span class="criteria-item ${passed ? 'is-pass' : ''}">${passed ? '✓' : '○'} 影片 ${Math.min(100, Math.round(percent))}% / ${n(lesson.videoPassPercent)}%</span></div></div>`;
  }

  function renderLessonPage(preview = false) {
    const { pkg, lesson } = activeLesson();
    if (!pkg || !lesson) return;
    $('studentDashboard').hidden = true;
    $('adminDashboard').hidden = true;
    $('lessonPage').hidden = false;
    $('lessonPackageName').textContent = pkg.title;
    $('lessonTitle').textContent = visibleLessonTitle(lesson);
    $('lessonMeta').innerHTML = (preview ? '<div class="preview-banner">學員視角預覽｜不會寫入學習紀錄</div>' : '') + `<span class="tag">${escapeHtml(contentTypes(lesson))}</span><span class="tag ${lesson.required ? 'tag--warning' : 'tag--muted'}">${lesson.required ? '必修' : '選修'}</span>`;
    const contents = (lesson.contents || []).filter(c => c.enabled !== false);
    $('lessonContent').innerHTML = buildCriteria(lesson) + (contents.length ? contents.map(renderContentBlock).join('') : '<div class="content-placeholder">尚未設定教材</div>');
    updateLessonFooter(lesson, preview);
    bindLessonMedia();
    bindDownloadButtons();
    if (!preview && lesson.submissionMode && lesson.submissionMode !== '不需要' && state.features.submissions) renderStudentSubmissionShell(lesson);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function trackerProgress(item) {
    const lesson = activeLesson().lesson;
    const progress = state.tracker?.contentProgress || lesson?.contentProgress || {};
    return progress[item.id] || {};
  }

  function renderContentBlock(item) {
    const type = clean(item.type).toUpperCase();
    const title = escapeHtml(item.title || '教材');
    const url = clean(item.url);
    const progress = trackerProgress(item);
    if (type === 'TEXT') return `<article class="content-block"><h3>${title}</h3><div class="text-material">${escapeHtml(item.text || '').replace(/\n/g, '<br>')}</div></article>`;
    if (type === 'FILE') return `<article class="content-block"><h3>${title}</h3>${url ? `<div class="download-card"><div><strong>${title}</strong><span>按下後直接下載，不會跳到 Google Drive 頁面</span></div><button class="primary-button primary-button--fit" type="button" data-direct-download="${escapeHtml(url)}">下載檔案</button></div>` : '<div class="content-placeholder">下載檔尚未設定</div>'}</article>`;
    if (type === 'VIDEO') {
      const id = youtubeId(url);
      if (!id) return `<article class="content-block"><h3>${title}</h3><div class="content-placeholder">影片連結格式不正確</div></article>`;
      return `<article class="content-block video-content" data-media-block data-content-id="${escapeHtml(item.id)}" data-media-type="VIDEO" data-youtube-id="${escapeHtml(id)}"><h3>${title}</h3><div class="video-player"><div class="video-player__target" id="video_${escapeHtml(item.id)}"><div class="media-lazy-placeholder"><div><strong>影片尚未載入</strong><span>滑到此處才載入播放器</span></div></div></div></div><div class="pdf-status-line"><span>觀看：<strong data-video-time="${escapeHtml(item.id)}">${formatSeconds(progress.seconds || 0)}</strong></span></div></article>`;
    }
    if (type === 'PDF') {
      if (!url) return `<article class="content-block"><h3>${title}</h3><div class="content-placeholder">PDF 尚未設定</div></article>`;
      return `<article class="content-block pdf-content" data-media-block data-content-id="${escapeHtml(item.id)}" data-media-type="PDF" data-pdf-url="${escapeHtml(url)}"><h3>${title}</h3><div class="pdf-embed-shell" data-pdf-host="${escapeHtml(item.id)}"><div class="pdf-loading">正在載入 PDF…</div></div><div class="pdf-status-line"><span>閱讀：<strong data-pdf-time="${escapeHtml(item.id)}">${formatSeconds(progress.seconds || 0)}</strong></span></div></article>`;
    }
    return '';
  }


  function nextLessonFor(pkg, lesson) {
    const lessons = (pkg?.lessons || []).filter(x => x.enabled !== false);
    const index = lessons.findIndex(x => x.id === lesson?.id);
    return index >= 0 ? (lessons[index + 1] || null) : null;
  }

  function updateLessonFooter(lesson, preview = false) {
    const back = $('lessonBackBottomButton'), complete = $('completeLessonButton'), next = $('nextLessonButton');
    if (back) { back.hidden = false; back.textContent = preview ? '← 返回課程管理' : '← 返回課程'; }
    if (!complete || !next) return;
    if (preview) { complete.hidden = true; next.hidden = true; return; }
    const { pkg } = activeLesson();
    const following = nextLessonFor(pkg, lesson);
    if (lesson.status === 'complete') {
      complete.hidden = true;
      next.hidden = !following;
      next.textContent = following ? `繼續下一個：${visibleLessonTitle(following)} →` : '已完成本課程最後一項';
    } else {
      complete.hidden = false;
      complete.disabled = false;
      complete.textContent = '完成此子課程';
      next.hidden = true;
    }
  }

  async function goNextLesson() {
    if (state.previewMode) { closeLesson(false); return; }
    const { pkg, lesson } = activeLesson();
    const next = nextLessonFor(pkg, lesson);
    if (!next) { closeLesson(false); return; }
    if (state.tracker?.dirty) flushProgress(false).catch(() => {});
    stopTracker();
    await openLesson(pkg.id, next.id);
  }

  function bindDownloadButtons() {
    document.querySelectorAll('[data-direct-download]').forEach(button => {
      button.onclick = () => {
        const raw = clean(button.dataset.directDownload);
        if (!raw) return;
        const url = directDownloadUrl(raw);
        saveViewState();
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 1000);
        showToast('已開始下載檔案');
      };
    });
  }

  function loadPdfJs() {
    if (window.pdfjsLib?.getDocument) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return Promise.resolve(window.pdfjsLib);
    }
    if (state.pdfJsPromise) return state.pdfJsPromise;
    state.pdfJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDFJS_URL;
      script.async = true;
      script.onload = () => {
        if (!window.pdfjsLib?.getDocument) { reject(new Error('PDF 閱讀器載入失敗')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('PDF 閱讀器載入失敗'));
      document.head.appendChild(script);
    });
    return state.pdfJsPromise;
  }

  function base64Bytes(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function mountPdf(block) {
    if (!block || block.dataset.loaded === '1') return;
    block.dataset.loaded = '1';
    const contentId = block.dataset.contentId;
    const pdfUrl = clean(block.dataset.pdfUrl);
    const host = block.querySelector('[data-pdf-host]');
    if (!host) return;
    host.oncontextmenu = event => event.preventDefault();
    try {
      // V1.1.4: 所有 PDF 都走自有 PDF.js 閱讀器，不再嵌入 Google Drive 預覽器。
      // 這樣可移除 Drive 自帶的「彈出式視窗」控制項，且手機/電腦閱讀介面一致。
      host.classList.remove('pdf-drive-shell');
      let data = state.pdfCache.get(contentId);
      if (!data) {
        data = await api('getPdfContent', { contentId }, state.token, { timeout: 60000 });
        state.pdfCache.set(contentId, data);
      }
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: base64Bytes(data.base64) }).promise;
      host.innerHTML = '<div class="pdf-canvas-stack"></div>';
      const stack = host.firstElementChild;
      const available = Math.max(280, host.clientWidth - 28);
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = Math.min(2, available / baseViewport.width);
        const pixelRatio = Math.min(window.innerWidth <= 760 ? 1.25 : 1.6, Math.max(1, window.devicePixelRatio || 1));
        const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
        const cssWidth = Math.max(1, Math.floor(baseViewport.width * cssScale));
        const cssHeight = Math.max(1, Math.floor(baseViewport.height * cssScale));
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        const label = document.createElement('div');
        label.className = 'pdf-page-label';
        label.textContent = `第 ${pageNo} / ${pdf.numPages} 頁`;
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.addEventListener('contextmenu', event => event.preventDefault());
        wrap.append(label, canvas);
        stack.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: renderViewport }).promise;
      }
    } catch (error) {
      block.dataset.loaded = '0';
      host.innerHTML = `<div class="content-placeholder">PDF 載入失敗：${escapeHtml(error.message || '請確認檔案權限')}</div>`;
    }
  }

  function startTracker() {
    stopTracker();
    if (state.previewMode) return;
    const { lesson } = activeLesson();
    if (!lesson) return;
    state.tracker = {
      contentProgress: JSON.parse(JSON.stringify(lesson.contentProgress || {})),
      playingVideos: new Set(), visiblePdfs: new Set(), dirty: false, lastSync: Date.now(), timer: null
    };
    state.tracker.timer = setInterval(tickTracker, 1000);
  }

  function stopTracker() {
    if (state.tracker?.timer) clearInterval(state.tracker.timer);
    state.tracker = null;
    state.youtubePlayers.forEach(player => { try { player.destroy(); } catch {} });
    state.youtubePlayers.clear();
    if (state.mediaObserver) state.mediaObserver.disconnect();
    state.mediaObserver = null;
  }

  function ensureContentProgress(id, type) {
    const tracker = state.tracker;
    if (!tracker) return {};
    tracker.contentProgress[id] = tracker.contentProgress[id] || { type, seconds: 0, duration: 0, confirmed: false };
    tracker.contentProgress[id].type = type;
    return tracker.contentProgress[id];
  }

  function tickTracker() {
    const tracker = state.tracker;
    if (!tracker) return;
    tracker.playingVideos.forEach(id => {
      const progress = ensureContentProgress(id, 'VIDEO');
      const player = state.youtubePlayers.get(id);
      const duration = player ? n(player.getDuration?.()) : 0;
      if (duration > 0) progress.duration = Math.max(n(progress.duration), duration);
      progress.seconds = Math.min(progress.duration || Number.MAX_SAFE_INTEGER, n(progress.seconds) + 1);
      tracker.dirty = true;
      const el = document.querySelector(`[data-video-time="${CSS.escape(id)}"]`);
      if (el) el.textContent = formatSeconds(progress.seconds);
    });
    tracker.visiblePdfs.forEach(id => {
      const progress = ensureContentProgress(id, 'PDF');
      progress.seconds = n(progress.seconds) + 1;
      tracker.dirty = true;
      const el = document.querySelector(`[data-pdf-time="${CSS.escape(id)}"]`);
      if (el) el.textContent = formatSeconds(progress.seconds);
    });
    if (tracker.dirty && Date.now() - tracker.lastSync >= SYNC_INTERVAL_MS) flushProgress(false);
  }

  async function flushProgress(wait = false) {
    const tracker = state.tracker;
    const { lesson } = activeLesson();
    if (!tracker || !lesson || !tracker.dirty || state.previewMode) return;
    tracker.dirty = false;
    tracker.lastSync = Date.now();
    const payload = { lessonId: lesson.id, contentProgress: tracker.contentProgress };
    const task = api('saveProgress', payload).then(packages => {
      if (Array.isArray(packages)) state.packages = packages;
    }).catch(error => {
      tracker.dirty = true;
      if (wait) throw error;
    });
    if (wait) await task;
  }

  function loadYoutubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (state.youtubeApiPromise) return state.youtubeApiPromise;
    state.youtubeApiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return state.youtubeApiPromise;
  }

  async function mountYoutube(block) {
    if (block.dataset.loaded === '1') return;
    block.dataset.loaded = '1';
    const id = block.dataset.contentId;
    const videoId = block.dataset.youtubeId;
    const host = block.querySelector('.video-player__target');
    try {
      await loadYoutubeApi();
      const player = new YT.Player(host, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: event => {
            const p = ensureContentProgress(id, 'VIDEO');
            p.duration = Math.max(n(p.duration), n(event.target.getDuration()));
            if (state.tracker) state.tracker.dirty = true;
          },
          onStateChange: event => {
            if (!state.tracker) return;
            if (event.data === YT.PlayerState.PLAYING) state.tracker.playingVideos.add(id);
            else state.tracker.playingVideos.delete(id);
          }
        }
      });
      state.youtubePlayers.set(id, player);
    } catch {
      host.innerHTML = '<div class="content-placeholder">YouTube 播放器載入失敗，請重新整理後再試。</div>';
    }
  }

  function bindLessonMedia() {
    if (state.mediaObserver) state.mediaObserver.disconnect();
    state.mediaObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const block = entry.target;
        const id = block.dataset.contentId;
        const type = block.dataset.mediaType;
        if (type === 'VIDEO' && entry.isIntersecting) mountYoutube(block);
        if (type === 'PDF' && entry.isIntersecting) mountPdf(block);
        if (type === 'PDF' && state.tracker) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) state.tracker.visiblePdfs.add(id);
          else state.tracker.visiblePdfs.delete(id);
        }
      });
    }, { rootMargin: '500px 0px', threshold: [0, 0.25, 0.6] });
    document.querySelectorAll('[data-media-block]').forEach(block => state.mediaObserver.observe(block));
  }

  async function completeActiveLesson() {
    if (state.previewMode) return;
    const { lesson } = activeLesson();
    if (!lesson) return;
    const button = $('completeLessonButton');
    setButtonBusy(button, true, '完成中…');
    try {
      // 只送一次 completeLesson，避免舊版先 saveProgress 再 completeLesson 造成雙倍等待。
      const packages = await api('completeLesson', { lessonId: lesson.id, contentProgress: state.tracker?.contentProgress || lesson.contentProgress || {} });
      if (Array.isArray(packages)) state.packages = packages;
      stopTracker();
      showToast('子課程已完成');
      renderLessonPage(false);
      saveViewState({ view: 'lesson', scrollY: window.scrollY || 0 });
    } catch (error) {
      setButtonBusy(button, false);
      showToast(error.message || '尚未符合完成條件');
    }
  }

  async function closeLesson(save = true) {
    if (save && !state.previewMode && state.tracker?.dirty) {
      // 返回課程不等待網路；進度在背景補寫，操作畫面立即切回。
      flushProgress(true).catch(error => showToast(error.message || '進度稍後再同步'));
    }
    const wasPreview = state.previewMode;
    stopTracker();
    state.activePackageId = '';
    state.activeLessonId = '';
    state.previewMode = false;
    state.activeSubmission = null;
    $('lessonPage').hidden = true;
    if (wasPreview) {
      $('adminDashboard').hidden = false;
      setAdminTab('manage', false);
      renderAdminManage();
    } else {
      $('studentDashboard').hidden = false;
      renderStudent();
      setStudentTab(state.studentTab || 'courses', false);
    }
    saveViewState({ view: wasPreview ? 'admin' : 'student', activePackageId: '', activeLessonId: '', scrollY: 0 });
  }

  function catalogPackages() { return state.adminCatalog?.packages || []; }
  function catalogLearners() { return state.adminCatalog?.learners || []; }
  function catalogAssignments() { return state.adminCatalog?.assignments || []; }
  function findCatalogPackage(id) { return catalogPackages().find(p => p.id === id); }
  function findCatalogLesson(id) { for (const pkg of catalogPackages()) { const lesson = (pkg.lessons || []).find(l => l.id === id); if (lesson) return lesson; } return null; }
  function findCatalogContent(id) { for (const pkg of catalogPackages()) for (const lesson of pkg.lessons || []) { const content = (lesson.contents || []).find(c => c.id === id); if (content) return content; } return null; }
  function directLesson(pkg) { return (pkg?.lessons || []).find(l => l.title === '__PACKAGE_DIRECT__') || null; }
  function normalLessons(pkg) { return (pkg?.lessons || []).filter(l => l.title !== '__PACKAGE_DIRECT__'); }

  function renderAdmin() {
    const people = state.adminOverview || [];
    const assigned = people.reduce((sum, person) => sum + (person.packages || []).length, 0);
    const done = people.reduce((sum, person) => sum + (person.packages || []).filter(pkg => packageSummary(pkg).status === 'complete').length, 0);
    $('adminSummary').innerHTML = `
      <article class="summary-card"><span>帳號</span><strong>${people.length}</strong></article>
      <article class="summary-card"><span>課程指派</span><strong>${assigned}</strong></article>
      <article class="summary-card"><span>完成</span><strong>${done}</strong></article>`;
    renderAdminPeople();
    renderAdminCourses();
    renderAdminManage();
  }

  async function ensureAdminOverview() {
    if (!state.overviewDirty) return;
    const panel = state.adminTab === 'courses' ? $('adminCoursesPanel') : $('adminPeoplePanel');
    if (panel) panel.innerHTML = '<div class="empty-state"><h3>更新學習紀錄中…</h3></div>';
    try {
      const data = await api('adminOverview', {}, state.token, { retry: true });
      state.adminOverview = Array.isArray(data.overview) ? data.overview : [];
      state.overviewDirty = false;
      renderAdmin();
    } catch (error) { showToast(error.message || '無法更新學習紀錄'); }
  }

  function matchesAdminSearch(value) {
    const q = normalize($('adminSearch')?.value);
    return !q || normalize(value).includes(q);
  }

  function renderAdminPeople() {
    const people = (state.adminOverview || []).filter(person => matchesAdminSearch(`${person.employeeId} ${person.name} ${person.store} ${(person.packages || []).map(x => x.title).join(' ')}`));
    $('adminPeoplePanel').innerHTML = people.length ? people.map(person => `
      <article class="accordion-card"><button class="accordion-toggle" type="button"><span class="accordion-title"><strong>${escapeHtml(person.name)}｜${escapeHtml(person.employeeId)}</strong><span>${escapeHtml(person.area)}｜${escapeHtml(person.store)}</span></span><span class="accordion-arrow">›</span></button>
      <div class="accordion-content" hidden>${(person.packages || []).map(pkg => renderAdminPersonPackage(person, pkg)).join('') || '<div class="manage-empty">目前沒有指派課程</div>'}</div></article>`).join('') : '<div class="empty-state"><h3>查無資料</h3></div>';
    bindAdminAccordions($('adminPeoplePanel'));
    document.querySelectorAll('[data-force-complete]').forEach(button => button.onclick = () => forceCompletePackage(button));
    document.querySelectorAll('[data-clear-force-complete]').forEach(button => button.onclick = () => clearForceCompletePackage(button));
  }

  function renderAdminPersonPackage(person, pkg) {
    const summary = packageSummary(pkg);
    const lessons = (pkg.lessons || []).map(lesson => `<div class="admin-lesson-row"><strong>${escapeHtml(visibleLessonTitle(lesson))}</strong>${statusTag(lesson.status)}<span class="admin-lesson-meta">影片 ${formatSeconds(lesson.videoSeconds)}｜PDF ${formatSeconds(lesson.pdfSeconds)}｜完成 ${formatDateTime(lesson.completedAt)}</span></div>`).join('');
    const force = state.features.forceComplete && !pkg.forcedComplete && summary.status !== 'complete' ? `<button class="mini-button v1-force-button" type="button" data-force-complete data-employee-id="${escapeHtml(person.employeeId)}" data-package-id="${escapeHtml(pkg.id)}">強制通過</button>` : '';
    const clearForce = state.features.forceComplete && pkg.forcedComplete ? `<button class="mini-button" type="button" data-clear-force-complete data-employee-id="${escapeHtml(person.employeeId)}" data-package-id="${escapeHtml(pkg.id)}">取消強制通過</button>` : '';
    const forcedMeta = pkg.forcedComplete ? `<div class="force-complete-note">教育中心人工通過${pkg.forcedAt ? `｜${escapeHtml(pkg.forcedAt)}` : ''}${pkg.forcedBy ? `｜${escapeHtml(pkg.forcedBy)}` : ''}${pkg.forcedNote ? `<br>${escapeHtml(pkg.forcedNote)}` : ''}</div>` : '';
    return `<div class="person-package"><div class="person-package__head"><button class="person-package__toggle" type="button"><span><strong>${escapeHtml(pkg.title)}</strong><small>${pkg.forcedComplete ? `人工通過｜原實際進度 ${summary.done}/${summary.total}` : `${summary.done}/${summary.total} 完成`}</small></span>${statusTag(summary.status)}</button><div class="person-package__quick-actions">${force}${clearForce}</div></div><div class="person-package__body" hidden>${forcedMeta}${lessons}</div></div>`;
  }

  function uniquePackagesForAdmin() {
    const map = new Map();
    state.adminOverview.forEach(person => (person.packages || []).forEach(pkg => { if (!map.has(pkg.id)) map.set(pkg.id, { id: pkg.id, title: pkg.title }); }));
    return [...map.values()];
  }

  function renderAdminCourses() {
    const packages = uniquePackagesForAdmin().filter(pkg => matchesAdminSearch(`${pkg.id} ${pkg.title}`));
    $('adminCoursesPanel').innerHTML = packages.length ? packages.map(info => {
      const rows = state.adminOverview.map(person => {
        const pkg = (person.packages || []).find(x => x.id === info.id);
        if (!pkg) return '';
        const summary = packageSummary(pkg);
        return `<div class="person-package"><button class="person-package__toggle" type="button"><span><strong>${escapeHtml(person.name)}｜${escapeHtml(person.employeeId)}</strong><small>${escapeHtml(person.store)}｜${summary.done}/${summary.total} 完成</small></span>${statusTag(summary.status)}</button><div class="person-package__body" hidden>${(pkg.lessons || []).map(lesson => `<div class="admin-lesson-row"><strong>${escapeHtml(visibleLessonTitle(lesson))}</strong>${statusTag(lesson.status)}<span class="admin-lesson-meta">影片 ${formatSeconds(lesson.videoSeconds)}｜PDF ${formatSeconds(lesson.pdfSeconds)}｜完成 ${formatDateTime(lesson.completedAt)}</span></div>`).join('')}</div></div>`;
      }).filter(Boolean).join('');
      return `<article class="accordion-card"><button class="accordion-toggle" type="button"><span class="accordion-title"><strong>${escapeHtml(info.title)}</strong><span>查看帳號學習狀況</span></span><span class="accordion-arrow">›</span></button><div class="accordion-content" hidden>${rows}</div></article>`;
    }).join('') : '<div class="empty-state"><h3>查無資料</h3></div>';
    bindAdminAccordions($('adminCoursesPanel'));
  }

  function bindAdminAccordions(root) {
    root?.querySelectorAll(':scope > .accordion-card > .accordion-toggle').forEach(button => {
      button.onclick = () => {
        const content = button.nextElementSibling;
        if (!content) return;
        content.hidden = !content.hidden;
        button.classList.toggle('is-open', !content.hidden);
      };
    });
    root?.querySelectorAll('.person-package__toggle').forEach(button => {
      button.onclick = () => {
        const body = button.closest('.person-package')?.querySelector(':scope > .person-package__body');
        if (body) body.hidden = !body.hidden;
      };
    });
  }

  function publishBadge(pkg) {
    const stateText = pkg.publishState || '草稿';
    const cls = stateText === '已發布' ? 'tag--success' : stateText === '封存' ? 'tag--muted' : 'tag--warning';
    return `<span class="tag ${cls}">${escapeHtml(stateText)}</span>`;
  }

  function adminEnabledText(enabled) { return enabled === false ? '停用' : '啟用'; }
  function ruleText(lesson) { return lesson.videoPassPercent != null ? `影片達 ${n(lesson.videoPassPercent)}%` : '完成確認'; }
  function applicabilityLabel(lesson) {
    const mode = lesson?.applicabilityMode || '全部適用';
    if (mode === '指定帳號') return `指定 ${Array.isArray(lesson.applicableIds) ? lesson.applicableIds.length : 0} 個帳號`;
    if (mode === '其餘未指定') return '其餘未指定帳號';
    return '全部適用';
  }

  function validateCatalogPackage(pkg) {
    const errors = [];
    const direct = directLesson(pkg);
    const directContents = (direct?.contents || []).filter(c => c.enabled !== false);
    const lessons = normalLessons(pkg).filter(l => l.enabled !== false);
    if (!directContents.length && !lessons.length) errors.push('至少建立課程教材或一個子課程');
    const fallback = lessons.filter(l => (l.applicabilityMode || '全部適用') === '其餘未指定');
    if (fallback.length > 1) errors.push('分流設定：只能有一個「其餘未指定」子課程');
    const owner = new Map();
    lessons.filter(l => l.applicabilityMode === '指定帳號').forEach(lesson => {
      const ids = Array.isArray(lesson.applicableIds) ? lesson.applicableIds : [];
      if (!ids.length) errors.push(`${lesson.title}：尚未選擇指定帳號`);
      ids.forEach(id => { if (owner.has(id) && owner.get(id) !== lesson.id) errors.push(`分流設定：${id} 重複出現在不同子課程`); else owner.set(id, lesson.id); });
    });
    lessons.forEach(lesson => {
      const contents = (lesson.contents || []).filter(c => c.enabled !== false);
      if (!contents.length) errors.push(`${lesson.title}：尚未建立教材`);
      if (lesson.videoPassPercent != null && !contents.some(c => clean(c.type).toUpperCase() === 'VIDEO' && youtubeId(c.url))) errors.push(`${lesson.title}：有影片門檻但沒有有效 YouTube`);
    });
    return errors;
  }

  function renderAdminManage() {
    const packages = catalogPackages();
    const assignments = catalogAssignments().filter(a => a.enabled !== false);
    const normalLessonCount = packages.reduce((sum, pkg) => sum + normalLessons(pkg).length, 0);
    $('adminCatalogSummary').innerHTML = `
      <article class="summary-card"><span>課程</span><strong>${packages.length}</strong></article>
      <article class="summary-card"><span>子課程</span><strong>${normalLessonCount}</strong></article>
      <article class="summary-card"><span>有效指派</span><strong>${assignments.length}</strong></article>`;
    $('adminCatalogList').innerHTML = packages.length ? packages.map(pkg => renderManagePackage(pkg, assignments)).join('') : '<div class="empty-state"><h3>尚未建立課程</h3></div>';
    bindAdminManageEvents();
  }

  function renderManagePackage(pkg, assignments) {
    const errors = validateCatalogPackage(pkg);
    const activeAssign = assignments.filter(a => a.packageId === pkg.id).length;
    const open = state.manageOpenPackages.has(pkg.id);
    const direct = directLesson(pkg);
    const directRow = direct && (direct.contents || []).length ? renderManageLesson(direct, true) : '';
    const normal = normalLessons(pkg).sort((a,b) => n(a.sort) - n(b.sort));
    const lessonRows = normal.map((lesson,index) => renderManageLesson(lesson, false, { first:index===0, last:index===normal.length-1 })).join('');
    return `<article class="manage-card"><div class="manage-card__head"><div class="manage-card__title"><strong>${escapeHtml(pkg.title)}</strong><small>${escapeHtml(pkg.description || '')}｜${adminEnabledText(pkg.enabled)}｜已指派 ${activeAssign} 人</small><div style="margin-top:7px">${publishBadge(pkg)}</div>${errors.length ? `<div class="manage-warning">${escapeHtml(errors.slice(0,3).join('；'))}${errors.length > 3 ? '…' : ''}</div>` : ''}</div>
      <div class="manage-card__actions"><button class="mini-button" type="button" data-toggle-manage="${escapeHtml(pkg.id)}">${open ? '收合' : '展開'}</button><button class="mini-button" type="button" data-preview-package="${escapeHtml(pkg.id)}">預覽</button><button class="mini-button" type="button" data-edit-package="${escapeHtml(pkg.id)}">編輯</button><button class="mini-button" type="button" data-add-package-content="${escapeHtml(pkg.id)}">＋教材</button><button class="mini-button" type="button" data-add-lesson="${escapeHtml(pkg.id)}">＋子課程</button><button class="mini-button" type="button" data-assign-package="${escapeHtml(pkg.id)}">批次指派</button>${pkg.publishState === '已發布' ? `<button class="mini-button" type="button" data-draft-package="${escapeHtml(pkg.id)}">轉草稿</button>` : `<button class="mini-button" type="button" data-publish-package="${escapeHtml(pkg.id)}">發布</button>`}<button class="mini-button mini-button--danger" type="button" data-delete-package="${escapeHtml(pkg.id)}">刪除／封存</button></div></div>
      <div class="manage-card__body" data-manage-body="${escapeHtml(pkg.id)}" ${open ? '' : 'hidden'}>${directRow}${lessonRows || '<div class="manage-empty">尚未建立子課程；也可以直接用上方「＋教材」建立課程教材。</div>'}</div></article>`;
  }

  function renderManageLesson(lesson, direct, position = {}) {
    const contents = (lesson.contents || []).sort((a,b) => n(a.sort) - n(b.sort));
    const open = state.manageOpenLessons.has(lesson.id);
    const contentRows = contents.map((content, index) => `<div class="manage-content"><span><strong>${escapeHtml(content.title)}</strong><small>${escapeHtml(contentTypeLabel(content.type))}｜${adminEnabledText(content.enabled)}</small></span><div class="v1-content-actions"><button class="mini-button" type="button" data-edit-content="${escapeHtml(content.id)}">編輯</button><button class="mini-button" type="button" data-move-content="${escapeHtml(content.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button class="mini-button" type="button" data-move-content="${escapeHtml(content.id)}" data-direction="1" ${index === contents.length - 1 ? 'disabled' : ''}>↓</button><button class="mini-button mini-button--danger" type="button" data-delete-content="${escapeHtml(content.id)}">刪除</button></div></div>`).join('');
    const normal = !direct;
    return `<div class="manage-row ${open ? 'is-v1-lesson-open' : ''}"><div class="manage-row__top"><div><strong>${direct ? '課程教材' : escapeHtml(lesson.title)}</strong><div class="manage-row__meta">${direct ? '直接放在課程內' : `${lesson.required ? '必修' : '選修'}｜${escapeHtml(ruleText(lesson))}｜${adminEnabledText(lesson.enabled)}｜適用：${escapeHtml(applicabilityLabel(lesson))}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}`}</div></div><div class="manage-row__actions">${contents.length ? `<button class="mini-button" type="button" data-toggle-lesson-content="${escapeHtml(lesson.id)}">${open ? `收合教材 (${contents.length})` : `展開教材 (${contents.length})`}</button>` : ''}${normal ? `<button class="mini-button" type="button" data-edit-lesson="${escapeHtml(lesson.id)}">編輯</button>` : ''}<button class="mini-button" type="button" data-add-content="${escapeHtml(lesson.id)}">＋教材</button>${normal ? `<button class="mini-button" type="button" data-move-lesson="${escapeHtml(lesson.id)}" data-direction="-1" ${position.first ? 'disabled' : ''}>↑</button><button class="mini-button" type="button" data-move-lesson="${escapeHtml(lesson.id)}" data-direction="1" ${position.last ? 'disabled' : ''}>↓</button><button class="mini-button mini-button--danger" type="button" data-delete-lesson="${escapeHtml(lesson.id)}">刪除</button>` : ''}</div></div><div class="manage-content-list" data-lesson-content-list="${escapeHtml(lesson.id)}" ${open ? '' : 'hidden'}>${contentRows || '<div class="manage-empty">尚未建立教材</div>'}</div></div>`;
  }

  function bindAdminManageEvents() {
    document.querySelectorAll('[data-toggle-manage]').forEach(button => button.onclick = () => {
      const id = button.dataset.toggleManage;
      if (state.manageOpenPackages.has(id)) state.manageOpenPackages.delete(id); else state.manageOpenPackages.add(id);
      saveFoldState(); renderAdminManage();
    });
    document.querySelectorAll('[data-toggle-lesson-content]').forEach(button => button.onclick = () => {
      const id = button.dataset.toggleLessonContent;
      if (state.manageOpenLessons.has(id)) state.manageOpenLessons.delete(id); else state.manageOpenLessons.add(id);
      saveFoldState(); renderAdminManage();
    });
    document.querySelectorAll('[data-preview-package]').forEach(b => b.onclick = () => openAdminPreview(findCatalogPackage(b.dataset.previewPackage)));
    document.querySelectorAll('[data-edit-package]').forEach(b => b.onclick = () => openPackageEditor(findCatalogPackage(b.dataset.editPackage)));
    document.querySelectorAll('[data-add-package-content]').forEach(b => b.onclick = () => openDirectContentEditor(findCatalogPackage(b.dataset.addPackageContent)));
    document.querySelectorAll('[data-add-lesson]').forEach(b => b.onclick = () => openLessonEditor(null, b.dataset.addLesson));
    document.querySelectorAll('[data-edit-lesson]').forEach(b => b.onclick = () => openLessonEditor(findCatalogLesson(b.dataset.editLesson)));
    document.querySelectorAll('[data-add-content]').forEach(b => b.onclick = () => openContentEditor(null, b.dataset.addContent));
    document.querySelectorAll('[data-edit-content]').forEach(b => b.onclick = () => openContentEditor(findCatalogContent(b.dataset.editContent)));
    document.querySelectorAll('[data-assign-package]').forEach(b => b.onclick = () => openAssignmentEditor(findCatalogPackage(b.dataset.assignPackage)));
    document.querySelectorAll('[data-publish-package]').forEach(b => b.onclick = () => changePublishState(b.dataset.publishPackage, '已發布', b));
    document.querySelectorAll('[data-draft-package]').forEach(b => b.onclick = () => changePublishState(b.dataset.draftPackage, '草稿', b));
    document.querySelectorAll('[data-delete-package]').forEach(b => b.onclick = () => safeDeletePackage(b.dataset.deletePackage, b));
    document.querySelectorAll('[data-delete-lesson]').forEach(b => b.onclick = () => safeDeleteLesson(b.dataset.deleteLesson, b));
    document.querySelectorAll('[data-delete-content]').forEach(b => b.onclick = () => safeDeleteContent(b.dataset.deleteContent, b));
    document.querySelectorAll('[data-move-lesson]').forEach(b => b.onclick = () => moveItem('moveLesson', b.dataset.moveLesson, n(b.dataset.direction), b));
    document.querySelectorAll('[data-move-content]').forEach(b => b.onclick = () => moveItem('moveContent', b.dataset.moveContent, n(b.dataset.direction), b));
  }

  function showAdminEditor(title, html) {
    $('adminEditorTitle').textContent = title;
    $('adminEditorBody').innerHTML = html;
    $('adminEditorOverlay').hidden = false;
    document.body.classList.add('is-locked');
  }

  function closeAdminEditor() {
    $('adminEditorOverlay').hidden = true;
    $('adminEditorBody').innerHTML = '';
    document.body.classList.remove('is-locked');
  }

  function yesNoSelect(value) {
    return `<option value="true" ${value !== false ? 'selected' : ''}>是</option><option value="false" ${value === false ? 'selected' : ''}>否</option>`;
  }

  function field(label, id, value = '', type = 'text', extra = '') {
    return `<label class="field-group"><span>${label}</span><input id="${id}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra}></label>`;
  }

  function bindEditorForm() {
    document.querySelectorAll('[data-cancel-editor]').forEach(button => button.onclick = closeAdminEditor);
    const form = $('adminEditForm');
    if (form) form.onsubmit = submitAdminEditor;
  }

  function openPackageEditor(pkg) {
    pkg = pkg || { title: '', description: '', enabled: true, sort: catalogPackages().length + 1, publishState: '草稿', completionRule: '所有必修子課程完成' };
    showAdminEditor(pkg.id ? '編輯課程' : '新增課程', `<form id="adminEditForm" class="admin-form" data-admin-form="package"><input type="hidden" id="editId" value="${escapeHtml(pkg.id || '')}"><input type="hidden" id="editPublishState" value="${escapeHtml(pkg.publishState || '草稿')}"><div class="form-grid">${field('課程名稱', 'editTitle', pkg.title, 'text', 'required')}${field('排序', 'editSort', pkg.sort || 1, 'number', 'min="1" required')}<label class="field-group field-group--wide"><span>簡短說明</span><textarea id="editDescription">${escapeHtml(pkg.description || '')}</textarea></label><label class="field-group"><span>課程完成規則</span><select id="editCompletionRule"><option value="所有必修子課程完成" ${pkg.completionRule !== '任一必修子課程完成' ? 'selected' : ''}>所有必修子課程完成</option><option value="任一必修子課程完成" ${pkg.completionRule === '任一必修子課程完成' ? 'selected' : ''}>任一必修子課程完成</option></select></label><label class="field-group"><span>啟用</span><select id="editEnabled">${yesNoSelect(pkg.enabled)}</select></label></div><p class="form-hint">「任一必修子課程完成」適合依門市類型分流：3 個子課程只要完成其中 1 個，整門課即完成。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">儲存</button></div></form>`);
    bindEditorForm();
  }

  function openLessonEditor(lesson, packageId) {
    lesson = lesson || { packageId, title: '', required: true, enabled: true, sort: normalLessons(findCatalogPackage(packageId)).length + 1, videoPassPercent: null, submissionMode: '不需要', submissionNote: '', applicabilityMode: '全部適用', applicableIds: [] };
    const selected = new Set(Array.isArray(lesson.applicableIds) ? lesson.applicableIds : []);
    const learners = catalogLearners();
    const learnerRows = learners.map(l => `<label class="learner-check applicability-learner"><input type="checkbox" name="applicableLearner" value="${escapeHtml(l.employeeId)}" ${selected.has(l.employeeId) ? 'checked' : ''}><span><strong>${escapeHtml(l.name)}｜${escapeHtml(l.employeeId)}</strong><small>${escapeHtml(l.store || '')}｜${escapeHtml(l.role || '')}</small></span></label>`).join('');
    showAdminEditor(lesson.id ? '編輯子課程' : '新增子課程', `<form id="adminEditForm" class="admin-form" data-admin-form="lesson"><input type="hidden" id="editId" value="${escapeHtml(lesson.id || '')}"><input type="hidden" id="editPackageId" value="${escapeHtml(lesson.packageId || packageId || '')}"><div class="form-grid">${field('子課程名稱', 'editTitle', lesson.title, 'text', 'required')}${field('排序', 'editSort', lesson.sort || 1, 'number', 'min="1" required')}<label class="field-group"><span>必修</span><select id="editRequired">${yesNoSelect(lesson.required)}</select></label><label class="field-group"><span>啟用</span><select id="editEnabled">${yesNoSelect(lesson.enabled)}</select></label>${field('影片最低完成率 %', 'editVideo', lesson.videoPassPercent ?? '', 'number', 'min="1" max="100"')}<label class="field-group"><span>作業回傳</span><select id="editSubmissionMode"><option value="不需要" ${lesson.submissionMode === '不需要' ? 'selected' : ''}>不需要</option><option value="選填" ${lesson.submissionMode === '選填' ? 'selected' : ''}>選填</option><option value="必繳審核" ${lesson.submissionMode === '必繳審核' ? 'selected' : ''}>必繳並審核</option></select></label><label class="field-group field-group--wide"><span>適用對象</span><select id="editApplicabilityMode"><option value="全部適用" ${lesson.applicabilityMode !== '指定帳號' && lesson.applicabilityMode !== '其餘未指定' ? 'selected' : ''}>全部適用（一般課程使用）</option><option value="指定帳號" ${lesson.applicabilityMode === '指定帳號' ? 'selected' : ''}>指定門市／帳號</option><option value="其餘未指定" ${lesson.applicabilityMode === '其餘未指定' ? 'selected' : ''}>其餘未指定門市／帳號</option></select></label><div id="applicabilityPicker" class="field-group field-group--wide applicability-picker"><span>指定門市／帳號</span><input id="applicabilitySearch" type="search" placeholder="搜尋帳號、姓名或店別"><div id="applicabilitySearchResult" class="v1-search-result"></div><div class="learner-checklist applicability-list">${learnerRows || '<div class="manage-empty">目前沒有可選帳號</div>'}</div></div><label class="field-group field-group--wide"><span>作業說明</span><textarea id="editSubmissionNote" placeholder="例如：請下載檢核表填寫後回傳。">${escapeHtml(lesson.submissionNote || '')}</textarea></label></div><p class="form-hint">分流課程只需把特殊門市設成「指定門市／帳號」，一般門市那堂設成「其餘未指定」；一般課程維持「全部適用」即可。發布時系統會檢查重複分流。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">儲存</button></div></form>`);
    bindEditorForm();
    const mode = $('editApplicabilityMode'), picker = $('applicabilityPicker'), search = $('applicabilitySearch');
    const refreshPicker = () => { if (picker) picker.hidden = mode?.value !== '指定帳號'; };
    if (mode) mode.onchange = refreshPicker;
    if (search) {
      const filter = () => { const q = normalize(search.value); let shown = 0; document.querySelectorAll('.applicability-learner').forEach(row => { const hit = !q || normalize(row.textContent).includes(q); row.hidden = !hit; if (hit) shown++; }); if ($('applicabilitySearchResult')) $('applicabilitySearchResult').textContent = q ? `找到 ${shown} 筆` : `共 ${learners.length} 筆可選帳號`; };
      search.oninput = filter; filter();
    }
    refreshPicker();
  }

  function openDirectContentEditor(pkg) {
    const direct = directLesson(pkg);
    openContentEditor(null, direct?.id || '', pkg.id);
  }

  function openContentEditor(content, lessonId = '', directPackageId = '') {
    content = content || { lessonId, type: 'VIDEO', title: '', url: '', text: '', sort: (findCatalogLesson(lessonId)?.contents || []).length + 1, enabled: true };
    showAdminEditor(content.id ? '編輯教材' : '新增教材', `<form id="adminEditForm" class="admin-form" data-admin-form="content"><input type="hidden" id="editId" value="${escapeHtml(content.id || '')}"><input type="hidden" id="editLessonId" value="${escapeHtml(content.lessonId || lessonId || '')}"><input type="hidden" id="editDirectPackageId" value="${escapeHtml(directPackageId || '')}"><div class="form-grid"><label class="field-group"><span>教材類型</span><select id="editType"><option value="VIDEO" ${content.type === 'VIDEO' ? 'selected' : ''}>YouTube影片</option><option value="PDF" ${content.type === 'PDF' ? 'selected' : ''}>PDF（網站內閱讀）</option><option value="FILE" ${content.type === 'FILE' ? 'selected' : ''}>電子範本／下載檔</option><option value="TEXT" ${content.type === 'TEXT' ? 'selected' : ''}>文字</option></select></label>${field('排序', 'editSort', content.sort || 1, 'number', 'min="1" required')}${field('教材標題', 'editTitle', content.title, 'text', 'required')}<label class="field-group"><span>啟用</span><select id="editEnabled">${yesNoSelect(content.enabled)}</select></label><label class="field-group field-group--wide"><span>影片／PDF／下載檔網址</span><input id="editUrl" type="url" value="${escapeHtml(content.url || '')}" placeholder="https://..."></label><label class="field-group field-group--wide"><span>文字教材內容</span><textarea id="editText">${escapeHtml(content.text || '')}</textarea></label></div><p class="form-hint">PDF 可使用 Google Drive 分享連結，學員會直接在網站內閱讀，不另開視窗。</p><div class="form-actions"><button id="testContentLinkButton" class="secondary-button" type="button">測試連結</button><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">儲存</button></div></form>`);
    bindEditorForm();
    $('testContentLinkButton').onclick = () => {
      const type = $('editType').value, url = clean($('editUrl').value);
      if (type === 'TEXT') { showToast('文字教材不需要連結'); return; }
      if (!/^https?:\/\//i.test(url)) { showToast('請先輸入有效網址'); return; }
      if (type === 'VIDEO' && !youtubeId(url)) { showToast('YouTube 網址格式不正確'); return; }
      if (type === 'PDF') { showToast('PDF 會由網站內建閱讀器顯示；請儲存後使用「預覽」確認。'); return; }
      if (type === 'FILE') {
        const a = document.createElement('a');
        a.href = directDownloadUrl(url);
        a.download = '';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      window.open(url, '_blank', 'noopener');
    };
  }

  function openAssignmentEditor(pkg) {
    if (!pkg) return;
    const active = catalogAssignments().filter(a => a.packageId === pkg.id && a.enabled !== false);
    const activeIds = new Set(active.map(a => a.employeeId));
    const learnerMap = new Map(catalogLearners().map(l => [l.employeeId, l]));
    const assignedRows = active.map(a => {
      const learner = learnerMap.get(a.employeeId) || { name: a.employeeId, store: '' };
      return `<div class="assignment-row"><span><strong>${escapeHtml(learner.name)}｜${escapeHtml(a.employeeId)}</strong><small>${escapeHtml(learner.store || '')}${a.dueAt ? `｜截止 ${escapeHtml(a.dueAt)}` : ''}</small></span><button class="mini-button mini-button--danger" type="button" data-disable-assignment="${escapeHtml(a.id)}" data-employee-id="${escapeHtml(a.employeeId)}">取消指派</button></div>`;
    }).join('');
    showAdminEditor(`批次指派｜${pkg.title}`, `<form id="adminEditForm" class="admin-form" data-admin-form="assignment"><input type="hidden" id="editPackageId" value="${escapeHtml(pkg.id)}"><div class="v1-assignment-tools"><strong>快速勾選</strong><div class="v1-assignment-buttons"><button type="button" class="mini-button" data-pick="all">全部</button><button type="button" class="mini-button" data-pick="門市">全部門市</button><button type="button" class="mini-button" data-pick="儲備幹部">全部儲備幹部</button><button type="button" class="mini-button" data-pick="clear">清除勾選</button></div></div><label class="field-group"><span>搜尋指派對象</span><input id="assignmentSearch" type="search" placeholder="輸入帳號、姓名或店別"></label><div id="assignmentSearchResult" class="v1-search-result"></div><label class="field-group"><span>選擇要新增／重新啟用的帳號</span><div class="learner-checklist">${catalogLearners().map(l => `<label class="learner-check"><input type="checkbox" name="assignLearner" value="${escapeHtml(l.employeeId)}" ${activeIds.has(l.employeeId) ? 'checked' : ''}><span><strong>${escapeHtml(l.name)}｜${escapeHtml(l.employeeId)}</strong><small>${escapeHtml(l.store)}｜${escapeHtml(l.role)}</small></span></label>`).join('')}</div></label>${field('截止日期', 'editDue', '', 'date')}<button class="primary-button" type="submit">儲存批次指派</button></form><div class="assignment-list">${assignedRows || '<div class="manage-empty">目前沒有指派帳號</div>'}</div>`);
    bindEditorForm();
    const search = $('assignmentSearch');
    const filter = () => {
      const q = normalize(search.value); let shown = 0;
      document.querySelectorAll('.learner-check').forEach(row => { const hit = !q || normalize(row.textContent).includes(q); row.hidden = !hit; if (hit) shown++; });
      $('assignmentSearchResult').textContent = q ? `找到 ${shown} 筆` : `共 ${catalogLearners().length} 筆可指派帳號`;
    };
    search.oninput = filter; filter();
    document.querySelectorAll('[data-pick]').forEach(button => button.onclick = () => {
      const mode = button.dataset.pick;
      document.querySelectorAll('input[name="assignLearner"]').forEach(input => {
        const learner = learnerMap.get(input.value);
        input.checked = mode === 'all' ? true : mode === 'clear' ? false : learner?.role === mode;
      });
    });
    document.querySelectorAll('[data-disable-assignment]').forEach(button => button.onclick = async () => {
      setButtonBusy(button, true);
      try {
        await saveAdminAction('saveAssignment', { id: button.dataset.disableAssignment, employeeId: button.dataset.employeeId, packageId: pkg.id, enabled: false });
        closeAdminEditor(); openAssignmentEditor(findCatalogPackage(pkg.id)); showToast('已取消指派');
      } catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
    });
  }

  function boolValue(id) { return $(id)?.value === 'true'; }
  function optionalNumber(id) { const value = clean($(id)?.value); return value === '' ? null : Number(value); }

  async function saveAdminAction(action, payload) {
    const data = await api(action, payload);
    if (data?.catalog) { state.adminCatalog = data.catalog; state.adminCatalogLoaded = true; }
    if (Array.isArray(data?.overview)) { state.adminOverview = data.overview; state.overviewDirty = false; }
    else state.overviewDirty = true;
    if (data?.user) state.user = data.user;
    renderAdminManage();
    return data;
  }

  async function submitAdminEditor(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const kind = form.dataset.adminForm;
    const button = form.querySelector('button[type="submit"]');
    setButtonBusy(button, true, '儲存中…');
    try {
      let action, payload;
      if (kind === 'package') {
        action = 'savePackage';
        payload = { id: $('editId').value, title: $('editTitle').value, description: $('editDescription').value, sort: Number($('editSort').value), enabled: boolValue('editEnabled'), publishState: $('editPublishState').value, completionRule: $('editCompletionRule')?.value || '所有必修子課程完成' };
      } else if (kind === 'lesson') {
        action = 'saveLesson';
        payload = { id: $('editId').value, packageId: $('editPackageId').value, title: $('editTitle').value, sort: Number($('editSort').value), required: boolValue('editRequired'), enabled: boolValue('editEnabled'), videoPassPercent: optionalNumber('editVideo'), submissionMode: $('editSubmissionMode').value, submissionNote: $('editSubmissionNote').value, applicabilityMode: $('editApplicabilityMode')?.value || '全部適用', applicableIds: [...document.querySelectorAll('input[name="applicableLearner"]:checked')].map(x => x.value) };
        state.manageOpenPackages.add(payload.packageId);
      } else if (kind === 'content') {
        action = 'saveContent';
        payload = { id: $('editId').value, lessonId: $('editLessonId').value, packageId: $('editDirectPackageId').value, type: $('editType').value, title: $('editTitle').value, url: $('editUrl').value, text: $('editText').value, sort: Number($('editSort').value), enabled: boolValue('editEnabled') };
        const lesson = findCatalogLesson(payload.lessonId);
        if (lesson) { state.manageOpenPackages.add(lesson.packageId); state.manageOpenLessons.add(lesson.id); }
        if (payload.packageId) state.manageOpenPackages.add(payload.packageId);
      } else if (kind === 'assignment') {
        action = 'saveAssignmentsBatch';
        payload = { employeeIds: [...document.querySelectorAll('input[name="assignLearner"]:checked')].map(x => x.value), packageId: $('editPackageId').value, dueAt: $('editDue').value };
      } else return;
      saveFoldState();
      const data = await saveAdminAction(action, payload);
      if (kind === 'content' && payload.packageId) {
        const direct = directLesson(findCatalogPackage(payload.packageId));
        if (direct) state.manageOpenLessons.add(direct.id);
        renderAdminManage();
      }
      closeAdminEditor();
      saveFoldState();
      showToast(data?.message || '已儲存');
    } catch (error) {
      setButtonBusy(button, false);
      showToast(error.message || '儲存失敗');
    }
  }

  async function changePublishState(id, publishState, button) {
    const pkg = findCatalogPackage(id);
    if (!pkg) return;
    if (publishState === '已發布') {
      const errors = validateCatalogPackage(pkg);
      if (errors.length) { showToast(errors[0]); return; }
    }
    setButtonBusy(button, true);
    try { const data = await saveAdminAction('setPackageState', { id, publishState }); showToast(data.message || '已更新'); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
  }

  async function safeDeletePackage(id, button) {
    const pkg = findCatalogPackage(id);
    if (!pkg || !confirm(`確定處理「${pkg.title}」？\n有學習或指派紀錄時會安全封存，不會破壞歷史資料。`)) return;
    setButtonBusy(button, true);
    try { const data = await saveAdminAction('deletePackage', { id }); showToast(data.message || '已處理'); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
  }

  async function safeDeleteLesson(id, button) {
    const lesson = findCatalogLesson(id);
    if (!lesson || !confirm(`確定刪除子課程「${lesson.title}」？\n已有學習紀錄時會改為停用。`)) return;
    setButtonBusy(button, true);
    try { const data = await saveAdminAction('deleteLesson', { id }); showToast(data.message || '已處理'); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
  }

  async function safeDeleteContent(id, button) {
    const content = findCatalogContent(id);
    if (!content || !confirm(`確定刪除教材「${content.title}」？\n已有觀看／閱讀紀錄時會改為停用。`)) return;
    setButtonBusy(button, true);
    try { const data = await saveAdminAction('deleteContent', { id }); showToast(data.message || '已處理'); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
  }

  async function moveItem(action, id, direction, button) {
    setButtonBusy(button, true);
    try { const data = await saveAdminAction(action, { id, direction }); showToast(data.message || '排序已更新'); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '排序失敗'); }
  }

  async function forceCompletePackage(button) {
    const employeeId = button.dataset.employeeId;
    const packageId = button.dataset.packageId;
    if (!confirm('確定強制將此帳號的整門課程記錄為完成？\n\n系統不會偽造影片觀看秒數或作業附件。')) return;
    const reason = prompt('完成備註', '教育中心人工確認');
    if (reason === null) return;
    setButtonBusy(button, true);
    try {
      const data = await api('forceCompletePackage', { employeeId, packageId, reason });
      if (Array.isArray(data.overview)) state.adminOverview = data.overview;
      else if (Array.isArray(data.packages)) {
        const person = state.adminOverview.find(p => p.employeeId === data.employeeId);
        if (person) person.packages = data.packages;
      }
      state.overviewDirty = false;
      renderAdmin();
      showToast(data.message || '已強制通過');
    } catch (error) { setButtonBusy(button, false); showToast(error.message || '操作失敗'); }
  }

  async function exportProgress() {
    try {
      const rows = await api('exportProgress');
      if (!Array.isArray(rows) || !rows.length) { showToast('目前沒有可匯出的紀錄'); return; }
      const headers = Object.keys(rows[0]);
      const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csv = '\ufeff' + [headers.map(csvEscape).join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `training_records_${new Date().toISOString().slice(0,10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showToast(error.message || '匯出失敗'); }
  }

  function ensureSubmissionTab() {
    const nav = $('adminDashboard')?.querySelector(':scope > .tab-bar');
    if (!nav) return;
    let button = nav.querySelector('[data-admin-tab="submissions"]');
    if (!state.features.submissions) { button?.remove(); $('adminSubmissionPanel')?.remove(); return; }
    if (!button) {
      button = document.createElement('button');
      button.className = 'tab-button'; button.type = 'button'; button.dataset.adminTab = 'submissions'; button.textContent = '作業回傳';
      const manage = nav.querySelector('[data-admin-tab="manage"]');
      nav.insertBefore(button, manage || null);
      button.onclick = () => setAdminTab('submissions');
    }
    if (!$('adminSubmissionPanel')) {
      const panel = document.createElement('section'); panel.id = 'adminSubmissionPanel'; panel.className = 'tab-panel'; panel.hidden = true;
      panel.innerHTML = '<div class="panel-heading"><div><h2>作業回傳</h2><p class="package-meta">查看、通過或退回學員繳交的附件</p></div></div><div id="submissionAdminBody"></div>';
      $('adminDashboard').appendChild(panel);
    }
  }

  async function loadAdminSubmissions(force = false) {
    const body = $('submissionAdminBody');
    if (!force && state.adminSubmissionsLoadedAt && Date.now() - state.adminSubmissionsLoadedAt < 30000) {
      renderAdminSubmissions();
      return;
    }
    if (body) body.innerHTML = '<div class="empty-state"><h3>載入作業資料中…</h3></div>';
    try {
      const data = await api('adminSubmissions');
      state.adminSubmissions = data;
      state.adminSubmissionsLoadedAt = Date.now();
      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };
      renderAdminSubmissions();
    } catch (error) { if (body) body.innerHTML = `<div class="empty-state"><h3>${escapeHtml(error.message || '無法載入')}</h3></div>`; }
  }

  function renderAdminSubmissions() {
    const body = $('submissionAdminBody'); if (!body) return;
    const items = state.adminSubmissions.items || [];
    const counts = { pending: items.filter(x => x.status === '待審核').length, rejected: items.filter(x => x.status === '已退件').length, approved: items.filter(x => x.status === '已通過').length };
    body.innerHTML = `<div class="summary-grid"><article class="summary-card"><span>待審核</span><strong>${counts.pending}</strong></article><article class="summary-card"><span>已退件</span><strong>${counts.rejected}</strong></article><article class="summary-card"><span>已通過</span><strong>${counts.approved}</strong></article></div><div class="v1-sub-toolbar"><input id="submissionSearch" type="search" placeholder="搜尋帳號、姓名、店別、課程或子課程"><select id="submissionFilter"><option value="">全部狀態</option><option value="待審核">待審核</option><option value="已退件">已退件</option><option value="已通過">已通過</option><option value="未送審">未送審</option></select>${state.adminSubmissions.rootFolderUrl ? `<a class="secondary-button primary-button--fit" href="${escapeHtml(state.adminSubmissions.rootFolderUrl)}" target="_blank" rel="noopener">開啟回傳資料夾</a>` : ''}</div><div id="submissionAdminList" class="v1-sub-list"></div>`;
    $('submissionSearch').oninput = renderAdminSubmissionList;
    $('submissionFilter').onchange = renderAdminSubmissionList;
    renderAdminSubmissionList();
  }

  function submissionStatusClass(status) {
    return status === '已通過' ? 'tag--success' : status === '待審核' ? 'tag--warning' : status === '已退件' ? 'tag--danger' : 'tag--muted';
  }

  function formatBytes(bytes) {
    const size = n(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1048576).toFixed(1)} MB`;
  }

  function renderAdminSubmissionList() {
    const host = $('submissionAdminList'); if (!host) return;
    const q = normalize($('submissionSearch')?.value), filter = $('submissionFilter')?.value || '';
    const items = (state.adminSubmissions.items || []).filter(x => (!filter || x.status === filter) && (!q || normalize(`${x.employeeId} ${x.name} ${x.store} ${x.courseTitle} ${x.lessonTitle}`).includes(q)));
    host.innerHTML = items.length ? items.map(x => `<article class="card v1-sub-admin-card"><div class="v1-sub-card-head"><div><strong>${escapeHtml(x.name || x.employeeId)}｜${escapeHtml(x.employeeId)}</strong><p class="package-meta">${escapeHtml(x.store || '')}｜${escapeHtml(x.courseTitle)} → ${escapeHtml(x.lessonTitle)}</p></div><span class="tag ${submissionStatusClass(x.status)}">${escapeHtml(x.status)}</span></div><div class="v1-sub-meta"><span>V${String(Math.max(1,n(x.version))).padStart(2,'0')}</span><span>送出：${escapeHtml(x.submittedAt || '—')}</span><span>審核：${escapeHtml(x.reviewedAt || '—')}</span></div>${x.rejectReason ? `<div class="v1-reject-note"><strong>退件原因：</strong>${escapeHtml(x.rejectReason)}</div>` : ''}<div class="v1-file-grid">${(x.files || []).map(file => `<a class="v1-file-link" href="${escapeHtml(file.url)}" target="_blank" rel="noopener">${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></a>`).join('') || '<span class="package-meta">尚無附件</span>'}</div>${x.status === '待審核' ? `<div class="v1-review-actions"><button class="primary-button primary-button--fit" type="button" data-review-approve="${escapeHtml(x.id)}">通過</button><button class="secondary-button primary-button--fit" type="button" data-review-reject="${escapeHtml(x.id)}">退件</button></div>` : ''}</article>`).join('') : '<div class="empty-state"><h3>查無作業回傳</h3></div>';
    host.querySelectorAll('[data-review-approve]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewApprove, 'approve', button));
    host.querySelectorAll('[data-review-reject]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewReject, 'reject', button));
  }

  async function reviewSubmission(id, decision, button) {
    let reason = '';
    if (decision === 'reject') { reason = prompt('請輸入退件原因（必填）', '') ?? ''; if (!reason.trim()) return; }
    else if (!confirm('確定將這份作業設為「已通過」？')) return;
    setButtonBusy(button, true);
    try {
      const data = await api('reviewSubmission', { id, decision, reason });
      state.adminSubmissions = data;
      state.adminSubmissionsLoadedAt = Date.now();
      state.overviewDirty = true;
      renderAdminSubmissions();
      showToast(data.message || '審核完成');
    } catch (error) { setButtonBusy(button, false); showToast(error.message || '審核失敗'); }
  }

  function renderStudentSubmissionShell(lesson) {
    const host = $('lessonContent'); if (!host) return;
    let card = host.querySelector('[data-student-submission]');
    if (!card) { card = document.createElement('article'); card.className = 'content-block v1-student-submission'; card.dataset.studentSubmission = '1'; host.appendChild(card); }
    card.innerHTML = '<h3>作業／附件回傳</h3><div class="loading-list">載入作業狀態…</div>';
  }


  async function clearForceCompletePackage(button) {
    const employeeId = button.dataset.employeeId, packageId = button.dataset.packageId;
    if (!confirm('確定取消教育中心強制通過？取消後會恢復依實際子課程進度判定。')) return;
    setButtonBusy(button, true, '處理中…');
    try {
      const data = await api('clearForceCompletePackage', { employeeId, packageId });
      state.adminOverview = Array.isArray(data.overview) ? data.overview : state.adminOverview;
      state.overviewDirty = false;
      showToast(data.message || '已取消強制通過');
      renderAdmin();
    } catch (error) { showToast(error.message || '操作失敗'); setButtonBusy(button, false); }
  }

  function cacheStudentSubmission(lessonId, data) {
    if (!lessonId || !data) return data;
    state.submissionCache.set(lessonId, { data, savedAt: Date.now() });
    return data;
  }

  function cachedStudentSubmission(lessonId) {
    const entry = state.submissionCache.get(lessonId);
    if (!entry) return null;
    if (Date.now() - entry.savedAt > SUBMISSION_CACHE_MS) { state.submissionCache.delete(lessonId); return null; }
    return entry.data;
  }

  function requestStudentSubmission(lessonId, force = false) {
    if (!force) {
      const cached = cachedStudentSubmission(lessonId);
      if (cached) return Promise.resolve(cached);
      const inflight = state.submissionInflight.get(lessonId);
      if (inflight) return inflight;
    }
    const task = api('getSubmission', { lessonId })
      .then(data => cacheStudentSubmission(lessonId, data))
      .finally(() => state.submissionInflight.delete(lessonId));
    state.submissionInflight.set(lessonId, task);
    return task;
  }

  async function loadStudentSubmission(lessonId, force = false) {
    try {
      const cached = !force ? cachedStudentSubmission(lessonId) : null;
      if (cached && state.activeLessonId === lessonId) {
        state.activeSubmission = cached;
        state.uploadConfig = { ...state.uploadConfig, ...(cached.config || {}) };
        renderStudentSubmission();
        return;
      }
      const data = await requestStudentSubmission(lessonId, force);
      if (state.activeLessonId !== lessonId) return;
      state.activeSubmission = data;
      state.uploadConfig = { ...state.uploadConfig, ...(data.config || {}) };
      renderStudentSubmission();
    } catch (error) { showToast(error.message || '無法載入作業狀態'); }
  }

  function renderStudentSubmission() {
    const { lesson } = activeLesson();
    const card = document.querySelector('[data-student-submission]');
    if (!lesson || !card || !state.activeSubmission) return;
    const data = state.activeSubmission;
    const sub = data.latest;
    const status = sub?.status || '尚未上傳';
    const files = sub?.files || [];
    const locked = status === '待審核' || status === '已通過';
    const required = (data.mode || lesson.submissionMode) === '必繳審核';
    card.innerHTML = `<div class="v1-sub-title"><div><h3>作業／附件回傳</h3><p class="package-meta">${required ? '必須送出並由教育中心審核通過' : '選填，不影響課程完成'}</p></div><span class="tag ${submissionStatusClass(status)}">${escapeHtml(status)}</span></div>${data.note ? `<div class="v1-assignment-note">${escapeHtml(data.note)}</div>` : ''}${sub ? `<div class="v1-sub-meta"><span>V${String(Math.max(1,n(sub.version))).padStart(2,'0')}</span><span>${sub.submittedAt ? `送出：${escapeHtml(sub.submittedAt)}` : '尚未送審'}</span></div>` : ''}${status === '已退件' && sub?.rejectReason ? `<div class="v1-reject-note"><strong>退件原因：</strong>${escapeHtml(sub.rejectReason)}</div>` : ''}<div class="v1-uploaded-list">${files.map(file => `<div class="v1-uploaded-file"><span><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}${file.uploadedAt ? `｜${escapeHtml(file.uploadedAt)}` : ''}</small></span>${status === '未送審' ? `<button class="mini-button mini-button--danger" type="button" data-remove-upload="${escapeHtml(file.id)}">刪除</button>` : ''}</div>`).join('') || '<div class="manage-empty">目前沒有附件</div>'}</div>${!locked ? `<div class="v1-upload-box"><input id="submissionFiles" type="file" multiple accept="${(data.config?.allowedExtensions || state.uploadConfig.allowedExtensions || []).map(x => '.' + x).join(',')}"><small>一次最多 ${data.config?.maxFilesPerBatch || 5} 個；單檔最多 ${data.config?.maxMb || 20} MB；每一版最多 ${data.config?.maxFilesPerSubmission || 20} 個。</small><div id="selectedSubmissionFiles" class="v1-selected-files"></div><button id="uploadSubmissionFilesButton" class="secondary-button primary-button--fit" type="button" disabled>選擇檔案後上傳</button></div>` : ''}${status === '未送審' && files.length ? '<button class="primary-button" type="button" data-submit-review>送出教育中心審核</button>' : ''}${status === '待審核' ? '<div class="v1-lock-note">已送出審核，附件目前已鎖定；若退件後可建立新版重新上傳。</div>' : ''}${status === '已通過' ? '<div class="v1-pass-note">教育中心已審核通過。</div>' : ''}`;
    const complete = $('completeLessonButton');
    if (required && lesson.status !== 'complete') {
      const approved = status === '已通過';
      complete.disabled = !approved;
      complete.textContent = approved ? '完成此子課程' : '需先完成作業審核';
    }
    bindStudentSubmissionEvents(lesson, data.config || state.uploadConfig);
  }

  function bindStudentSubmissionEvents(lesson, config) {
    const input = $('submissionFiles'), upload = $('uploadSubmissionFilesButton'), selected = $('selectedSubmissionFiles');
    if (input) input.onchange = () => {
      const files = [...(input.files || [])];
      if (files.length > n(config.maxFilesPerBatch || 5)) { showToast(`一次最多選擇 ${config.maxFilesPerBatch || 5} 個檔案`); input.value = ''; return; }
      const allowed = (config.allowedExtensions || []).map(x => clean(x).toLowerCase());
      const maxBytes = n(config.maxMb || 20) * 1024 * 1024;
      const invalid = files.find(file => file.size > maxBytes || (allowed.length && !allowed.includes((file.name.split('.').pop() || '').toLowerCase())));
      if (invalid) { showToast(`${invalid.name} 的格式不支援或超過 ${config.maxMb || 20} MB`); input.value = ''; return; }
      state.selectedSubmissionFiles = files;
      selected.innerHTML = files.map(file => `<span>${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></span>`).join('');
      upload.disabled = !files.length;
      upload.textContent = files.length ? `上傳 ${files.length} 個檔案` : '選擇檔案後上傳';
    };
    if (upload) upload.onclick = () => uploadSubmissionFiles(lesson, upload);
    document.querySelectorAll('[data-remove-upload]').forEach(button => button.onclick = () => removeSubmissionFile(lesson, button.dataset.removeUpload, button));
    document.querySelector('[data-submit-review]')?.addEventListener('click', () => submitSubmission(lesson));
  }

  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const value = String(reader.result || ''); resolve(value.slice(value.indexOf(',') + 1)); };
      reader.onerror = () => reject(new Error(`無法讀取檔案：${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function uploadSubmissionFiles(lesson, button) {
    const files = [...state.selectedSubmissionFiles];
    if (!files.length) return;
    button.disabled = true;
    try {
      const totalBytes = files.reduce((sum, file) => sum + n(file.size), 0);
      const canBatch = !!state.features.batchUploadV114 && files.length > 1 && totalBytes <= 6 * 1024 * 1024;
      if (canBatch) {
        button.textContent = `整理 ${files.length} 個檔案…`;
        const encoded = await Promise.all(files.map(async file => ({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileBase64: await fileBase64(file)
        })));
        button.textContent = `一次上傳 ${files.length} 個檔案…`;
        state.activeSubmission = cacheStudentSubmission(lesson.id, await api('uploadSubmissionFilesBatch', { lessonId: lesson.id, files: encoded }, state.token, { timeout: 120000 }));
      } else {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          button.textContent = `上傳中 ${i + 1}/${files.length}…`;
          const fileBase64Value = await fileBase64(file);
          state.activeSubmission = cacheStudentSubmission(lesson.id, await api('uploadSubmissionFile', { lessonId: lesson.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileBase64: fileBase64Value }, state.token, { timeout: 60000 }));
        }
      }
      state.selectedSubmissionFiles = [];
      renderStudentSubmission();
      showToast('檔案已上傳');
    } catch (error) { button.disabled = false; button.textContent = '重新上傳'; showToast(error.message || '上傳失敗'); }
  }

  async function removeSubmissionFile(lesson, fileId, button) {
    if (!confirm('確定刪除這個尚未送審的附件？')) return;
    setButtonBusy(button, true);
    try { state.activeSubmission = cacheStudentSubmission(lesson.id, await api('removeSubmissionFile', { lessonId: lesson.id, fileId })); renderStudentSubmission(); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '刪除失敗'); }
  }

  async function submitSubmission(lesson) {
    if (!confirm('送出後附件會鎖定，教育中心審核前不能再修改。\n\n確定送出審核？')) return;
    try { state.activeSubmission = cacheStudentSubmission(lesson.id, await api('submitSubmission', { lessonId: lesson.id })); renderStudentSubmission(); showToast('已送出教育中心審核'); }
    catch (error) { showToast(error.message || '送出失敗'); }
  }

  async function setAdminTab(tab, refresh = true, persist = true) {
    state.adminTab = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.adminTab === tab));
    $('adminTrackingPanel').hidden = !['people', 'courses'].includes(tab);
    $('adminManagePanel').hidden = tab !== 'manage';
    $('adminPeoplePanel').hidden = tab !== 'people';
    $('adminCoursesPanel').hidden = tab !== 'courses';
    if ($('adminSubmissionPanel')) $('adminSubmissionPanel').hidden = tab !== 'submissions';
    if (tab === 'manage') {
      if (state.features.lazyDataV114 && !state.adminCatalogLoaded) {
        if ($('adminCatalogList')) $('adminCatalogList').innerHTML = '<div class="empty-state"><h3>正在載入課程管理資料…</h3></div>';
        ensureAdminCatalog().catch(error => showToast(error.message || '課程管理資料載入失敗'));
      } else renderAdminManage();
    }
    if (tab === 'submissions') loadAdminSubmissions();
    if (refresh && ['people', 'courses'].includes(tab)) ensureAdminOverview();
    if (persist) saveViewState({ view: 'admin', adminTab: tab, scrollY: 0 });
  }

  function setStudentTab(tab, persist = true) {
    document.querySelectorAll('[data-student-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.studentTab === tab));
    $('studentCoursesPanel').hidden = tab !== 'courses';
    $('studentRecordsPanel').hidden = tab !== 'records';
    state.studentTab = tab;
    if (tab === 'courses' && state.features.lazyDataV114 && !state.studentPackagesLoaded) {
      ensureStudentPackages().catch(error => showToast(error.message || '課程載入失敗'));
    }
    if (persist) saveViewState({ view: 'student', studentTab: tab, scrollY: 0 });
  }

  function logout() {
    // V1.1.4: 使用者按下登出後立即切回登入頁；伺服器 session 清除改為背景執行。
    const token = state.token;
    if (state.activeLessonId && !state.previewMode && state.tracker?.dirty) flushProgress(false).catch(() => {});
    stopTracker();
    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt = 0; state.studentPackagesLoaded = false; state.adminCatalogLoaded = false; state.studentPackagesLoading = null; state.adminCatalogLoading = null; state.activePackageId = ''; state.activeLessonId = ''; state.previewMode = false; state.activeSubmission = null;
    clearSession();
    clearViewState();
    $('dashboardView').hidden = true; $('studentDashboard').hidden = true; $('adminDashboard').hidden = true; $('lessonPage').hidden = true; $('loginView').hidden = false; $('password').value = '';
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (token) api('logout', {}, token, { timeout: 10000 }).catch(() => {});
  }

  function bindStaticEvents() {
    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      $('loginMessage').hidden = true;
      const button = $('loginButton'); setButtonBusy(button, true, '登入中…');
      try { await login(clean($('employeeId').value), clean($('password').value)); }
      catch (error) { state.token = ''; clearSession(); $('loginMessage').textContent = error.message || '登入失敗'; $('loginMessage').hidden = false; }
      finally { setButtonBusy(button, false); }
    });
    $('togglePassword').onclick = () => { const input = $('password'); input.type = input.type === 'password' ? 'text' : 'password'; $('togglePassword').textContent = input.type === 'password' ? '顯示' : '隱藏'; };
    $('logoutButton').onclick = logout;
    $('backLessonButton').onclick = () => closeLesson();
    $('lessonBackBottomButton').onclick = () => closeLesson();
    $('completeLessonButton').onclick = completeActiveLesson;
    $('nextLessonButton').onclick = goNextLesson;
    $('newPackageButton').onclick = () => openPackageEditor(null);
    $('exportProgressButton').onclick = exportProgress;
    $('closeAdminEditorButton').onclick = closeAdminEditor;
    $('adminEditorOverlay').onclick = event => { if (event.target === $('adminEditorOverlay')) closeAdminEditor(); };
    document.querySelectorAll('[data-student-tab]').forEach(button => button.onclick = () => setStudentTab(button.dataset.studentTab));
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.onclick = () => setAdminTab(button.dataset.adminTab));
    $('adminSearch').oninput = () => { renderAdminPeople(); renderAdminCourses(); };
    window.addEventListener('beforeunload', () => { saveViewState(); if (state.tracker?.dirty) flushProgress(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { saveViewState(); if (state.tracker?.dirty) flushProgress(false); } });
    let viewSaveTimer = 0;
    window.addEventListener('scroll', () => { clearTimeout(viewSaveTimer); viewSaveTimer = setTimeout(() => saveViewState(), 180); }, { passive: true });
  }

  async function init() {
    loadFoldState();
    bindStaticEvents();
    const healthTask = checkHealth();
    const restored = await restoreSession();
    if (!restored) { if ($('bootView')) $('bootView').hidden = true; $('loginView').hidden = false; $('dashboardView').hidden = true; }
    healthTask.catch(() => {});
  }

  init();
})();
