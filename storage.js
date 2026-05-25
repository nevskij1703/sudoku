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
      hints: window.GAME_CONFIG.BALANCE.hintsPerLevel,

      // Настройки
      settings: {
        sound: window.GAME_CONFIG.enableSound,
        vibration: window.GAME_CONFIG.enableVibration,
        highlighter: true,
        autoNotesClean: true
      },

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
      // completedByDifficulty и activeByMode мерджим вглубь.
      const defaults = DEFAULTS();
      cached = Object.assign({}, defaults, state, {
        schemaVersion: target,
        settings: Object.assign({}, defaults.settings, state.settings || {}),
        completedByDifficulty: Object.assign({}, defaults.completedByDifficulty, state.completedByDifficulty || {}),
        activeByMode: Object.assign({}, defaults.activeByMode, state.activeByMode || {})
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

  // === Активные уровни (per mode) ===
  //
  // Каждый режим имеет свой слот сейва — `activeByMode[mode]`. Это позволяет
  // игроку играть в Классику, выйти в меню, начать Сугуру, вернуться в меню,
  // а потом продолжить Классику с того же места. См. также Game.startNewLevel
  // и main.js → btn-start-level (показывает модалку Продолжить/Начать заново
  // если для выбранного режима есть сохранение).

  function getActiveByMode(mode) {
    const s = load();
    return (s.activeByMode && s.activeByMode[mode]) || null;
  }

  function setActiveByMode(mode, activeState) {
    const s = load();
    if (!s.activeByMode) s.activeByMode = {};
    s.activeByMode[mode] = activeState;
    persist();
  }

  function clearActiveByMode(mode) {
    const s = load();
    if (s.activeByMode && s.activeByMode[mode]) {
      delete s.activeByMode[mode];
      persist();
    }
  }

  function getAllActiveModes() {
    const s = load();
    if (!s.activeByMode) return [];
    return Object.keys(s.activeByMode);
  }

  // Legacy-aliases. До v3 сейв был single-slot; некоторые места (например
  // dev-panel) могут ещё дёргать getActive/setActive/clearActive. Мапим их
  // на «первый попавшийся» mode чтобы сохранить базовое поведение, но новый
  // код должен использовать ByMode-API.

  function getActive() {
    const s = load();
    const modes = Object.keys(s.activeByMode || {});
    return modes.length ? s.activeByMode[modes[0]] : null;
  }

  function setActive(activeState) {
    if (!activeState || !activeState.mode) return;
    setActiveByMode(activeState.mode, activeState);
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

  // === Mock ads / rate / служебное ===

  function getMockAds()  { return !!load().mockAds; }
  function setMockAds(v) { const s = load(); s.mockAds = !!v; persist(); }

  function getRateGiven()  { return !!load().rateGiven; }
  function setRateGiven(v) { const s = load(); s.rateGiven = !!v; persist(); }

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
    // Настройки
    getSettings: getSettings,
    setSettings: setSettings,
    // Служебное
    getMockAds: getMockAds,    setMockAds: setMockAds,
    getRateGiven: getRateGiven, setRateGiven: setRateGiven,
    resetProgress: resetProgress,
    resetAll: resetAll
  };
})();
