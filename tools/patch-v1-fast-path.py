from pathlib import Path
import json

p=Path('app.js')
s=p.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    c=s.count(old)
    if c!=count: raise SystemExit(f'{label}: expected {count}, got {c}')
    s=s.replace(old,new,count)

rep("const SAFE_RETRY_ACTIONS = new Set(['health','bootstrap','studentPackages','adminOverview','adminCatalog','getSubmission','adminSubmissions','getPdfContent','exportProgress']);",
    "const SAFE_RETRY_ACTIONS = new Set(['health','bootstrap','studentPackages','studentHome','studentLesson','adminOverview','adminTracking','adminTrackingDetail','adminCatalog','getSubmission','adminSubmissions','getPdfContent','exportProgress']);",'safe read actions')
rep("if (['studentPackages','adminOverview','adminCatalog','getSubmission','adminSubmissions','exportProgress'].includes(action)) return 12000;",
    "if (['studentPackages','studentHome','studentLesson','adminOverview','adminTracking','adminTrackingDetail','adminCatalog','getSubmission','adminSubmissions','exportProgress'].includes(action)) return 12000;",'timeouts')

rep("""  function contentTypes(lesson) {
    const types = [...new Set((lesson.contents || []).filter(c => c.enabled !== false).map(c => contentTypeLabel(c.type)))];
    return types.join('＋') || '教材';
  }""",
"""  function contentTypes(lesson) {
    if (Array.isArray(lesson?.contentTypes)) {
      const types = [...new Set(lesson.contentTypes.map(contentTypeLabel).filter(Boolean))];
      return types.join('＋') || (n(lesson.contentCount) ? '教材' : '無教材');
    }
    const types = [...new Set((lesson?.contents || []).filter(c => c.enabled !== false).map(c => contentTypeLabel(c.type)))];
    return types.join('＋') || '教材';
  }""",'summary content types')

rep("""    const task = api('studentPackages', {}, state.token, { retry: true, timeout: 12000 })
      .then(data => {""",
"""    const action = state.features.splitReadV1 ? 'studentHome' : 'studentPackages';
    const task = api(action, {}, state.token, { retry: true, timeout: 12000 })
      .then(data => {""",'student home action')

rep("""      const data = await api('adminOverview', {}, state.token, { retry: true, timeout: 12000 });""",
    """      const action = state.features.splitReadV1 ? 'adminTracking' : 'adminOverview';
      const data = await api(action, {}, state.token, { retry: true, timeout: 12000 });""",'admin tracking action')

old_login="""  async function login(account, password) {
    const generation = ++state.authGeneration;
    clearViewState();
    const data = await api('login', { employeeId: account, password }, '', { timeout: 18000 });
    if (generation !== state.authGeneration) {
      if (data?.sessionToken) api('logout', {}, data.sessionToken, { timeout: 5000, retry: false }).catch(() => {});
      return false;
    }
    state.token = data.sessionToken;
    saveSession();
    const bootstrap = data.bootstrap || await api('bootstrap', {}, state.token, { retry: true, timeout: 12000 });
    if (generation !== state.authGeneration) return false;
    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
    return true;
  }"""
new_login="""  async function login(account, password) {
    const generation = ++state.authGeneration;
    clearViewState();
    const requestId = `L${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`;
    const payload = { employeeId: account, password, requestId };
    let data;
    try {
      data = await api('login', payload, '', { timeout: 18000, retry: false });
    } catch (error) {
      const canRetry = !!state.features.loginRetryV1 && ['TIMEOUT','NETWORK_ERROR','NON_JSON_RESPONSE'].includes(error?.code || '');
      if (!canRetry || generation !== state.authGeneration) throw error;
      setModeBadge('checking', '後端正在啟動｜自動續登入');
      await new Promise(resolve => setTimeout(resolve, 700));
      data = await api('login', payload, '', { timeout: 22000, retry: false });
    }
    if (generation !== state.authGeneration) {
      if (data?.sessionToken) api('logout', {}, data.sessionToken, { timeout: 5000, retry: false }).catch(() => {});
      return false;
    }
    state.token = data.sessionToken;
    saveSession();
    const bootstrap = data.bootstrap || await api('bootstrap', {}, state.token, { retry: true, timeout: 12000 });
    if (generation !== state.authGeneration) return false;
    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
    return true;
  }"""
rep(old_login,new_login,'login retry')

# Insert learner detail loader before openLesson.
anchor='  async function openLesson(packageId, lessonId) {'
idx=s.index(anchor)
block=r'''  async function ensureStudentLessonDetail(packageId, lessonId) {
    let found = findStudentLesson(packageId, lessonId);
    if (!state.features.splitReadV1 || found.lesson?.detailLoaded !== false) return found;
    const data = await api('studentLesson', { lessonId }, state.token, { retry: true, timeout: 12000 });
    const detail = data?.lesson;
    if (!detail?.id) throw new Error('教材資料格式不完整');
    const pkg = state.packages.find(x => x.id === (data.packageId || packageId));
    if (!pkg) throw new Error('找不到課程');
    const position = (pkg.lessons || []).findIndex(x => x.id === detail.id);
    if (position < 0) throw new Error('找不到子課程');
    pkg.lessons[position] = { ...pkg.lessons[position], ...detail, detailLoaded: true };
    return { pkg, lesson: pkg.lessons[position] };
  }

'''
s=s[:idx]+block+s[idx:]

rep("""  async function openLesson(packageId, lessonId) {
    let { pkg, lesson } = findStudentLesson(packageId, lessonId);
    if (!pkg || !lesson) return;
    state.activePackageId = packageId;
    state.activeLessonId = lessonId;""",
"""  async function openLesson(packageId, lessonId) {
    let { pkg, lesson } = findStudentLesson(packageId, lessonId);
    if (!pkg || !lesson) return;
    if (state.features.splitReadV1 && lesson.detailLoaded === false) {
      state.activePackageId = packageId;
      state.activeLessonId = lessonId;
      $('studentDashboard').hidden = true;
      $('adminDashboard').hidden = true;
      $('lessonPage').hidden = false;
      $('lessonPackageName').textContent = pkg.title;
      $('lessonTitle').textContent = visibleLessonTitle(lesson);
      $('lessonMeta').innerHTML = '';
      $('lessonContent').innerHTML = '<div class=\"empty-state\"><h3>正在載入教材…</h3><p>先載入需要的這一堂，不下載其他課程教材。</p></div>';
      try { ({ pkg, lesson } = await ensureStudentLessonDetail(packageId, lessonId)); }
      catch (error) { $('lessonPage').hidden = true; $('studentDashboard').hidden = false; showToast(error.message || '教材載入失敗'); return; }
    }
    state.activePackageId = packageId;
    state.activeLessonId = lessonId;""",'learner lazy detail')

# Admin detail helper and lazy person package body.
anchor='  function renderAdminPersonPackage(person, pkg) {'
idx=s.index(anchor)
helper=r'''  async function ensureAdminTrackingDetail(employeeId, packageId) {
    const person = (state.adminOverview || []).find(x => clean(x.employeeId) === clean(employeeId));
    let pkg = (person?.packages || []).find(x => clean(x.id) === clean(packageId));
    if (!state.features.splitReadV1 || Array.isArray(pkg?.lessons)) return { person, pkg };
    const data = await api('adminTrackingDetail', { employeeId, packageId }, state.token, { retry: true, timeout: 12000 });
    if (!data?.package) throw new Error('找不到課程細項');
    if (person) {
      const position = (person.packages || []).findIndex(x => clean(x.id) === clean(packageId));
      if (position >= 0) person.packages[position] = { ...person.packages[position], ...data.package };
      pkg = person.packages[position];
    } else pkg = data.package;
    return { person, pkg };
  }

  function adminPackageDetailHtml(pkg) {
    if (!pkg) return '<div class="manage-empty">找不到課程細項</div>';
    const summary = packageSummary(pkg);
    const forcedMeta = pkg.forcedComplete ? `<div class="force-complete-note">教育中心人工通過${pkg.forcedAt ? `｜${escapeHtml(pkg.forcedAt)}` : ''}${pkg.forcedBy ? `｜${escapeHtml(pkg.forcedBy)}` : ''}${pkg.forcedNote ? `<br>${escapeHtml(pkg.forcedNote)}` : ''}</div>` : '';
    const lessons = (pkg.lessons || []).map(lesson => `<div class="admin-lesson-row"><strong>${escapeHtml(visibleLessonTitle(lesson))}</strong>${statusTag(lesson.status)}<span class="admin-lesson-meta">影片 ${formatSeconds(lesson.videoSeconds)}｜PDF ${formatSeconds(lesson.pdfSeconds)}｜完成 ${formatDateTime(lesson.completedAt)}</span></div>`).join('');
    return forcedMeta + (lessons || `<div class="manage-empty">${summary.status === 'complete' ? '此課程已完成' : '此課程沒有子課程明細'}</div>`);
  }

  async function toggleAdminTrackingDetail(button) {
    const row = button.closest('.person-package');
    const body = row?.querySelector(':scope > .person-package__body');
    if (!body) return;
    if (!body.hidden) { body.hidden = true; button.classList.remove('is-open'); return; }
    if (body.dataset.loaded !== '1') {
      body.innerHTML = '<div class="manage-empty">正在載入細項…</div>';
      body.hidden = false;
      try {
        const { pkg } = await ensureAdminTrackingDetail(button.dataset.employeeId, button.dataset.packageId);
        body.innerHTML = adminPackageDetailHtml(pkg);
        body.dataset.loaded = '1';
      } catch (error) { body.innerHTML = `<div class="manage-empty">${escapeHtml(error.message || '細項載入失敗')}</div>`; }
    } else body.hidden = false;
    button.classList.add('is-open');
  }

'''
s=s[:idx]+helper+s[idx:]

start=s.index('  function renderAdminPersonPackage(person, pkg) {')
end=s.index('\n  function uniquePackagesForAdmin()',start)
replacement=r'''  function renderAdminPersonPackage(person, pkg) {
    const summary = packageSummary(pkg);
    const force = state.features.forceComplete && !pkg.forcedComplete && summary.status !== 'complete' ? `<button class="mini-button v1-force-button" type="button" data-force-complete data-employee-id="${escapeHtml(person.employeeId)}" data-package-id="${escapeHtml(pkg.id)}">強制通過</button>` : '';
    const clearForce = state.features.forceComplete && pkg.forcedComplete ? `<button class="mini-button" type="button" data-clear-force-complete data-employee-id="${escapeHtml(person.employeeId)}" data-package-id="${escapeHtml(pkg.id)}">取消強制通過</button>` : '';
    const alreadyDetailed = Array.isArray(pkg.lessons);
    return `<div class="person-package"><div class="person-package__head"><button class="person-package__toggle" type="button" data-admin-tracking-detail data-employee-id="${escapeHtml(person.employeeId)}" data-package-id="${escapeHtml(pkg.id)}"><span><strong>${escapeHtml(pkg.title)}</strong><small>${pkg.forcedComplete ? `人工通過｜原實際進度 ${summary.done}/${summary.total}` : `${summary.done}/${summary.total} 完成`}</small></span>${statusTag(summary.status)}</button><div class="person-package__quick-actions">${force}${clearForce}</div></div><div class="person-package__body" ${alreadyDetailed ? 'data-loaded="1"' : ''} hidden>${alreadyDetailed ? adminPackageDetailHtml(pkg) : ''}</div></div>`;
  }
'''
s=s[:start]+replacement+s[end:]

# Courses detail should use backend detail if summary-only.
start=s.index('  function renderAdminCoursePersonDetails(button) {')
end=s.index('\n  function bindAdminCourseViewEvents()',start)
replacement=r'''  async function renderAdminCoursePersonDetails(button) {
    const employeeId = clean(button.dataset.coursePerson);
    const packageId = clean(button.dataset.coursePackage);
    const row = button.closest('.person-package');
    const body = row?.querySelector(':scope > .person-package__body');
    if (!body) return;
    if (!body.hidden) { body.hidden = true; button.classList.remove('is-open'); return; }
    if (body.dataset.loaded !== '1') {
      body.innerHTML = '<div class="manage-empty">正在載入細項…</div>';
      body.hidden = false;
      try {
        const { pkg } = await ensureAdminTrackingDetail(employeeId, packageId);
        body.innerHTML = adminPackageDetailHtml(pkg);
        body.dataset.loaded = '1';
      } catch (error) { body.innerHTML = `<div class="manage-empty">${escapeHtml(error.message || '細項載入失敗')}</div>`; }
    } else body.hidden = false;
    button.classList.add('is-open');
  }
'''
s=s[:start]+replacement+s[end:]

# Bind detail buttons after people render, and stop generic binder from overriding them.
rep("""    document.querySelectorAll('[data-clear-force-complete]').forEach(button => button.onclick = () => clearForceCompletePackage(button));
  }""",
"""    document.querySelectorAll('[data-clear-force-complete]').forEach(button => button.onclick = () => clearForceCompletePackage(button));
    $('adminPeoplePanel')?.querySelectorAll('[data-admin-tracking-detail]').forEach(button => button.onclick = () => toggleAdminTrackingDetail(button));
  }""",'bind people detail')
rep("""    root?.querySelectorAll('.person-package__toggle').forEach(button => {
      button.onclick = () => {
        const body = button.closest('.person-package')?.querySelector(':scope > .person-package__body');
        if (body) body.hidden = !body.hidden;
      };
    });""",
"""    root?.querySelectorAll('.person-package__toggle:not([data-admin-tracking-detail]):not([data-course-person])').forEach(button => {
      button.onclick = () => {
        const body = button.closest('.person-package')?.querySelector(':scope > .person-package__body');
        if (body) body.hidden = !body.hidden;
      };
    });""",'generic accordion guard')

# Better login message: automatic retry is handled internally.
rep("""$('loginMessage').textContent = error?.code === 'TIMEOUT' ? '後端正在啟動或回應較慢，請稍候再按一次登入；不需要重新整理頁面。' : (error.message || '登入失敗');""",
    """$('loginMessage').textContent = error?.code === 'TIMEOUT' ? '後端本次啟動超過等待時間，請稍候再試。' : (error.message || '登入失敗');""",'login error text')

# Student report panel participates in tab switching; iframe only loads on demand.
rep("""    $('studentRecordsPanel').hidden = tab !== 'records';
    state.studentTab = tab;""",
"""    $('studentRecordsPanel').hidden = tab !== 'records';
    if ($('studentReportPanel')) $('studentReportPanel').hidden = tab !== 'report';
    if (tab === 'report') {
      const frame = $('recordReportFrame');
      if (frame && !frame.dataset.loaded) { frame.src = frame.dataset.src || frame.src; frame.dataset.loaded = '1'; }
    }
    state.studentTab = tab;""",'report tab lazy')
rep("""    state.studentTab = saved.studentTab === 'records' ? 'records' : 'courses';""",
    """    state.studentTab = ['records','report'].includes(saved.studentTab) ? saved.studentTab : 'courses';""",'restore report tab')

p.write_text(s,encoding='utf-8')

# index: truly lazy Google Form and cache-bust Fast Path frontend.
idx=Path('index.html'); h=idx.read_text(encoding='utf-8')
h=h.replace('<section id="studentReportPanel" class="tab-panel" aria-label="紀錄回報">','<section id="studentReportPanel" class="tab-panel" aria-label="紀錄回報" hidden>',1)
h=h.replace('id="recordReportFrame" class="report-frame" title="實際錄用紀錄回報問卷" src="https://forms.gle/rSCuspJrPx5YmKAp7" loading="lazy"','id="recordReportFrame" class="report-frame" title="實際錄用紀錄回報問卷" src="about:blank" data-src="https://forms.gle/rSCuspJrPx5YmKAp7" loading="lazy"',1)
h=h.replace("frame.src = FORM_URL;","frame.src = FORM_URL;\n          frame.dataset.loaded = '1';",1)
h=h.replace('app.js?v=1.0-adminfilter-20260828','app.js?v=1.0-fastpath-20260831',1)
idx.write_text(h,encoding='utf-8')

# contract includes backend Fast Path actions/flags. Frontend only uses them when deployed.
cp=Path('apps-script/contract.json'); c=json.loads(cp.read_text(encoding='utf-8'))
for action in ['studentHome','studentLesson','adminTracking','adminTrackingDetail']:
    if action not in c['actions']:
        c['actions'].insert(c['actions'].index('adminCatalog') if action.startswith('admin') else c['actions'].index('adminOverview'), action)
for feature in ['fastPathV1','loginRetryV1','splitReadV1','warmSnapshotV1']:
    c['features'][feature]=True
cp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

vp=Path('tools/verify-contract.js'); v=vp.read_text(encoding='utf-8')
v=v.replace("'health','login','logout','bootstrap','studentPackages','adminOverview','adminCatalog',","'health','login','logout','bootstrap','studentPackages','studentHome','studentLesson','adminOverview','adminTracking','adminTrackingDetail','adminCatalog',")
v=v.replace("'packageDirectSubmissionV116','contentMoveV1','courseReuseV1']","'packageDirectSubmissionV116','contentMoveV1','courseReuseV1','fastPathV1','loginRetryV1','splitReadV1','warmSnapshotV1']")
vp.write_text(v,encoding='utf-8')
