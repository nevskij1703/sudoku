/**
 * rustoreReview.js — обёртка над нативным RuStore In-App Review SDK с deep-link fallback.
 *
 * Архитектура:
 *   native    — html2apk с -RuStoreReviewSdk экспонирует window.RuStoreReview.launch()
 *               и шлёт результат в window.__rustoreReviewCallback(result, error).
 *   fallback  — если bridge отсутствует или SDK вернул 'unavailable' — window.open(deepLink).
 *
 * Контракт (Java -> JS):
 *   window.__rustoreReviewCallback(result, error)
 *     result: 'shown' | 'failed' | 'unavailable'
 *
 * Публичное API:
 *   RuStoreReviewClient.configure(appId)
 *   RuStoreReviewClient.launch() → Promise<{shown, fallbackUsed, error}>
 */
window.RuStoreReviewClient = (function () {
  const DEEP_LINK_TEMPLATE = 'https://www.rustore.ru/catalog/app/';
  const CALLBACK_TIMEOUT_MS = 30000;

  let appIdForFallback = null;
  let pendingResolve = null;
  let pendingTimer = null;
  let callbackRegistered = false;

  function setupCallback() {
    if (callbackRegistered) return;
    callbackRegistered = true;
    window.__rustoreReviewCallback = function (result, error) {
      console.log('[rustoreReview] callback:', result, error);
      if (!pendingResolve) {
        console.warn('[rustoreReview] callback without pending resolver');
        return;
      }
      const resolve = pendingResolve;
      pendingResolve = null;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }

      if (result === 'shown') {
        resolve({ shown: true, fallbackUsed: false, error: null });
      } else if (result === 'failed') {
        resolve({ shown: false, fallbackUsed: false, error: error });
      } else {
        openDeepLink();
        resolve({ shown: false, fallbackUsed: true, error: error });
      }
    };
  }

  function openDeepLink() {
    if (!appIdForFallback) {
      console.warn('[rustoreReview] no appId configured, skipping fallback');
      return;
    }
    try {
      window.open(DEEP_LINK_TEMPLATE + appIdForFallback, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.warn('[rustoreReview] deep-link open failed:', e);
    }
  }

  function hasBridge() {
    return !!(window.RuStoreReview && typeof window.RuStoreReview.launch === 'function');
  }

  function configure(appId) {
    appIdForFallback = appId;
    if (hasBridge()) {
      setupCallback();
      try { window.RuStoreReview.preload(); }
      catch (e) { console.warn('[rustoreReview] preload threw:', e); }
      console.log('[rustoreReview] backend=native, preload requested');
    } else {
      console.log('[rustoreReview] backend=fallback (no bridge — dev browser or APK without -RuStoreReviewSdk)');
    }
  }

  function launch() {
    if (pendingResolve) {
      return new Promise(function (resolve) {
        const prev = pendingResolve;
        pendingResolve = function (r) { prev(r); resolve(r); };
      });
    }
    if (!hasBridge()) {
      openDeepLink();
      return Promise.resolve({ shown: false, fallbackUsed: true, error: 'no_bridge' });
    }
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      pendingTimer = setTimeout(function () {
        if (!pendingResolve) return;
        console.warn('[rustoreReview] callback timeout');
        const r = pendingResolve;
        pendingResolve = null;
        pendingTimer = null;
        openDeepLink();
        r({ shown: false, fallbackUsed: true, error: 'callback_timeout' });
      }, CALLBACK_TIMEOUT_MS);
      try {
        window.RuStoreReview.launch();
      } catch (e) {
        console.warn('[rustoreReview] native launch threw:', e);
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        pendingResolve = null;
        openDeepLink();
        resolve({ shown: false, fallbackUsed: true, error: 'launch_threw' });
      }
    });
  }

  return { configure: configure, launch: launch };
})();
