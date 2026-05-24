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
    let n = 0;
    for (let i = 0; i < 81; i++) if (puzzle[i] !== 0) n++;
    return n;
  }

  function rateDifficulty(puzzle, variant) {
    if (!variant) variant = Core.ClassicVariant;
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

  function randomSolved(rng) {
    let g = Core.ClassicVariant.seedGrid();
    g = relabel(g, rng);
    // Внутри каждого бэнда — несколько случайных swap'ов строк
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
    // Несколько swap'ов целых бэндов и стэков
    for (let k = 0; k < 4; k++) {
      g = swapBands(g, Math.floor(rng() * 3), Math.floor(rng() * 3));
      g = swapStacks(g, Math.floor(rng() * 3), Math.floor(rng() * 3));
    }
    if (rng() < 0.5) g = transpose(g);
    return g;
  }

  // ===== Удаление клеток с проверкой уникальности =====

  function symmetryPartner(i, mode) {
    if (mode === 'none') return -1;
    if (mode === 'rotational') {
      // 180° поворот: (r, c) → (8-r, 8-c)
      const p = Core.rc(i);
      return Core.idx(8 - p.r, 8 - p.c);
    }
    if (mode === 'mirror') {
      // Горизонтальное отражение: (r, c) → (r, 8-c)
      const p = Core.rc(i);
      return Core.idx(p.r, 8 - p.c);
    }
    return -1;
  }

  function makePuzzle(solution, opts, rng, deadline) {
    const symmetry = opts.symmetry || 'rotational';
    const givensTarget = opts.givensTargetRange || [26, 30];
    const minGivens = givensTarget[0];

    const puzzle = solution.slice();
    // Список индексов в случайном порядке
    const order = shuffleArray(Array.from({ length: 81 }, (_, i) => i), rng);

    for (let k = 0; k < order.length; k++) {
      if (Date.now() > deadline) break;
      const i = order[k];
      if (puzzle[i] === 0) continue;

      const partner = symmetryPartner(i, symmetry);
      const cells = (partner !== -1 && partner !== i) ? [i, partner] : [i];

      // Не уходим ниже минимума givens
      const currentGivens = countGivens(puzzle);
      if (currentGivens - cells.length < minGivens) continue;

      const backup = cells.map(c => puzzle[c]);
      for (const c of cells) puzzle[c] = 0;

      const cnt = Core.countSolutions(puzzle, 2);
      if (cnt !== 1) {
        // Восстанавливаем
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
    const givensRange = (CONFIG.givensTarget[targetDifficulty] || [30, 35]).slice();
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
      const solution = randomSolved(rng);
      const puzzle = makePuzzle(solution, {
        symmetry: symmetry,
        givensTargetRange: givensRange
      }, rng, deadline);

      // Финальный verify (защита-сетка). makePuzzle уже проверяет uniqueness
      // на каждом удалении, но проверяем явно ещё раз — и заодно сверяем
      // решение из backtrack-солвера с заранее известным `solution`.
      const verifyRes = verifyPuzzle(puzzle, solution, variant);
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

      // Fallback: запомним «ближайший» вариант, если не получится найти точное совпадение
      if (!bestFallback || difficultyDistance(verifyRes.difficulty, targetDifficulty) <
                          difficultyDistance(bestFallback.difficulty, targetDifficulty)) {
        bestFallback = candidate;
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

    // Совсем не получилось — возвращаем минимальный seed solution с дырками.
    console.warn('[generator] full failure, returning trivial fallback');
    const sol = randomSolved(rng);
    const triv = sol.slice();
    // Удаляем 30 случайных ячеек без проверки уникальности
    const idxs = shuffleArray(Array.from({ length: 81 }, (_, i) => i), rng);
    for (let k = 0; k < 30; k++) triv[idxs[k]] = 0;
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
  function verifyPuzzle(puzzle, solution, variant) {
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
      for (let i = 0; i < 81; i++) {
        if (bt[i] !== solution[i]) return { ok: false, reason: 'solution_mismatch' };
      }
    }

    // 4. Оценка сложности и решаемость человеком.
    const rating = rateDifficulty(puzzle, variant);
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
