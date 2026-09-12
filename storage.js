/**
 * storage.js — single-key обёртка над localStorage с системой миграций.
 * См. docs/SAVES.md (контракт) и migrations.js (реестр).
 *
 * Всё хранится в одном ключе `sudoku_save`. Структура — см. DEFAULTS().
 *
 * Активный уровень (`active`) — null если игрок в меню, объект с прогрессом
 * текущего уровня если игра запущена. При закрытии app это позволяет
 * восстановить состояние на следующем открытии (кнопка «Продолжить»).
 */
window.Storage = (function () {
  const STORAGE_KEY = 'sudoku_save';

  function DEFAULTS() {
    return {
      schemaVersion: window.Migrations.getCurrentSchemaVersion(),

      // Прогресс
      completedLevels: 0,
      completedByDifficulty: { easy: 0, medium: 0, hard: 0 },

      // Сейвы активных уровней по режимам: { classic: state, sugur: state, ... }.
      // Каждый режим хранит свой in-progress уровень — игрок может выйти в
      // меню и продолжить с того же места. См. docs/SAVES.md.
      activeByMode: {},

      // Глобальный счётчик подсказок. Переносится между уровнями И между
      // режимами — потратил в Классике, останется меньше для Сугуру.
      // Уменьшается при использовании подсказки, увеличивается на +1
      // после просмотра rewarded ad. См. migrations[2].
      // Значение СБОРКИ. Ключ `hints_start` правит его не здесь, а один раз
      // после ответа сети — см. `applyStartGrant` ниже.
      hints: window.GAME_CONFIG.BALANCE.hintsPerLevel,

      // Поправка стартового запаса подсказок из конфига ещё не применялась.
      // `false` бывает только у свежего сейва: migrations[10] ставит уже
      // играющим `true`, чтобы у них ничего не отняли и не добавили.
      startAdjusted: false,

      // Счётчик «следующий шаблон» для sugur/chain. Game.startNewLevel
      // берёт шаблон по этому индексу из PrecomputedPools[mode], затем
      // инкрементит и заворачивает по pool.length. Это даёт цикличное
      // прохождение всех 25 болванок (на каждой будет разный relabel +
      // carve, так что игрок не замечает повтор формы). См. migration v5.
      templateIndices: { sugur: 0, chain: 0 },

      // Последний сыгранный режим/сложность. Записывается при каждом
      // Game.startNewLevel и Game.resumeMode. При запуске app, если нет
      // активного сейва и нет других условий — стартуем новый уровень
      // с этими параметрами (чтобы игрок продолжил в том режиме, где
      // последний раз играл). null означает «никогда не играл».
      lastPlayedMode: null,
      lastPlayedDifficulty: null,

      // Настройки
      settings: {
        sound: window.GAME_CONFIG.enableSound,
        vibration: window.GAME_CONFIG.enableVibration,
        highlighter: true,
        autoNotesClean: true,
        // Тема: null = «следовать системе» (prefers-color-scheme),
        // 'light' / 'dark' — явный выбор юзера через toggle в Settings.
        theme: null
      },

      // Push-уведомления (Local Notifications).
      // pushEnabled — toggle в Settings. Default true; без permission всё равно
      //               ничего не показывается, так что безопасно.
      // pushPermissionAsked — спрашивали ли уже Android permission. Чтобы
      //                       не доставать юзера повторно при каждом win.
      // См. migration[8] и pushScheduler.js.
      pushEnabled: true,
      pushPermissionAsked: false,

      // Аналитика AppMetrica. См. migration[9] и analytics.js.
      // Стабильный UUID per-install. Миграция 9 генерирует при загрузке;
      // для fresh install (без миграций) getUserId() генерирует лениво.
      userId: null,

      // Dev / служебное
      mockAds: window.GAME_CONFIG.mockAds,
      rateGiven: false
    };
  }

  let cached = null;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch (e) {
      console.warn('[storage] save failed', e);
    }
  }

  function load() {
    if (cached) return cached;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let parsed = null;
      let fromVersion = 0;

      if (raw) {
        parsed = JSON.parse(raw);
        fromVersion = (typeof parsed.schemaVersion === 'number') ? parsed.schemaVersion : 0;
      }

      if (parsed === null) {
        cached = DEFAULTS();
        persist();
        return cached;
      }

      const target = window.Migrations.getCurrentSchemaVersion();

      if (fromVersion > target) {
        // Сейв из «будущей» версии приложения (юзер откатился). Делаем backup
        // и стартуем с дефолтов, чтобы не сломать данные.
        console.warn('[storage] save schemaVersion=' + fromVersion + ' > code=' + target + ', resetting');
        try { localStorage.setItem(STORAGE_KEY + '_backup_future_v' + fromVersion, raw); } catch (e) {}
        cached = DEFAULTS();
        persist();
        return cached;
      }

      let state = parsed;
      if (fromVersion < target) {
        const result = window.Migrations.runMigrations(parsed, fromVersion);
        state = result.state;
        state.schemaVersion = result.schemaVersion;
      }

      // Мердж с дефолтами на случай, если новые поля добавились без миграции
      // (например, settings.highlighter появилось позже). settings,
      // completedByDifficulty, activeByMode и templateIndices мерджим вглубь.
      const defaults = DEFAULTS();
      cached = Object.assign({}, defaults, state, {
        schemaVersion: target,
        settings: Object.assign({}, defaults.settings, state.settings || {}),
        completedByDifficulty: Object.assign({}, defaults.completedByDifficulty, state.completedByDifficulty || {}),
        activeByMode: Object.assign({}, defaults.activeByMode, state.activeByMode || {}),
        templateIndices: Object.assign({}, defaults.templateIndices, state.templateIndices || {})
      });
      persist();
      return cached;
    } catch (e) {
      console.warn('[storage] load failed, using defaults', e);
      cached = DEFAULTS();
      return cached;
    }
  }

  // === Прогресс ===

  function getCompletedLevels() {
    return load().completedLevels;
  }

  function getCompletedByDifficulty(difficulty) {
    const s = load();
    if (difficulty) return s.completedByDifficulty[difficulty] || 0;
    return Object.assign({}, s.completedByDifficulty);
  }

  function incrementCompleted(difficulty) {
    const s = load();
    s.completedLevels = (s.completedLevels || 0) + 1;
    if (!s.completedByDifficulty[difficulty]) s.completedByDifficulty[difficulty] = 0;
    s.completedByDifficulty[difficulty]++;
    persist();
  }

  // === Активные уровни (per mode × difficulty) ===
  //
  // Каждая пара (режим, сложность) имеет свой слот сейва. Ключ —
  // composite-string `"mode:difficulty"` в `activeByMode`. Это позволяет
  // игроку держать одновременно начатую Классику-Простой и Классику-Средний,
  // переключаясь между ними без потери прогресса. См. также migration v4.

  function makeKey(mode, difficulty) {
    return (mode || 'classic') + ':' + (difficulty || 'medium');
  }

  function getActiveByMode(mode, difficulty) {
    const s = load();
    return (s.activeByMode && s.activeByMode[makeKey(mode, difficulty)]) || null;
  }

  function setActiveByMode(mode, difficulty, activeState) {
    const s = load();
    if (!s.activeByMode) s.activeByMode = {};
    s.activeByMode[makeKey(mode, difficulty)] = activeState;
    persist();
  }

  function clearActiveByMode(mode, difficulty) {
    const s = load();
    const key = makeKey(mode, difficulty);
    if (s.activeByMode && s.activeByMode[key]) {
      delete s.activeByMode[key];
      persist();
    }
  }

  // Возвращает массив объектов `{mode, difficulty}` для всех непустых слотов.
  function getAllActiveModes() {
    const s = load();
    if (!s.activeByMode) return [];
    return Object.keys(s.activeByMode).map(function (k) {
      const parts = k.split(':');
      return { mode: parts[0] || 'classic', difficulty: parts[1] || 'medium' };
    });
  }

  // Legacy-aliases. До v3 сейв был single-slot. Некоторые места (dev-panel)
  // могут ещё дёргать getActive/setActive/clearActive — мапим их на
  // «первый попавшийся» слот чтобы сохранить базовое поведение.

  function getActive() {
    const s = load();
    const keys = Object.keys(s.activeByMode || {});
    return keys.length ? s.activeByMode[keys[0]] : null;
  }

  function setActive(activeState) {
    if (!activeState || !activeState.mode) return;
    setActiveByMode(activeState.mode, activeState.difficulty, activeState);
  }

  function clearActive() {
    const s = load();
    s.activeByMode = {};
    persist();
  }

  // === Настройки ===

  function getSettings() {
    return Object.assign({}, load().settings);
  }

  function setSettings(patch) {
    const s = load();
    s.settings = Object.assign({}, s.settings, patch);
    persist();
  }

  // === Подсказки (глобальные, переносятся между уровнями) ===

  function getHints() {
    const v = load().hints;
    return (typeof v === 'number' && v >= 0) ? v : 0;
  }

  function setHints(n) {
    const s = load();
    s.hints = Math.max(0, n | 0);
    persist();
  }

  function addHints(delta) {
    const s = load();
    s.hints = Math.max(0, ((s.hints | 0) + (delta | 0)));
    persist();
  }

  /**
   * Довести стартовый запас подсказок до того, что сказал конфиг. Один раз за
   * жизнь установки, сразу после ответа сети.
   *
   * ПОЧЕМУ НЕ `hints: tuned('hints_start', ...)` В DEFAULTS. Сейв рождается
   * раньше конфига: `Storage.load()` — первый шаг `init()`, а у загрузки
   * конфига свой таймаут в 4 секунды. Ключ, прочитанный там, вернул бы значение
   * сборки у КАЖДОГО нового игрока — то есть ровно у тех, ради кого он заведён.
   *
   * ПРИБАВЛЯЕМ РАЗНИЦУ, А НЕ ПРИСВАИВАЕМ: пока отвечает сеть, игрок уже мог
   * потратить подсказку. Присвоение вернуло бы её обратно, а при меньшем
   * значении в бакете отняло бы лишнюю. Разница верна в любой момент — конфиг
   * говорит не «столько у тебя сейчас», а «столько выдать на входе».
   *
   * Конфиг не доехал — `tuned` отдаёт значение сборки, разница нулевая, и
   * функция не делает ничего.
   */
  function applyStartGrant() {
    const s = load();
    if (s.startAdjusted) return;
    s.startAdjusted = true;
    // Уровень уже пройден — стартовый запас своё отработал, и поправка
    // означала бы правку кошелька играющего человека.
    const played = getCompletedLevels() > 0;
    if (!played) {
      const build = window.GAME_CONFIG.BALANCE.hintsPerLevel;
      const delta = window.tuned('hints_start', build) - build;
      s.hints = Math.max(0, (s.hints | 0) + delta);
    }
    persist();
  }

  // === Template index (для pool болванок Sugur/Chain) ===
  //
  // Game.startNewLevel вызывает getNextTemplateIndex(mode) — он возвращает
  // текущий index и сразу инкрементит его modulo pool size. Так все 25
  // болванок проходят по очереди, и игрок не получает один и тот же
  // template подряд. На каждой болванке делается random relabel +
  // случайный carve, поэтому визуально каждый уровень новый.

  function getNextTemplateIndex(mode, poolSize) {
    const s = load();
    if (!s.templateIndices) s.templateIndices = { sugur: 0, chain: 0 };
    const idx = (s.templateIndices[mode] | 0) % Math.max(1, poolSize | 0);
    s.templateIndices[mode] = (idx + 1) % Math.max(1, poolSize | 0);
    persist();
    return idx;
  }

  // === Mock ads / rate / служебное ===

  function getMockAds()  { return !!load().mockAds; }
  function setMockAds(v) { const s = load(); s.mockAds = !!v; persist(); }

  function getRateGiven()  { return !!load().rateGiven; }
  function setRateGiven(v) { const s = load(); s.rateGiven = !!v; persist(); }

  // === Push-уведомления ===

  function getPushEnabled() { return load().pushEnabled !== false; }  // default true
  function setPushEnabled(v) { const s = load(); s.pushEnabled = !!v; persist(); }

  function getPushPermissionAsked() { return !!load().pushPermissionAsked; }
  function setPushPermissionAsked(v) { const s = load(); s.pushPermissionAsked = !!v; persist(); }

  // === Сброс ===
  //
  // Прогресс игрока (completedLevels + completedByDifficulty) сохраняется на
  // устройстве и НЕ сбрасывается при выходе из уровня, gameover, abandon и т.п.
  // Единственные способы обнулить прогресс:
  //   • Storage.resetProgress() — только counts.
  //   • Storage.resetAll()      — полный factory reset.
  // Оба вызываются исключительно из dev-panel (см. devPanel.js).
  // На устройстве пользователя без dev-доступа единственный способ —
  // переустановка приложения (или «Очистить данные» в настройках Android).

  // === Последний сыгранный режим/сложность ===
  //
  // Используется в main.js при старте app — если активного сейва нет,
  // но игрок уже играл, стартуем новый уровень в последнем выбранном
  // режиме (без выпадения на home). null = игрок ещё ни разу не играл,
  // тогда main.js использует свой fallback (classic/medium).

  function getLastPlayed() {
    const s = load();
    return {
      mode: s.lastPlayedMode || null,
      difficulty: s.lastPlayedDifficulty || null
    };
  }

  function setLastPlayed(mode, difficulty) {
    const s = load();
    s.lastPlayedMode = mode || null;
    s.lastPlayedDifficulty = difficulty || null;
    persist();
  }

  function resetProgress() {
    const s = load();
    s.completedLevels = 0;
    s.completedByDifficulty = { easy: 0, medium: 0, hard: 0 };
    persist();
  }

  function resetAll() {
    cached = DEFAULTS();
    persist();
  }

  return {
    load: load,
    // Прогресс
    getCompletedLevels: getCompletedLevels,
    getCompletedByDifficulty: getCompletedByDifficulty,
    incrementCompleted: incrementCompleted,
    // Активные уровни (per mode)
    getActiveByMode: getActiveByMode,
    setActiveByMode: setActiveByMode,
    clearActiveByMode: clearActiveByMode,
    getAllActiveModes: getAllActiveModes,
    // Legacy single-slot API (см. секцию)
    getActive: getActive,
    setActive: setActive,
    clearActive: clearActive,
    // Подсказки
    getHints: getHints,
    setHints: setHints,
    addHints: addHints,
    applyStartGrant: applyStartGrant,
    // Template-index для pool болванок
    getNextTemplateIndex: getNextTemplateIndex,
    // Последний сыгранный режим/сложность (для auto-resume старта)
    getLastPlayed: getLastPlayed,
    setLastPlayed: setLastPlayed,
    // Настройки
    getSettings: getSettings,
    setSettings: setSettings,
    // Служебное
    getMockAds: getMockAds,    setMockAds: setMockAds,
    getRateGiven: getRateGiven, setRateGiven: setRateGiven,
    getPushEnabled: getPushEnabled, setPushEnabled: setPushEnabled,
    getPushPermissionAsked: getPushPermissionAsked, setPushPermissionAsked: setPushPermissionAsked,
    getUserId: getUserId,
    resetProgress: resetProgress,
    resetAll: resetAll
  };

  // ===== AppMetrica analytics (стабильный UUID per-install) =====
  function getUserId() {
    const s = load();
    if (!s.userId) {
      s.userId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      persist();
    }
    return s.userId;
  }
})();
