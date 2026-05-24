/**
 * sudokuCore.js — низкоуровневые примитивы и битмасковый солвер.
 * См. docs/SUDOKU_GENERATOR.md.
 *
 * Концепции:
 *   grid: number[81] — плоский массив 9×9, 0 = пустая ячейка.
 *   idx = r*9 + c.
 *   variant: объект-стратегия (см. ClassicVariant), описывает «юниты» (row/col/box).
 *
 * API:
 *   SudokuCore.idx(r, c) / .rc(idx)
 *   SudokuCore.cloneGrid(g)
 *   SudokuCore.boxOf(r, c)
 *   SudokuCore.solve(grid, variant?) → number[81] | null
 *   SudokuCore.countSolutions(grid, max=2, variant?) → integer
 *   SudokuCore.isComplete(grid, variant?) → bool
 *   SudokuCore.gridFromString(str) / .gridToString(grid) — для dev/import-export
 *   SudokuCore.ClassicVariant
 */
window.SudokuCore = (function () {

  // ===== Утилиты индексации =====
  function idx(r, c) { return r * 9 + c; }
  function rc(i)     { return { r: Math.floor(i / 9), c: i % 9 }; }
  function boxOf(r, c) { return Math.floor(r / 3) * 3 + Math.floor(c / 3); }

  function cloneGrid(g) { return g.slice(); }

  function emptyGrid() {
    const g = new Array(81);
    for (let i = 0; i < 81; i++) g[i] = 0;
    return g;
  }

  // ===== Сериализация =====

  function gridFromString(str) {
    // Принимает 81 символ: 0/./- = пусто, 1..9 = цифры. Пробелы/переводы строк игнорируются.
    const out = emptyGrid();
    let i = 0;
    for (let k = 0; k < str.length && i < 81; k++) {
      const ch = str[k];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (ch >= '1' && ch <= '9') { out[i++] = ch.charCodeAt(0) - 48; }
      else if (ch === '0' || ch === '.' || ch === '-') { out[i++] = 0; }
      else return null;
    }
    if (i !== 81) return null;
    return out;
  }

  function gridToString(g) {
    let s = '';
    for (let i = 0; i < 81; i++) s += g[i] === 0 ? '.' : String(g[i]);
    return s;
  }

  // ===== ClassicVariant =====
  // Все солверы и техники принимают variant как параметр, чтобы в будущем
  // подключить DiagonalVariant / KillerVariant без правки sudokuCore/Techniques.

  const ClassicVariant = (function () {
    // Предвычисленные «юниты» — массив из 27 списков по 9 индексов.
    // Каждый юнит = группа из 9 ячеек, где цифры 1..9 должны встречаться по разу.
    const rowUnits = [];
    const colUnits = [];
    const boxUnits = [];
    for (let i = 0; i < 9; i++) {
      const row = [], col = [], box = [];
      for (let j = 0; j < 9; j++) {
        row.push(idx(i, j));
        col.push(idx(j, i));
      }
      rowUnits.push(row);
      colUnits.push(col);
    }
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const box = [];
        for (let dr = 0; dr < 3; dr++) {
          for (let dc = 0; dc < 3; dc++) {
            box.push(idx(br * 3 + dr, bc * 3 + dc));
          }
        }
        boxUnits.push(box);
      }
    }
    const allUnits = rowUnits.concat(colUnits).concat(boxUnits);

    // Для каждой ячейки — три её юнита и список «пиров» (20 других ячеек,
    // которые видят эту через row/col/box). Пиры используются в техниках.
    const cellUnits = new Array(81);
    const peers     = new Array(81);
    for (let i = 0; i < 81; i++) {
      const p = rc(i);
      const ru = rowUnits[p.r];
      const cu = colUnits[p.c];
      const bu = boxUnits[boxOf(p.r, p.c)];
      cellUnits[i] = [ru, cu, bu];
      const peerSet = new Set();
      for (const u of [ru, cu, bu]) for (const j of u) if (j !== i) peerSet.add(j);
      peers[i] = Array.from(peerSet);
    }

    function unitsForCell(i)  { return cellUnits[i]; }
    function peersForCell(i)  { return peers[i]; }
    function allUnitsFor()    { return allUnits; }
    function rowsAndCols()    { return { rows: rowUnits, cols: colUnits, boxes: boxUnits }; }

    function isLegal(g, i, digit) {
      const us = cellUnits[i];
      for (let u = 0; u < us.length; u++) {
        const unit = us[u];
        for (let k = 0; k < unit.length; k++) {
          if (unit[k] !== i && g[unit[k]] === digit) return false;
        }
      }
      return true;
    }

    // Одна валидная сетка — стартовый seed для seed-transform генератора.
    // Это любой корректный 9×9 Sudoku; берётся canonical (1..9 циклическим сдвигом по бэндам).
    function seedGrid() {
      const g = emptyGrid();
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          // Канонический паттерн (3*(r%3) + Math.floor(r/3) + c) % 9 + 1.
          // Каждая строка/столбец/блок будет содержать 1..9 ровно один раз.
          g[idx(r, c)] = ((3 * (r % 3) + Math.floor(r / 3) + c) % 9) + 1;
        }
      }
      return g;
    }

    return {
      name: 'classic',
      // Геометрия. Используется обобщённым solver'ом / generator'ом.
      size: 9, boxRows: 3, boxCols: 3, cellCount: 81,
      ALL_MASK: 0x1FF,
      digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      unitsForCell: unitsForCell,
      peersForCell: peersForCell,
      allUnits: allUnitsFor,
      rowsAndCols: rowsAndCols,
      isLegal: isLegal,
      seedGrid: seedGrid
    };
  })();

  // ===== Битмасковый бэктрек-солвер =====
  //
  // Используем 9 бит на маску: бит k (0-based) = «цифра k+1 ещё доступна».
  // Полная маска ALL = 0b111111111 = 0x1FF = 511.
  //
  // Поддерживаем три набора масок: rowMask[9], colMask[9], boxMask[9].
  // Доступные цифры для ячейки (r,c) = rowMask[r] & colMask[c] & boxMask[box].

  const ALL = 0x1FF;

  function bitCount(x) {
    // Hamming weight для 9-битного числа. Достаточно SWAR-маленький.
    x = x - ((x >> 1) & 0x55);
    x = (x & 0x33) + ((x >> 2) & 0x33);
    x = (x + (x >> 4)) & 0x0F;
    x = x + (x >> 8);
    return x & 0x3F;
  }

  function lowestBit(x) {
    // Возвращает индекс младшего установленного бита (0..8), -1 если 0.
    if (x === 0) return -1;
    let n = 0;
    while ((x & 1) === 0) { x >>= 1; n++; }
    return n;
  }

  function buildMasks(g) {
    const row = new Array(9).fill(ALL);
    const col = new Array(9).fill(ALL);
    const box = new Array(9).fill(ALL);
    for (let i = 0; i < 81; i++) {
      if (g[i] !== 0) {
        const p = rc(i);
        const bit = 1 << (g[i] - 1);
        row[p.r] &= ~bit;
        col[p.c] &= ~bit;
        box[boxOf(p.r, p.c)] &= ~bit;
      }
    }
    return { row: row, col: col, box: box };
  }

  // ===== Generic backtracking solver через variant.allUnits() =====
  //
  // Стары код использовал hardcoded row/col/box и игнорировал variant. Для
  // режимов Diagonal/Center/Windoku/Kropki/Sugur нам нужны доп. unit'ы (или
  // совсем другая раскладка). Поэтому solver теперь:
  //   1. Берёт `variant.allUnits()` — массив списков клеточных индексов.
  //   2. Строит маску каждого unit'а (9-битный mask «какие цифры ещё свободны»).
  //   3. Для каждой пустой ячейки candidates = AND масок всех unit'ов, в которые она входит.
  //   4. Опционально применяет variant.extraConstraints(g) — для Kropki / Sugur
  //      / Chain, где правила выходят за рамки «нет повторений внутри unit».
  //
  // Это чуть дороже чем row/col/box-specialised solver (для classic ~10% loss),
  // но универсально и работает для всех вариантов.

  function buildGenericMasks(g, variant) {
    const units = variant.allUnits();
    const ALL_LOC = variant.ALL_MASK || ALL;
    const unitMask = new Array(units.length).fill(ALL_LOC);
    const N = variant.cellCount || g.length;
    // cellToUnits[i] = массив индексов unit'ов в которые входит i
    const cellToUnits = new Array(N);
    for (let i = 0; i < N; i++) cellToUnits[i] = [];
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      for (let k = 0; k < unit.length; k++) cellToUnits[unit[k]].push(u);
    }
    for (let i = 0; i < N; i++) {
      const v = g[i];
      if (v !== 0) {
        const bit = 1 << (v - 1);
        const us = cellToUnits[i];
        for (let k = 0; k < us.length; k++) unitMask[us[k]] &= ~bit;
      }
    }
    return { unitMask: unitMask, cellToUnits: cellToUnits };
  }

  function _solveImpl(g, maxSolutions, randomize, rng, variant) {
    if (!variant) variant = ClassicVariant;
    const N = variant.cellCount || g.length;
    const masks = buildGenericMasks(g, variant);
    const solutions = [];
    const hasExtra = typeof variant.extraConstraintsOk === 'function';

    function recurse() {
      if (solutions.length >= maxSolutions) return;

      // MRV: ячейка с минимальным числом кандидатов.
      let best = -1, bestCount = 99, bestMask = 0;
      for (let i = 0; i < N; i++) {
        if (g[i] !== 0) continue;
        let m = ~0;
        const us = masks.cellToUnits[i];
        for (let k = 0; k < us.length; k++) m &= masks.unitMask[us[k]];
        m &= (variant.ALL_MASK || ALL);
        const cnt = bitCount(m);
        if (cnt === 0) return;
        if (cnt < bestCount) {
          best = i; bestCount = cnt; bestMask = m;
          if (cnt === 1) break;
        }
      }
      if (best === -1) {
        // Все клетки заполнены — проверяем extra-constraints (Kropki и др).
        if (hasExtra && !variant.extraConstraintsOk(g)) return;
        solutions.push(g.slice());
        return;
      }

      const digits = [];
      for (let d = 0; d < (variant.size || 9); d++) {
        if ((bestMask >> d) & 1) digits.push(d + 1);
      }
      if (randomize) {
        for (let i = digits.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const t = digits[i]; digits[i] = digits[j]; digits[j] = t;
        }
      }

      const us = masks.cellToUnits[best];
      for (let k = 0; k < digits.length; k++) {
        const d = digits[k];
        const bit = 1 << (d - 1);
        g[best] = d;
        // Опциональный pre-check: extra-constraints для частично-заполненного g
        if (hasExtra && variant.extraPreCheck && !variant.extraPreCheck(g, best, d)) {
          g[best] = 0;
          continue;
        }
        for (let u = 0; u < us.length; u++) masks.unitMask[us[u]] &= ~bit;
        recurse();
        for (let u = 0; u < us.length; u++) masks.unitMask[us[u]] |= bit;
        g[best] = 0;
        if (solutions.length >= maxSolutions) return;
      }
    }

    recurse();
    return solutions;
  }

  function solve(grid, variant, rng) {
    const g = cloneGrid(grid);
    const sols = _solveImpl(g, 1, !!rng, rng || Math.random, variant);
    return sols.length ? sols[0] : null;
  }

  function countSolutions(grid, max, variant) {
    if (typeof max !== 'number') max = 2;
    const g = cloneGrid(grid);
    const sols = _solveImpl(g, max, false, Math.random, variant);
    return sols.length;
  }

  function isComplete(grid) {
    for (let i = 0; i < 81; i++) if (grid[i] === 0) return false;
    // Дополнительно: проверка что нет конфликтов
    for (let u = 0; u < ClassicVariant.allUnits().length; u++) {
      const unit = ClassicVariant.allUnits()[u];
      const seen = new Set();
      for (let k = 0; k < unit.length; k++) {
        const v = grid[unit[k]];
        if (seen.has(v)) return false;
        seen.add(v);
      }
    }
    return true;
  }

  return {
    // utils
    idx: idx,
    rc: rc,
    boxOf: boxOf,
    cloneGrid: cloneGrid,
    emptyGrid: emptyGrid,
    gridFromString: gridFromString,
    gridToString: gridToString,
    bitCount: bitCount,
    lowestBit: lowestBit,
    ALL_MASK: ALL,
    // variant
    ClassicVariant: ClassicVariant,
    // solver
    solve: solve,
    countSolutions: countSolutions,
    isComplete: isComplete
  };
})();
