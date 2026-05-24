# Сейв и миграции (Судоку Классик)

## Структура (schema v2)

LocalStorage-ключ: `sudoku_save`. Единый JSON:

```jsonc
{
  "schemaVersion": 2,

  // Прогресс (для отображения на главной)
  "completedLevels": 0,
  "completedByDifficulty": { "easy": 0, "medium": 0, "hard": 0 },

  // Активный уровень (null если игрок в меню, объект если играется уровень)
  "active": null,
  // ↑ или:
  // {
  //   "difficulty": "easy" | "medium" | "hard",
  //   "mode": "classic",
  //   "puzzle":    [81 numbers, 0=пусто],
  //   "solution":  [81 numbers],
  //   "givens":    [81 booleans],
  //   "board":     [81 numbers, текущее заполнение игрока],
  //   "notes":     [81 numbers, маска заметок карандашом],
  //   "mistakes":  [81 booleans, красные ячейки],
  //   "hintCells": [81 booleans, ячейки заполненные подсказкой],
  //   "hearts":    3,
  //   "hintsUsed": 0,           // per-level статистика для модалки win (НЕ перенос)
  //   "elapsedMs": 0,
  //   "score":     <число — score из rateDifficulty>
  // }

  // Глобальный счётчик подсказок (ПЕРЕНОСИТСЯ между уровнями).
  // Стартовый запас GAME_CONFIG.BALANCE.hintsPerLevel (5).
  // Уменьшается при handleHint(), увеличивается при applyHintReward()
  // после rewarded ad. См. migration 2.
  "hints": 5,

  // Настройки
  "settings": {
    "sound": true,
    "vibration": true,
    "highlighter": true,
    "autoNotesClean": true
  },

  // Служебное
  "mockAds": false,
  "rateGiven": false
}
```

## Changelog миграций

| schemaVersion | Что изменилось |
|---------------|----------------|
| 1 | Начальная схема (single-key, нет legacy multi-key). |
| 2 | Добавлено поле `hints` (глобальный счётчик подсказок, переносится между уровнями). Раньше подсказки сбрасывались до 5 на каждом новом уровне. Migration[2] устанавливает `hints: 5` для юзеров, у которых был сейв v1 без этого поля. |

**Заметки:**
- `puzzle`, `solution`, `givens`, `board`, `notes`, `mistakes`, `hintCells` — плоские массивы длины 81. `idx = row * 9 + col`.
- `notes[i]` — 9-битная маска: бит k = карандашная заметка цифры (k+1) в ячейке i.
- `score` — абсолютная сложность (см. `sudokuGenerator.js` → `rateDifficulty`).

## Контракт

- [migrations.js](../migrations.js) — реестр миграций. Каждая миграция — чистая функция `(state) => state`.
- [storage.js](../storage.js) при `load()`:
  1. Читает single-key `sudoku_save`.
  2. Прогоняет через `Migrations.runMigrations()` (каскад от `schemaVersion` до текущего).
  3. Мерджит с `DEFAULTS()` чтобы новые поля (например `settings.highlighter`) появлялись у старых юзеров.

API `window.Storage.*`:

| Метод | Что делает |
|---|---|
| `load()` | Lazy-load с миграциями. Возвращает state. |
| `getCompletedLevels()` / `getCompletedByDifficulty(?d)` | Прогресс. |
| `incrementCompleted(difficulty)` | После победы — увеличить счётчики. |
| `getActive()` / `setActive(state)` / `clearActive()` / `updateActive(patch)` | Активный уровень. |
| `getHints()` / `setHints(n)` / `addHints(delta)` | Глобальный счётчик подсказок (переносится между уровнями). Clamped в `[0, ∞)`. |
| `getSettings()` / `setSettings(patch)` | Настройки. |
| `getMockAds()` / `setMockAds(v)` | Dev-only override бэкенда рекламы. |
| `getRateGiven()` / `setRateGiven(v)` | Чтобы не теребить юзера повторно RuStore-обзором. |
| `resetProgress()` | Сбросить ТОЛЬКО счётчики пройденных. Dev-only. |
| `resetAll()` | Полный factory reset. Dev-only. |

## Политика сохранения прогресса

Прогресс игрока (`completedLevels` и `completedByDifficulty`) сохраняется на устройстве и **никогда не теряется** в обычном геймплее:

- Выход из активного уровня (← В меню, ⏸ → В главное меню, «Новый уровень» в game-over) — НЕ трогает прогресс, чистит только `active`.
- Поражение (закончились сердца) — прогресс не теряется. Победа над уровнем — увеличивает счётчики через `incrementCompleted(difficulty)`.
- Закрытие приложения / перезагрузка устройства — прогресс остаётся (localStorage сохраняется до удаления приложения).

**Единственные способы обнулить прогресс:**
1. Через **dev-panel** (`?dev=1`):
   - Кнопка «📉 Сбросить прогресс» — `Storage.resetProgress()`, чистит **только** счётчики.
   - Кнопка «🗑 Полный сброс (factory)» — `Storage.resetAll()`, чистит всё включая настройки и активный уровень.
2. Через системные настройки Android: **Настройки → Приложения → Судоку Классик → Очистить данные** (или переустановка приложения).

В release-сборке dev-panel вырезается html2apk-маркерами, и у конечного пользователя остаётся только системный способ через Android.

## Как добавить новую миграцию

1. В коде поменялся формат сейва. Текущая `getCurrentSchemaVersion()` возвращает, например, 1.
2. В [migrations.js](../migrations.js) добавь функцию `2: function(state) { /* v1 → v2 */ return state; }`.
3. Обнови `DEFAULTS()` в [storage.js](../storage.js) — добавь новые поля.
4. После публикации в РуСтор обнови `.claude/release-state.json` (`lastPublishedSchemaVersion: 2`).

**Пример сценариев:**

- **Добавляем новое поле в `settings`** (например `settings.theme = 'light'`):
  - Добавь в `DEFAULTS()`. Миграция **не нужна** — мердж с дефолтами в `load()` сам подставит у старых юзеров.

- **Меняем формат `active.notes` с `Set` на `bitmask`** (хотя у нас bitmask и сейчас):
  - Добавь миграцию N+1, которая прокатает старый формат в новый.

- **Переименовываем поле**:
  - Миграция читает старое поле, пишет в новое, удаляет старое.

## ⚠️ Правила

- **Не меняй уже опубликованную миграцию** — у живых юзеров она уже отработала.
- **Defensive**: используй `state.foo ?? defaultValue` для отсутствующих полей.
- **Не зашивай `SCHEMA_VERSION` константу** — `getCurrentSchemaVersion()` авто-выводится из `max(keys(migrations))`.

## Проверка перед релизом

Skill `prepare-release-candidate` перед сборкой запускает **полный self-test**: пустой сейв прогоняется через **все** миграции в реестре, проверяется корректность результата. Если что-то падает — сборка релиза не запускается.

## Опубликованный релиз

`.claude/release-state.json` обновляется **автоматически** skill'ом `prepare-release-candidate` после того, как пользователь подтвердил, что отправляет собранный APK в стор. Если не подтвердил — файл не трогается.
