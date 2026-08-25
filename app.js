(()=>{'use strict';
const PARTS=['app.bundle.001?v=1.1.2','app.bundle.002?v=1.1.2','app.bundle.003?v=1.1.2','app.bundle.004?v=1.1.2'];
const css=`
.app-shell{width:min(100%,1600px)!important;padding-left:18px!important;padding-right:18px!important}
.boot-card{max-width:520px;margin:8vh auto 0;display:flex;align-items:center;justify-content:center;gap:12px;text-align:center}.boot-spinner{width:22px;height:22px;border:3px solid var(--line);border-top-color:var(--brand);border-radius:50%;animation:v112spin .8s linear infinite}@keyframes v112spin{to{transform:rotate(360deg)}}
.lesson-footer-actions{display:grid;grid-template-columns:minmax(150px,.45fr) minmax(260px,1fr) minmax(260px,1fr);gap:10px;align-items:stretch}.lesson-footer-actions .primary-button,.lesson-footer-actions .secondary-button{width:100%;min-height:50px}.lesson-footer-actions [hidden]{display:none!important}
.pdf-embed-shell{width:100%;height:auto!important;min-height:68vh;border:1px solid var(--line);border-radius:14px;overflow:auto;background:#e8e4df;padding:12px}.pdf-canvas-stack{display:grid;gap:14px;justify-items:center;width:100%}.pdf-page-wrap{display:grid;gap:6px;justify-items:center;width:100%}.pdf-page-label{font-size:.76rem;font-weight:800;color:var(--muted);background:rgba(255,255,255,.9);padding:4px 9px;border-radius:999px}.pdf-page-canvas{display:block;max-width:100%;height:auto;background:#fff;box-shadow:0 3px 18px rgba(0,0,0,.18);user-select:none;-webkit-user-select:none}.pdf-loading{min-height:64vh;display:grid;place-items:center;text-align:center;color:var(--muted);font-weight:800}
.video-player{width:min(100%,1280px)!important;aspect-ratio:16/9;margin:10px auto 0!important;border-radius:14px;overflow:hidden;background:#000}.video-player__target,.video-player iframe{width:100%!important;height:100%!important;border:0;display:block}
.person-package__head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;background:#fff}.person-package__head .person-package__toggle{min-width:0}.person-package__quick-actions{display:flex;align-items:center;gap:7px;padding:9px 11px 9px 0}.force-complete-note{margin:10px 12px;padding:10px 12px;border-radius:12px;background:var(--success-soft);color:var(--success);font-size:.78rem;font-weight:700;line-height:1.5}
@media(max-width:760px){.app-shell{padding-left:10px!important;padding-right:10px!important}.lesson-footer-actions{grid-template-columns:1fr}.lesson-page__footer{bottom:4px}.content-block{padding:12px}.pdf-embed-shell{min-height:58vh;padding:7px}.video-player{width:100%!important;border-radius:10px}.person-package__head{grid-template-columns:1fr}.person-package__quick-actions{padding:0 12px 10px;justify-content:flex-end}}
`;
function patch(source){
  const reps=[];
  reps.push(["const VERSION = 'V1.1.1';","const VERSION = 'V1.1.2';"]);
  reps.push([/function packageSummary\(pkg\) \{[\s\S]*?\n  \}\n\n  function contentTypeLabel/,`function packageSummary(pkg) {
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

  function contentTypeLabel`]);
  reps.push(["return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : raw;","return id ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t` : raw;"]);
  reps.push(["<p class=\"package-meta\">${escapeHtml(pkg.description || '')}</p>","<p class=\"package-meta\">${escapeHtml(pkg.description || '')}${pkg.completionRule === '任一必修子課程完成' ? '｜完成其中 1 個必修子課程即可' : ''}${pkg.forcedComplete ? '｜教育中心人工通過' : ''}</p>"]);
  reps.push(["<div class=\"video-player\" id=\"video_${escapeHtml(item.id)}\"><div class=\"media-lazy-placeholder\">","<div class=\"video-player\"><div class=\"video-player__target\" id=\"video_${escapeHtml(item.id)}\"><div class=\"media-lazy-placeholder\">"]);
  reps.push(["</div></div><div class=\"pdf-status-line\"><span>觀看：<strong data-video-time=\"${escapeHtml(item.id)}\">","</div></div></div><div class=\"pdf-status-line\"><span>觀看：<strong data-video-time=\"${escapeHtml(item.id)}\">"]);
  reps.push(["const pixelRatio = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1));","const pixelRatio = Math.min(window.innerWidth <= 760 ? 1.25 : 1.6, Math.max(1, window.devicePixelRatio || 1));"]);
  reps.push(["const host = block.querySelector('.video-player');","const host = block.querySelector('.video-player__target');"]);
  reps.push(["const player = new YT.Player(host, {\n        videoId,","const player = new YT.Player(host, {\n        width: '100%',\n        height: '100%',\n        videoId,"]);
  reps.push(["document.querySelectorAll('[data-force-complete]').forEach(button => button.onclick = () => forceCompletePackage(button));","document.querySelectorAll('[data-force-complete]').forEach(button => button.onclick = () => forceCompletePackage(button));\n    document.querySelectorAll('[data-clear-force-complete]').forEach(button => button.onclick = () => clearForceCompletePackage(button));"]);
  reps.push([/function renderAdminPersonPackage\(person, pkg\) \{[\s\S]*?\n  \}\n\n  function uniquePackagesForAdmin/,`function renderAdminPersonPackage(person, pkg) {
    const summary = packageSummary(pkg);
    const lessons = (pkg.lessons || []).map(lesson => \`<div class="admin-lesson-row"><strong>\${escapeHtml(visibleLessonTitle(lesson))}</strong>\${statusTag(lesson.status)}<span class="admin-lesson-meta">影片 \${formatSeconds(lesson.videoSeconds)}｜PDF \${formatSeconds(lesson.pdfSeconds)}｜完成 \${formatDateTime(lesson.completedAt)}</span></div>\`).join('');
    const force = state.features.forceComplete && !pkg.forcedComplete && summary.status !== 'complete' ? \`<button class="mini-button v1-force-button" type="button" data-force-complete data-employee-id="\${escapeHtml(person.employeeId)}" data-package-id="\${escapeHtml(pkg.id)}">強制通過</button>\` : '';
    const clearForce = state.features.forceComplete && pkg.forcedComplete ? \`<button class="mini-button" type="button" data-clear-force-complete data-employee-id="\${escapeHtml(person.employeeId)}" data-package-id="\${escapeHtml(pkg.id)}">取消強制通過</button>\` : '';
    const forcedMeta = pkg.forcedComplete ? \`<div class="force-complete-note">教育中心人工通過\${pkg.forcedAt ? \`｜\${escapeHtml(pkg.forcedAt)}\` : ''}\${pkg.forcedBy ? \`｜\${escapeHtml(pkg.forcedBy)}\` : ''}\${pkg.forcedNote ? \`<br>\${escapeHtml(pkg.forcedNote)}\` : ''}</div>\` : '';
    return \`<div class="person-package"><div class="person-package__head"><button class="person-package__toggle" type="button"><span><strong>\${escapeHtml(pkg.title)}</strong><small>\${pkg.forcedComplete ? \`人工通過｜原實際進度 \${summary.done}/\${summary.total}\` : \`\${summary.done}/\${summary.total} 完成\`}</small></span>\${statusTag(summary.status)}</button><div class="person-package__quick-actions">\${force}\${clearForce}</div></div><div class="person-package__body" hidden>\${forcedMeta}\${lessons}</div></div>\`;
  }

  function uniquePackagesForAdmin`]);
  reps.push(["const body = button.nextElementSibling;","const body = button.closest('.person-package')?.querySelector(':scope > .person-package__body');"]);
  reps.push([/function openPackageEditor\(pkg\) \{[\s\S]*?\n  \}\n\n  function openLessonEditor/,`function openPackageEditor(pkg) {
    pkg = pkg || { title: '', description: '', enabled: true, sort: catalogPackages().length + 1, publishState: '草稿', completionRule: '所有必修子課程完成' };
    showAdminEditor(pkg.id ? '編輯課程' : '新增課程', \`<form id="adminEditForm" class="admin-form" data-admin-form="package"><input type="hidden" id="editId" value="\${escapeHtml(pkg.id || '')}"><input type="hidden" id="editPublishState" value="\${escapeHtml(pkg.publishState || '草稿')}"><div class="form-grid">\${field('課程名稱', 'editTitle', pkg.title, 'text', 'required')}\${field('排序', 'editSort', pkg.sort || 1, 'number', 'min="1" required')}<label class="field-group field-group--wide"><span>簡短說明</span><textarea id="editDescription">\${escapeHtml(pkg.description || '')}</textarea></label><label class="field-group"><span>課程完成規則</span><select id="editCompletionRule"><option value="所有必修子課程完成" \${pkg.completionRule !== '任一必修子課程完成' ? 'selected' : ''}>所有必修子課程完成</option><option value="任一必修子課程完成" \${pkg.completionRule === '任一必修子課程完成' ? 'selected' : ''}>任一必修子課程完成</option></select></label><label class="field-group"><span>啟用</span><select id="editEnabled">\${yesNoSelect(pkg.enabled)}</select></label></div><p class="form-hint">「任一必修子課程完成」適合依門市類型分流：3 個子課程只要完成其中 1 個，整門課即完成。</p><div class="form-actions"><button class="secondary-button" type="button" data-cancel-editor>取消</button><button class="primary-button" type="submit">儲存</button></div></form>\`);
    bindEditorForm();
  }

  function openLessonEditor`]);
  reps.push(["publishState: $('editPublishState').value };","publishState: $('editPublishState').value, completionRule: $('editCompletionRule')?.value || '所有必修子課程完成' };"]);
  reps.push(["  async function loadStudentSubmission(lessonId) {",`\n  async function clearForceCompletePackage(button) {
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

  async function loadStudentSubmission(lessonId) {`]);
  let count=0;
  for(const [from,to] of reps){const before=source;source=source.replace(from,to);if(source!==before)count++;}
  if(count!==reps.length)throw new Error('PATCH_MISMATCH_'+count+'_'+reps.length);
  return source;
}
(async()=>{
  try{
    if(typeof DecompressionStream!=='function')throw new Error('BROWSER_UNSUPPORTED');
    const texts=await Promise.all(PARTS.map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('BUNDLE_HTTP_'+r.status);return r.text();}));
    const bin=atob(texts.join(''));const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));let source=await new Response(stream).text();source=patch(source);
    const style=document.createElement('style');style.id='v112-release-style';style.textContent=css;document.head.appendChild(style);
    (0,eval)(source);
  }catch(err){console.error('V1.1.2 boot failed',err);const boot=document.getElementById('bootView');if(boot)boot.innerHTML='<strong>新版程式載入失敗，請重新整理頁面。</strong>';}
})();
})();