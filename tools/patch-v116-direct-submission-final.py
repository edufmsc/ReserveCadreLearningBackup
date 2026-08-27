from pathlib import Path

path = Path('app.js')
s = path.read_text(encoding='utf-8')

def one(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, got {count}')
    s = s.replace(old, new, 1)

one(
    "  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';",
    "  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';\n  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';",
    'xlsx constant'
)
one("    pdfJsPromise: null,", "    pdfJsPromise: null,\n    xlsxPromise: null,", 'xlsx state')

one(r'''  function validateCatalogPackage(pkg) {
    const errors = [];
    const direct = directLesson(pkg);
    const directContents = (direct?.contents || []).filter(c => c.enabled !== false);
    const lessons = normalLessons(pkg).filter(l => l.enabled !== false);
    if (!directContents.length && !lessons.length) errors.push('至少建立課程教材或一個子課程');''', r'''  function validateCatalogPackage(pkg) {
    const errors = [];
    const direct = directLesson(pkg);
    const directContents = (direct?.contents || []).filter(c => c.enabled !== false);
    const directSubmission = !!(direct && direct.submissionMode && direct.submissionMode !== '不需要');
    const lessons = normalLessons(pkg).filter(l => l.enabled !== false);
    if (!directContents.length && !directSubmission && !lessons.length) errors.push('至少建立課程教材、課程回傳或一個子課程');''', 'package validation')

one("    const directRow = direct && (direct.contents || []).length ? renderManageLesson(direct, true) : '';",
    "    const directRow = direct && ((direct.contents || []).length || (direct.submissionMode && direct.submissionMode !== '不需要')) ? renderManageLesson(direct, true) : '';",
    'direct row visibility')

one(r'''<button class="mini-button" type="button" data-add-package-content="${escapeHtml(pkg.id)}">＋教材</button><button class="mini-button" type="button" data-add-lesson="${escapeHtml(pkg.id)}">＋子課程</button>''',
    r'''<button class="mini-button" type="button" data-add-package-content="${escapeHtml(pkg.id)}">＋教材</button>${state.features.packageDirectSubmissionV116 ? `<button class="mini-button" type="button" data-direct-submission="${escapeHtml(pkg.id)}">回傳設定</button>` : ''}<button class="mini-button" type="button" data-add-lesson="${escapeHtml(pkg.id)}">＋子課程</button>''',
    'package direct submission button')

one(r'''  function applicabilityLabel(lesson) {
    const mode = lesson?.applicabilityMode || '全部適用';
    if (mode === '指定帳號') return `指定 ${Array.isArray(lesson.applicableIds) ? lesson.applicableIds.length : 0} 個帳號`;
    if (mode === '其餘未指定') return '其餘未指定帳號';
    return '全部適用';
  }''', r'''  function applicabilityLabel(lesson) {
    const mode = lesson?.applicabilityMode || '全部適用';
    if (mode === '指定帳號') return `指定 ${Array.isArray(lesson.applicableIds) ? lesson.applicableIds.length : 0} 個帳號`;
    if (mode === '其餘未指定') return '其餘未指定帳號';
    return '全部適用';
  }

  function directLessonMeta(lesson) {
    const mode = lesson?.submissionMode || '不需要';
    return mode !== '不需要' ? `直接放在課程內｜作業：${mode}` : '直接放在課程內';
  }''', 'direct lesson meta helper')

one(r'''${direct ? '直接放在課程內' : `${lesson.required ? '必修' : '選修'}｜${escapeHtml(ruleText(lesson))}｜${adminEnabledText(lesson.enabled)}｜適用：${escapeHtml(applicabilityLabel(lesson))}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}`}''',
    r'''${direct ? escapeHtml(directLessonMeta(lesson)) : `${lesson.required ? '必修' : '選修'}｜${escapeHtml(ruleText(lesson))}｜${adminEnabledText(lesson.enabled)}｜適用：${escapeHtml(applicabilityLabel(lesson))}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}`}''',
    'direct lesson meta render')

one("    document.querySelectorAll('[data-add-package-content]').forEach(b => b.onclick = () => openDirectContentEditor(findCatalogPackage(b.dataset.addPackageContent)));",
    "    document.querySelectorAll('[data-add-package-content]').forEach(b => b.onclick = () => openDirectContentEditor(findCatalogPackage(b.dataset.addPackageContent)));\n    document.querySelectorAll('[data-direct-submission]').forEach(b => b.onclick = () => openDirectSubmissionEditor(findCatalogPackage(b.dataset.directSubmission)));",
    'bind direct submission button')

one(r'''  function openDirectContentEditor(pkg) {
    const direct = directLesson(pkg);
    openContentEditor(null, direct?.id || '', pkg.id);
  }''', r'''  function openDirectSubmissionEditor(pkg) {
    if (!pkg) return;
    if (!state.features.packageDirectSubmissionV116) { showToast('後端尚未啟用母課程直接回傳'); return; }
    const direct = directLesson(pkg);
    const mode = direct?.submissionMode || '不需要';
    showAdminEditor(`課程回傳設定｜${pkg.title}`, `<form id="adminEditForm" class="admin-form" data-admin-form="directSubmission"><input type="hidden" id="editPackageId" value="${escapeHtml(pkg.id)}"><div class="form-grid"><label class="field-group"><span>課程回傳</span><select id="editDirectSubmissionMode"><option value="不需要" ${mode === '不需要' ? 'selected' : ''}>不需要</option><option value="選填" ${mode === '選填' ? 'selected' : ''}>選填，不影響完成</option><option value="必繳審核" ${mode === '必繳審核' ? 'selected' : ''}>必繳，由教育中心審核</option></select></label><label class="field-group field-group--wide"><span>回傳說明</span><textarea id="editDirectSubmissionNote" placeholder="例如：請下載 OJT 表單，完成後上傳並送出教育中心確認。">${escapeHtml(direct?.submissionNote || '')}</textarea></label></div><p class="form-hint">適合 OJT、表單回傳等臨時課程；學員可直接在母課程教材頁下載、上傳、送審，不必另外建立子課程。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">儲存</button></div></form>`);
    bindEditorForm();
  }

  function openDirectContentEditor(pkg) {
    const direct = directLesson(pkg);
    openContentEditor(null, direct?.id || '', pkg.id);
  }''', 'direct submission editor')

one("      } else if (kind === 'lesson') {", r'''      } else if (kind === 'directSubmission') {
        action = 'saveLesson';
        const packageId = $('editPackageId').value;
        const pkg = findCatalogPackage(packageId);
        const direct = directLesson(pkg);
        payload = { id: direct?.id || '', packageId, title: '__PACKAGE_DIRECT__', sort: direct?.sort || 1, required: true, enabled: true, videoPassPercent: direct?.videoPassPercent ?? null, submissionMode: $('editDirectSubmissionMode').value, submissionNote: $('editDirectSubmissionNote').value, applicabilityMode: '全部適用', applicableIds: [] };
        state.manageOpenPackages.add(packageId);
      } else if (kind === 'lesson') {''', 'direct submission save')

one(r'''  function buildCriteria(lesson) {
    const required = lesson.videoPassPercent != null;
    if (!required) return '<div class="criteria-panel"><strong>完成條件</strong><div class="criteria-list"><span class="criteria-item is-pass">✓ 無額外閱讀門檻，完成後按「完成此子課程」</span></div></div>';''', r'''  function buildCriteria(lesson) {
    const required = lesson.videoPassPercent != null;
    const finishLabel = lesson?.title === '__PACKAGE_DIRECT__' ? '完成此課程' : '完成此子課程';
    if (!required) return `<div class="criteria-panel"><strong>完成條件</strong><div class="criteria-list"><span class="criteria-item is-pass">✓ 無額外閱讀門檻，完成後按「${finishLabel}」</span></div></div>`;''', 'direct criteria label')

one("      complete.textContent = '完成此子課程';", "      complete.textContent = lesson?.title === '__PACKAGE_DIRECT__' ? '完成此課程' : '完成此子課程';", 'direct footer label')
one("      showToast('子課程已完成');", "      showToast(lesson.title === '__PACKAGE_DIRECT__' ? '課程已完成' : '子課程已完成');", 'direct complete toast')
one("      complete.textContent = approved ? '完成此子課程' : '需先完成作業審核';", "      complete.textContent = approved ? (lesson.title === '__PACKAGE_DIRECT__' ? '完成此課程' : '完成此子課程') : '需先完成作業審核';", 'direct submission complete label')

one("      renderStudentSubmission();\n    } catch (error) { showToast(error.message || '無法載入作業狀態'); }",
    "      renderStudentSubmission();\n      if (data?.latest?.status === '已通過') ensureStudentPackages(true).catch(() => {});\n    } catch (error) { showToast(error.message || '無法載入作業狀態'); }",
    'approved submission refresh')

one(r'''${escapeHtml(x.store || '')}｜${escapeHtml(x.courseTitle)} → ${escapeHtml(x.lessonTitle)}''',
    r'''${escapeHtml(x.store || '')}｜${escapeHtml(x.courseTitle)} → ${escapeHtml(x.lessonTitle === '__PACKAGE_DIRECT__' ? '課程回傳' : x.lessonTitle)}''',
    'admin direct submission title')

one(r'''  async function exportProgress() {
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
  }''', r'''  function loadXlsx() {
    if (window.XLSX?.utils) return Promise.resolve(window.XLSX);
    if (state.xlsxPromise) return state.xlsxPromise;
    state.xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = XLSX_URL; script.async = true;
      script.onload = () => window.XLSX?.utils ? resolve(window.XLSX) : reject(new Error('Excel 匯出元件載入失敗'));
      script.onerror = () => reject(new Error('Excel 匯出元件載入失敗'));
      document.head.appendChild(script);
    });
    return state.xlsxPromise;
  }

  async function exportProgress() {
    try {
      const rows = await api('exportProgress');
      if (!Array.isArray(rows) || !rows.length) { showToast('目前沒有可匯出的紀錄'); return; }
      const headers = ['姓名', '人員工號', '課程名稱', '課程報名日期', '課程狀態', '課程完成日期'];
      const XLSX = await loadXlsx();
      const matrix = [headers, ...rows.map(row => headers.map(header => row?.[header] ?? ''))];
      const sheet = XLSX.utils.aoa_to_sheet(matrix);
      sheet['!cols'] = [{wch:14},{wch:16},{wch:30},{wch:18},{wch:14},{wch:20}];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '訓練紀錄');
      XLSX.writeFile(book, `training_records_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (error) { showToast(error.message || 'Excel 匯出失敗'); }
  }''', 'xlsx export')

path.write_text(s, encoding='utf-8')
print('patched app.js', len(s.encode('utf-8')), 'bytes')
