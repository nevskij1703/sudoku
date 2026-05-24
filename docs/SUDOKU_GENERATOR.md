# Генератор уровней и оценка сложности

Документ описывает алгоритмы из [sudokuCore.js](../sudokuCore.js), [sudokuTechniques.js](../sudokuTechniques.js) и [sudokuGenerator.js](../sudokuGenerator.js).

## API (короткая шпаргалка)

```js
SudokuGenerator.generate(targetDifficulty, opts?) → {
  puzzle:     number[81],    // 0 = пусто
  solution:   number[81],    // полное решение
  givens:     boolean[81],   // puzzle[i] != 0
  difficulty: 'easy'|'medium'|'hard',
  score:      number,        // абсолютный score
  techniques: { [techName]: count },
  elapsedMs:  number,
  attempts:   number
}

SudokuGenerator.rateDifficulty(puzzle) → { score, label, techniques, solvable }

SudokuCore.solve(grid)               → number[81] | null
SudokuCore.countSolutions(grid, max) → integer (0,1,2,...,max)
SudokuCore.isComplete(grid)          → boolean

SudokuTechniques.humanSolve(grid)    → { solved, grid, log: [{tech, eliminations}] }
```

## 1. Низкоуровневые структуры

- **grid**: `number[81]` плоский массив. `idx = row*9 + col`. `0` = пусто.
- **variant**: объект-стратегия (`ClassicVariant`). Описывает «юниты» (9 строк + 9 столбцов + 9 боксов) и проверку валидности. На будущее: `DiagonalVariant`, `KillerVariant` — другие юниты / `isLegal()`.
- **bitmask**: 9-битное число. Бит `k` = «цифра `k+1` присутствует/возможна». `ALL_MASK = 0x1FF`.

## 2. `countSolutions(grid, max)` — uniqueness check

Битмасковый бэктрек:
- Для каждой строки/столбца/бокса держим маску «доступных цифр».
- На каждом шаге MRV: ищем пустую ячейку с минимальным числом кандидатов.
- Перебираем кандидатов, при тупике откатываемся.
- Считаем сколько решений найдено; **early-exit** при `count >= max`.

Использование в генераторе: вызываем с `max=2`. Если вернулось `1` — puzzle уникален. Если `2` — у него больше одного решения, не годится.

## 3. `humanSolve(grid)` — человекоподобный солвер

Применяет техники в порядке возрастания «стоимости». При успехе любой техники — перезапускает поиск с самой дешёвой (greedy). Возвращает лог применений.

**Пайплайн (ascending difficulty):**

| # | Техника | Вес | Описание |
|---|---|---|---|
| 1 | nakedSingle | 1 | Единственный кандидат в ячейке → ставим |
| 2 | hiddenSingle | 2 | Цифра возможна в одной ячейке юнита → ставим |
| 3 | nakedPair | 8 | Две ячейки с одинаковой парой кандидатов → удаляем из остальных в юните |
| 4 | pointingPair | 10 | В боксе цифра только в одной строке/столбце → удаляем из этой линии вне бокса |
| 5 | boxLineReduction | 12 | В строке/столбце цифра только в одном боксе → удаляем из бокса вне линии |
| 6 | nakedTriple | 20 | Три ячейки с 3 общими кандидатами → удаляем из остальных в юните |
| 7 | xWing | 50 | Цифра в 2 строках возможна ровно в 2 одинаковых столбцах → удаляем из этих столбцов в других строках. Симметрично по строкам/столбцам. |

Что **не** реализовано (намеренно): Swordfish, X-Y wing, цепи. Они нужны только для самых сложных puzzle'ов, которые мы и не хотим показывать на мобильном экране.

## 4. `rateDifficulty(puzzle)` — формула score

```js
score = (81 - countGivens) * 0.5             // вклад открытых клеток
      + Σ (weight[tech] * count[tech])        // суммарная стоимость применений
      + 100 * weight[hardestTech]             // доминантный бонус за самую тяжёлую технику
```

**Лейблы** (см. `GAME_CONFIG.GENERATOR.labelThresholds`):
- `easy`: `score ≤ 250` И `hardestTechWeight ≤ 2` (только naked + hidden singles)
- `medium`: `score ≤ 1000` И `hardestTechWeight ≤ 10` (до pointing pair)
- `hard`: всё что выше, либо нужна `boxLineReduction` / `nakedTriple` / `xWing`

Если `humanSolve` не решил puzzle — мы возвращаем `score = Infinity, label = 'hard'`. Если бэктрек тоже не решает — `solvable = false`, puzzle отбрасывается генератором.

## 5. `generate(targetDifficulty, opts)` — главный поток

```
1. Создаём полную сетку:
   grid = seed-transform(canonical_seed)
        = relabel + swap_rows + swap_cols + swap_bands + swap_stacks + maybe_transpose
   → за O(1), всегда валидно

2. Удаляем клетки парами (симметрично):
   - Случайный порядок индексов
   - Для каждой пары [i, partner(i)] — пробуем убрать обе
   - Проверка: countSolutions(puzzle, 2) === 1?
     - да → коммитим
     - нет → восстанавливаем
   - Стоп когда givens достигло targetRange.min или времени не осталось

3. rateDifficulty(puzzle) → { score, label }

4. Если label === targetDifficulty → return.
   Иначе → повторяем с шага 1 (до maxRetries = 20, до timeBudgetMs = 1500).

5. Если за бюджет так и не нашли точно нужный лейбл —
   возвращаем «ближайший» (например, easy если просили medium).
```

**Симметрия**:
- `rotational` (по умолчанию): `(r, c) ↔ (8-r, 8-c)`. Классический «газетный» вид.
- `mirror`: `(r, c) ↔ (r, 8-c)`. Горизонтальное отражение.
- `none`: чуть быстрее, но визуально менее опрятно.

## 6. Тайминги

На типичном MacBook M1 / mid-range Android (Snapdragon 6xx):
- `countSolutions(g, 2)` на 26-givens puzzle: 1–20 мс.
- `humanSolve` полный прогон: 5–50 мс (тяжелее на hard).
- `generate('medium')`: 100–600 мс в типичном случае.
- `generate('hard')`: 300–1500 мс (могут потребоваться retries для нужного лейбла).

Если выходим за `timeBudgetMs` — возвращаем fallback с предупреждением в консоль.

## 7. Variant-расширение (на будущее)

```js
const DiagonalVariant = {
  ...ClassicVariant,
  name: 'diagonal',
  unitsForCell(idx) { /* добавить main + anti диагонали */ },
  allUnits()        { /* + 2 диагональных юнита */ },
  isLegal(g,i,d)    { /* + проверка диагоналей */ },
  seedGrid: null    // для диагонального судоку seed-transform не сохраняет валидность —
                    // нужен честный backtracking-fill
};
```

Все техники в `sudokuTechniques.js` принимают `variant` параметром и итерируют `variant.allUnits()` — для диагонального варианта они автоматически расширятся на диагональные ограничения.

## 8. Калибровка порогов

Для проверки распределения лейблов используй кнопку «Стат. по 50 уровням» в [devPanel.js](../devPanel.js). Она выведет:
- среднее время генерации,
- распределение `easy / medium / hard`,
- min/max/median score'ов.

Если распределение перекошено (например, на `medium` 80% выходит `hard`) — подкорректируй пороги в `config.js` → `GAME_CONFIG.GENERATOR.labelThresholds`.

## 9. Файлы

- [sudokuCore.js](../sudokuCore.js) — низкоуровневые примитивы + solver + ClassicVariant.
- [sudokuTechniques.js](../sudokuTechniques.js) — humanSolve + 7 техник.
- [sudokuGenerator.js](../sudokuGenerator.js) — generate + rateDifficulty + seed-transform.
- [config.js](../config.js) — `GAME_CONFIG.GENERATOR.*` параметры.
