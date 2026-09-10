# ANALYTICS — карта событий проекта «Судоку»

Проект подключён к **Yandex AppMetrica** (бесплатный analytics SDK от Яндекса).
Подключение: [analytics.js](../analytics.js), native bridge — `html2apk -YandexAppMetrica`.

**API key:** `f819bc73-52cb-4fc4-90df-042f23e3d000` (хранится в [.claude/build-config.json](../.claude/build-config.json) → `appMetricaApiKey`).

**Контракт обёртки и архитектура:** см. skill `connect-appmetrica` (`~/.claude/skills/connect-appmetrica/SKILL.md`).

---

## События

Все события идут через `window.Analytics.event(name, params)` (или `Analytics.adShown({...})`).
Системные параметры (`app_name='sudoku'`, `app_version`, `platform`, `user_id`) добавляются автоматически.

### Общие события (как у других игр мастерской)

| Event name | Params | File:line | Когда срабатывает |
|---|---|---|---|
| `session_start` | — | [main.js](../main.js) init() | Сразу после `Analytics.configure()`. |
| `level_start` | `{ level_num, difficulty, mode }` | [main.js](../main.js) `proceedToNextLevel` | Перед `Game.startNewLevel`. |
| `level_complete` | `{ level_num, difficulty, mode, mistakes, hints_used }` | [main.js](../main.js) `Game.on('win')` | Победа. |
| `level_fail` | `{ level_num, difficulty, mode, reason: 'hearts_zero' }` | [main.js](../main.js) `Game.on('gameover')` | Hearts <= 0 без extra-heart rewarded. |
| `ad_interstitial_shown` | `{ placement: 'level_transition' }` | [main.js](../main.js) `proceedToNextLevel` | Перед показом interstitial. |
| `ad_rewarded_shown` | `{ placement, watched, reward_given }` | [main.js](../main.js) `requestHintRefill`, `requestFastToggle`, `btn-gameover-ad` | После rewarded callback. `placement`: `hint_refill` / `fast_mode_unlock` / `extra_heart`. |
| `hint_used` | `{ level_num, difficulty, mode, source: 'free' }` | [main.js](../main.js) onHint в NumberPad | Юзер потратил подсказку из счётчика. |
| `settings_opened` | — | [main.js](../main.js) `openSettings()` | Открытие settings modal. |
| `rate_clicked` | `{ source: 'modal' }` | [main.js](../main.js) `btn-rate-now` | Клик «Оценить» в rate-modal. |

### Sudoku-специфичные события

| Event name | Params | File:line | Когда срабатывает |
|---|---|---|---|
| `difficulty_selected` | `{ difficulty, mode }` | [main.js](../main.js) `btn-start-level` click | Юзер нажал «Старт» на главном экране (выбор diff+mode). |
| `mistake_made` | `{ remaining_hearts, mistakes_total, level_num, difficulty, mode }` | [game.js](../game.js) wrong-digit branch (~line 642) | Введена неправильная цифра. `mistakes_total` — счётчик за уровень. |
| `rewarded_hint_obtained` | `{ level_num }` | [main.js](../main.js) `requestHintRefill` (watched=true) | Юзер досмотрел rewarded и получил +1 подсказку. |

### Системные параметры (auto-injected)

- `app_name`: `'sudoku'`
- `app_version`: `'1.0.0'` (из [main.js](../main.js))
- `platform`: `'android'` (или `'browser'` в dev)
- `user_id`: UUID из `Storage.getUserId()`

### AppMetrica auto-tracked (НЕ дублируем)

- `app_open` / sessions / session length — авто
- Retention D1/D7/D30 — авто
- Crashes / ANRs — авто

---

## Где смотреть в дашборде AppMetrica

Открыть https://appmetrica.yandex.ru/, выбрать приложение «Судоку».

### Audience
**Reports → Audience overview** — DAU/WAU/MAU, средняя длительность сессии.

### Retention
**Reports → Retention** → выбрать `session_start` или auto-tracked app_open → cohort D1/D3/D7/D14/D30.
Цель: D1 ≥ 35%, D7 ≥ 12% (без push); с push можно надеяться на ≥ 50% / ≥ 18%.

### Funnels
**Reports → Funnels** → создать воронку:

**Воронка прохождения уровня (per-difficulty):**
1. `level_start` (фильтр `difficulty='hard'`)
2. `level_complete` (фильтр `difficulty='hard'`)

Покажет конверсию easy → medium → hard.

**Воронка hint engagement:**
1. `hint_used` (любой source)
2. `level_complete` (в течение N минут)

% юзеров, которым подсказки помогли завершить уровень.

**Воронка rewarded engagement:**
1. `ad_rewarded_shown` (placement='hint_refill')
2. `hint_used` (source='rewarded' — добавим если разделим)

Сейчас можно посмотреть `rewarded_hint_obtained` directly — это означает успешный пройденный rewarded.

**Воронка gameover-revive:**
1. `level_fail`
2. `ad_rewarded_shown` (placement='extra_heart')
3. `level_complete`

% юзеров которые после геймовера посмотрели rewarded и доиграли уровень.

### Ad views
**Reports → Events** → фильтр по `ad_*_shown`. Group by `placement` для разреза по точкам.

### Custom segments
**Audience → Сегменты** → создать.

Примеры:
- «Хардкорщики»: `difficulty_selected` count where `difficulty='hard'` ≥ 5
- «Залипают на medium»: `level_fail` count where `difficulty='medium'` ≥ 3
- «Любители hint»: `hint_used` count ≥ 10 per session
- «Rewarded-friendly»: `ad_rewarded_shown` count where `watched=true` ≥ 5

---

## Как добавить новое событие

1. Придумай **семантичное имя** (snake_case). Сначала проверь общую таксономию в skill `connect-appmetrica` — может, уже есть.
2. Добавь вызов в нужном месте кода: `window.Analytics.event('event_name', { ...params })`.
3. Запиши в таблицу выше: имя, params, file:line.
4. Если событие специфично — упомяни в [CLAUDE.md](../CLAUDE.md) → раздел «Аналитика».
5. **НЕ переименовывай уже опубликованные события** — это сломает воронки/retention в дашборде.

---

## Privacy

Сбор данных описан в [Store_Info/PRIVACY_POLICY.md](../Store_Info/PRIVACY_POLICY.md) → раздел «2.2. Аналитика (Yandex AppMetrica)». При изменении набора событий — обнови `.md` и регенерируй `.pdf`. `prepare-release-candidate` сделает PDF автоматически.
