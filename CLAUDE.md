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

⚠️ **Interstitial ВЫКЛЮЧЕН** с 2026-06-04 (`ADS.interstitial.enabled = false` в config.js) —
фрустрировал игроков по отзывам в РуСтор при малой доле в доходе. Гейт в `ads.js` →
`shouldShowInterstitial()` + `showInterstitialAd()`. Вернуть = `enabled: true`.
Rewarded работает как раньше. Подробности — [docs/ADS.md](docs/ADS.md).

**Точки вызова:**
- Interstitial (сейчас no-op): `main.js` → `proceedToNextLevel(diff, mode)` (общая функция для `#btn-start-level`, `#btn-win-next` после rate-modal, `#btn-rate-later`).
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

## Аналитика: Yandex AppMetrica

Подключено через `-YandexAppMetrica` html2apk-flag (skill `~/.claude/skills/connect-appmetrica/SKILL.md`). SDK активируется в `MainActivity.onCreate` (до WebView), JS-обёртка — [analytics.js](analytics.js) (classic IIFE → `window.Analytics`).

**API key**: `f819bc73-52cb-4fc4-90df-042f23e3d000` (в `.claude/build-config.json` → `appMetricaApiKey`).

**Карта событий + где смотреть в дашборде** — [docs/ANALYTICS.md](docs/ANALYTICS.md).

### Минимальный список событий (Sudoku)

**Общие (как у других игр):**
- `session_start`, `level_start`, `level_complete`, `level_fail`
- `ad_interstitial_shown`, `ad_rewarded_shown` (placement: `hint_refill` / `fast_mode_unlock` / `extra_heart` / `level_transition`)
- `hint_used` (source: 'free'), `settings_opened`, `rate_clicked`

**Sudoku-специфичные:**
- `difficulty_selected` `{ difficulty, mode }` — клик «Старт» с главного экрана
- `mistake_made` `{ remaining_hearts, mistakes_total, level_num, difficulty, mode }` — неправильная цифра ([game.js](game.js) ~line 642)
- `rewarded_hint_obtained` `{ level_num }` — успешный rewarded → +1 подсказка

### Правила (для будущих сессий)

- **НЕ дублируй имена событий** из общей таксономии — они должны совпадать one-to-one во всех 4 проектах мастерской.
- **НЕ меняй имена опубликованных событий** — сломаешь воронки/retention в дашборде у живых юзеров.
- **НЕ шли PII** (имя, email, точная геолокация) в event params — нарушение Privacy Policy.
- **userId** генерируется один раз через `Storage.getUserId()` (UUID v4 / pseudo-UUID fallback). Стабилен между сессиями, теряется при чистке данных Android.
- **НЕ меняй имя bridge'а** `window.AppMetrica` — оно зашито в `AppMetricaBridge.java`.
- При добавлении новых событий — обязательно обнови [docs/ANALYTICS.md](docs/ANALYTICS.md).

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
- `connect-yandex-mobile-ads` — уже подключено. Флаг `-YandexAdsBridge`
  передавать руками **не нужно и не надо**: он берётся из
  `"yandexAdsBridge": true` в `.claude/build-config.json`. Источник правды один —
  конфиг. Руками флаг терялся молча: команду копируют, забывают флаг, и сборка
  уезжает в стор без монетизации при рабочем рекламном коде. Гейт пяти
  обязательных SDK в `prepare-release-candidate` смотрит тоже в конфиг.
- `connect-rustore-review` — уже подключено через html2apk флаг `-RuStoreReviewSdk`.


## Автотесты на устройстве: тестовый мост

Проверять руками «выйдет ли межстраничная» — это несколько честных прохождений,
а «прошёл ли кулдаун» — это подождать. Поэтому у игры есть **тестовый мост**: те
же действия, что в дев-панели, но вызовом извне. Инструменты приходят через
MCP-сервер, он объявлен в [`.mcp.json`](.mcp.json) и живёт в `../admin/mcp/`.

```
game_use → game_info → game_param_set / game_time / game_do / game_events / game_screenshot
```

Что умеет именно эта игра — [`testActions.js`](testActions.js): `state`, `grant.hearts`, `grant.hints`, `level.win`, `level.new`, `progress.reset`, `progress.wipe`. Плюс общие команды моста: параметры,
сдвиг часов, хранилище, перехваченные события аналитики.

**Мост есть и в релизной сборке — намеренно.** Дев-панели там нет, а проверять
надо именно релизную сборку. Безопасно это потому, что мост исполняет только
**подписанную** команду — ключ P-256 лежит в
`admin/secrets/testbridge.local.json`, и в APK его нет. Подробности и границы
защиты — `../admin/docs/TEST_BRIDGE.md`.

**Отладка WebView зависит от типа сборки** (html2apk, флаг `-WebViewDebug`): в
debug включена, в `-Release` ВЫКЛЮЧЕНА, а с флагом остаётся включённой — это и
есть релиз-кандидат, который проверяют мостом. В стор уходит сборка без флага, к
ней посторонний с adb уже не подключится. До 10.09.2026 в шаблоне стояло жёсткое
`true`, то есть отладка была открыта и в опубликованных сборках.

## Игра подчиняется админке (`../admin`)

`RuStore-games/admin/` — **отдельный репозиторий**, общий для всех личных игр.
Отсюда берутся удалённая конфигурация, A/B-тесты и вся аналитика в одном месте.
Короткая инструкция — **[admin/docs/FOR_GAMES.md](../admin/docs/FOR_GAMES.md)**:
что админка читает у игры, что менять при изменениях и на что она НЕ смотрит.

### Что это меняет в работе здесь

**Часть чисел игры больше не только в коде.** Главный выключатель межстраничной
(`interstitial_enabled` — формат выключен с 04.06.2026, и включить его обратно
теперь можно без сборки), все четыре гейта её показа и порог просьбы об оценке
(`rateus_min_levels`) читаются в `ads.js` и `main.js`. Значение приезжает из
файла в облаке и меняется **без выпуска обновления**.

- Объявление — **[`remote-config.json`](remote-config.json)** в корне игры:
  `defaults` (обязаны совпадать с константами сборки), `ranges` (ключ без рамки
  игра не применит вовсе), `labels` (подписи в админке), `funnel` (шаги
  воронки).
- Значения, которые сейчас у игроков —
  `admin/cloud/config/com.terekh.sudoku.json`. Правка файла без заливки
  (`cloud/config-push.ps1`) не меняет ничего.
- Помощник общий: `window.tuned(ключ, константа)` и `window.tunedText(...)` в
  [`config.js`](config.js). Он был локальным в `ads.js`, и остальным файлам
  пришлось бы заводить свою копию.
- Расхождение объявления с константами сборки видно в консоли:
  `window.checkDeclaredDefaults()` в дев-сборке пишет о нём при запуске.
- В `cloud/config/*.json` лежат **только сознательные отклонения**; пусто —
  значит «как в сборке».
- НЕ вынесены сердечки и подсказки: их стартовые значения записываются в СЕЙВ
  при создании уровня. Хуже того, по равенству `active.hearts ===
  heartsPerLevel` игра решает, свежий ли уровень (`game.js`), — сменившееся
  число сломало бы эту проверку молча.
- `givens_shift_*` — общая ручка сложности: таблица `DIFFICULTY` остаётся
  авторской (windoku проще classic на четыре клетки), а сдвиг двигает её целиком.
- Читать значения — только через `tuned()` и **при обращении**, а не
  в константу при старте: иначе значение застынет и правка в облаке не
  подействует до перезапуска.

**Дефолты живут здесь, в игре.** Пустой, недоступный или битый конфиг обязан
означать «игра работает как была». Сервер только перебивает значения. Здесь у
этого правила есть и второй смысл: `remote/remoteConfig.iife.js` собран из
ES2020-исходников, и достаточно старый WebView его не разберёт — тогда
`window.RemoteConfig` не появится вовсе. Поэтому bootstrap проверяет наличие
клиента, а `GAME_CONFIG.ADS.interstitial.*` остаётся резервом. **Не убирай эти
константы.**

Сердечки и подсказки в конфиг сознательно НЕ вынесены: их стартовые значения
пишутся в сейв при создании уровня и участвуют в миграциях — правка из облака
означала бы правку формата сейва задним числом.

**Конфиги приурочены к версиям.** `versionBase` в
[`.claude/build-config.json`](.claude/build-config.json) (сейчас `1.0`) — это
ключ слоя `byVersion`: им новой сборке дают одни значения, а выпущенной
оставляют прежние. Поднимаешь мажор или минор — новый слой в админке появится
сам. Со `versionName` из магазина (`1.0.0.202606041000`) это **разные
пространства имён**, сводить их нельзя.

**Группы A/B уходят в аналитику.** `window.Analytics.setAbCohorts()` зовётся
после загрузки конфига, и метка уходит параметром `ab` в каждом событии.
`session_start` намеренно ЖДЁТ группу — иначе верх воронки размечен хуже низа.
Без этого тест бессмыслен: разбиение есть, а сравнить группы нечем.

**Прохождение и группа A/B — в ОДНОМ параметре одного события.** `level_start` в
`main.js` отправляет рядом с плоским `level_num` ещё и вложенный `progress: {
"<уровень>": "<группа>" }`.

Вложенный — не для красоты. В дереве параметров отчёта уровень и группа тогда
лежат на разных уровнях ОДНОЙ ветви и пересекаются запросом
(`paramsLevel2`+`paramsLevel3`); лежа соседними ветвями — то есть `level_num` и
`ab` просто рядом — они не пересекаются, и такой запрос отдаёт ноль строк.
Проверено на живых данных.

Форму собирает `progressParams()` из общего клиента: один код на игру и на
админку, иначе запрос не нашёл бы данные. Вне тестов группа называется
`default`, а не пустой строкой — пустое значение в отчёте неотличимо от
«параметра не было».

Плоский `level_num` остаётся на месте: только он есть у выпущенных сборок, и
панель прохождения умеет читать обе формы. Отдельных событий `level_<N>_done`
больше нет — они были следствием неверной посылки, будто разрез по параметру
недостижим в принципе.

### Что нужно обновить в админке, если правишь игру

Админка **не разбирает код игры** — она знает только то, что написано в
`remote-config.json` и `.claude/build-config.json`. Поэтому:

| в игре поменялось | что сделать в `../admin` |
|---|---|
| новое число, которое хочется крутить из облака | ключ в `remote-config.json` (+`ranges`!), затем в `cloud/config/com.terekh.sudoku.json` со значением константы сборки |
| ключ переименован или убран | поправить оба файла, иначе в бакете останется значение, которое игра молча отбрасывает |
| поменялось событие или параметр прохождения | `funnel.levels` (`event` / `param` / `max`) — по нему рисуется график |
| поднят мажор/минор | `versionBase` в `.claude/build-config.json` |
| просят «завести A/B-тест» | **тест не пишется в код игры.** Он заводится в админке (вкладка «Ремоут») или в `cloud/config/com.terekh.sudoku.json`; от игры нужно только объявленный ключ. Значения группы приходят поверх общих сами |

Клиент в `remote/` — **генерируемая копия** из `admin/client/`, править её здесь
нельзя:

```bash
node tools/sync-client.mjs --write   # из папки admin
```

Проверить, что объявление игры и бакет не разошлись:

```bash
node tools/check-config.mjs          # из папки admin
```
