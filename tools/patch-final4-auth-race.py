from pathlib import Path

p=Path('app.js')
s=p.read_text(encoding='utf-8')

s=s.replace(
"    sessionRestoreInFlight: null,\n    selectedAdminContentFile: null",
"    sessionRestoreInFlight: null,\n    authGeneration: 0,\n    selectedAdminContentFile: null",
1)

old='''  async function login(account, password) {
    clearViewState();
    const data = await api('login', { employeeId: account, password }, '', { timeout: 12000 });
    state.token = data.sessionToken;
    saveSession();
    const bootstrap = data.bootstrap || await api('bootstrap', {}, state.token, { retry: true });
    captureBootstrap(bootstrap);
    renderDashboard();
    hydrateDashboardData().catch(error => showToast(error.message || '資料載入失敗'));
  }'''
new='''  async function login(account, password) {
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
  }'''
if old not in s: raise RuntimeError('login target missing')
s=s.replace(old,new,1)

old='''    const restoreToken = saved.token;
    state.token = restoreToken;
    const task = (async () => {
      try {
        const data = await api('bootstrap', {}, restoreToken, { retry: true, timeout: 12000 });
        if (state.token !== restoreToken && state.user) return true;
        captureBootstrap(data);'''
new='''    const restoreToken = saved.token;
    const generation = state.authGeneration;
    state.token = restoreToken;
    const task = (async () => {
      try {
        const data = await api('bootstrap', {}, restoreToken, { retry: true, timeout: 12000 });
        if (generation !== state.authGeneration) return false;
        if (state.token !== restoreToken && state.user) return true;
        captureBootstrap(data);'''
if old not in s: raise RuntimeError('restore start target missing')
s=s.replace(old,new,1)

old='''      } catch (error) {
        if (isSessionExpiredError(error)) {
          if (state.token === restoreToken) state.token = '';
          clearSession();
          clearViewState();
        } else {
          state.token = restoreToken;
        }
        return false;
      } finally { state.sessionRestoreInFlight = null; }'''
new='''      } catch (error) {
        if (generation !== state.authGeneration) return false;
        if (isSessionExpiredError(error)) {
          if (state.token === restoreToken) state.token = '';
          clearSession();
          clearViewState();
        } else if (state.token === restoreToken || !state.user) {
          state.token = restoreToken;
        }
        return false;
      } finally { state.sessionRestoreInFlight = null; }'''
if old not in s: raise RuntimeError('restore catch target missing')
s=s.replace(old,new,1)

old='''  function logout() {
    // V1.1.4: 使用者按下登出後立即切回登入頁；伺服器 session 清除改為背景執行。
    const token = state.token;'''
new='''  function logout() {
    // FINAL4: invalidate any in-flight login/session restore before clearing UI.
    state.authGeneration += 1;
    const token = state.token;'''
if old not in s: raise RuntimeError('logout target missing')
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('patched auth generation guard')
