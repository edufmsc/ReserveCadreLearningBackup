const fs = require('fs');
const path = 'app.js';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const index = s.indexOf(from);
  if (index < 0) throw new Error('Missing patch target: ' + label);
  if (s.indexOf(from, index + from.length) >= 0) throw new Error('Patch target is not unique: ' + label);
  s = s.slice(0, index) + to + s.slice(index + from.length);
}

replaceOnce(
  "    adminSubmissions: { items: [], config: null, rootFolderUrl: '' },\n    adminSubmissionsLoadedAt: 0\n  };",
  "    adminSubmissions: { items: [], config: null, rootFolderUrl: '' },\n    adminSubmissionsLoadedAt: 0,\n    studentPackagesLoaded: false,\n    adminCatalogLoaded: false,\n    studentPackagesLoading: null,\n    adminCatalogLoading: null\n  };",
  'lazy state flags'
);

replaceOnce(
  "    const retryable = options.retry === true || ['health', 'bootstrap', 'adminOverview'].includes(action);",
  "    const retryable = options.retry === true || ['health', 'bootstrap', 'adminOverview', 'studentPackages', 'adminCatalog'].includes(action);",
  'retryable lazy endpoints'
);

replaceOnce(
`  function captureBootstrap(data) {
    state.user = data.user || null;
    state.mode = data.mode || '';
    state.features = { ...state.features, ...(data.features || {}) };
    state.uploadConfig = { ...state.uploadConfig, ...(data.uploadConfig || {}) };
    if (data.mode === 'admin') {
      state.adminOverview = Array.isArray(data.overview) ? data.overview : [];
      state.adminCatalog = data.catalog || { packages: [], learners: [], assignments: [] };
      state.packages = [];
      state.overviewDirty = false;
    } else {
      state.packages = Array.isArray(data.packages) ? data.packages : [];
      state.adminOverview = [];
      state.adminCatalog = { packages: [], learners: [], assignments: [] };
    }
  }`,
`  function captureBootstrap(data) {
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
  }`,
  'capture bootstrap and lazy data helpers'
);

replaceOnce(
`    captureBootstrap(bootstrap);
    renderDashboard();
  }

  async function restoreSession()`,
`    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
  }

  async function restoreSession()`,
  'background load after login'
);

replaceOnce(
`      captureBootstrap(data);
      saveSession();
      renderDashboard();
      await restoreSavedView();
      return true;`,
`      captureBootstrap(data);
      saveSession();
      renderDashboard();
      if (state.features.lazyDataV114 && state.user?.roleKey !== 'admin') {
        try { await ensureStudentPackages(); } catch (error) { showToast(error.message || '課程載入失敗'); }
      }
      await restoreSavedView();
      hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
      return true;`,
  'lazy restore session'
);

replaceOnce(
`    $('packageList').innerHTML = state.packages.length ? state.packages.map(renderPackageCard).join('') : '<div class="empty-state"><h3>目前沒有指派課程</h3></div>';`,
`    $('packageList').innerHTML = state.packages.length ? state.packages.map(renderPackageCard).join('') : (state.features.lazyDataV114 && !state.studentPackagesLoaded ? '<div class="empty-state"><h3>正在載入課程…</h3></div>' : '<div class="empty-state"><h3>目前沒有指派課程</h3></div>');`,
  'student loading state'
);

replaceOnce(
`    if (data?.catalog) state.adminCatalog = data.catalog;`,
`    if (data?.catalog) { state.adminCatalog = data.catalog; state.adminCatalogLoaded = true; }`,
  'admin save catalog loaded flag'
);

replaceOnce(
`  async function setAdminTab(tab, refresh = true, persist = true) {
    state.adminTab = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.adminTab === tab));
    $('adminTrackingPanel').hidden = !['people', 'courses'].includes(tab);
    $('adminManagePanel').hidden = tab !== 'manage';
    $('adminPeoplePanel').hidden = tab !== 'people';
    $('adminCoursesPanel').hidden = tab !== 'courses';
    if ($('adminSubmissionPanel')) $('adminSubmissionPanel').hidden = tab !== 'submissions';
    if (tab === 'manage') renderAdminManage();
    if (tab === 'submissions') loadAdminSubmissions();
    if (refresh && ['people', 'courses'].includes(tab)) ensureAdminOverview();
    if (persist) saveViewState({ view: 'admin', adminTab: tab, scrollY: 0 });
  }

  function setStudentTab(tab, persist = true) {
    document.querySelectorAll('[data-student-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.studentTab === tab));
    $('studentCoursesPanel').hidden = tab !== 'courses';
    $('studentRecordsPanel').hidden = tab !== 'records';
    state.studentTab = tab;
    if (persist) saveViewState({ view: 'student', studentTab: tab, scrollY: 0 });
  }`,
`  async function setAdminTab(tab, refresh = true, persist = true) {
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
  }`,
  'lazy tabs'
);

replaceOnce(
`    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt = 0;`,
`    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt = 0; state.studentPackagesLoaded = false; state.adminCatalogLoaded = false; state.studentPackagesLoading = null; state.adminCatalogLoading = null;`,
  'logout lazy reset'
);

fs.writeFileSync(path, s, 'utf8');
console.log('Patched app.js for V1.1.4 lazy data compatibility:', Buffer.byteLength(s), 'bytes');
