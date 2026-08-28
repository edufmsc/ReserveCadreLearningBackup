from pathlib import Path
import json

p = Path('app.js')
s = p.read_text(encoding='utf-8')

# Package actions: copy whole course + pick existing materials for direct course materials.
old = '''<button class="mini-button" type="button" data-edit-package="${escapeHtml(pkg.id)}">編輯</button><button class="mini-button" type="button" data-add-package-content="${escapeHtml(pkg.id)}">＋教材</button>'''
new = '''<button class="mini-button" type="button" data-edit-package="${escapeHtml(pkg.id)}">編輯</button>${state.features.courseReuseV1 ? `<button class="mini-button" type="button" data-copy-package="${escapeHtml(pkg.id)}">複製課程</button>` : ''}<button class="mini-button" type="button" data-add-package-content="${escapeHtml(pkg.id)}">＋教材</button>${state.features.courseReuseV1 ? `<button class="mini-button" type="button" data-library-package="${escapeHtml(pkg.id)}">從既有教材選用</button>` : ''}'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

# Lesson actions: copy child lesson + pick existing materials.
old = '''${normal ? `<button class="mini-button" type="button" data-edit-lesson="${escapeHtml(lesson.id)}">編輯</button>` : `<button class="mini-button" type="button" data-convert-direct="${escapeHtml(lesson.id)}">轉為子課程</button>`}<button class="mini-button" type="button" data-add-content="${escapeHtml(lesson.id)}">＋教材</button>'''
new = '''${normal ? `<button class="mini-button" type="button" data-edit-lesson="${escapeHtml(lesson.id)}">編輯</button>${state.features.courseReuseV1 ? `<button class="mini-button" type="button" data-copy-lesson="${escapeHtml(lesson.id)}">複製</button>` : ''}` : `<button class="mini-button" type="button" data-convert-direct="${escapeHtml(lesson.id)}">轉為子課程</button>`}<button class="mini-button" type="button" data-add-content="${escapeHtml(lesson.id)}">＋教材</button>${state.features.courseReuseV1 ? `<button class="mini-button" type="button" data-library-lesson="${escapeHtml(lesson.id)}">從既有教材選用</button>` : ''}'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

# Event bindings.
old = '''    document.querySelectorAll('[data-edit-package]').forEach(b => b.onclick = () => openPackageEditor(findCatalogPackage(b.dataset.editPackage)));
    document.querySelectorAll('[data-add-package-content]').forEach(b => b.onclick = () => openDirectContentEditor(findCatalogPackage(b.dataset.addPackageContent)));'''
new = '''    document.querySelectorAll('[data-edit-package]').forEach(b => b.onclick = () => openPackageEditor(findCatalogPackage(b.dataset.editPackage)));
    document.querySelectorAll('[data-copy-package]').forEach(b => b.onclick = () => openCopyPackageEditor(findCatalogPackage(b.dataset.copyPackage)));
    document.querySelectorAll('[data-add-package-content]').forEach(b => b.onclick = () => openDirectContentEditor(findCatalogPackage(b.dataset.addPackageContent)));
    document.querySelectorAll('[data-library-package]').forEach(b => b.onclick = () => openMaterialLibrary('', b.dataset.libraryPackage));'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

old = '''    document.querySelectorAll('[data-edit-lesson]').forEach(b => b.onclick = () => openLessonEditor(findCatalogLesson(b.dataset.editLesson)));
    document.querySelectorAll('[data-convert-direct]').forEach(b => b.onclick = () => openConvertDirectLessonEditor(findCatalogLesson(b.dataset.convertDirect)));'''
new = '''    document.querySelectorAll('[data-edit-lesson]').forEach(b => b.onclick = () => openLessonEditor(findCatalogLesson(b.dataset.editLesson)));
    document.querySelectorAll('[data-copy-lesson]').forEach(b => b.onclick = () => openCopyLessonEditor(findCatalogLesson(b.dataset.copyLesson)));
    document.querySelectorAll('[data-convert-direct]').forEach(b => b.onclick = () => openConvertDirectLessonEditor(findCatalogLesson(b.dataset.convertDirect)));
    document.querySelectorAll('[data-library-lesson]').forEach(b => b.onclick = () => openMaterialLibrary(b.dataset.libraryLesson, ''));'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

# New practical reuse/copy editors. No separate database sheet: existing content rows are the source catalog.
anchor = '''  function openMoveContentsEditor(sourceLessonId, contentIds) {'''
assert s.count(anchor) == 1
block = r'''  function materialLibraryEntries() {
    const map = new Map();
    catalogPackages().forEach(pkg => (pkg.lessons || []).forEach(lesson => (lesson.contents || []).forEach(content => {
      if (content.enabled === false) return;
      const type = clean(content.type).toUpperCase();
      const url = clean(content.url);
      const text = clean(content.text);
      const key = url ? `${type}|URL|${normalize(url)}` : `${type}|TEXT|${normalize(content.title)}|${text}`;
      if (!key || key.endsWith('|TEXT||')) return;
      const sourceLabel = `${pkg.title}｜${visibleLessonTitle(lesson)}`;
      if (!map.has(key)) map.set(key, { key, id: content.id, title: content.title, type, url, text, sources: [sourceLabel] });
      else {
        const item = map.get(key);
        if (!item.sources.includes(sourceLabel)) item.sources.push(sourceLabel);
      }
    })));
    return [...map.values()].sort((a,b) => normalize(a.title).localeCompare(normalize(b.title), 'zh-Hant'));
  }

  function openMaterialLibrary(targetLessonId = '', targetPackageId = '') {
    if (!state.features.courseReuseV1) { showToast('後端尚未啟用快速建課功能'); return; }
    const targetLesson = targetLessonId ? findCatalogLesson(targetLessonId) : null;
    const targetPackage = targetPackageId ? findCatalogPackage(targetPackageId) : (targetLesson ? findCatalogPackage(targetLesson.packageId) : null);
    if (!targetPackage) { showToast('找不到要加入教材的課程'); return; }
    const entries = materialLibraryEntries();
    if (!entries.length) { showToast('目前還沒有可重複使用的既有教材'); return; }
    const rows = entries.map(item => `<label class="learner-check quick-material-row"><input type="checkbox" name="reuseContent" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(contentTypeLabel(item.type))}｜使用於 ${item.sources.length} 個課程位置<br>${escapeHtml(item.sources.slice(0,2).join('、'))}${item.sources.length > 2 ? '…' : ''}</small></span></label>`).join('');
    const targetName = targetLesson ? `${targetPackage.title}｜${visibleLessonTitle(targetLesson)}` : `${targetPackage.title}｜課程教材`;
    showAdminEditor(`從既有教材選用｜${targetName}`, `<form id="adminEditForm" class="admin-form" data-admin-form="reuseContents"><input type="hidden" id="editReuseTargetLessonId" value="${escapeHtml(targetLessonId)}"><input type="hidden" id="editReuseTargetPackageId" value="${escapeHtml(targetLesson ? '' : targetPackage.id)}"><div class="v1-assignment-tools"><strong>既有教材</strong><div class="v1-assignment-buttons"><button class="mini-button" type="button" data-reuse-pick="visible">全選目前顯示</button><button class="mini-button" type="button" data-reuse-pick="clear">清除勾選</button></div></div><label class="field-group"><span>搜尋教材</span><input id="reuseContentSearch" type="search" placeholder="輸入教材名稱、類型或原課程"></label><div id="reuseContentSearchResult" class="v1-search-result"></div><div class="learner-checklist quick-material-list">${rows}</div><p class="form-hint">加入後會建立新的教材 ID，因此每門課的觀看／閱讀進度獨立；PDF、下載檔、YouTube 與網址仍沿用同一份來源，不重新上傳。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">加入選取教材</button></div></form>`);
    bindEditorForm();
    const search = $('reuseContentSearch');
    const filter = () => {
      const q = normalize(search?.value || ''); let shown = 0;
      document.querySelectorAll('.quick-material-row').forEach(row => { const hit = !q || normalize(row.textContent).includes(q); row.hidden = !hit; if (hit) shown++; });
      if ($('reuseContentSearchResult')) $('reuseContentSearchResult').textContent = q ? `找到 ${shown} 筆` : `共 ${entries.length} 筆可重複使用教材`;
    };
    if (search) search.oninput = filter; filter();
    document.querySelectorAll('[data-reuse-pick]').forEach(button => button.onclick = () => {
      const mode = button.dataset.reusePick;
      document.querySelectorAll('.quick-material-row input[name="reuseContent"]').forEach(input => { input.checked = mode === 'clear' ? false : !input.closest('.quick-material-row')?.hidden; });
    });
  }

  function openCopyLessonEditor(lesson) {
    if (!state.features.courseReuseV1 || !lesson || lesson.title === '__PACKAGE_DIRECT__') return;
    const targets = catalogPackages().filter(pkg => pkg.enabled !== false);
    const sourcePackage = findCatalogPackage(lesson.packageId);
    showAdminEditor(`複製子課程｜${lesson.title}`, `<form id="adminEditForm" class="admin-form" data-admin-form="copyLesson"><input type="hidden" id="editCopyLessonId" value="${escapeHtml(lesson.id)}"><div class="form-grid">${field('新子課程名稱', 'editCopyLessonTitle', `${lesson.title} 複本`, 'text', 'required')}<label class="field-group"><span>複製到母課程</span><select id="editCopyLessonPackage">${targets.map(pkg => `<option value="${escapeHtml(pkg.id)}" ${pkg.id === lesson.packageId ? 'selected' : ''}>${escapeHtml(pkg.title)}</option>`).join('')}</select></label></div><p class="form-hint">會複製子課程設定與教材，但建立新的子課程／教材 ID；不複製任何學習進度、作業附件或審核結果。完成後會直接開啟新子課程編輯畫面讓你微調。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">建立複本</button></div></form>`);
    bindEditorForm();
  }

  function openCopyPackageEditor(pkg) {
    if (!state.features.courseReuseV1 || !pkg) return;
    showAdminEditor(`複製整門課程｜${pkg.title}`, `<form id="adminEditForm" class="admin-form" data-admin-form="copyPackage"><input type="hidden" id="editCopyPackageId" value="${escapeHtml(pkg.id)}"><div class="form-grid">${field('新課程名稱', 'editCopyPackageTitle', `${pkg.title} 複本`, 'text', 'required')}<label class="field-group field-group--wide"><span>簡短說明</span><textarea id="editCopyPackageDescription">${escapeHtml(pkg.description || '')}</textarea></label></div><p class="form-hint">會複製母課程、子課程、教材引用、完成規則與作業設定，新課程固定建立為「草稿」。不複製指派人員、學習紀錄、已上傳作業或審核結果。完成後會直接開啟新課程編輯畫面。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">建立課程複本</button></div></form>`);
    bindEditorForm();
  }

'''
s = s.replace(anchor, block + anchor, 1)

# Correct old user-facing version wording.
s = s.replace("直接上傳教材需部署 V1.1.6 後端；目前仍可貼 Google Drive / 網址。", "直接上傳教材需部署 V1.0 後端；目前仍可貼 Google Drive / 網址。")

# Longer timeout for copy/reuse operations.
old = "    const timeout = action === 'saveContent' && payload?.fileBase64 ? 90000 : action === 'moveContentsToLesson' ? 90000 : 15000;"
new = "    const timeout = action === 'saveContent' && payload?.fileBase64 ? 90000 : ['moveContentsToLesson','reuseContents','copyLesson','copyPackage'].includes(action) ? 120000 : 15000;"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

# Submit handlers.
old = '''      } else if (kind === 'moveContents') {
        action = 'moveContentsToLesson';'''
new = '''      } else if (kind === 'reuseContents') {
        action = 'reuseContents';
        const contentIds = [...document.querySelectorAll('input[name="reuseContent"]:checked')].map(x => x.value);
        const targetLessonId = $('editReuseTargetLessonId').value;
        const targetPackageId = $('editReuseTargetPackageId').value;
        if (!contentIds.length) throw new Error('請至少勾選一筆教材');
        payload = { contentIds, targetLessonId, targetPackageId };
        if (targetLessonId) {
          const lesson = findCatalogLesson(targetLessonId);
          if (lesson) { state.manageOpenPackages.add(lesson.packageId); state.manageOpenLessons.add(targetLessonId); }
        } else if (targetPackageId) state.manageOpenPackages.add(targetPackageId);
      } else if (kind === 'copyLesson') {
        action = 'copyLesson';
        payload = { sourceLessonId: $('editCopyLessonId').value, targetPackageId: $('editCopyLessonPackage').value, title: $('editCopyLessonTitle').value };
        state.manageOpenPackages.add(payload.targetPackageId);
      } else if (kind === 'copyPackage') {
        action = 'copyPackage';
        payload = { sourcePackageId: $('editCopyPackageId').value, title: $('editCopyPackageTitle').value, description: $('editCopyPackageDescription').value };
      } else if (kind === 'moveContents') {
        action = 'moveContentsToLesson';'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

# After saving copies, immediately open their edit screen.
old = '''      closeAdminEditor();
      saveFoldState();
      showToast(data?.message || '已儲存');'''
new = '''      closeAdminEditor();
      saveFoldState();
      if (kind === 'copyLesson' && data?.createdLessonId) {
        const copiedLesson = findCatalogLesson(data.createdLessonId);
        if (copiedLesson) { state.manageOpenPackages.add(copiedLesson.packageId); state.manageOpenLessons.add(copiedLesson.id); saveFoldState(); renderAdminManage(); openLessonEditor(copiedLesson); }
        showToast(data?.message || '子課程已複製');
        return;
      }
      if (kind === 'copyPackage' && data?.createdPackageId) {
        const copiedPackage = findCatalogPackage(data.createdPackageId);
        if (copiedPackage) { state.manageOpenPackages.add(copiedPackage.id); saveFoldState(); renderAdminManage(); openPackageEditor(copiedPackage); }
        showToast(data?.message || '課程已複製');
        return;
      }
      showToast(data?.message || '已儲存');'''
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')

# Contract: add 3 write actions and one feature flag.
cp = Path('apps-script/contract.json')
contract = json.loads(cp.read_text(encoding='utf-8'))
actions = contract['actions']
insert_after = actions.index('moveContentsToLesson') + 1
for action in reversed(['reuseContents','copyLesson','copyPackage']):
    if action not in actions:
        actions.insert(insert_after, action)
contract['features']['courseReuseV1'] = True
cp.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Permanent contract verifier: these are now part of the supported V1.0 contract.
vp = Path('tools/verify-contract.js')
v = vp.read_text(encoding='utf-8')
v = v.replace("'setPackageState','deletePackage','deleteLesson','deleteContent','moveLesson','moveContent','moveContentsToLesson',", "'setPackageState','deletePackage','deleteLesson','deleteContent','moveLesson','moveContent','moveContentsToLesson','reuseContents','copyLesson','copyPackage',")
v = v.replace("'packageDirectSubmissionV116','contentMoveV1']", "'packageDirectSubmissionV116','contentMoveV1','courseReuseV1']")
vp.write_text(v, encoding='utf-8')
