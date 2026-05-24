# Судоку Классик — заметки для Claude

## Preview port

**8776** (фиксированный, не менять — занят в общей мастерской `~/.claude/launch.json`).

```powershell
python -m http.server 8776
# открыть http://localhost:8776/
# dev-режим: http://localhost:8776/?dev=1
```

## Архитектура

Classic IIFE pattern (без модулей / сборщика). Каждый файл монтирует свой namespace на `window.X`. Порядок загрузки фиксирован в [index.html](index.html) — менять с осторожностью (зависимости снизу вверх):

```
config → migrations → storage → sudokuCore → sudokuTechniques → sudokuGenerator
       → ads → rustoreReview → audio
       → ui → board → numberPad → game → devPanel → main
```

## Сейв и миграции

См. [docs/SAVES.md](docs/SAVES.md).

**Главное:**
- Single-key `sudoku_save` в localStorage.
- `getCurrentSchemaVersion()` авто-выводится из `max(keys(migrations))`.
- **Никогда не меняй уже опубликованные миграции** — у живых юзеров они уже отработали.
- Skill `prepare-release-candidate` сам проверит реестр перед сборкой.

**Политика прогресса:** Прогресс (`completedLevels`, `completedByDifficulty`) **никогда не сбрасывается** автоматически. Сбросить можно только через dev-panel (`?dev=1`) или системную «Очистить данные» Android. См. `Storage.resetProgress()` / `Storage.resetAll()` и [docs/SAVES.md](docs/SAVES.md). Не добавляй других путей сброса в gameplay-код.

## Реклама

Yandex Mobile Ads (только в APK через `-YandexAdsBridge`). В браузере — mock-оверлей.

**Точки вызова:**
- Interstitial: `main.js` → `proceedToNextLevel(diff, mode)` (общая функция для `#btn-start-level`, `#btn-win-next` после rate-modal, `#btn-rate-later`).
- Rewarded #1: `main.js` → `#btn-gameover-ad` (+1 сердце по запросу пользователя).
- Rewarded #2: `main.js` → `requestHintRefill()` через `onHint` callback NumberPad при `Storage.getHints() === 0` (+1 подсказка после просмотра).

**Unit-IDs** в [config.js](config.js) → `GAME_CONFIG.ADS.{interstitial,rewarded}.unitId`:
- Interstitial: `R-M-19325500-1`
- Rewarded: `R-M-19325500-2`

Источник: [Yandex Partner Mobile Ads](https://partner.yandex.ru/mobile-ads).

См. [docs/ADS.md](docs/ADS.md) для деталей.

## RuStore in-app review (с rate-modal между уровнями)

Подключается через html2apk `-RuStoreReviewSdk`. JS-обёртка: [rustoreReview.js](rustoreReview.js).

**Два места показа:**

1. **Модалка `#modal-rate` («Нравится игра?») между уровнями.** Показывается:
   - один раз когда `completedLevels >= 3` (триггер «после 3-го пройденного уровня»),
   - **И** `Storage.getRateGiven() === false` (юзер ещё не оценивал),
   - **И** `rateModalShownThisSession === false` (in-memory флаг, сбрасывается при перезапуске app).

   Кнопка «Оценить» → `Storage.setRateGiven(true)` + `RuStoreReviewClient.launch()` + сразу следующий уровень **БЕЗ** interstitial. Кнопка «Может позже» → `proceedToNextLevel()` (cadence-логика interstitial). Sessional флаг взводится в обоих случаях.

2. **Кнопка «Оценить приложение» в модалке Settings.** Доступна всегда. Вызывает `RuStoreReviewClient.launch()` напрямую, после успешного показа (`result='shown'`) пишет `Storage.setRateGiven(true)`.

**Fallback policy** (внутри `rustoreReview.js`):
- Bridge нет (browser dev / APK без `-RuStoreReviewSdk`) → `window.open(deep-link)` сразу.
- SDK вернул `'unavailable'` → fallback на deep-link.
- SDK вернул `'failed'` (`RuStoreReviewExists` / `Limit` / `Unauthorized` / `InvalidReviewInfo`) → silent.

## Подсказки и rewarded-ad refill

Глобальный счётчик `Storage.hints` — переносится между уровнями (в отличие от сердечек). Стартовый запас `GAME_CONFIG.BALANCE.hintsPerLevel` (5).

- `Game.handleHint()` уменьшает `Storage.hints` на 1 (и инкрементит `active.hintsUsed` для статистики модалки win).
- `Game.startNewLevel()` сбрасывает `active.hintsUsed = 0`, но **не трогает** `Storage.hints`.
- При `Storage.getHints() === 0` — кнопка «Подсказка» в `numberPad.js` показывает бэйдж **«+1 ▶»** (золотисто-оранжевый, пульсирующий). Клик в этом состоянии перенаправляется из `onHint` в `requestHintRefill()` → `AdManager.showRewardedAd({kind:'hint'})` → если `watched`, `Game.applyHintReward()` (+1 в Storage.hints).

См. также migration 2 в [migrations.js](migrations.js) и [docs/SAVES.md](docs/SAVES.md).

## Dev panel

Файл [devPanel.js](devPanel.js) **целиком** обёрнут в `HTML2APK:DEV_ONLY_BEGIN/END` маркеры. При release-сборке html2apk удаляет содержимое.

Активация: `?dev=1` в URL. Если открыть release-APK с `?dev=1` — `main.js` проверяет `window.__BUILD_RELEASE__` и не мониторует панель.

## Генератор уровней

См. [docs/SUDOKU_GENERATOR.md](docs/SUDOKU_GENERATOR.md).

**API:**
```js
SudokuGenerator.generate(targetDifficulty='medium', opts?) → {puzzle, solution, givens, difficulty, score, techniques, ...}
SudokuGenerator.rateDifficulty(puzzle) → {score, label, techniques, solvable}
SudokuCore.countSolutions(grid, max=2) → integer
```

**Цели:**
- ≤ 1.5 секунды генерация на mid-range Android.
- Каждый puzzle — уникальное решение (`countSolutions=1`).
- Лейбл совпадает с запрошенной сложностью (с fallback на ближайшую при таймауте).

**Подкрутка** порогов лейблов — в [config.js](config.js) → `GAME_CONFIG.GENERATOR.labelThresholds`. Для калибровки запускай dev-panel «Стат. по 50 уровням».

## Игровая логика

- **Hearts**: 3 на уровень, при ошибке -1, при 0 — модалка game-over. Сердца НЕ переносятся между уровнями (восстанавливаются на 3 при каждом `startNewLevel`).
- **Hints**: глобальный счётчик в `Storage.hints` — **ПЕРЕНОСИТСЯ между уровнями**. Стартовый запас 5 (из `BALANCE.hintsPerLevel`), не выдаётся повторно на новом уровне. При использовании ставится правильная цифра, ячейка помечается `hintCells[i] = true`. При исчерпании — бэйдж «+1 ▶» предлагает rewarded-ad refill. См. раздел «Подсказки и rewarded-ad refill» выше.
- **Mistakes**: при неверной цифре — красная подсветка ячейки, цифра остаётся (юзер сам стирает). При следующей попытке поставить туда же другую цифру — повторно проверяется.
- **Notes (карандаш)**: 9-битная маска в `notes[i]`. Не показываются если в ячейке стоит цифра в `board[i]`.
- **Auto-clean notes**: при установке правильной цифры — соответствующая заметка убирается из всех ячеек-пиров. Управляется `settings.autoNotesClean`.
- **Undo stack**: до 50 шагов in-memory (не персистится).
- **Resume**: при выходе с экрана игры через ← или ⏸ → главное меню — `active` остаётся в Storage. На главной появляется кнопка «Продолжить».
- **Win**: после правильного заполнения последней ячейки → `incrementCompleted(difficulty)`, `clearActive()`, модалка win.

## Расширение под новые режимы (Diagonal, Killer)

Архитектурно подготовлено: все техники и солвер принимают `variant` параметром. Чтобы добавить, например, Diagonal:

1. В `sudokuCore.js` добавь `DiagonalVariant` (overrides `unitsForCell`, `allUnits`, `isLegal`).
2. В `sudokuGenerator.js` для генерации полной сетки используй backtracking-fill вместо seed-transform (seed не сохраняет валидность диагоналей).
3. В `screen-difficulty` сними `.locked` с соответствующей плитки и добавь логику в `main.js` для передачи `mode` в `Game.startNewLevel`.

## Скилы

- `prepare-release-candidate` — сборка release APK с проверкой миграций.
- `build-apk-from-html` — обычная debug-сборка.
- `connect-yandex-mobile-ads` — уже подключено через html2apk флаг `-YandexAdsBridge`.
- `connect-rustore-review` — уже подключено через html2apk флаг `-RuStoreReviewSdk`.
