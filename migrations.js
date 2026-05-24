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
    }
    // 2: function (state) { ... }  ← добавляй сюда при следующих изменениях схемы
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
