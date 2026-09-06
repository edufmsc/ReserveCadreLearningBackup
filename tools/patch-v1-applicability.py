from pathlib import Path

p=Path('app.js')
s=p.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    c=s.count(old)
    if c!=count:
        raise SystemExit(f'{label}: expected {count}, got {c}')
    s=s.replace(old,new,count)

rep("""  function applicabilityLabel(lesson) {
    const mode = lesson?.applicabilityMode || '全部適用';
    if (mode === '指定帳號') return `指定 ${Array.isArray(lesson.applicableIds) ? lesson.applicableIds.length : 0} 個帳號`;
    if (mode === '其餘未指定') return '其餘未指定帳號';
    return '全部適用';
  }""",
"""  function applicabilityInfo(lesson) {
    const ids = Array.isArray(lesson?.applicableIds) ? [...new Set(lesson.applicableIds.map(clean).filter(Boolean))] : [];
    const learners = new Map(catalogLearners().map(x => [clean(x.employeeId), x]));
    return {
      valid: ids.map(id => learners.get(id)).filter(Boolean),
      invalid: ids.filter(id => !learners.has(id))
    };
  }

  function applicabilityLabel(lesson) {
    const mode = lesson?.applicabilityMode || '全部適用';
    if (mode === '指定帳號') {
      const info = applicabilityInfo(lesson);
      return info.invalid.length ? `指定 ${info.valid.length} 人｜⚠ ${info.invalid.length} 筆失效` : `指定 ${info.valid.length} 人`;
    }
    if (mode === '其餘未指定') return '其餘未指定帳號';
    return '全部適用';
  }""",'valid applicability label')

old="""    const selected = new Set(Array.isArray(lesson.applicableIds) ? lesson.applicableIds : []);
    const learners = catalogLearners();
    const learnerRows = learners.map(l => `<label class=\"learner-check applicability-learner\"><input type=\"checkbox\" name=\"applicableLearner\" value=\"${escapeHtml(l.employeeId)}\" ${selected.has(l.employeeId) ? 'checked' : ''}><span><strong>${escapeHtml(l.name)}｜${escapeHtml(l.employeeId)}</strong><small>${escapeHtml(l.store || '')}｜${escapeHtml(l.role || '')}</small></span></label>`).join('');"""
new="""    const selected = new Set(Array.isArray(lesson.applicableIds) ? lesson.applicableIds.map(clean).filter(Boolean) : []);
    const learners = catalogLearners();
    const learnerIds = new Set(learners.map(l => clean(l.employeeId)));
    const invalidSelected = [...selected].filter(id => !learnerIds.has(id));
    const learnerRows = learners.map(l => `<label class=\"learner-check applicability-learner\"><input type=\"checkbox\" name=\"applicableLearner\" value=\"${escapeHtml(l.employeeId)}\" ${selected.has(clean(l.employeeId)) ? 'checked' : ''}><span><strong>${escapeHtml(l.name)}｜${escapeHtml(l.employeeId)}</strong><small>${escapeHtml(l.store || '')}｜${escapeHtml(l.role || '')}</small></span></label>`).join('');"""
rep(old,new,'editor selected validation')

rep("""<div id=\"applicabilityPicker\" class=\"field-group field-group--wide applicability-picker\"><span>指定門市／帳號</span><input id=\"applicabilitySearch\" type=\"search\" placeholder=\"搜尋帳號、姓名或店別\"><div id=\"applicabilitySearchResult\" class=\"v1-search-result\"></div><div class=\"learner-checklist applicability-list\">${learnerRows || '<div class=\"manage-empty\">目前沒有可選帳號</div>'}</div></div>""",
"""<div id=\"applicabilityPicker\" class=\"field-group field-group--wide applicability-picker\"><span>指定門市／帳號</span><div id=\"applicabilitySelectionSummary\" class=\"form-hint\"></div>${invalidSelected.length ? `<div class=\"v1-reject-note\"><strong>資料異常：</strong>${escapeHtml(invalidSelected.join('、'))} 無法對應員工主檔，重新儲存前請確認選取人員。</div>` : ''}<input id=\"applicabilitySearch\" type=\"search\" placeholder=\"搜尋帳號、姓名或店別\"><div id=\"applicabilitySearchResult\" class=\"v1-search-result\"></div><div class=\"learner-checklist applicability-list\">${learnerRows || '<div class=\"manage-empty\">目前沒有可選帳號</div>'}</div></div>""",'editor selection summary host')

rep("""    const mode = $('editApplicabilityMode'), picker = $('applicabilityPicker'), search = $('applicabilitySearch');
    const refreshPicker = () => { if (picker) picker.hidden = mode?.value !== '指定帳號'; };
    if (mode) mode.onchange = refreshPicker;
    if (search) {""",
"""    const mode = $('editApplicabilityMode'), picker = $('applicabilityPicker'), search = $('applicabilitySearch'), selectionSummary = $('applicabilitySelectionSummary');
    const refreshSelectionSummary = () => {
      if (!selectionSummary) return;
      const checked = [...document.querySelectorAll('input[name=\"applicableLearner\"]:checked')].map(input => {
        const learner = learners.find(x => clean(x.employeeId) === clean(input.value));
        return learner ? `${learner.name || learner.store || '未命名'}｜${learner.employeeId}` : clean(input.value);
      });
      selectionSummary.textContent = checked.length ? `已選 ${checked.length} 人：${checked.join('、')}` : '目前未選任何帳號';
    };
    const refreshPicker = () => { if (picker) picker.hidden = mode?.value !== '指定帳號'; refreshSelectionSummary(); };
    if (mode) mode.onchange = refreshPicker;
    document.querySelectorAll('input[name=\"applicableLearner\"]').forEach(input => input.addEventListener('change', refreshSelectionSummary));
    if (search) {""",'editor selection summary binding')

# Ensure initial summary is rendered after search/filter setup.
rep("""      search.oninput = filter; filter();""","""      search.oninput = filter; filter(); refreshSelectionSummary();""",'initial selection summary')

p.write_text(s,encoding='utf-8')

# cache bust only; visible version remains V1.0
ip=Path('index.html')
html=ip.read_text(encoding='utf-8')
old='app.js?v=1.0-fastpath-20260831'
new='app.js?v=1.0-applicability-20260906'
if old not in html:
    raise SystemExit('cache bust target not found')
ip.write_text(html.replace(old,new,1),encoding='utf-8')
