const fs=require('fs');let s=fs.readFileSync('app.js','utf8');
function one(a,b,n){const i=s.indexOf(a);if(i<0)throw Error('missing '+n);if(s.indexOf(a,i+a.length)>=0)throw Error('duplicate '+n);s=s.slice(0,i)+b+s.slice(i+a.length)}
one("    adminCatalogLoading: null\n  };","    adminCatalogLoading: null,\n    submissionDeleteChains: new Map()\n  };",'state');
one(`  async function api(action, payload = {}, token = state.token, options = {}) {
    if (!configured()) throw new Error('尚未設定 Apps Script /exec 網址。');
    const retryable = options.retry === true || ['health', 'bootstrap', 'adminOverview', 'studentPackages', 'adminCatalog'].includes(action);
    const attempts = retryable ? 3 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
        const response = await fetch(window.LEARNING_CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ action, payload: payload || {}, sessionToken: token || '' }),
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
        clearTimeout(timer);
        const result = await response.json();
        if (!result || result.success !== true) {
          const err = new Error(result?.error?.message || '後端處理失敗。');
          err.code = result?.error?.code || 'SERVER_ERROR';
          throw err;
        }
        return result.data;
      } catch (error) {
        lastError = error;
        const sessionExpired = /SESSION_EXPIRED|SESSION_REQUIRED/.test(error.code || '') || /登入已逾時|請重新登入/.test(error.message || '');
        if (!retryable || sessionExpired || attempt === attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error('連線失敗。');
  }`,`  async function api(action, payload = {}, token = state.token, options = {}) {
    if (!configured()) throw new Error('尚未設定 Apps Script /exec 網址。');
    const retryable = options.retry === true && action !== 'bootstrap';
    const attempts = retryable ? 2 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timeout = options.timeout || (action === 'health' ? 6000 : action === 'bootstrap' ? 7000 : action === 'login' ? 12000 : 15000);
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(window.LEARNING_CONFIG.API_URL, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ action, payload: payload || {}, sessionToken: token || '' }),
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal
        });
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); }
        catch {
          const err = new Error('後端暫時無法提供資料，請稍後再試。');
          err.code = 'NON_JSON_RESPONSE'; err.retryable = false; throw err;
        }
        if (!response.ok) { const err = new Error(result?.error?.message || '後端連線失敗。'); err.code = result?.error?.code || 'HTTP_ERROR'; err.retryable = response.status >= 500; throw err; }
        if (!result || result.success !== true) { const err = new Error(result?.error?.message || '後端處理失敗。'); err.code = result?.error?.code || 'SERVER_ERROR'; err.retryable = false; throw err; }
        return result.data;
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError') { const err = new Error('後端回應逾時，請再試一次。'); err.code='TIMEOUT'; err.retryable=true; lastError=err; }
        const sessionExpired = /SESSION_EXPIRED|SESSION_REQUIRED/.test(lastError.code || '') || /登入已逾時|請重新登入/.test(lastError.message || '');
        if (!retryable || sessionExpired || lastError.retryable === false || attempt === attempts - 1) throw lastError;
        await new Promise(resolve => setTimeout(resolve, 250));
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('連線失敗。');
  }`,'api');
one("    const data = await api('health', {}, '', { retry: true, timeout: 15000 });","    const data = await api('health', {}, '', { retry: false, timeout: 6000 });",'health');
one("    const data = await api('login', { employeeId: account, password }, '', { timeout: 25000 });","    const data = await api('login', { employeeId: account, password }, '', { timeout: 12000 });",'login timeout');
one("      const data = await api('bootstrap', {}, state.token, { retry: true });","      const data = await api('bootstrap', {}, state.token, { retry: false, timeout: 7000 });",'restore bootstrap');
one(`  async function removeSubmissionFile(lesson, fileId, button) {
    if (!confirm('確定刪除這個尚未送審的附件？')) return;
    setButtonBusy(button, true);
    try { state.activeSubmission = cacheStudentSubmission(lesson.id, await api('removeSubmissionFile', { lessonId: lesson.id, fileId })); renderStudentSubmission(); }
    catch (error) { setButtonBusy(button, false); showToast(error.message || '刪除失敗'); }
  }`,`  function removeSubmissionFile(lesson, fileId) {
    const current=state.activeSubmission, files=current?.latest?.files||[];
    if(!current?.latest || !files.some(f=>f.id===fileId)) return;
    state.activeSubmission=cacheStudentSubmission(lesson.id,{...current,latest:{...current.latest,files:files.filter(f=>f.id!==fileId)}});
    renderStudentSubmission();
    const previous=state.submissionDeleteChains.get(lesson.id)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>api('removeSubmissionFile',{lessonId:lesson.id,fileId},state.token,{timeout:15000}));
    state.submissionDeleteChains.set(lesson.id,task);
    task.catch(error=>showToast(error.message||'刪除失敗，正在重新同步')).finally(()=>{
      if(state.submissionDeleteChains.get(lesson.id)!==task)return;
      state.submissionDeleteChains.delete(lesson.id);
      requestStudentSubmission(lesson.id,true).then(data=>{if(state.activeLessonId===lesson.id){state.activeSubmission=data;renderStudentSubmission();}}).catch(()=>{});
    });
  }`,'delete');
one("state.submissionCache.clear(); state.submissionInflight.clear(); state.adminSubmissionsLoadedAt","state.submissionCache.clear(); state.submissionInflight.clear(); state.submissionDeleteChains.clear(); state.adminSubmissionsLoadedAt",'logout delete reset');
fs.writeFileSync('app.js',s);
