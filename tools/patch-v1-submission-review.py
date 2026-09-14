from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

def rep(old, new, label, count=1):
    global s
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'{label}: expected {count}, got {actual}')
    s = s.replace(old, new, count)

rep("""    adminCourseSearch: '',
    adminCourseSort: 'attention'
  };""", """    adminCourseSearch: '',
    adminCourseSort: 'attention',
    adminSubmissionSearch: '',
    adminSubmissionStatus: '',
    adminSubmissionArea: ''
  };""", 'submission filter state')

old_render = """  function renderAdminSubmissions() {
    const body = $('submissionAdminBody'); if (!body) return;
    const items = state.adminSubmissions.items || [];
    const counts = { pending: items.filter(x => x.status === '待審核').length, rejected: items.filter(x => x.status === '已退件').length, approved: items.filter(x => x.status === '已通過').length };
    body.innerHTML = `<div class=\"summary-grid\"><article class=\"summary-card\"><span>待審核</span><strong>${counts.pending}</strong></article><article class=\"summary-card\"><span>已退件</span><strong>${counts.rejected}</strong></article><article class=\"summary-card\"><span>已通過</span><strong>${counts.approved}</strong></article></div><div class=\"v1-sub-toolbar\"><input id=\"submissionSearch\" type=\"search\" placeholder=\"搜尋帳號、姓名、店別、課程或子課程\"><select id=\"submissionFilter\"><option value=\"\">全部狀態</option><option value=\"待審核\">待審核</option><option value=\"已退件\">已退件</option><option value=\"已通過\">已通過</option><option value=\"未送審\">未送審</option></select>${state.adminSubmissions.rootFolderUrl ? `<a class=\"secondary-button primary-button--fit\" href=\"${escapeHtml(state.adminSubmissions.rootFolderUrl)}\" target=\"_blank\" rel=\"noopener\">開啟回傳資料夾</a>` : ''}</div><div id=\"submissionAdminList\" class=\"v1-sub-list\"></div>`;
    $('submissionSearch').oninput = renderAdminSubmissionList;
    $('submissionFilter').onchange = renderAdminSubmissionList;
    renderAdminSubmissionList();
  }"""
new_render = """  function renderAdminSubmissions() {
    const body = $('submissionAdminBody'); if (!body) return;
    const items = state.adminSubmissions.items || [];
    const counts = { pending: items.filter(x => x.status === '待審核').length, rejected: items.filter(x => x.status === '已退件').length, approved: items.filter(x => x.status === '已通過').length };
    const areas = [...new Set(items.map(x => clean(x.area)).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
    if (state.adminSubmissionArea && !areas.includes(state.adminSubmissionArea)) state.adminSubmissionArea = '';
    const areaOptions = areas.map(area => `<option value=\"${escapeHtml(area)}\" ${area === state.adminSubmissionArea ? 'selected' : ''}>${escapeHtml(area)}</option>`).join('');
    body.innerHTML = `<div class=\"summary-grid\"><article class=\"summary-card\"><span>待審核</span><strong>${counts.pending}</strong></article><article class=\"summary-card\"><span>已退件</span><strong>${counts.rejected}</strong></article><article class=\"summary-card\"><span>已通過</span><strong>${counts.approved}</strong></article></div><div class=\"v1-sub-toolbar\"><input id=\"submissionSearch\" type=\"search\" value=\"${escapeHtml(state.adminSubmissionSearch)}\" placeholder=\"搜尋帳號、姓名、區域、店別、課程或子課程\"><select id=\"submissionAreaFilter\"><option value=\"\">全部區域</option>${areaOptions}</select><select id=\"submissionFilter\"><option value=\"\" ${!state.adminSubmissionStatus ? 'selected' : ''}>全部狀態</option><option value=\"待審核\" ${state.adminSubmissionStatus === '待審核' ? 'selected' : ''}>待審核</option><option value=\"已退件\" ${state.adminSubmissionStatus === '已退件' ? 'selected' : ''}>已退件</option><option value=\"已通過\" ${state.adminSubmissionStatus === '已通過' ? 'selected' : ''}>已通過</option><option value=\"未送審\" ${state.adminSubmissionStatus === '未送審' ? 'selected' : ''}>未送審</option></select>${state.adminSubmissions.rootFolderUrl ? `<a class=\"secondary-button primary-button--fit\" href=\"${escapeHtml(state.adminSubmissions.rootFolderUrl)}\" target=\"_blank\" rel=\"noopener\">開啟回傳資料夾</a>` : ''}</div><div id=\"submissionAdminList\" class=\"v1-sub-list\"></div>`;
    $('submissionSearch').oninput = event => { state.adminSubmissionSearch = event.currentTarget.value; renderAdminSubmissionList(); };
    $('submissionAreaFilter').onchange = event => { state.adminSubmissionArea = event.currentTarget.value; renderAdminSubmissionList(); };
    $('submissionFilter').onchange = event => { state.adminSubmissionStatus = event.currentTarget.value; renderAdminSubmissionList(); };
    renderAdminSubmissionList();
  }"""
rep(old_render, new_render, 'renderAdminSubmissions')

old_list = """  function renderAdminSubmissionList() {
    const host = $('submissionAdminList'); if (!host) return;
    const q = normalize($('submissionSearch')?.value), filter = $('submissionFilter')?.value || '';
    const items = (state.adminSubmissions.items || []).filter(x => (!filter || x.status === filter) && (!q || normalize(`${x.employeeId} ${x.name} ${x.store} ${x.courseTitle} ${x.lessonTitle}`).includes(q)));
    host.innerHTML = items.length ? items.map(x => `<article class=\"card v1-sub-admin-card\"><div class=\"v1-sub-card-head\"><div><strong>${escapeHtml(x.name || x.employeeId)}｜${escapeHtml(x.employeeId)}</strong><p class=\"package-meta\">${escapeHtml(x.store || '')}｜${escapeHtml(x.courseTitle)} → ${escapeHtml(x.lessonTitle === '__PACKAGE_DIRECT__' ? '課程回傳' : x.lessonTitle)}</p></div><span class=\"tag ${submissionStatusClass(x.status)}\">${escapeHtml(x.status)}</span></div><div class=\"v1-sub-meta\"><span>V${String(Math.max(1,n(x.version))).padStart(2,'0')}</span><span>送出：${escapeHtml(x.submittedAt || '—')}</span><span>審核：${escapeHtml(x.reviewedAt || '—')}</span></div>${x.rejectReason ? `<div class=\"v1-reject-note\"><strong>退件原因：</strong>${escapeHtml(x.rejectReason)}</div>` : ''}<div class=\"v1-file-grid\">${(x.files || []).map(file => `<a class=\"v1-file-link\" href=\"${escapeHtml(file.url)}\" target=\"_blank\" rel=\"noopener\">${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></a>`).join('') || '<span class=\"package-meta\">尚無附件</span>'}</div>${x.status === '待審核' ? `<div class=\"v1-review-actions\"><button class=\"primary-button primary-button--fit\" type=\"button\" data-review-approve=\"${escapeHtml(x.id)}\">通過</button><button class=\"secondary-button primary-button--fit\" type=\"button\" data-review-reject=\"${escapeHtml(x.id)}\">退件</button></div>` : ''}</article>`).join('') : '<div class=\"empty-state\"><h3>查無作業回傳</h3></div>';
    host.querySelectorAll('[data-review-approve]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewApprove, 'approve', button));
    host.querySelectorAll('[data-review-reject]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewReject, 'reject', button));
  }"""
new_list = """  function renderAdminSubmissionList() {
    const host = $('submissionAdminList'); if (!host) return;
    const q = normalize(state.adminSubmissionSearch), filter = state.adminSubmissionStatus || '', area = state.adminSubmissionArea || '';
    const items = (state.adminSubmissions.items || []).filter(x => (!filter || x.status === filter) && (!area || clean(x.area) === area) && (!q || normalize(`${x.employeeId} ${x.name} ${x.area} ${x.store} ${x.courseTitle} ${x.lessonTitle}`).includes(q)));
    host.innerHTML = items.length ? items.map(x => {
      const location = [clean(x.area), clean(x.store)].filter(Boolean).join('｜');
      const reviewActions = x.status === '待審核'
        ? `<div class=\"v1-review-actions\"><button class=\"primary-button primary-button--fit\" type=\"button\" data-review-approve=\"${escapeHtml(x.id)}\" data-review-from=\"待審核\">通過</button><button class=\"secondary-button primary-button--fit\" type=\"button\" data-review-reject=\"${escapeHtml(x.id)}\" data-review-from=\"待審核\">退件</button></div>`
        : x.status === '已通過'
          ? `<div class=\"v1-review-actions\"><button class=\"secondary-button primary-button--fit\" type=\"button\" data-review-reject=\"${escapeHtml(x.id)}\" data-review-from=\"已通過\">更正為退件</button></div>`
          : '';
      return `<article class=\"card v1-sub-admin-card\"><div class=\"v1-sub-card-head\"><div><strong>${escapeHtml(x.name || x.employeeId)}｜${escapeHtml(x.employeeId)}</strong><p class=\"package-meta\">${escapeHtml(location || '未設定區域／店別')}｜${escapeHtml(x.courseTitle)} → ${escapeHtml(x.lessonTitle === '__PACKAGE_DIRECT__' ? '課程回傳' : x.lessonTitle)}</p></div><span class=\"tag ${submissionStatusClass(x.status)}\">${escapeHtml(x.status)}</span></div><div class=\"v1-sub-meta\"><span>V${String(Math.max(1,n(x.version))).padStart(2,'0')}</span><span>送出：${escapeHtml(x.submittedAt || '—')}</span><span>審核：${escapeHtml(x.reviewedAt || '—')}</span></div>${x.rejectReason ? `<div class=\"v1-reject-note\"><strong>退件原因：</strong>${escapeHtml(x.rejectReason)}</div>` : ''}<div class=\"v1-file-grid\">${(x.files || []).map(file => `<a class=\"v1-file-link\" href=\"${escapeHtml(file.url)}\" target=\"_blank\" rel=\"noopener\">${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></a>`).join('') || '<span class=\"package-meta\">尚無附件</span>'}</div>${reviewActions}</article>`;
    }).join('') : '<div class=\"empty-state\"><h3>查無作業回傳</h3><p>目前搜尋、區域與狀態條件沒有符合資料。</p></div>';
    host.querySelectorAll('[data-review-approve]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewApprove, 'approve', button, button.dataset.reviewFrom));
    host.querySelectorAll('[data-review-reject]').forEach(button => button.onclick = () => reviewSubmission(button.dataset.reviewReject, 'reject', button, button.dataset.reviewFrom));
  }"""
rep(old_list, new_list, 'renderAdminSubmissionList')

old_review = """  async function reviewSubmission(id, decision, button) {
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
  }"""
new_review = """  async function reviewSubmission(id, decision, button, fromStatus = '') {
    const current = clean(fromStatus) || clean((state.adminSubmissions.items || []).find(x => x.id === id)?.status);
    let reason = '';
    if (decision === 'reject') {
      reason = prompt(current === '已通過' ? '請輸入更正為退件的原因（必填）' : '請輸入退件原因（必填）', '') ?? '';
      if (!reason.trim()) return;
      if (current === '已通過' && !confirm('確定撤銷這份作業的「已通過」狀態並改為「已退件」？\\n\\n若這次通過曾讓子課程完成，後端會重新判定該學習狀態。')) return;
    } else if (!confirm('確定將這份作業設為「已通過」？')) return;
    setButtonBusy(button, true);
    try {
      const data = await api('reviewSubmission', { id, decision, reason, previousStatus: current });
      state.adminSubmissions = data;
      state.adminSubmissionsLoadedAt = Date.now();
      state.overviewDirty = true;
      renderAdminSubmissions();
      showToast(data.message || '審核完成');
    } catch (error) { setButtonBusy(button, false); showToast(error.message || '審核失敗'); }
  }"""
rep(old_review, new_review, 'reviewSubmission')

p.write_text(s, encoding='utf-8')

ip = Path('index.html')
html = ip.read_text(encoding='utf-8')
old = 'app.js?v=1.0-applicability-20260906'
new = 'app.js?v=1.0-submission-review-20260914'
if old not in html:
    raise SystemExit('cache bust target not found')
ip.write_text(html.replace(old, new, 1), encoding='utf-8')
