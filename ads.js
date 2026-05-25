/**
 * ads.js — менеджер рекламы для Sudoku.
 *
 * Архитектура (см. docs/ADS.md):
 *   native — html2apk с -YandexAdsBridge экспонирует window.YandexAds.*
 *            и шлёт результаты в window.__yandexAdsCallback(kind, event).
 *   mock   — DOM-оверлей для dev-режима в браузере.
 *
 * Cadence (Sudoku-специфика):
 *   Interstitial — между уровнями, не чаще раза в N секунд (cooldownMs).
 *   Rewarded — по запросу пользователя (например +1 сердце в game-over).
 *
 * API:
 *   AdManager.showInterstitialAd()            → Promise<{watched: bool}>
 *   AdManager.showRewardedAd(reward?)         → Promise<{watched: bool, reward}>
 *   AdManager.shouldShowInterstitial(levelsCompleted) → bool
 *   AdManager.scheduleNextAd()                — сбрасывает cooldown
 *   AdManager.getBackend()                    → 'native' | 'mock' | 'pending'
 *   AdManager.stats()
 */
window.AdManager = (function () {
  const CFG = window.GAME_CONFIG.ADS;
  const CALLBACK_TIMEOUT_MS = 120000;

  let backend = null;
  let pendingInterstitial = null;
  let pendingRewarded = null;
  let pendingInterstitialTimer = null;
  let pendingRewardedTimer = null;
  let lastInterstitialAt = 0;
  let totalShown = 0;
  // Время старта сессии — используется для гэйта minSessionMs.
  // В первую минуту app interstitial не показывается, даже если все
  // остальные condition'ы выполнены. Хорошее first-impression UX.
  const sessionStartAt = Date.now();

  function isForcedMock() {
    return window.Storage ? window.Storage.getMockAds() : window.GAME_CONFIG.mockAds;
  }

  function ensureBackend() {
    if (backend !== null) return;
    if (isForcedMock()) {
      backend = 'mock';
      console.log('[ads] backend=mock (forced)');
      return;
    }
    if (window.YandexAds && typeof window.YandexAds.showInterstitial === 'function') {
      backend = 'native';
      setupNativeCallback();
      console.log('[ads] backend=native (YandexAds bridge detected)');
      try {
        window.YandexAds.preloadInterstitial(CFG.interstitial.unitId);
        window.YandexAds.preloadRewarded(CFG.rewarded.unitId);
      } catch (e) { console.warn('[ads] preload skipped:', e); }
      return;
    }
    backend = 'mock';
    console.log('[ads] backend=mock (no YandexAds bridge — dev browser)');
  }

  function setupNativeCallback() {
    window.__yandexAdsCallback = function (kind, event) {
      if (kind === 'interstitial' && pendingInterstitial) {
        const resolve = pendingInterstitial;
        pendingInterstitial = null;
        if (pendingInterstitialTimer) { clearTimeout(pendingInterstitialTimer); pendingInterstitialTimer = null; }
        resolve({ watched: true });
      }
      if (kind === 'rewarded' && pendingRewarded) {
        const resolve = pendingRewarded;
        pendingRewarded = null;
        if (pendingRewardedTimer) { clearTimeout(pendingRewardedTimer); pendingRewardedTimer = null; }
        resolve({ watched: event === 'rewarded' });
      }
    };
  }

  function showMockOverlay(title, subtitle, durationMs) {
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'ad-mock-overlay';
      overlay.innerHTML = ''
        + '<div class="ad-mock-box">'
        + '<div class="ad-mock-badge">Реклама (mock)</div>'
        + '<div class="ad-mock-title">' + title + '</div>'
        + '<div class="ad-mock-sub">' + subtitle + '</div>'
        + '<div class="ad-mock-bar"><div class="ad-mock-bar-fill"></div></div>'
        + '</div>';
      document.body.appendChild(overlay);

      const fill = overlay.querySelector('.ad-mock-bar-fill');
      requestAnimationFrame(function () {
        fill.style.transition = 'width ' + durationMs + 'ms linear';
        fill.style.width = '100%';
      });

      setTimeout(function () {
        overlay.classList.add('fade-out');
        setTimeout(function () { overlay.remove(); }, 220);
        resolve({ watched: true });
      }, durationMs);
    });
  }

  function showInterstitialAd() {
    totalShown++;
    lastInterstitialAt = Date.now();
    ensureBackend();
    if (backend === 'native') {
      return new Promise(function (resolve) {
        pendingInterstitial = resolve;
        pendingInterstitialTimer = setTimeout(function () {
          if (pendingInterstitial) {
            console.warn('[ads] interstitial callback timeout');
            pendingInterstitial = null;
            pendingInterstitialTimer = null;
            resolve({ watched: false });
          }
        }, CALLBACK_TIMEOUT_MS);
        try {
          window.YandexAds.showInterstitial(CFG.interstitial.unitId);
        } catch (err) {
          console.warn('[ads] native interstitial failed', err);
          pendingInterstitial = null;
          if (pendingInterstitialTimer) { clearTimeout(pendingInterstitialTimer); pendingInterstitialTimer = null; }
          resolve({ watched: false });
        }
      });
    }
    return showMockOverlay('Интерстишиал', 'Игра продолжится через мгновение…', 1200);
  }

  function showRewardedAd(reward) {
    totalShown++;
    ensureBackend();
    if (backend === 'native') {
      return new Promise(function (resolve) {
        pendingRewarded = function (r) { resolve(Object.assign({}, r, { reward: reward || true })); };
        pendingRewardedTimer = setTimeout(function () {
          if (pendingRewarded) {
            console.warn('[ads] rewarded callback timeout');
            pendingRewarded = null;
            pendingRewardedTimer = null;
            resolve({ watched: false, reward: reward || true });
          }
        }, CALLBACK_TIMEOUT_MS);
        try {
          window.YandexAds.showRewarded(CFG.rewarded.unitId);
        } catch (err) {
          console.warn('[ads] native rewarded failed', err);
          pendingRewarded = null;
          if (pendingRewardedTimer) { clearTimeout(pendingRewardedTimer); pendingRewardedTimer = null; }
          resolve({ watched: false, reward: reward || true });
        }
      });
    }
    return showMockOverlay('Бонусная реклама', 'Спасибо за поддержку!', 1600)
      .then(function (r) { return Object.assign({}, r, { reward: reward || true }); });
  }

  function shouldShowInterstitial(levelsCompleted) {
    // Гэйты (все должны быть пройдены чтобы показать interstitial):
    //   1. Пройдено уровней ≥ skipFirstNLevels (3 — игрок не сразу
    //      получает рекламу, а после знакомства с механикой).
    //   2. С момента запуска приложения прошло ≥ minSessionMs (60s).
    //      Хороший first-impression UX, рекламы не сразу в лоб.
    //   3. С последнего показа прошло ≥ cooldownMs (90s).
    //   4. levelsCompleted кратен cadenceLevels (по умолчанию каждый 2-й).
    if (levelsCompleted < CFG.interstitial.skipFirstNLevels) return false;
    const minSession = CFG.interstitial.minSessionMs | 0;
    if (minSession > 0 && Date.now() - sessionStartAt < minSession) return false;
    if ((levelsCompleted % CFG.interstitial.cadenceLevels) !== 0) return false;
    if (Date.now() - lastInterstitialAt < CFG.interstitial.cooldownMs) return false;
    return true;
  }

  function scheduleNextAd() {
    lastInterstitialAt = Date.now();
  }

  function stats() {
    return {
      totalShown: totalShown,
      backend: backend || 'pending',
      lastInterstitialAt: lastInterstitialAt
    };
  }

  function getBackend() { return backend || 'pending'; }

  ensureBackend();

  return {
    showInterstitialAd: showInterstitialAd,
    showRewardedAd: showRewardedAd,
    shouldShowInterstitial: shouldShowInterstitial,
    scheduleNextAd: scheduleNextAd,
    stats: stats,
    getBackend: getBackend
  };
})();
