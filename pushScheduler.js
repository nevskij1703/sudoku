/**
 * pushScheduler.js — менеджер локальных пуш-уведомлений для casual-игр.
 *
 * Архитектура (см. ~/.claude/skills/connect-local-notifications/SKILL.md):
 *   native    — html2apk с -LocalNotifications экспонирует window.LocalNotifications.
 *               Через AlarmManager + BroadcastReceiver + NotificationManager.
 *   fallback  — если bridge отсутствует (browser dev): mock log в console.
 *
 * Контракт Java -> JS:
 *   window.__localNotificationsCallback(kind, data)
 *     kind='permission', data='granted'|'denied'
 *     kind='error',      data=<message>
 *
 * Публичное API:
 *   PushScheduler.configure({appName, templates, maxPerDay, storageKey})
 *   PushScheduler.requestPermission() → Promise<'granted'|'denied'>
 *   PushScheduler.refresh()           — переплан расписания на 48ч вперёд
 *   PushScheduler.setEnabled(v)       — toggle через Settings
 *   PushScheduler.isEnabled()         → bool
 *   PushScheduler.getPermissionState() → 'granted'|'denied'|'not_requested'
 *
 * Шаблон уведомления:
 *   {
 *     id: 'morning-challenge',  // уникальный
 *     slot: 'morning'|'lunch'|'evening'|'night',
 *     weekdays: 'any'|'weekend'|'weekday'|[0..6],   // 0=вс, 1=пн...
 *     title: '...',
 *     body: '...',
 *     cooldownDays: 3,         // не повторять id чаще
 *     requires: null | (state) => bool,  // дополнительный фильтр
 *     weight: 1                // вес для random-выбора
 *   }
 *
 * Slot windows (random время в окне):
 *   morning:  09:00 + 0..90 мин
 *   lunch:    13:00 + 0..60 мин
 *   evening:  19:30 + 0..90 мин
 *   night:    22:30 + 0..30 мин
 */
window.PushScheduler = (function () {
  const SLOT_WINDOWS = {
    morning: { hour: 9,  minute: 0,  spreadMinutes: 90 },
    lunch:   { hour: 13, minute: 0,  spreadMinutes: 60 },
    evening: { hour: 19, minute: 30, spreadMinutes: 90 },
    night:   { hour: 22, minute: 30, spreadMinutes: 30 }
  };
  const HORIZON_HOURS = 168;         // 7 дней. Главный механизм поддержки цепочки — auto-reschedule в Java NotificationReceiver (skill connect-local-notifications).
  const DEFAULT_MAX_PER_DAY = 4;

  let appName = 'Game';
  let templates = [];
  let maxPerDay = DEFAULT_MAX_PER_DAY;
  let storageKey = 'push_scheduler';
  let pendingPermissionResolve = null;

  function hasBridge() {
    return !!(window.LocalNotifications
              && typeof window.LocalNotifications.schedule === 'function');
  }

  // ---------- Callback wiring ----------

  let callbackRegistered = false;
  function setupCallback() {
    if (callbackRegistered) return;
    callbackRegistered = true;
    window.__localNotificationsCallback = function (kind, data) {
      console.log('[push] callback:', kind, data);
      if (kind === 'permission' && pendingPermissionResolve) {
        const resolve = pendingPermissionResolve;
        pendingPermissionResolve = null;
        resolve(data);
      }
    };
  }

  // ---------- State persistence ----------

  function readState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { shownAt: {}, lastScheduled: 0 };
      return JSON.parse(raw);
    } catch (e) {
      return { shownAt: {}, lastScheduled: 0 };
    }
  }

  function writeState(s) {
    try { localStorage.setItem(storageKey, JSON.stringify(s)); }
    catch (e) { console.warn('[push] state write failed', e); }
  }

  // ---------- Slot selection ----------

  function nextSlotDate(slot, baseDate) {
    const w = SLOT_WINDOWS[slot];
    if (!w) return null;
    const d = new Date(baseDate);
    const offsetMin = Math.floor(Math.random() * (w.spreadMinutes + 1));
    d.setHours(w.hour, w.minute + offsetMin, 0, 0);
    // Если уже прошло — переносим на завтра.
    if (d.getTime() <= Date.now() + 60_000) {
      d.setDate(d.getDate() + 1);
      // Свежий рандом для завтрашнего слота.
      const off2 = Math.floor(Math.random() * (w.spreadMinutes + 1));
      d.setHours(w.hour, w.minute + off2, 0, 0);
    }
    return d;
  }

  function isWeekdayMatch(template, date) {
    const dow = date.getDay();  // 0=вс, 6=сб
    const w = template.weekdays;
    if (!w || w === 'any') return true;
    if (w === 'weekend') return dow === 0 || dow === 6;
    if (w === 'weekday') return dow >= 1 && dow <= 5;
    if (Array.isArray(w)) return w.indexOf(dow) >= 0;
    return true;
  }

  function pickTemplateForSlot(slot, date, state, gameState) {
    const now = Date.now();
    const candidates = templates.filter(function (t) {
      if (t.slot !== slot) return false;
      if (!isWeekdayMatch(t, date)) return false;
      if (typeof t.requires === 'function') {
        try { if (!t.requires(gameState || {})) return false; }
        catch (e) { return false; }
      }
      return true;
    });
    if (candidates.length === 0) return null;

    // Считаем «эффективное время с последнего показа» (если не показывался — Infinity).
    function ageOf(t) {
      const last = state.shownAt[t.id] || 0;
      const cooldownMs = (t.cooldownDays || 1) * 24 * 3600 * 1000;
      const elapsed = now - last;
      // Если в cooldown — даём отрицательный priority (но не исключаем полностью).
      return elapsed < cooldownMs ? (elapsed - cooldownMs) : elapsed;
    }

    // Сортируем по убыванию age (давно не показывался → выше).
    // Среди равных — по weight (больший weight → выше).
    candidates.sort(function (a, b) {
      const da = ageOf(a), db = ageOf(b);
      if (db !== da) return db - da;
      return (b.weight || 1) - (a.weight || 1);
    });
    return candidates[0];
  }

  // ---------- Public API ----------

  function configure(opts) {
    if (!opts) return;
    appName = opts.appName || appName;
    templates = Array.isArray(opts.templates) ? opts.templates : [];
    maxPerDay = (typeof opts.maxPerDay === 'number') ? opts.maxPerDay : DEFAULT_MAX_PER_DAY;
    storageKey = opts.storageKey || storageKey;
    setupCallback();
    console.log('[push] configured: ' + templates.length + ' templates, maxPerDay=' + maxPerDay
                + ', backend=' + (hasBridge() ? 'native' : 'mock'));
  }

  function getPermissionState() {
    if (!hasBridge()) return 'denied';  // browser dev — нет native API
    try { return window.LocalNotifications.getPermissionState() || 'denied'; }
    catch (e) { return 'denied'; }
  }

  function requestPermission() {
    if (!hasBridge()) return Promise.resolve('denied');
    if (pendingPermissionResolve) {
      // Уже идёт запрос — возвращаем тот же promise.
      return new Promise(function (resolve) {
        const prev = pendingPermissionResolve;
        pendingPermissionResolve = function (r) { prev(r); resolve(r); };
      });
    }
    return new Promise(function (resolve) {
      pendingPermissionResolve = resolve;
      try { window.LocalNotifications.requestPermission(); }
      catch (e) {
        pendingPermissionResolve = null;
        resolve('denied');
      }
      // Защитный таймаут — если callback не пришёл за 60s.
      setTimeout(function () {
        if (pendingPermissionResolve === resolve || pendingPermissionResolve) {
          const r = pendingPermissionResolve;
          pendingPermissionResolve = null;
          if (r) r('denied');
        }
      }, 60_000);
    });
  }

  function isEnabled() {
    // Источник правды — Storage проекта (через intl-функцию или localStorage).
    // Здесь fallback на нашу собственную ячейку, если интеграция не задана.
    if (typeof window.__getPushEnabled === 'function') {
      return !!window.__getPushEnabled();
    }
    const s = readState();
    return s.enabled !== false;  // default true
  }

  function setEnabled(v) {
    if (typeof window.__setPushEnabled === 'function') {
      window.__setPushEnabled(!!v);
    } else {
      const s = readState();
      s.enabled = !!v;
      writeState(s);
    }
    if (!v) {
      // Отключили — снимаем все pending.
      if (hasBridge()) {
        try { window.LocalNotifications.cancelAll(); } catch (e) {}
      }
    } else {
      refresh();
    }
  }

  /**
   * Главная логика: планируем расписание на HORIZON_HOURS вперёд.
   * Вызывается на старте + после ключевых событий (win, gameover, settings toggle).
   *
   * @param {object} [gameState] — опциональные данные для template.requires
   */
  function refresh(gameState) {
    if (!isEnabled()) {
      console.log('[push] refresh skipped: disabled');
      return;
    }
    if (getPermissionState() !== 'granted') {
      console.log('[push] refresh skipped: permission=' + getPermissionState());
      return;
    }
    if (!templates.length) {
      console.warn('[push] no templates');
      return;
    }

    // Cancel все ранее запланированные, чтобы не дублировать.
    if (hasBridge()) {
      try { window.LocalNotifications.cancelAll(); } catch (e) {}
    }

    const state = readState();
    const slots = ['morning', 'lunch', 'evening', 'night'];

    // Считаем сколько дней в горизонте (округлено вверх).
    const days = Math.ceil(HORIZON_HOURS / 24);
    let scheduled = 0;
    const scheduledLog = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      let perDay = 0;
      for (let i = 0; i < slots.length && perDay < maxPerDay; i++) {
        const slot = slots[i];
        const base = new Date();
        base.setDate(base.getDate() + dayOffset);
        const at = nextSlotDate(slot, base);
        if (!at) continue;
        if (at.getTime() > Date.now() + HORIZON_HOURS * 3600 * 1000) continue;
        if (at.getTime() <= Date.now() + 30_000) continue;  // не ставить в прошлое/слишком близко

        const tmpl = pickTemplateForSlot(slot, at, state, gameState);
        if (!tmpl) continue;

        // Unique numeric id для AlarmManager. Используем хэш id-строки + дата.
        const numId = hashId(tmpl.id) ^ Math.floor(at.getTime() / 60000);
        if (hasBridge()) {
          try {
            // 5-й аргумент templateId — для push attribution. Java сохраняет
            // его в PendingIntent, NotificationReceiver кладёт в launch Intent,
            // MainActivity.onCreate/onNewIntent → bridge → consumePushTemplateId
            // → JS на bootstrap шлёт Analytics.event('push_opened', {template_id}).
            window.LocalNotifications.schedule(numId | 0, tmpl.title, tmpl.body, at.getTime(), tmpl.id);
          } catch (e) {
            console.warn('[push] schedule failed', tmpl.id, e);
            continue;
          }
        }
        state.shownAt[tmpl.id] = at.getTime();
        scheduled++;
        perDay++;
        scheduledLog.push({
          id: tmpl.id, slot: slot,
          at: at.toLocaleString(),
          title: tmpl.title
        });
      }
    }

    state.lastScheduled = Date.now();
    writeState(state);

    console.log('[push] scheduled ' + scheduled + ' notifications:', scheduledLog);
  }

  function hashId(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
    }
    return h;
  }

  return {
    configure: configure,
    refresh: refresh,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    requestPermission: requestPermission,
    getPermissionState: getPermissionState,
    // dev-helpers
    _readState: readState,
    _hashId: hashId
  };
})();
