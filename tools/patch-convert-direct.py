from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

def one(old, new, label):
    global s
    count = s.count(old)
    assert count == 1, f'{label}: expected 1 match, got {count}'
    s = s.replace(old, new, 1)

old = """    return `<div class=\"manage-row ${open ? 'is-v1-lesson-open' : ''}\"><div class=\"manage-row__top\"><div><strong>${direct ? '課程教材' : escapeHtml(lesson.title)}</strong><div class=\"manage-row__meta\">${direct ? escapeHtml(directLessonMeta(lesson)) : `${lesson.required ? '必修' : '選修'}｜${escapeHtml(ruleText(lesson))}｜${adminEnabledText(lesson.enabled)}｜適用：${escapeHtml(applicabilityLabel(lesson))}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}`}</div></div><div class=\"manage-row__actions\">${contents.length ? `<button class=\"mini-button\" type=\"button\" data-toggle-lesson-content=\"${escapeHtml(lesson.id)}\">${open ? `收合教材 (${contents.length})` : `展開教材 (${contents.length})`}</button>` : ''}${normal ? `<button class=\"mini-button\" type=\"button\" data-edit-lesson=\"${escapeHtml(lesson.id)}\">編輯</button>` : ''}<button class=\"mini-button\" type=\"button\" data-add-content=\"${escapeHtml(lesson.id)}\">＋教材</button>${normal ? `<button class=\"mini-button\" type=\"button\" data-move-lesson=\"${escapeHtml(lesson.id)}\" data-direction=\"-1\" ${position.first ? 'disabled' : ''}>↑</button><button class=\"mini-button\" type=\"button\" data-move-lesson=\"${escapeHtml(lesson.id)}\" data-direction=\"1\" ${position.last ? 'disabled' : ''}>↓</button><button class=\"mini-button mini-button--danger\" type=\"button\" data-delete-lesson=\"${escapeHtml(lesson.id)}\">刪除</button>` : ''}</div></div><div class=\"manage-content-list\" data-lesson-content-list=\"${escapeHtml(lesson.id)}\" ${open ? '' : 'hidden'}>${contentRows || '<div class=\"manage-empty\">尚未建立教材</div>'}</div></div>`;"""
new = """    return `<div class=\"manage-row ${open ? 'is-v1-lesson-open' : ''}\"><div class=\"manage-row__top\"><div><strong>${direct ? '課程教材' : escapeHtml(lesson.title)}</strong><div class=\"manage-row__meta\">${direct ? escapeHtml(directLessonMeta(lesson)) : `${lesson.required ? '必修' : '選修'}｜${escapeHtml(ruleText(lesson))}｜${adminEnabledText(lesson.enabled)}｜適用：${escapeHtml(applicabilityLabel(lesson))}${lesson.submissionMode && lesson.submissionMode !== '不需要' ? `｜作業：${escapeHtml(lesson.submissionMode)}` : ''}`}</div></div><div class=\"manage-row__actions\">${contents.length ? `<button class=\"mini-button\" type=\"button\" data-toggle-lesson-content=\"${escapeHtml(lesson.id)}\">${open ? `收合教材 (${contents.length})` : `展開教材 (${contents.length})`}</button>` : ''}${normal ? `<button class=\"mini-button\" type=\"button\" data-edit-lesson=\"${escapeHtml(lesson.id)}\">編輯</button>` : `<button class=\"mini-button\" type=\"button\" data-convert-direct=\"${escapeHtml(lesson.id)}\">轉為子課程</button>`}<button class=\"mini-button\" type=\"button\" data-add-content=\"${escapeHtml(lesson.id)}\">＋教材</button>${normal ? `<button class=\"mini-button\" type=\"button\" data-move-lesson=\"${escapeHtml(lesson.id)}\" data-direction=\"-1\" ${position.first ? 'disabled' : ''}>↑</button><button class=\"mini-button\" type=\"button\" data-move-lesson=\"${escapeHtml(lesson.id)}\" data-direction=\"1\" ${position.last ? 'disabled' : ''}>↓</button><button class=\"mini-button mini-button--danger\" type=\"button\" data-delete-lesson=\"${escapeHtml(lesson.id)}\">刪除</button>` : ''}</div></div><div class=\"manage-content-list\" data-lesson-content-list=\"${escapeHtml(lesson.id)}\" ${open ? '' : 'hidden'}>${contentRows || '<div class=\"manage-empty\">尚未建立教材</div>'}</div></div>`;"""
one(old, new, 'direct lesson convert button')

one(
"""    document.querySelectorAll('[data-edit-lesson]').forEach(b => b.onclick = () => openLessonEditor(findCatalogLesson(b.dataset.editLesson)));""",
"""    document.querySelectorAll('[data-edit-lesson]').forEach(b => b.onclick = () => openLessonEditor(findCatalogLesson(b.dataset.editLesson)));
    document.querySelectorAll('[data-convert-direct]').forEach(b => b.onclick = () => openConvertDirectLessonEditor(findCatalogLesson(b.dataset.convertDirect)));""",
'bind convert button')

one(
"""  function openDirectSubmissionEditor(pkg) {""",
"""  function openConvertDirectLessonEditor(lesson) {
    if (!lesson || lesson.title !== '__PACKAGE_DIRECT__') return;
    const pkg = findCatalogPackage(lesson.packageId);
    const suggested = clean(pkg?.title) ? `${pkg.title} OJT` : 'OJT';
    showAdminEditor('轉為子課程', `<form id=\"adminEditForm\" class=\"admin-form\" data-admin-form=\"convertDirect\"><input type=\"hidden\" id=\"editId\" value=\"${escapeHtml(lesson.id)}\"><input type=\"hidden\" id=\"editPackageId\" value=\"${escapeHtml(lesson.packageId)}\"><div class=\"form-grid\">${field('子課程名稱', 'editTitle', suggested, 'text', 'required')}${field('排序', 'editSort', normalLessons(pkg).length + 1, 'number', 'min=\"1\" required')}<label class=\"field-group\"><span>必修</span><select id=\"editRequired\">${yesNoSelect(lesson.required)}</select></label><label class=\"field-group\"><span>啟用</span><select id=\"editEnabled\">${yesNoSelect(lesson.enabled)}</select></label></div><div class=\"manage-warning\">這不是複製。系統會保留原本子課程 ID，只把「課程教材」轉成一般子課程，因此原本教材、作業、進度與審核紀錄都會保留。</div><div class=\"form-actions\"><button class=\"secondary-button\" type=\"button\" data-cancel-editor>取消</button><button class=\"primary-button\" type=\"submit\">確認轉為子課程</button></div></form>`);
    bindEditorForm();
  }

  function openDirectSubmissionEditor(pkg) {""",
'convert editor')

one(
"""      } else if (kind === 'directSubmission') {
        action = 'saveLesson';""",
"""      } else if (kind === 'convertDirect') {
        action = 'saveLesson';
        const packageId = $('editPackageId').value;
        const pkg = findCatalogPackage(packageId);
        const direct = directLesson(pkg);
        const title = clean($('editTitle').value);
        if (!direct || direct.id !== $('editId').value) throw new Error('找不到要轉換的課程教材');
        if (!title || title === '__PACKAGE_DIRECT__') throw new Error('請輸入有效的子課程名稱');
        if (normalLessons(pkg).some(x => normalize(x.title) === normalize(title))) throw new Error('已有同名子課程，請使用不同名稱');
        payload = { id: direct.id, packageId, title, sort: Number($('editSort').value), required: boolValue('editRequired'), enabled: boolValue('editEnabled'), videoPassPercent: direct.videoPassPercent ?? null, submissionMode: direct.submissionMode || '不需要', submissionNote: direct.submissionNote || '', applicabilityMode: direct.applicabilityMode || '全部適用', applicableIds: Array.isArray(direct.applicableIds) ? direct.applicableIds : [] };
        state.manageOpenPackages.add(packageId);
        state.manageOpenLessons.add(direct.id);
      } else if (kind === 'directSubmission') {
        action = 'saveLesson';""",
'convert submit')

p.write_text(s, encoding='utf-8')
print('patched direct lesson conversion')
