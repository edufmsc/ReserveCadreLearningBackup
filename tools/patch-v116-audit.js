const fs=require('fs');
let s=fs.readFileSync('app.js','utf8');
function one(a,b,n){const i=s.indexOf(a);if(i<0)throw Error('missing '+n);if(s.indexOf(a,i+a.length)>=0)throw Error('duplicate '+n);s=s.slice(0,i)+b+s.slice(i+a.length);}
one("  const VERSION = 'V1.1.4';","  const VERSION = 'V1.1.6';",'version');
one("    pdfCache: new Map(),\n    mediaObserver: null,","    pdfCache: new Map(),\n    pdfPageObservers: new Set(),\n    mediaObserver: null,",'pdf observer state');
one("    submissionDeleteChains: new Map()\n  };","    submissionDeleteChains: new Map(),\n    apiConnected: false,\n    selectedAdminContentFile: null\n  };",'api content state');
one("        if (!result || result.success !== true) { const err = new Error(result?.error?.message || '後端處理失敗。'); err.code = result?.error?.code || 'SERVER_ERROR'; err.retryable = false; throw err; }\n        return result.data;","        if (!result || result.success !== true) { const err = new Error(result?.error?.message || '後端處理失敗。'); err.code = result?.error?.code || 'SERVER_ERROR'; err.retryable = false; throw err; }\n        state.apiConnected = true;\n        if (action !== 'health') setModeBadge('online', '後端正常');\n        return result.data;",'api connected');
one(`      const backendVersion = clean(data?.version);
      if (data?.ok && backendVersion && backendVersion !== VERSION) setModeBadge('checking', \`後端 \${backendVersion}｜待更新\`);
      else setModeBadge(data?.ok ? 'online' : 'offline', data?.ok ? '後端正常' : '資料異常');
      if (data?.features) state.features = { ...state.features, ...data.features };
      return !!data?.ok;
    } catch {
      setModeBadge('offline', '連線異常');
      return false;`, `      const backendVersion = clean(data?.version);
      if (data?.ok) { state.apiConnected = true; setModeBadge('online', backendVersion ? \`後端正常｜\${backendVersion}\` : '後端正常'); }
      else setModeBadge('offline', '資料異常');
      if (data?.features) state.features = { ...state.features, ...data.features };
      return !!data?.ok;
    } catch {
      setModeBadge(state.apiConnected ? 'online' : 'offline', state.apiConnected ? '後端正常' : '連線異常');
      return false;`,'health status');
one("    const task = api('studentPackages', {}, state.token, { retry: true })","    const task = api('studentPackages', {}, state.token, { retry: false, timeout: 8000 })",'student packages timeout');
one("    const task = api('adminCatalog', {}, state.token, { retry: true })","    const task = api('adminCatalog', {}, state.token, { retry: false, timeout: 8000 })",'admin catalog timeout');
one("      const data = await api('adminOverview', {}, state.token, { retry: true });","      const data = await api('adminOverview', {}, state.token, { retry: false, timeout: 8000 });",'admin overview timeout');
one(`    } catch (error) {
      const expired = /SESSION_EXPIRED|SESSION_REQUIRED/.test(error.code || '') || /登入已逾時|請重新登入/.test(error.message || '');
      if (expired) {
        state.token = '';
        clearSession();
        clearViewState();
      }
      return false;
    }`, `    } catch (error) {
      // 恢復失敗就清掉本機舊 session，避免每次重新整理都再次卡在 bootstrap。
      state.token = '';
      clearSession();
      clearViewState();
      return false;
    }`,'restore clear stale session');
one("    if (state.mediaObserver) state.mediaObserver.disconnect();\n    state.mediaObserver = null;","    if (state.mediaObserver) state.mediaObserver.disconnect();\n    state.mediaObserver = null;\n    state.pdfPageObservers.forEach(observer => { try { observer.disconnect(); } catch {} });\n    state.pdfPageObservers.clear();",'disconnect pdf observers');

const oldPdf=`      host.innerHTML = '<div class="pdf-canvas-stack"></div>';
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
        label.textContent = \`第 \${pageNo} / \${pdf.numPages} 頁\`;
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = \`\${cssWidth}px\`;
        canvas.style.height = \`\${cssHeight}px\`;
        canvas.addEventListener('contextmenu', event => event.preventDefault());
        wrap.append(label, canvas);
        stack.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: renderViewport }).promise;
      }`;
const newPdf=`      host.innerHTML = '<div class="pdf-canvas-stack"></div>';
      const stack = host.firstElementChild;
      const available = Math.max(280, host.clientWidth - 28);
      const pixelRatio = Math.min(window.innerWidth <= 760 ? 1.15 : 1.4, Math.max(1, window.devicePixelRatio || 1));
      const renderPage = async wrap => {
        if (wrap.dataset.rendered === '1' || wrap.dataset.rendering === '1') return;
        wrap.dataset.rendering = '1';
        try {
          const pageNo = Number(wrap.dataset.pageNo);
          const page = await pdf.getPage(pageNo);
          const baseViewport = page.getViewport({ scale: 1 });
          const cssScale = Math.min(2, available / baseViewport.width);
          const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
          const canvas = wrap.querySelector('canvas');
          canvas.width = Math.max(1, Math.floor(renderViewport.width));
          canvas.height = Math.max(1, Math.floor(renderViewport.height));
          await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: renderViewport }).promise;
          wrap.dataset.rendered = '1';
        } finally { wrap.dataset.rendering = '0'; }
      };
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) renderPage(entry.target).catch(() => {});
      }), { root: host, rootMargin: '900px 0px', threshold: 0.01 });
      state.pdfPageObservers.add(observer);
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = Math.min(2, available / baseViewport.width);
        const cssWidth = Math.max(1, Math.floor(baseViewport.width * cssScale));
        const cssHeight = Math.max(1, Math.floor(baseViewport.height * cssScale));
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap'; wrap.dataset.pageNo = String(pageNo);
        const label = document.createElement('div'); label.className = 'pdf-page-label'; label.textContent = \`第 \${pageNo} / \${pdf.numPages} 頁\`;
        const canvas = document.createElement('canvas'); canvas.className = 'pdf-page-canvas';
        canvas.style.width = \`\${cssWidth}px\`; canvas.style.height = \`\${cssHeight}px\`;
        canvas.addEventListener('contextmenu', event => event.preventDefault());
        wrap.append(label, canvas); stack.appendChild(wrap); observer.observe(wrap);
      }
      const first = stack.querySelector('.pdf-page-wrap'); if (first) renderPage(first).catch(() => {});`;
one(oldPdf,newPdf,'lazy pdf pages');

one("  function openContentEditor(content, lessonId = '', directPackageId = '') {\n    content = content ||", "  function contentUploadEditorHtml() {\n    if (!state.features.contentFileUploadV116) return '<div class=\"manage-warning\">直接上傳教材需部署 V1.1.6 後端；目前仍可貼 Google Drive / 網址。</div>';\n    const maxMb = n(state.uploadConfig.maxMb || 20);\n    return `<label id=\"editContentFileGroup\" class=\"field-group field-group--wide\"><span>或直接上傳檔案</span><input id=\"editContentFile\" type=\"file\"><small>PDF 或下載檔可直接選檔；單檔最多 ${maxMb} MB。母課程與子課程使用同一套流程。</small></label>`;\n  }\n\n  function openContentEditor(content, lessonId = '', directPackageId = '') {\n    state.selectedAdminContentFile = null;\n    content = content ||",'content upload helper');
one("</textarea></label></div><p class=\"form-hint\">PDF 可使用 Google Drive 分享連結，學員會直接在網站內閱讀，不另開視窗。</p>", "</textarea></label>${contentUploadEditorHtml()}</div><p class=\"form-hint\">PDF／下載檔可貼網址或直接上傳檔案；母課程與子課程操作一致。</p>",'content editor upload ui');
one("    bindEditorForm();\n    $('testContentLinkButton').onclick = () => {", "    bindEditorForm();\n    const fileInput = $('editContentFile'), fileGroup = $('editContentFileGroup'), typeInput = $('editType');\n    const refreshFileInput = () => { if (fileGroup) fileGroup.hidden = !['PDF','FILE'].includes(typeInput?.value || ''); };\n    if (typeInput) { typeInput.addEventListener('change', refreshFileInput); refreshFileInput(); }\n    if (fileInput) fileInput.onchange = () => {\n      const file = fileInput.files?.[0] || null; state.selectedAdminContentFile = file;\n      if (!file) return;\n      const maxBytes = n(state.uploadConfig.maxMb || 20) * 1024 * 1024;\n      if (file.size > maxBytes) { state.selectedAdminContentFile = null; fileInput.value=''; showToast(`檔案不可超過 ${state.uploadConfig.maxMb || 20} MB`); return; }\n      if (typeInput?.value === 'PDF' && !/\\.pdf$/i.test(file.name)) { state.selectedAdminContentFile = null; fileInput.value=''; showToast('PDF 教材請選擇 .pdf 檔案'); }\n    };\n    $('testContentLinkButton').onclick = () => {",'bind content file');
one("        payload = { id: $('editId').value, lessonId: $('editLessonId').value, packageId: $('editDirectPackageId').value, type: $('editType').value, title: $('editTitle').value, url: $('editUrl').value, text: $('editText').value, sort: Number($('editSort').value), enabled: boolValue('editEnabled') };", "        payload = { id: $('editId').value, lessonId: $('editLessonId').value, packageId: $('editDirectPackageId').value, type: $('editType').value, title: $('editTitle').value, url: $('editUrl').value, text: $('editText').value, sort: Number($('editSort').value), enabled: boolValue('editEnabled') };\n        const adminFile = state.selectedAdminContentFile;\n        if (adminFile) {\n          if (!state.features.contentFileUploadV116) throw new Error('後端尚未啟用教材直接上傳');\n          button.textContent = '上傳並儲存中…';\n          payload.fileName = adminFile.name; payload.mimeType = adminFile.type || 'application/octet-stream'; payload.fileBase64 = await fileBase64(adminFile);\n        }",'content submit file');
one("    const data = await api(action, payload);", "    const data = await api(action, payload, state.token, { timeout: action === 'saveContent' && payload?.fileBase64 ? 90000 : 15000 });",'admin save timeout');
one("    $('adminEditorBody').innerHTML = '';\n    document.body.classList.remove('is-locked');", "    $('adminEditorBody').innerHTML = '';\n    state.selectedAdminContentFile = null;\n    document.body.classList.remove('is-locked');",'clear admin file');
one("state.submissionDeleteChains.clear(); state.adminSubmissionsLoadedAt", "state.submissionDeleteChains.clear(); state.selectedAdminContentFile = null; state.apiConnected = false; state.adminSubmissionsLoadedAt",'logout state');
fs.writeFileSync('app.js',s);
let h=fs.readFileSync('index.html','utf8');h=h.replace(/V1\.1\.4/g,'V1.1.6').replace(/v=1\.1\.4/g,'v=1.1.6');fs.writeFileSync('index.html',h);
