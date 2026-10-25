/**
 * pushScheduler.js — менеджер локальных пуш-уведомлений для casual-игр.
 *
 * Архитектура (см. ~/.claude/skills/connect-local-notifications/SKILL.md):
 *   native    — html2apk с -LocalNotifications экспонирует window.LocalNotifications.
 *               Через AlarmManager + BroadcastReceiver + NotificationManager.
 *   без моста — browser dev: модуль молчит.
 *
 * Контракт Java -> JS:
 *   window.__localNotificationsCallback(kind, data)
 *     kind='permission', data='granted'|'denied'
 *     kind='error',      data=<message>
 *
 * Публичное API:
 *   PushScheduler.configure({appName, templates, maxPerDay, storageKey})
 *   PushScheduler.requestPermission() → Promise<'granted'|'denied'>
 *   PushScheduler.refresh()           — очередь заново: снять всё, разложить от «сейчас»
 *   PushScheduler.setEnabled(v)       — toggle через Settings
 *   PushScheduler.isEnabled()         → bool
 *   PushScheduler.getPermissionState() → 'granted'|'denied'|'not_requested'
 *
 * Шаблон уведомления:
 *   {
 *     id: 'morning-challenge',  // уникальный
 *     slot: 'morning'|'evening',
 *     weekdays: 'any'|'weekend'|'weekday'|[0..6],   // 0=вс, 1=пн...
 *     title: '...',
 *     body: '...',
 *     cooldownDays: 3,         // не повторять id чаще
 *     tail: true,              // неизменная фраза последнего в очереди (один шаблон)
 *     requires: null | (state) => bool,  // дополнительный фильтр
 *     weight: 1                // вес для random-выбора
 *   }
 *
 * РАСПИСАНИЕ. Точка отсчёта — «сейчас», то есть возможный уход из игры:
 *   - в день ухода больше ничего;
 *   - следующие три дня — по два: утро 09:00 + 0..90 мин, вечер 19:30 + 0..90 мин;
 *   - дальше — по одному вечером до конца горизонта (7 дней);
 *   - у последнего неизменная фраза (`tail`): его мост повторяет каждые сутки
 *     сам, поэтому по одному в день идёт и дальше — пока человек не зайдёт.
 *
 * РЕЖИМ МОСТА `setManaged` ОБЯЗАТЕЛЕН. Без него мост html2apk продлевает на
 * сутки КАЖДОЕ сработавшее напоминание, и план на дни вперёд размножается: на
 * N-й день без захода по N копий в слот, через неделю — 28 в день. А его
 * страховочная задача раз в сутки досыпает «Не забудь про игру» в пустую
 * очередь, то есть и выключившему напоминания. В режиме мост продлевает только
 * последнее в очереди и пустую очередь не трогает.
 */
window.PushScheduler = (function () {
  const SLOT_WINDOWS = {
    morning: { hour: 9,  minute: 0,  spreadMinutes: 90 },
    evening: { hour: 19, minute: 30, spreadMinutes: 90 }
  };
  // rank 1 — самый нужный: потолок в день (maxPerDay) оставляет слоты с рангом
  // не выше него. Вечер первым — в игру садятся, когда дела сделаны.
  const PLAN_SLOTS = [
    { slot: 'morning', rank: 2 },
    { slot: 'evening', rank: 1 }
  ];
  const HORIZON_DAYS = 7;       // дней после дня ухода в очереди; дальше мост повторяет последнее
  const TWICE_DAILY_DAYS = 3;   // столько дней после дня ухода — по два
  // Сутки расписания начинаются в 4:00: ушедший в час ночи ушёл «вчера», и
  // наступающее утро для него уже первый день, а не день ухода.
  const DAY_START_HOUR = 4;
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

  // ---------- Schedule ----------

  /** Полночь суток расписания, в которые попадает момент t (граница — 4:00). */
  function scheduleDay(t) {
    const d = new Date(t - DAY_START_HOUR * 3600 * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // День прибавляется номером в календаре, а не миллисекундами: переход на
  // летнее время сдвинул бы весь список на час.
  function slotDate(slot, day0, dayOffset) {
    const w = SLOT_WINDOWS[slot];
    const offsetMin = Math.floor(Math.random() * (w.spreadMinutes + 1));
    return new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + dayOffset,
                    w.hour, w.minute + offsetMin, 0, 0);
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

  /**
   * Расписание от момента now: [{ id, at, tmpl }] по времени. Каждый слот — не
   * чаще раза в сутки; у последнего — неизменная фраза (шаблон `tail: true`).
   */
  function planPushes(now, cap, state, gameState) {
    const out = [];
    if (!(cap > 0)) return out;
    const day0 = scheduleDay(now);
    for (let d = 1; d <= HORIZON_DAYS; d++) {
      const perDay = Math.min(cap, d <= TWICE_DAILY_DAYS ? 2 : 1);
      PLAN_SLOTS.forEach(function (s) {
        if (s.rank > perDay) return;
        const at = slotDate(s.slot, day0, d);
        if (at.getTime() <= now + 60_000) return;
        const tmpl = pickTemplateForSlot(s.slot, at, state, gameState);
        if (!tmpl) return;
        state.shownAt[tmpl.id] = at.getTime();
        // id уникален в пределах горизонта: номер местных суток и ранг слота
        const dayNo = Math.floor((at.getTime() - at.getTimezoneOffset() * 60_000) / 86_400_000);
        out.push({ id: (dayNo % 100000) * 10 + s.rank, at: at, tmpl: tmpl });
      });
    }
    out.sort(function (a, b) { return a.at - b.at; });
    const tail = templates.find(function (t) { return t.tail; });
    if (tail && out.length) out[out.length - 1].tmpl = tail;
    return out;
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
    refresh();
  }

  /**
   * Очередь заново: снять ВСЁ и разложить от «сейчас». Зовётся на запуске, на
   * входе из фона, после уровня и с тумблера — в любом состоянии: выключенному
   * и без разрешения она только снимает очередь. В ней может лежать то, что
   * мост дописал сам, в том числе у прежних версий игры.
   *
   * @param {object} [gameState] — опциональные данные для template.requires
   */
  function refresh(gameState) {
    if (!hasBridge()) return;
    const bridge = window.LocalNotifications;
    try {
      if (typeof bridge.setManaged === 'function') bridge.setManaged(true);
      bridge.cancelAll();
    } catch (e) {
      console.warn('[push] очередь не снялась', e);
      return;
    }
    if (!isEnabled()) {
      console.log('[push] refresh: disabled');
      return;
    }
    if (getPermissionState() !== 'granted') {
      console.log('[push] refresh: permission=' + getPermissionState());
      return;
    }
    if (!templates.length) {
      console.warn('[push] no templates');
      return;
    }

    const state = readState();
    const scheduledLog = [];
    planPushes(Date.now(), maxPerDay, state, gameState).forEach(function (p) {
      try {
        // 5-й аргумент templateId — для push attribution. Java сохраняет
        // его в PendingIntent, NotificationReceiver кладёт в launch Intent,
        // MainActivity.onCreate/onNewIntent → bridge → consumePushTemplateId
        // → JS на bootstrap шлёт Analytics.event('push_opened', {template_id}).
        bridge.schedule(p.id, p.tmpl.title, p.tmpl.body, p.at.getTime(), p.tmpl.id);
      } catch (e) {
        console.warn('[push] schedule failed', p.tmpl.id, e);
        return;
      }
      scheduledLog.push({ id: p.tmpl.id, at: p.at.toLocaleString(), title: p.tmpl.title });
    });

    state.lastScheduled = Date.now();
    writeState(state);

    console.log('[push] scheduled ' + scheduledLog.length + ' notifications:', scheduledLog);
  }

  return {
    configure: configure,
    refresh: refresh,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
    requestPermission: requestPermission,
    getPermissionState: getPermissionState,
    // dev-helpers
    _readState: readState
  };
})();
