/**
 * sudokuVariants.js — реестр variant'ов (стратегий) для разных режимов Sudoku.
 *
 * Каждый variant — объект, описывающий геометрию и ограничения поля. Он передаётся
 * в SudokuCore (solver/countSolutions) и SudokuGenerator. Поля variant'а:
 *
 *   name        : string — короткий уникальный ключ ('classic', 'diagonal', ...)
 *   size        : 9       — размер стороны (для мини будет 4)
 *   boxRows     : 3       — высота блока
 *   boxCols     : 3       — ширина блока
 *   cellCount   : 81
 *   ALL_MASK    : 0x1FF   — bitmask «все цифры доступны»
 *   digits      : [1..9]
 *   unitsForCell(i)  → массив unit'ов, в которые входит клетка i (для use в techniques)
 *   peersForCell(i)  → массив пиров (соседей по любому unit'у)
 *   allUnits()       → массив всех unit'ов (для buildMasks в core solver)
 *   rowsAndCols()    → {rows, cols, boxes} — для техник, использующих эту структуру
 *   isLegal(g,i,d)   → можно ли поставить d в i (не нарушает variant constraints)
 *   seedGrid()       → null | number[81] — быстрый seed для seed-transform.
 *                       Если null — generator использует backtracking от пустой сетки.
 *
 * API:
 *   SudokuVariants.byMode(modeKey) → variant
 *   SudokuVariants.Classic / Diagonal / Center / Windoku / ... — прямые ссылки
 */
window.SudokuVariants = (function () {
  const Core = window.SudokuCore;
  const Classic = Core.ClassicVariant;

  // ===== Утилита: добавить дополнительные unit'ы к Classic =====
  // Возвращает новый variant, где `extraUnits` — массив дополнительных unit'ов
  // (списков индексов). unitsForCell / peersForCell / allUnits / isLegal сами
  // подбирают их и расширяют поведение классики.
  function extendClassic(extra) {
    const extraUnits = extra.units || [];
    const name = extra.name;
    const seed = extra.seedGrid !== undefined ? extra.seedGrid : null;

    // Предвычисленные peer-сеты для каждой extra unit
    const cellInExtra = new Array(81);
    for (let i = 0; i < 81; i++) cellInExtra[i] = [];
    for (let u = 0; u < extraUnits.length; u++) {
      const unit = extraUnits[u];
      for (let k = 0; k < unit.length; k++) {
        cellInExtra[unit[k]].push(u);
      }
    }

    return {
      name: name,
      size: 9, boxRows: 3, boxCols: 3, cellCount: 81,
      ALL_MASK: 0x1FF,
      digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      seedGrid: seed,

      unitsForCell: function (i) {
        const base = Classic.unitsForCell(i).slice();
        const ids = cellInExtra[i];
        for (let k = 0; k < ids.length; k++) base.push(extraUnits[ids[k]]);
        return base;
      },
      peersForCell: function (i) {
        const set = new Set(Classic.peersForCell(i));
        const ids = cellInExtra[i];
        for (let k = 0; k < ids.length; k++) {
          const unit = extraUnits[ids[k]];
          for (let m = 0; m < unit.length; m++) if (unit[m] !== i) set.add(unit[m]);
        }
        return Array.from(set);
      },
      allUnits: function () {
        return Classic.allUnits().concat(extraUnits);
      },
      rowsAndCols: Classic.rowsAndCols,
      isLegal: function (g, i, d) {
        if (!Classic.isLegal(g, i, d)) return false;
        const ids = cellInExtra[i];
        for (let k = 0; k < ids.length; k++) {
          const unit = extraUnits[ids[k]];
          for (let m = 0; m < unit.length; m++) {
            if (unit[m] !== i && g[unit[m]] === d) return false;
          }
        }
        return true;
      }
    };
  }

  // ===== Diagonal: классика + 2 главных диагонали =====
  const mainDiag = [];   // (0,0), (1,1), ..., (8,8)
  const antiDiag = [];   // (0,8), (1,7), ..., (8,0)
  for (let r = 0; r < 9; r++) {
    mainDiag.push(r * 9 + r);
    antiDiag.push(r * 9 + (8 - r));
  }
  const Diagonal = extendClassic({
    name: 'diagonal',
    units: [mainDiag, antiDiag]
    // seedGrid = null → backtracking
  });

  // ===== Center: классика + unit из 9 центральных клеток блоков 3×3 =====
  // Центры блоков: (r,c) где r%3===1 && c%3===1 → indices 10,13,16,37,40,43,64,67,70
  const centerUnit = [];
  for (let r = 1; r < 9; r += 3) {
    for (let c = 1; c < 9; c += 3) centerUnit.push(r * 9 + c);
  }
  const Center = extendClassic({
    name: 'center',
    units: [centerUnit]
  });

  // ===== Windoku: классика + 4 внутренних зоны 3×3 =====
  // Зоны на координатах (1..3, 1..3), (1..3, 5..7), (5..7, 1..3), (5..7, 5..7)
  // (0-indexed). Это 4 квадрата 3×3 не пересекающиеся с обычными blocks.
  function makeBox(r0, c0) {
    const cells = [];
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) cells.push((r0 + dr) * 9 + (c0 + dc));
    }
    return cells;
  }
  const windokuUnits = [
    makeBox(1, 1), makeBox(1, 5),
    makeBox(5, 1), makeBox(5, 5)
  ];
  const Windoku = extendClassic({
    name: 'windoku',
    units: windokuUnits
  });

  // ===== Kropki (Точки) =====
  //
  // На границах между некоторыми соседними клетками рисуются кружочки:
  //   ○ (пустой)     — цифры в соседних клетках отличаются на 1 (consecutive)
  //   ● (закрашенный) — одна цифра вдвое больше другой (double)
  // Если относится и то и другое (например 1 и 2: |1-2|=1 И 2=2·1) — выигрывает
  // double (●). Если ни то ни другое — точки нет.
  //
  // В positive-only варианте (наш v1) все relations показаны, поэтому puzzle
  // решается просто по правилам классики + видимым подсказкам. В будущем можно
  // подключить negative-constraint (отсутствие точки = соседние цифры НЕ
  // consecutive И НЕ ×2) — это сделает режим значительно сложнее.
  //
  // computeKropkiDots(solution) → массив { idx1, idx2, type: 'consec'|'double' }
  // makeKropki(dots) → variant, котоый помимо classic constraints учитывает dots
  //                    через extraPreCheck/extraConstraintsOk (см. sudokuCore.js).

  function relationOf(a, b) {
    if (a === 0 || b === 0) return null;
    if (a === 2 * b || b === 2 * a) return 'double';
    if (Math.abs(a - b) === 1)      return 'consec';
    return null;
  }

  function computeKropkiDots(grid) {
    const dots = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        // Право
        if (c < 8) {
          const j = i + 1;
          const t = relationOf(grid[i], grid[j]);
          if (t) dots.push({ idx1: i, idx2: j, type: t, side: 'right' });
        }
        // Низ
        if (r < 8) {
          const j = i + 9;
          const t = relationOf(grid[i], grid[j]);
          if (t) dots.push({ idx1: i, idx2: j, type: t, side: 'bottom' });
        }
      }
    }
    return dots;
  }

  function makeKropki(dots) {
    const cellDots = new Array(81);
    for (let i = 0; i < 81; i++) cellDots[i] = [];
    for (let k = 0; k < dots.length; k++) {
      const d = dots[k];
      cellDots[d.idx1].push(d);
      cellDots[d.idx2].push(d);
    }
    function checkRel(a, b, type) {
      if (a === 0 || b === 0) return true;     // не оба placed → ok пока
      if (type === 'consec') return Math.abs(a - b) === 1;
      if (type === 'double') return a === 2 * b || b === 2 * a;
      return true;
    }
    const base = Classic;
    return {
      name: 'kropki',
      size: 9, boxRows: 3, boxCols: 3, cellCount: 81,
      ALL_MASK: 0x1FF,
      digits: base.digits,
      unitsForCell: base.unitsForCell,
      peersForCell: base.peersForCell,
      allUnits: base.allUnits,
      rowsAndCols: base.rowsAndCols,
      isLegal: function (g, i, d) {
        if (!base.isLegal(g, i, d)) return false;
        const ds = cellDots[i];
        for (let k = 0; k < ds.length; k++) {
          const dot = ds[k];
          const other = (dot.idx1 === i) ? g[dot.idx2] : g[dot.idx1];
          if (other !== 0 && !checkRel(d, other, dot.type)) return false;
        }
        return true;
      },
      // Hook'и для generic solver — он сам зовёт extraPreCheck при placement
      // и extraConstraintsOk на полностью-заполненной сетке.
      extraPreCheck: function (g, idx, d) {
        const ds = cellDots[idx];
        for (let k = 0; k < ds.length; k++) {
          const dot = ds[k];
          const other = (dot.idx1 === idx) ? g[dot.idx2] : g[dot.idx1];
          if (other !== 0 && !checkRel(d, other, dot.type)) return false;
        }
        return true;
      },
      extraConstraintsOk: function (g) {
        for (let k = 0; k < dots.length; k++) {
          const dot = dots[k];
          if (!checkRel(g[dot.idx1], g[dot.idx2], dot.type)) return false;
        }
        return true;
      },
      seedGrid: null,
      _dots: dots
    };
  }

  // Карта mode-key → variant. Используется в Game.startNewLevel
  // и в auto-resume при load active.
  // Для Kropki dots зависят от конкретного solution, поэтому byMode возвращает
  // «базовый» classic variant, а Game.startNewLevel сам делает computeKropkiDots
  // + makeKropki после того как solution сгенерирован.
  function byMode(modeKey) {
    switch (modeKey) {
      case 'diagonal': return Diagonal;
      case 'center':   return Center;
      case 'windoku':  return Windoku;
      case 'kropki':   return Classic;            // см. Game.startNewLevel kropki-path
      // case 'sugur':   return Sugur;
      // case 'chain':   return Chain;
      // case 'mini':    return Mini;
      case 'classic':
      default:         return Classic;
    }
  }

  return {
    Classic: Classic,
    Diagonal: Diagonal,
    Center: Center,
    Windoku: Windoku,
    extendClassic: extendClassic,
    byMode: byMode,
    // Kropki API
    computeKropkiDots: computeKropkiDots,
    makeKropki: makeKropki,
    relationOf: relationOf,
    // Доп. справка: метаданные клеток для UI (рендерим тонировку и т.п.)
    META: {
      diagonal: {
        diagCells: function (i) {
          const r = Math.floor(i / 9), c = i % 9;
          return { main: r === c, anti: r + c === 8 };
        }
      },
      center: {
        isCenterCell: function (i) {
          const r = Math.floor(i / 9), c = i % 9;
          return r % 3 === 1 && c % 3 === 1;
        }
      },
      windoku: {
        zoneOf: function (i) {
          const r = Math.floor(i / 9), c = i % 9;
          if (r >= 1 && r <= 3 && c >= 1 && c <= 3) return 0;
          if (r >= 1 && r <= 3 && c >= 5 && c <= 7) return 1;
          if (r >= 5 && r <= 7 && c >= 1 && c <= 3) return 2;
          if (r >= 5 && r <= 7 && c >= 5 && c <= 7) return 3;
          return -1;
        }
      }
    }
  };
})();
