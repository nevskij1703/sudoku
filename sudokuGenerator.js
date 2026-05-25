/**
 * sudokuGenerator.js — генератор Sudoku-головоломок + оценка сложности.
 * См. docs/SUDOKU_GENERATOR.md.
 *
 * API:
 *   SudokuGenerator.generate(targetDifficulty='medium', opts?) → {
 *     puzzle: number[81],      // с пропусками (0 = пусто)
 *     solution: number[81],    // полное решение
 *     givens: boolean[81],     // true там где puzzle != 0
 *     difficulty: 'easy'|'medium'|'hard',
 *     score: number,           // абсолютный score из rateDifficulty
 *     techniques: object,      // counts по техникам, e.g. {nakedSingle: 12, hiddenSingle: 3}
 *     elapsedMs: number,
 *     attempts: number
 *   }
 *
 *   SudokuGenerator.rateDifficulty(puzzle, variant?) → {score, label, techniques, solvable}
 */
window.SudokuGenerator = (function () {
  const Core   = window.SudokuCore;
  const Tech   = window.SudokuTechniques;
  const CONFIG = window.GAME_CONFIG.GENERATOR;

  // ===== rateDifficulty =====

  function thresholdLabel(score, hardestWeight) {
    const T = CONFIG.labelThresholds;
    if (score <= T.easy.maxScore && hardestWeight <= T.easy.maxTechWeight) return 'easy';
    if (score <= T.medium.maxScore && hardestWeight <= T.medium.maxTechWeight) return 'medium';
    return 'hard';
  }

  function countGivens(puzzle) {
    // ВАЖНО: puzzle.length может быть 16 (Mini 4×4) или 81 (стандартные).
    // Hardcoded 81 даёт неправильный count для Mini — undefined cells
    // считаются как not-zero, carving никогда не доходит до min-cap.
    let n = 0;
    for (let i = 0; i < puzzle.length; i++) if (puzzle[i] !== 0) n++;
    return n;
  }

  function rateDifficulty(puzzle, variant, modeKey) {
    if (!variant) variant = Core.ClassicVariant;
    // Не-9×9 variants (Mini) и variants со skipHumanSolve=true (Diagonal,
    // Center, Windoku, Sugur, Chain) — humanSolve либо hardcoded под 9
    // units определённого типа, либо не учитывает extra-units, либо
    // слишком дорог. Возвращаем оценку по количеству givens, используя
    // per-mode targets из CONFIG.DIFFICULTY (или относительные 0.45/0.35*N
    // как fallback).
    if ((variant.size || 9) !== 9 || variant.skipHumanSolve) {
      const bt = Core.solve(puzzle, variant);
      const givens = countGivens(puzzle);
      const N = variant.cellCount || 81;
      const MODE_DIFFICULTY = (window.GAME_CONFIG && window.GAME_CONFIG.DIFFICULTY) || {};
      const mk = modeKey || (variant && variant.name) || 'classic';
      const D = MODE_DIFFICULTY[mk];
      let label;
      if (D && D.easy && D.medium && D.hard) {
        // Используем per-mode targets: lower bound каждого диапазона —
        // граница для попадания в этот лейбл (givens ≤ easy.max → easy,
        // givens ≤ medium.max → medium, иначе hard). Берём верхнюю границу
        // как threshold — она наиболее «лёгкая» границы данной сложности.
        if (givens > D.medium[1]) label = 'easy';
        else if (givens > D.hard[1]) label = 'medium';
        else label = 'hard';
      } else {
        label = givens >= 0.45 * N ? 'easy' :
                givens >= 0.35 * N ? 'medium' : 'hard';
      }
      return {
        score: (N - givens) * 1.0,
        label: label,
        techniques: {},
        solvable: !!bt,
        humanSolvable: true
      };
    }
    const result = Tech.humanSolve(puzzle, variant);
    const counts = Tech.summariseLog(result.log);

    if (!result.solved) {
      // Не решается человеческими техниками. Может, всё-таки есть решение,
      // но требует guess-логики — считаем «очень hard». Если бэктрек тоже не
      // находит решения — puzzle сломан, помечаем как невалидный.
      const bt = Core.solve(puzzle, variant);
      return {
        score: Infinity,
        label: 'hard',
        techniques: counts,
        solvable: !!bt,
        humanSolvable: false
      };
    }

    const weights = Tech.TECH_WEIGHTS;
    let score = (81 - countGivens(puzzle)) * 0.5;
    let hardest = 0;
    for (const techName in counts) {
      const w = weights[techName] || 1;
      score += w * counts[techName];
      if (w > hardest) hardest = w;
    }
    score += 100 * hardest;

    return {
      score: score,
      label: thresholdLabel(score, hardest),
      techniques: counts,
      solvable: true,
      humanSolvable: true
    };
  }

  // ===== Seed-transform: трансформации, сохраняющие валидность сетки =====
  //
  // Любая комбинация ниже даёт случайную валидную сетку из исходного seed:
  //   - random permutation 1..9 для значений
  //   - swap двух строк внутри одного бэнда (3 строки)
  //   - swap двух столбцов внутри одного стэка (3 столбца)
  //   - swap двух бэндов (3 строки целиком)
  //   - swap двух стэков (3 столбца целиком)
  //   - transpose (опционально)

  function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function relabel(grid, rng) {
    const perm = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    const out = new Array(81);
    for (let i = 0; i < 81; i++) {
      out[i] = grid[i] === 0 ? 0 : perm[grid[i] - 1];
    }
    return out;
  }

  function swapRows(grid, r1, r2) {
    if (r1 === r2) return grid;
    const out = grid.slice();
    for (let c = 0; c < 9; c++) {
      out[Core.idx(r1, c)] = grid[Core.idx(r2, c)];
      out[Core.idx(r2, c)] = grid[Core.idx(r1, c)];
    }
    return out;
  }

  function swapCols(grid, c1, c2) {
    if (c1 === c2) return grid;
    const out = grid.slice();
    for (let r = 0; r < 9; r++) {
      out[Core.idx(r, c1)] = grid[Core.idx(r, c2)];
      out[Core.idx(r, c2)] = grid[Core.idx(r, c1)];
    }
    return out;
  }

  function swapBands(grid, b1, b2) {
    let g = grid;
    for (let i = 0; i < 3; i++) g = swapRows(g, b1 * 3 + i, b2 * 3 + i);
    return g;
  }

  function swapStacks(grid, s1, s2) {
    let g = grid;
    for (let i = 0; i < 3; i++) g = swapCols(g, s1 * 3 + i, s2 * 3 + i);
    return g;
  }

  function transpose(grid) {
    const out = new Array(81);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) out[Core.idx(c, r)] = grid[Core.idx(r, c)];
    }
    return out;
  }

  // Полная случайная сетка-решение. Для classic — быстрый seed-transform.
  // Для остальных variants (Diagonal/Center/Windoku/Kropki/Sugur) seed-transform
  // не сохраняет constraints — используем randomized backtracking от пустой сетки.
  function randomSolved(rng, variant) {
    variant = variant || Core.ClassicVariant;
    const useSeedTransform = (variant === Core.ClassicVariant) ||
                             (variant.name === 'classic') ||
                             (variant.canSeedTransform === true);
    if (useSeedTransform) {
      let g = Core.ClassicVariant.seedGrid();
      g = relabel(g, rng);
      for (let band = 0; band < 3; band++) {
        for (let k = 0; k < 6; k++) {
          const a = band * 3 + Math.floor(rng() * 3);
          const b = band * 3 + Math.floor(rng() * 3);
          g = swapRows(g, a, b);
        }
      }
      for (let stack = 0; stack < 3; stack++) {
        for (let k = 0; k < 6; k++) {
          const a = stack * 3 + Math.floor(rng() * 3);
          const b = stack * 3 + Math.floor(rng() * 3);
          g = swapCols(g, a, b);
        }
      }
      for (let k = 0; k < 4; k++) {
        g = swapBands(g, Math.floor(rng() * 3), Math.floor(rng() * 3));
        g = swapStacks(g, Math.floor(rng() * 3), Math.floor(rng() * 3));
      }
      if (rng() < 0.5) g = transpose(g);
      return g;
    }
    // Backtracking путь — для variants без сохраняющих constraints преобразований.
    const N = variant.cellCount || 81;
    const empty = new Array(N).fill(0);
    return Core.solve(empty, variant, rng);
  }

  // ===== Удаление клеток с проверкой уникальности =====

  function symmetryPartner(i, mode, variant) {
    if (mode === 'none') return -1;
    const size = (variant && variant.size) || 9;
    const r = Math.floor(i / size);
    const c = i % size;
    if (mode === 'rotational') {
      return (size - 1 - r) * size + (size - 1 - c);
    }
    if (mode === 'mirror') {
      return r * size + (size - 1 - c);
    }
    return -1;
  }

  function makePuzzle(solution, opts, rng, deadline) {
    const symmetry = opts.symmetry || 'rotational';
    const givensTarget = opts.givensTargetRange || [26, 30];
    const variant = opts.variant || Core.ClassicVariant;
    const minGivens = givensTarget[0];
    const N = variant.cellCount || solution.length || 81;

    const puzzle = solution.slice();
    const order = shuffleArray(Array.from({ length: N }, (_, i) => i), rng);

    for (let k = 0; k < order.length; k++) {
      if (Date.now() > deadline) break;
      const i = order[k];
      if (puzzle[i] === 0) continue;

      const partner = symmetryPartner(i, symmetry, variant);
      const cells = (partner !== -1 && partner !== i) ? [i, partner] : [i];

      const currentGivens = countGivens(puzzle);
      if (currentGivens - cells.length < minGivens) continue;

      const backup = cells.map(c => puzzle[c]);
      for (const c of cells) puzzle[c] = 0;

      const cnt = Core.countSolutions(puzzle, 2, variant);
      if (cnt !== 1) {
        for (let m = 0; m < cells.length; m++) puzzle[cells[m]] = backup[m];
      }

      if (countGivens(puzzle) <= minGivens) break;
    }

    return puzzle;
  }

  // ===== Главный generate =====

  function generate(targetDifficulty, opts) {
    targetDifficulty = targetDifficulty || 'medium';
    opts = opts || {};
    const variant   = opts.variant || Core.ClassicVariant;
    const symmetry  = opts.symmetry || CONFIG.symmetry;
    // Per-mode пороги сложности (config.js → GAME_CONFIG.DIFFICULTY[mode]).
    // Учитывают extra-constraints: режимы с большей помощью (Windoku, Diagonal)
    // используют МЕНЬШЕ givens для той же difficulty. Если mode не задан в opts —
    // берём через variant.givensTarget (legacy) или общий CONFIG.givensTarget.
    const MODE_DIFFICULTY = (window.GAME_CONFIG && window.GAME_CONFIG.DIFFICULTY) || {};
    const modeKey = opts.mode || (variant && variant.name) || 'classic';
    const givensSource = MODE_DIFFICULTY[modeKey] || variant.givensTarget || CONFIG.givensTarget;
    const givensRange = (givensSource[targetDifficulty] || givensSource.medium || [30, 35]).slice();
    const timeBudget = opts.timeBudgetMs || CONFIG.timeBudgetMs;
    const maxRetries = opts.maxRetries || CONFIG.maxRetries;
    const seed = (typeof opts.seed === 'number') ? opts.seed : null;

    const rng = seed !== null ? makeSeededRng(seed) : Math.random;

    const startedAt = Date.now();
    const deadline  = startedAt + timeBudget;
    let attempts = 0;
    let bestFallback = null;

    while (attempts < maxRetries && Date.now() < deadline) {
      attempts++;
      const solution = randomSolved(rng, variant);
      const puzzle = makePuzzle(solution, {
        symmetry: symmetry,
        givensTargetRange: givensRange,
        variant: variant
      }, rng, deadline);

      // Финальный verify (защита-сетка). makePuzzle уже проверяет uniqueness
      // на каждом удалении, но проверяем явно ещё раз — и заодно сверяем
      // решение из backtrack-солвера с заранее известным `solution`.
      const verifyRes = verifyPuzzle(puzzle, solution, variant, modeKey);
      if (!verifyRes.ok) {
        console.warn('[generator] verify rejected:', verifyRes.reason);
        continue;
      }

      // Для easy/medium требуем что puzzle решается человеческими техниками
      // (humanSolve.solved). Hard разрешает чисто-логичные но более глубокие
      // решения; если humanSolve не справился, score=Infinity → label='hard'.
      if (!verifyRes.humanSolvable && targetDifficulty !== 'hard') {
        continue;
      }

      const givens = puzzle.map(v => v !== 0);

      const candidate = {
        puzzle: puzzle,
        solution: solution,
        givens: givens,
        difficulty: verifyRes.difficulty,
        score: verifyRes.score,
        techniques: verifyRes.techniques,
        elapsedMs: Date.now() - startedAt,
        attempts: attempts,
        verified: true
      };

      if (verifyRes.difficulty === targetDifficulty) return candidate;

      // Fallback: запомним «ближайший» вариант, если не получится найти
      // точное совпадение. Tie-breaker — count givens: предпочитаем тот,
      // где givens ближе к maxGivens целевого диапазона. Это защищает от
      // outliers с 56 givens (uncarved puzzle), которые формально могут
      // иметь «ближайший» лейбл из-за simple-rating per-mode.
      const fbGivens = candidate.puzzle.reduce(function (a, v) { return v !== 0 ? a + 1 : a; }, 0);
      const distNow = difficultyDistance(verifyRes.difficulty, targetDifficulty);
      const distGivens = Math.abs(fbGivens - givensRange[1]);
      if (!bestFallback) {
        bestFallback = candidate;
        bestFallback._dist = distNow;
        bestFallback._distGivens = distGivens;
      } else if (distNow < bestFallback._dist ||
                 (distNow === bestFallback._dist && distGivens < bestFallback._distGivens)) {
        bestFallback = candidate;
        bestFallback._dist = distNow;
        bestFallback._distGivens = distGivens;
      }
    }

    if (bestFallback) {
      // Подменяем лейбл на запрошенный — это компромисс, но альтернатива
      // (вернуть null или другой лейбл) хуже UX. Реальная сложность остаётся
      // в score.
      console.warn('[generator] fallback: requested=' + targetDifficulty +
                   ' got=' + bestFallback.difficulty + ' score=' + bestFallback.score);
      return bestFallback;
    }

    // Совсем не получилось — возвращаем разреженный solution с гарантированной
    // уникальностью (удаляем по одной клетке только если puzzle остаётся unique).
    console.warn('[generator] full failure, returning safe-trivial fallback');
    const sol = randomSolved(rng, variant);
    const triv = sol.slice();
    const N = variant.cellCount || 81;
    const idxs = shuffleArray(Array.from({ length: N }, (_, i) => i), rng);
    let removed = 0;
    for (let k = 0; k < idxs.length && removed < 25; k++) {
      const backup = triv[idxs[k]];
      triv[idxs[k]] = 0;
      if (Core.countSolutions(triv, 2, variant) !== 1) {
        triv[idxs[k]] = backup;
      } else {
        removed++;
      }
    }
    return {
      puzzle: triv,
      solution: sol,
      givens: triv.map(v => v !== 0),
      difficulty: targetDifficulty,
      score: 0,
      techniques: {},
      elapsedMs: Date.now() - startedAt,
      attempts: attempts,
      fallback: true
    };
  }

  function difficultyDistance(a, b) {
    const order = { easy: 0, medium: 1, hard: 2 };
    return Math.abs(order[a] - order[b]);
  }

  // ===== verifyPuzzle: проверка решаемости и единственности решения =====
  //
  // Используется как defensive safety-net в generate() — гарантирует:
  //   1. Существует хотя бы одно решение (countSolutions ≥ 1).
  //   2. Решение единственное (countSolutions === 1).
  //   3. Backtrack-решение совпадает с заранее известным solution (если передан).
  //   4. Возвращает оценку сложности и флаг humanSolvable.
  //
  // Дополнительно доступен публично как SudokuGenerator.verifyPuzzle(puzzle).
  function verifyPuzzle(puzzle, solution, variant, modeKey) {
    if (!variant) variant = Core.ClassicVariant;

    // 1. Уникальность через countSolutions с early-exit на 2.
    const cnt = Core.countSolutions(puzzle, 2, variant);
    if (cnt === 0) return { ok: false, reason: 'no_solution' };
    if (cnt > 1)  return { ok: false, reason: 'multiple_solutions' };

    // 2. Backtrack-решение (на всякий случай, для сверки).
    const bt = Core.solve(puzzle, variant);
    if (!bt) return { ok: false, reason: 'unsolvable' };

    // 3. Сверка с переданным solution.
    if (solution) {
      const N = variant.cellCount || 81;
      for (let i = 0; i < N; i++) {
        if (bt[i] !== solution[i]) return { ok: false, reason: 'solution_mismatch' };
      }
    }

    // 4. Оценка сложности и решаемость человеком.
    const rating = rateDifficulty(puzzle, variant, modeKey);
    return {
      ok: true,
      unique: true,
      humanSolvable: !!rating.humanSolvable,
      difficulty: rating.label,
      score: rating.score,
      techniques: rating.techniques
    };
  }

  // Seeded RNG (mulberry32) — для deterministic генерации
  function makeSeededRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===== dev helper: батч-генерация со статистикой =====
  function batchStats(n, difficulty) {
    const out = { totalMs: 0, byLabel: { easy: 0, medium: 0, hard: 0 }, scores: [], uniqueness: { ok: 0, fail: 0 } };
    for (let i = 0; i < n; i++) {
      const g = generate(difficulty);
      out.totalMs += g.elapsedMs;
      out.byLabel[g.difficulty] = (out.byLabel[g.difficulty] || 0) + 1;
      out.scores.push(Math.round(g.score));
      const cnt = Core.countSolutions(g.puzzle, 2);
      if (cnt === 1) out.uniqueness.ok++; else out.uniqueness.fail++;
    }
    return out;
  }

  return {
    generate: generate,
    rateDifficulty: rateDifficulty,
    verifyPuzzle: verifyPuzzle,
    randomSolved: randomSolved,
    makeSeededRng: makeSeededRng,
    batchStats: batchStats
  };
})();
