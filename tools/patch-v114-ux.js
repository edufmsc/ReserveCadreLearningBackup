const fs = require('fs');
let s = fs.readFileSync('app.js','utf8');
function one(a,b,label){const i=s.indexOf(a);if(i<0)throw new Error('missing '+label);if(s.indexOf(a,i+a.length)>=0)throw new Error('duplicate '+label);s=s.slice(0,i)+b+s.slice(i+a.length);}
one("  const VERSION = 'V1.1.3';","  const VERSION = 'V1.1.4';",'version');
one("    uploadConfig: { enabled: false, maxMb: 20, maxFilesPerBatch: 5, maxFilesPerSubmission: 20, allowedExtensions: [] },","    uploadConfig: { enabled: false, maxMb: 20, maxFilesPerBatch: 10, maxFilesPerSubmission: 20, allowedExtensions: [] },",'upload default');
one(`      if (isDriveUrl(pdfUrl) && googleFileId(pdfUrl)) {
        host.classList.add('pdf-drive-shell');
        host.innerHTML = \`<iframe class="pdf-drive-frame" src="\${escapeHtml(drivePreviewUrl(pdfUrl))}" title="PDF 教材" loading="lazy" referrerpolicy="no-referrer"></iframe>\`;
        return;
      }
      let data = state.pdfCache.get(contentId);`,`      // V1.1.4: 所有 PDF 都走自有 PDF.js 閱讀器，不再嵌入 Google Drive 預覽器。
      // 這樣可移除 Drive 自帶的「彈出式視窗」控制項，且手機/電腦閱讀介面一致。
      host.classList.remove('pdf-drive-shell');
      let data = state.pdfCache.get(contentId);`,'drive pdf iframe');
one(`  async function logout() {
    if (state.activeLessonId) await closeLesson();
    try { if (state.token) await api('logout'); } catch {}
    state.token = ''; state.user = null; state.packages = []; state.adminOverview = []; state.adminCatalog = { packages: [], learners: [], assignments: [] }; state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt = 0; state.studentPackagesLoaded = false; state.adminCatalogLoaded = false; state.studentPackagesLoading = null; state.adminCatalogLoading = null;
    clearSession();
    clearViewState();
    $('dashboardView').hidden = true; $('studentDashboard').hidden = true; $('adminDashboard').hidden = true; $('lessonPage').hidden = true; $('loginView').hidden = false; $('password').value = '';
  }`,`  function logout() {
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
  }`,'logout');
fs.writeFileSync('app.js',s,'utf8');

let h=fs.readFileSync('index.html','utf8');
h=h.replace(/V1\.1\.3/g,'V1.1.4').replace(/v=1\.1\.3/g,'v=1.1.4');
fs.writeFileSync('index.html',h,'utf8');
console.log('patched V1.1.4 UX');
