(function () {
  'use strict';

  function configured() {
    return !!(window.LEARNING_CONFIG && /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(String(window.LEARNING_CONFIG.API_URL || '').trim()));
  }

  async function request(action, payload, sessionToken) {
    if (!configured()) throw new Error('尚未設定 Apps Script /exec 網址。');
    const response = await fetch(window.LEARNING_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action, payload: payload || {}, sessionToken: sessionToken || '' }),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
    const result = await response.json();
    if (!result || result.success !== true) throw new Error(result && result.error ? result.error.message : '後端處理失敗。');
    return result.data;
  }

  window.LearningApi = Object.freeze({ configured, request });
})();
