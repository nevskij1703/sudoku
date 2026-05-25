/**
 * migrations.js — реестр миграций сейва. См. docs/SAVES.md.
 *
 * Контракт:
 *   migrations[N]: state v(N-1) → state vN  (чистая функция)
 *   getCurrentSchemaVersion() — авто-вывод из max(keys)
 *   runMigrations(state, fromVersion) — каскад
 *
 * ⚠️ После публикации в РуСтор НЕ меняй существующие миграции — у живых
 * пользователей сейвы уже мигрированы. Только добавляй новые: migrations[N+1].
 */
window.Migrations = (function () {
  const migrations = {
    1: function (state) {
      // v0 → v1: стартовая схема. Новый проект, легаси multi-key нет.
      // Просто гарантируем, что обязательные поля присутствуют — defaults
      // мерджит storage.js, так что здесь оставляем state как есть.
      return state;
    },
    2: function (state) {
      // v1 → v2: добавлен глобальный счётчик подсказок `hints`.
      // Раньше подсказки сбрасывались до CFG.BALANCE.hintsPerLevel (5)
      // на каждый новый уровень — то есть жили только внутри active.
      // Теперь они переносятся между уровнями (`Storage.hints`), а
      // active.hintsUsed остаётся per-level статистикой для модалки win.
      //
      // Если у юзера уже был сейв v1 без поля `hints` — даём ему
      // стартовый запас (BALANCE.hintsPerLevel). Для новых юзеров
      // дефолт берётся из DEFAULTS() storage.js.
      if (typeof state.hints !== 'number') {
        state.hints = (window.GAME_CONFIG && window.GAME_CONFIG.BALANCE
                        && typeof window.GAME_CONFIG.BALANCE.hintsPerLevel === 'number')
                      ? window.GAME_CONFIG.BALANCE.hintsPerLevel
                      : 5;
      }
      return state;
    },
    3: function (state) {
      // v2 → v3: сейв теперь разделён на отдельные слоты для каждого режима
      // (`activeByMode: { classic: state, sugur: state, ... }`). Это позволяет
      // игроку выйти в меню и вернуться в тот же режим, продолжив начатый
      // уровень. Старое поле `active` (single-slot) переезжает в свой слот
      // по active.mode (или 'classic' если mode не указан).
      if (!state.activeByMode || typeof state.activeByMode !== 'object') {
        state.activeByMode = {};
      }
      if (state.active && typeof state.active === 'object') {
        const m = state.active.mode || 'classic';
        // Если уже был слот этого режима — не затираем (не должно случиться
        // у v2-юзеров, но защищаемся defensive).
        if (!state.activeByMode[m]) state.activeByMode[m] = state.active;
      }
      delete state.active;
      return state;
    },
    4: function (state) {
      // v3 → v4: ключ слота расширен с `mode` до `mode:difficulty`. Теперь
      // юзер может одновременно держать сейв «Классика-Простой» и
      // «Классика-Средний». Старые ключи переименовываются по difficulty
      // из самого сейва (или 'medium' если поле не задано).
      if (!state.activeByMode || typeof state.activeByMode !== 'object') {
        state.activeByMode = {};
        return state;
      }
      const newMap = {};
      const oldKeys = Object.keys(state.activeByMode);
      for (let i = 0; i < oldKeys.length; i++) {
        const k = oldKeys[i];
        const slot = state.activeByMode[k];
        if (!slot) continue;
        // Если ключ уже в новом формате (содержит ':') — оставляем как есть.
        if (k.indexOf(':') !== -1) { newMap[k] = slot; continue; }
        const diff = slot.difficulty || 'medium';
        newMap[k + ':' + diff] = slot;
      }
      state.activeByMode = newMap;
      return state;
    },
    5: function (state) {
      // v4 → v5: добавлено поле templateIndices = { sugur, chain } —
      // курсор по pre-baked pool болванок для Sugur/Chain. Игроки v4
      // получают стартовые нули, и при первом старте уровня будут брать
      // template #0.
      if (!state.templateIndices || typeof state.templateIndices !== 'object') {
        state.templateIndices = { sugur: 0, chain: 0 };
      }
      if (typeof state.templateIndices.sugur !== 'number') state.templateIndices.sugur = 0;
      if (typeof state.templateIndices.chain !== 'number') state.templateIndices.chain = 0;
      return state;
    },
    6: function (state) {
      // v5 → v6: добавлен settings.theme (null|'light'|'dark') — выбор темы.
      // null = «следовать системе» (prefers-color-scheme), для существующих
      // пользователей оставляем null чтобы они не получили неожиданно
      // другую тему при апдейте.
      if (!state.settings) state.settings = {};
      if (state.settings.theme !== 'light' && state.settings.theme !== 'dark') {
        state.settings.theme = null;
      }
      return state;
    }
    // 7: function (state) { ... }  ← добавляй сюда при следующих изменениях схемы
  };

  function getCurrentSchemaVersion() {
    const keys = Object.keys(migrations).map(Number);
    return keys.length ? Math.max.apply(null, keys) : 1;
  }

  function runMigrations(state, fromVersion) {
    const current = getCurrentSchemaVersion();
    let v = (typeof fromVersion === 'number') ? fromVersion : 0;
    while (v < current) {
      const fn = migrations[v + 1];
      if (typeof fn !== 'function') {
        throw new Error('[migrations] Missing migration ' + (v + 1) + ' (target schemaVersion=' + current + ')');
      }
      state = fn(state);
      v++;
    }
    return { state: state, schemaVersion: current };
  }

  return {
    migrations: migrations,
    getCurrentSchemaVersion: getCurrentSchemaVersion,
    runMigrations: runMigrations
  };
})();
