/**
 * analytics.js — Yandex AppMetrica wrapper (classic IIFE, window.Analytics).
 *
 * Контракт см. в skill `connect-appmetrica` и docs/ANALYTICS.md.
 * JS-обёртка над нативным `window.AppMetrica` (bridge через html2apk
 * -YandexAppMetrica). В browser dev (нет window.AppMetrica) — mock-mode:
 * все события идут в console.log, чтобы можно было отлаживать без устройства.
 *
 * Подключается в index.html через <script src="analytics.js"></script>
 * ПЕРЕД main.js, чтобы window.Analytics был доступен на bootstrap'е.
 */
(function (global) {
  'use strict';

  var configured = false;

  // Группы A/B этого устройства — 'pacing:often'. Уходит параметром `ab` в
  // КАЖДОМ событии, и без этого тест бессмыслен: разбиение есть, а сравнить
  // группы нечем.
  //
  // Отдельным сеттером, а не полем configure: контекст заводится сразу, а
  // группы приезжают из сети и позже.
  var abLabel = '';
  var ctx = {
    appName: 'unknown',
    appVersion: '1.0.0',
    platform: (typeof window !== 'undefined' && window.AppMetrica) ? 'android' : 'browser',
    userId: null
  };

  function configure(opts) {
    opts = opts || {};
    if (opts.appName)    ctx.appName    = opts.appName;
    if (opts.appVersion) ctx.appVersion = opts.appVersion;
    if (opts.userId)     ctx.userId     = opts.userId;
    configured = true;
    if (window.AppMetrica && ctx.userId) {
      try { window.AppMetrica.setUserProfileID(String(ctx.userId)); }
      catch (e) { console.warn('[analytics] setUserProfileID failed:', e); }
    }
    if (!window.AppMetrica) {
      console.log('[analytics] configured (browser mock):', ctx);
    }
    // Push attribution: cold-start case — приложение запущено кликом по
    // нотификации. LocalNotifications bridge (если подключён) хранит
    // template_id, JS вычитывает его и шлёт push_opened event.
    checkPushOpenedAttribution();
    // Warm-start case — юзер сворачивал приложение, тапнул нотификацию
    // → onNewIntent → setPendingPushTemplateId → JS visibilitychange.
    if (!visibilityHooked && typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') checkPushOpenedAttribution();
      });
      visibilityHooked = true;
    }
  }

  var visibilityHooked = false;
  function checkPushOpenedAttribution() {
    if (!window.LocalNotifications || typeof window.LocalNotifications.consumePushTemplateId !== 'function') return;
    try {
      var tid = window.LocalNotifications.consumePushTemplateId();
      if (tid) {
        event('push_opened', { template_id: tid });
      }
    } catch (e) {
      console.warn('[analytics] consumePushTemplateId failed:', e);
    }
  }

  function setAbCohorts(label) {
    abLabel = label || '';
  }

  function event(name, params) {
    if (!configured) {
      console.warn('[analytics] event before configure():', name);
    }
    var payload = Object.assign({}, params || {}, {
      app_name:    ctx.appName,
      app_version: ctx.appVersion,
      platform:    ctx.platform,
      user_id:     ctx.userId,
      ab:          abLabel
    });
    if (window.AppMetrica) {
      try {
        window.AppMetrica.reportEvent(name, JSON.stringify(payload));
      } catch (e) {
        console.warn('[analytics] reportEvent failed:', name, e);
      }
    } else {
      console.log('[analytics]', name, payload);
    }
  }

  function adShown(opts) {
    opts = opts || {};
    var kind = opts.type === 'rewarded' ? 'ad_rewarded_shown' : 'ad_interstitial_shown';
    var params = { placement: opts.placement || 'unknown' };
    if (opts.type === 'rewarded') {
      params.watched      = !!opts.watched;
      params.reward_given = !!opts.rewardGiven;
    }
    event(kind, params);
  }

  function error(message, details) {
    if (window.AppMetrica) {
      try { window.AppMetrica.reportError(String(message || ''), String(details || '')); }
      catch (e) { console.warn('[analytics] reportError failed:', e); }
    } else {
      console.log('[analytics] error', message, details);
    }
  }

  function setUser(id) {
    ctx.userId = id;
    if (window.AppMetrica) {
      try { window.AppMetrica.setUserProfileID(String(id)); }
      catch (e) { console.warn('[analytics] setUser failed:', e); }
    }
  }

  global.Analytics = {
    configure: configure,
    setAbCohorts: setAbCohorts,
    event: event,
    adShown: adShown,
    error: error,
    setUser: setUser
  };
})(typeof window !== 'undefined' ? window : globalThis);
