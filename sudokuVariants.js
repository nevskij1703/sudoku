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

  // ===== Sugur — змейки вместо квадратов 3×3 =====
  //
  // Поле 9×9 делится на 9 ломаных «змеек» по 9 клеток каждая. Цифры не должны
  // повторяться по строкам, столбцам и в рамках одной змейки.
  //
  // Генератор раскладки змеек (snakes-layout):
  //   1. Случайно выбираем 9 seed-клеток.
  //   2. BFS-expansion: каждую итерацию расширяем snake с минимальным размером,
  //      пристраивая случайную соседнюю пустую клетку.
  //   3. Если snake застряла без соседей — restart с новыми seed'ами.
  //   4. После 200 retries возвращаем null (fallback на classic boxes).
  //
  // Generator-side: в Game.startNewLevel генерим snakes, создаём concrete
  // SugurVariant и подаём в Gen.generate().

  // Стратегия генерации змеек/цепочек:
  //   1. partitionInto9Regions(rng, connectivity) — BFS-expansion даёт 9
  //      связных регионов по 9 ячеек (любой формы, с возможными ветвлениями).
  //   2. findHamPath(region, connectivity, rng) — DFS со backtracking ищет
  //      Hamiltonian-путь внутри региона. Если не найден — region не годится
  //      как «верёвочка», возвращаем null и пересоздаём partition.
  // Финальный результат — путь из 9 ячеек в каждом регионе, с двумя концами
  // и изгибами только под 90° (для Sugur) или + по диагонали (для Chain).

  function partitionInto9Regions(rng, connectivity) {
    rng = rng || Math.random;
    const FIXED_SEEDS = [10, 13, 16, 37, 40, 43, 64, 67, 70];
    const DR4 = [-1, 1, 0, 0];
    const DC4 = [0, 0, -1, 1];
    const DR8 = [-1, -1, -1,  0, 0,  1, 1, 1];
    const DC8 = [-1,  0,  1, -1, 1, -1, 0, 1];
    const DR = connectivity === '8' ? DR8 : DR4;
    const DC = connectivity === '8' ? DC8 : DC4;
    for (let attempt = 0; attempt < 400; attempt++) {
      const cellRegion = new Array(81).fill(-1);
      const regions = [[], [], [], [], [], [], [], [], []];
      for (let s = 0; s < 9; s++) {
        cellRegion[FIXED_SEEDS[s]] = s;
        regions[s].push(FIXED_SEEDS[s]);
      }
      // helper: сколько соседей у cell n принадлежат региону s (по той же
      // connectivity что и partition). Используем для thin-constraint —
      // отбираем только тех соседей, у которых ≤1 уже в s. Это гарантирует
      // что регион не зарастает в широкий «блок» (2×2 / 3×3 кусками), а
      // остаётся узкой полоской — и в нём почти всегда есть Hamiltonian путь.
      function sameRegionDegree(n, s) {
        const r = Math.floor(n / 9), c = n % 9;
        let cnt = 0;
        for (let d = 0; d < DR.length; d++) {
          const nr = r + DR[d], nc = c + DC[d];
          if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
          if (cellRegion[nr * 9 + nc] === s) cnt++;
        }
        return cnt;
      }
      let stuck = false;
      while (true) {
        let allFull = true;
        for (let s = 0; s < 9; s++) if (regions[s].length < 9) { allFull = false; break; }
        if (allFull) break;
        const order = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(function (a, b) {
          return regions[a].length - regions[b].length;
        });
        let expanded = false;
        for (let oi = 0; oi < order.length; oi++) {
          const s = order[oi];
          if (regions[s].length >= 9) continue;
          const adj1 = [];     // степень=1 (preferred — гарантирует path-likeness)
          const adj2 = [];     // степень=2 (fallback — может создать T-узел, но позволяет завершить partition)
          const seen = new Set();
          for (let k = 0; k < regions[s].length; k++) {
            const cell = regions[s][k];
            const r = Math.floor(cell / 9), c = cell % 9;
            for (let d = 0; d < DR.length; d++) {
              const nr = r + DR[d], nc = c + DC[d];
              if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
              const n = nr * 9 + nc;
              if (cellRegion[n] !== -1) continue;
              if (seen.has(n)) continue;
              seen.add(n);
              const deg = sameRegionDegree(n, s);
              if (deg === 1) adj1.push(n);
              else if (deg === 2) adj2.push(n);
            }
          }
          const adj = adj1.length > 0 ? adj1 : adj2;
          if (adj.length === 0) continue;
          const next = adj[Math.floor(rng() * adj.length)];
          cellRegion[next] = s;
          regions[s].push(next);
          expanded = true;
          break;
        }
        if (!expanded) { stuck = true; break; }
      }
      if (stuck) continue;
      return { cellRegion: cellRegion, regions: regions };
    }
    return null;
  }

  function shuffleArr(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  // Ищет Hamiltonian-путь в подграфе region (9 ячеек) с заданной связностью.
  // DFS с randomized start + randomized neighbor order. Граф маленький
  // (9 cells), поэтому достаточно быстро.
  function findHamPath(region, connectivity, rng) {
    rng = rng || Math.random;
    const regionSet = new Set(region);
    const DR4 = [-1, 1, 0, 0];
    const DC4 = [0, 0, -1, 1];
    const DR8 = [-1, -1, -1,  0, 0,  1, 1, 1];
    const DC8 = [-1,  0,  1, -1, 1, -1, 0, 1];
    const DR = connectivity === '8' ? DR8 : DR4;
    const DC = connectivity === '8' ? DC8 : DC4;
    function neighborsInRegion(cell) {
      const r = Math.floor(cell / 9), c = cell % 9;
      const out = [];
      for (let d = 0; d < DR.length; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
        const n = nr * 9 + nc;
        if (regionSet.has(n)) out.push(n);
      }
      return out;
    }
    const startCandidates = shuffleArr(region, rng);
    for (let si = 0; si < startCandidates.length; si++) {
      const start = startCandidates[si];
      const visited = new Set([start]);
      const path = [start];
      if (dfs(path, visited)) return path;
    }
    return null;

    function dfs(path, visited) {
      if (path.length === regionSet.size) return true;
      const cur = path[path.length - 1];
      const nbrs = shuffleArr(neighborsInRegion(cur), rng);
      for (let k = 0; k < nbrs.length; k++) {
        const n = nbrs[k];
        if (visited.has(n)) continue;
        path.push(n);
        visited.add(n);
        if (dfs(path, visited)) return true;
        path.pop();
        visited.delete(n);
      }
      return false;
    }
  }

  // Возвращает 9 классических 3×3 блоков как массив регионов.
  // Используется для Chain (8-связность — внутри блока ham-path по диагоналям).
  function classicBlockRegions() {
    const regions = [[], [], [], [], [], [], [], [], []];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const s = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        regions[s].push(r * 9 + c);
      }
    }
    return regions;
  }

  // Горизонтальные полосы 9×1 — гарантированно path-shape по 4-conn.
  // Каждая полоса = строка целиком. После swap'ов получаем «верёвочки»
  // с изгибами 90°: стрипка делает уступ туда-сюда. Это нативно «змейка»
  // и user'у должно зайти.
  function horizontalStripeRegions() {
    const regions = [[], [], [], [], [], [], [], [], []];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) regions[r].push(r * 9 + c);
    }
    return regions;
  }

  // Делает несколько случайных swap-операций: меняем пары соседних cells
  // из разных регионов местами, если оба региона остаются связными и
  // имеют Hamiltonian-путь. Это даёт разнообразие форм без потери валидности.
  function diversifyRegions(regions, connectivity, rng, swapAttempts) {
    const cellRegion = new Array(81);
    for (let s = 0; s < 9; s++) for (const i of regions[s]) cellRegion[i] = s;
    const DR4 = [-1, 1, 0, 0];
    const DC4 = [0, 0, -1, 1];
    const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DR = connectivity === '8' ? DR8 : DR4;
    const DC = connectivity === '8' ? DC8 : DC4;
    function neighborsInRegion(cell, target) {
      const r = Math.floor(cell / 9), c = cell % 9;
      const out = [];
      for (let d = 0; d < DR.length; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
        const n = nr * 9 + nc;
        if (cellRegion[n] === target) out.push(n);
      }
      return out;
    }
    function isConnected(cells, target) {
      if (cells.length === 0) return true;
      const visited = new Set([cells[0]]);
      const stack = [cells[0]];
      while (stack.length) {
        const cur = stack.pop();
        for (const n of neighborsInRegion(cur, target)) {
          if (!visited.has(n)) { visited.add(n); stack.push(n); }
        }
      }
      return visited.size === cells.length;
    }
    for (let a = 0; a < swapAttempts; a++) {
      // Найти случайную boundary-пару (cell A в region sA, cell B в region sB ≠ sA, A и B соседи)
      const i = Math.floor(rng() * 81);
      const sA = cellRegion[i];
      const r = Math.floor(i / 9), c = i % 9;
      // Случайный сосед
      const dir = Math.floor(rng() * DR.length);
      const nr = r + DR[dir], nc = c + DC[dir];
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      const j = nr * 9 + nc;
      const sB = cellRegion[j];
      if (sA === sB) continue;
      // Свап
      cellRegion[i] = sB;
      cellRegion[j] = sA;
      // Восстанавливаем регионы
      const newA = [], newB = [];
      for (let k = 0; k < 81; k++) {
        if (cellRegion[k] === sA) newA.push(k);
        if (cellRegion[k] === sB) newB.push(k);
      }
      // Валидация: оба региона должны остаться связными
      if (!isConnected(newA, sA) || !isConnected(newB, sB)) {
        cellRegion[i] = sA;
        cellRegion[j] = sB;
        continue;
      }
      // Дополнительно: оба должны иметь Hamiltonian path в новой форме
      if (!findHamPath(newA, connectivity, rng) || !findHamPath(newB, connectivity, rng)) {
        cellRegion[i] = sA;
        cellRegion[j] = sB;
        continue;
      }
      // accept
      regions[sA] = newA;
      regions[sB] = newB;
    }
    return regions;
  }

  // Sugur layout — классические 3×3 блоки как regions, внутри каждого
  // ищем Hamiltonian-путь по 4-связности (z-shape / S-shape). Так
  // получается визуальная «змейка» внутри привычного блока, и solver
  // работает быстро (snake-constraint = block-constraint).
  // Diversify swaps пока не делаем — там есть риск что constraint
  // меняется и solve уходит в долгий поиск.
  function generateSnakeLayout(rng) {
    rng = rng || Math.random;
    const deadline = Date.now() + 250;
    const regions = classicBlockRegions();
    const paths = [];
    for (let s = 0; s < 9; s++) {
      if (Date.now() > deadline) return null;
      const p = findHamPath(regions[s], '4', rng);
      if (!p) return null;
      paths.push(p);
    }
    const cellSnake = new Array(81).fill(-1);
    const snakeCells = [];
    for (let s = 0; s < 9; s++) {
      snakeCells.push(paths[s].slice());
      for (let k = 0; k < paths[s].length; k++) cellSnake[paths[s][k]] = s;
    }
    return { cellSnake: cellSnake, snakeCells: snakeCells };
  }

  function makeSugur(snakeCells, cellSnake) {
    const rowUnits = [], colUnits = [];
    for (let i = 0; i < 9; i++) {
      const row = [], col = [];
      for (let j = 0; j < 9; j++) {
        row.push(i * 9 + j);
        col.push(j * 9 + i);
      }
      rowUnits.push(row);
      colUnits.push(col);
    }
    const all = rowUnits.concat(colUnits).concat(snakeCells);

    const cellUnits = new Array(81);
    const peers     = new Array(81);
    for (let i = 0; i < 81; i++) {
      cellUnits[i] = [];
      const peerSet = new Set();
      for (let u = 0; u < all.length; u++) {
        if (all[u].indexOf(i) !== -1) {
          cellUnits[i].push(all[u]);
          for (let k = 0; k < all[u].length; k++) if (all[u][k] !== i) peerSet.add(all[u][k]);
        }
      }
      peers[i] = Array.from(peerSet);
    }

    return {
      name: 'sugur',
      size: 9, boxRows: 0, boxCols: 0, cellCount: 81,
      ALL_MASK: 0x1FF,
      digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      skipHumanSolve: true,    // humanSolve не учитывает змейки — пропускаем
      // Для Sugur выбираем givensTarget исходя из общей сложности solver'а
      givensTarget: {
        easy:   [38, 42],
        medium: [32, 36],
        hard:   [26, 30]
      },
      unitsForCell: function (i) { return cellUnits[i]; },
      peersForCell: function (i) { return peers[i]; },
      allUnits: function () { return all; },
      rowsAndCols: function () { return { rows: rowUnits, cols: colUnits, boxes: snakeCells }; },
      isLegal: function (g, i, d) {
        const us = cellUnits[i];
        for (let u = 0; u < us.length; u++) {
          const unit = us[u];
          for (let k = 0; k < unit.length; k++) {
            if (unit[k] !== i && g[unit[k]] === d) return false;
          }
        }
        return true;
      },
      seedGrid: null,
      _snakeCells: snakeCells,
      _cellSnake: cellSnake
    };
  }

  // ===== Chain — цепочки с диагональной связностью =====
  //
  // Идеологически расширение Sugur: 9 цепочек по 9 ячеек, цифры 1-9 не должны
  // повторяться по строкам, столбцам и в каждой цепочке. Отличия:
  //   1. 8-связность: соседство по диагонали тоже считается. Цепочка может
  //      перейти из (3,3) сразу в (4,4) — это разрешено.
  //   2. Визуал: ячейки рендерятся кругами, между связанными парами ячеек
  //      одной цепочки рисуются линии (см. board.js → renderChainEdges).
  //
  // Для отрисовки сохраняем edges — список пар [a, b] из BFS-tree expansion
  // (каждая ячейка кроме seed связана с предком). Получается ровно 8 линий
  // на цепочку = 72 линии на доску, выглядит читаемо.
  //
  // ⚠ «Цепочки могут пересекать друг друга» в нашей v1 трактуется как
  // визуальное пересечение линий (две цепочки идут близко и их рёбра
  // геометрически перекрещиваются), а не как разделение одной ячейки между
  // несколькими цепочками. Последнее ломает баланс sudoku-constraint'ов и
  // оставлено на будущие итерации.
  // Цепочки: тот же sequential path-grow что Sugur, но 8-связность.
  // Edges = последовательные пары ячеек path'а, 8 на цепочку = 72.
  // Chain-layout — простой и надёжный алгоритм:
  //   1. Стартуем с классических 3×3 блоков (instant, всегда работает).
  //   2. Делаем несколько safe-swap'ов между соседними блоками — каждый swap
  //      сохраняет связность обоих и наличие Hamiltonian-пути.
  //   3. Внутри каждого блока ищем Ham-path по 8-связности (всегда есть в
  //      3×3 блоке с 8-conn — там полный граф).
  // На всё — hard deadline 250ms. Backtracking из прошлой реализации
  // мог уходить в экспоненту на bad-luck комбинациях, теперь это исключено.
  // Растит линейную цепочку из ровно 9 cells, начиная от seed.
  // 8-связность + Warnsdorff (next-cell с min free degree снижает шанс
  // изоляции остальных). При тупике делает 1-шаг backtrack.
  // Дополнительное ограничение: в одной строке/столбце не более 3 cells
  // одной цепочки — это исключает «вырожденные» layouts типа «вся
  // цепочка в одной row», которые делают chain-constraint конфликтующим
  // с row/col и солвер не находит решения за reasonable time.
  function growChainPath(occupied, seed, rng) {
    const DR = [-1, -1, -1,  0, 0,  1, 1, 1];
    const DC = [-1,  0,  1, -1, 1, -1, 0, 1];
    const MAX_PER_ROW = 3;
    const MAX_PER_COL = 3;
    function freeNbrs(cell) {
      const r = Math.floor(cell / 9), c = cell % 9;
      const out = [];
      for (let d = 0; d < 8; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
        const n = nr * 9 + nc;
        if (!occupied[n]) out.push(n);
      }
      return out;
    }
    const path = [seed];
    occupied[seed] = true;
    // Счётчики cells цепочки по строкам и столбцам.
    const rowCount = new Array(9).fill(0);
    const colCount = new Array(9).fill(0);
    rowCount[Math.floor(seed / 9)] = 1;
    colCount[seed % 9] = 1;

    let steps = 0;
    while (path.length < 9 && steps < 60) {
      steps++;
      const head = path[path.length - 1];
      const rawCands = freeNbrs(head);
      const cands = [];
      for (let k = 0; k < rawCands.length; k++) {
        const n = rawCands[k];
        const nr = Math.floor(n / 9), nc = n % 9;
        if (rowCount[nr] >= MAX_PER_ROW) continue;
        if (colCount[nc] >= MAX_PER_COL) continue;
        cands.push(n);
      }
      if (cands.length === 0) {
        // тупик — снимаем head и backtrack
        occupied[head] = false;
        rowCount[Math.floor(head / 9)]--;
        colCount[head % 9]--;
        path.pop();
        if (path.length === 0) return null;
        continue;
      }
      // Warnsdorff: minimum free degree
      let minDeg = 99;
      for (let k = 0; k < cands.length; k++) {
        const d = freeNbrs(cands[k]).length;
        if (d < minDeg) minDeg = d;
      }
      const best = [];
      for (let k = 0; k < cands.length; k++) {
        if (freeNbrs(cands[k]).length === minDeg) best.push(cands[k]);
      }
      const pick = best[Math.floor(rng() * best.length)];
      path.push(pick);
      occupied[pick] = true;
      rowCount[Math.floor(pick / 9)]++;
      colCount[pick % 9]++;
    }
    return path.length === 9 ? path : null;
  }

  // Chain layout — настоящие path-shape цепочки с 8-связностью (включая
  // диагональные связи). Каждая цепочка — 9 cells без ветвлений (один
  // start + один end). Формы разные на каждом запуске.
  //
  // Алгоритм: sequential random walk от случайного seed, Warnsdorff's
  // heuristic для выбора next-cell (избегаем изоляции остальных). Если
  // одна цепочка не выросла до 9 — restart всей раскладки. Hard deadline
  // 300ms; внутри одного path-grow есть step-cap чтобы не висеть.
  function generateChainLayout(rng) {
    rng = rng || Math.random;
    const deadline = Date.now() + 300;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (Date.now() > deadline) return null;
      const occupied = new Array(81).fill(false);
      const chains = [];
      let ok = true;
      for (let s = 0; s < 9; s++) {
        // Выбираем seed для следующей цепочки. Чтобы избегать изоляции
        // оставшихся клеток, ищем cell с минимальным числом свободных
        // соседей (corner-first) — это и есть Warnsdorff на старте.
        let seed = -1;
        let minDeg = 99;
        for (let i = 0; i < 81; i++) {
          if (occupied[i]) continue;
          const r = Math.floor(i / 9), c = i % 9;
          let deg = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
            if (!occupied[nr * 9 + nc]) deg++;
          }
          if (deg < minDeg) { minDeg = deg; seed = i; }
        }
        if (seed < 0) { ok = false; break; }
        const path = growChainPath(occupied, seed, rng);
        if (!path) { ok = false; break; }
        chains.push(path);
      }
      if (!ok || chains.length !== 9) continue;
      // Полное покрытие?
      let cnt = 0;
      for (let i = 0; i < 81; i++) if (occupied[i]) cnt++;
      if (cnt !== 81) continue;
      // Готовим результат
      const cellChain = new Array(81).fill(-1);
      const chainCells = [];
      const edges = [];
      for (let s = 0; s < 9; s++) {
        chainCells.push(chains[s].slice());
        for (let k = 0; k < chains[s].length; k++) cellChain[chains[s][k]] = s;
        for (let i = 1; i < chains[s].length; i++) edges.push([chains[s][i - 1], chains[s][i]]);
      }
      return { cellChain: cellChain, chainCells: chainCells, edges: edges };
    }
    return null;
  }

  // Версия diversifyRegions с deadline — выходит из loop когда время вышло.
  function diversifyRegionsTimed(regions, connectivity, rng, swapAttempts, deadline) {
    const cellRegion = new Array(81);
    for (let s = 0; s < 9; s++) for (const i of regions[s]) cellRegion[i] = s;
    const DR4 = [-1, 1, 0, 0];
    const DC4 = [0, 0, -1, 1];
    const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];
    const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DR = connectivity === '8' ? DR8 : DR4;
    const DC = connectivity === '8' ? DC8 : DC4;
    function neighborsInRegion(cell, target) {
      const r = Math.floor(cell / 9), c = cell % 9;
      const out = [];
      for (let d = 0; d < DR.length; d++) {
        const nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
        const n = nr * 9 + nc;
        if (cellRegion[n] === target) out.push(n);
      }
      return out;
    }
    function isConnected(cells, target) {
      if (cells.length === 0) return true;
      const visited = new Set([cells[0]]);
      const stack = [cells[0]];
      while (stack.length) {
        const cur = stack.pop();
        for (const n of neighborsInRegion(cur, target)) {
          if (!visited.has(n)) { visited.add(n); stack.push(n); }
        }
      }
      return visited.size === cells.length;
    }
    for (let a = 0; a < swapAttempts; a++) {
      if (Date.now() > deadline) break;
      const i = Math.floor(rng() * 81);
      const sA = cellRegion[i];
      const r = Math.floor(i / 9), c = i % 9;
      const dir = Math.floor(rng() * DR.length);
      const nr = r + DR[dir], nc = c + DC[dir];
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      const j = nr * 9 + nc;
      const sB = cellRegion[j];
      if (sA === sB) continue;
      cellRegion[i] = sB;
      cellRegion[j] = sA;
      const newA = [], newB = [];
      for (let k = 0; k < 81; k++) {
        if (cellRegion[k] === sA) newA.push(k);
        if (cellRegion[k] === sB) newB.push(k);
      }
      if (!isConnected(newA, sA) || !isConnected(newB, sB)) {
        cellRegion[i] = sA;
        cellRegion[j] = sB;
        continue;
      }
      // Не проверяем ham-path (это можно проверить только дорого) — accepting
      // если регион connected. В 8-conn graph 9-cell region почти всегда
      // имеет Ham-path, риск минимален; finalHam-search все равно найдёт.
      regions[sA] = newA;
      regions[sB] = newB;
    }
    return regions;
  }

  function makeChain(chainCells, cellChain, edges) {
    const rowUnits = [], colUnits = [];
    for (let i = 0; i < 9; i++) {
      const row = [], col = [];
      for (let j = 0; j < 9; j++) {
        row.push(i * 9 + j);
        col.push(j * 9 + i);
      }
      rowUnits.push(row);
      colUnits.push(col);
    }
    const all = rowUnits.concat(colUnits).concat(chainCells);

    const cellUnits = new Array(81);
    const peers     = new Array(81);
    for (let i = 0; i < 81; i++) {
      cellUnits[i] = [];
      const peerSet = new Set();
      for (let u = 0; u < all.length; u++) {
        if (all[u].indexOf(i) !== -1) {
          cellUnits[i].push(all[u]);
          for (let k = 0; k < all[u].length; k++) if (all[u][k] !== i) peerSet.add(all[u][k]);
        }
      }
      peers[i] = Array.from(peerSet);
    }

    return {
      name: 'chain',
      size: 9, boxRows: 0, boxCols: 0, cellCount: 81,
      ALL_MASK: 0x1FF,
      digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      skipHumanSolve: true,
      givensTarget: {
        easy:   [38, 42],
        medium: [32, 36],
        hard:   [26, 30]
      },
      unitsForCell: function (i) { return cellUnits[i]; },
      peersForCell: function (i) { return peers[i]; },
      allUnits: function () { return all; },
      rowsAndCols: function () { return { rows: rowUnits, cols: colUnits, boxes: chainCells }; },
      isLegal: function (g, i, d) {
        const us = cellUnits[i];
        for (let u = 0; u < us.length; u++) {
          const unit = us[u];
          for (let k = 0; k < unit.length; k++) {
            if (unit[k] !== i && g[unit[k]] === d) return false;
          }
        }
        return true;
      },
      seedGrid: null,
      _chainCells: chainCells,
      _cellChain: cellChain,
      _edges: edges
    };
  }

  // ===== Mini 4×4 — режим для начинающих =====
  // Поле 4×4 = 16 ячеек, 4 блока 2×2, цифры 1-4. Совершенно другая геометрия:
  // не extension Classic, а отдельный variant.
  const Mini = (function () {
    const SIZE = 4, BR = 2, BC = 2, N = SIZE * SIZE;
    const ALL_MINI = 0xF;
    const rowUnits = [], colUnits = [], boxUnits = [];
    for (let i = 0; i < SIZE; i++) {
      const row = [], col = [];
      for (let j = 0; j < SIZE; j++) {
        row.push(i * SIZE + j);
        col.push(j * SIZE + i);
      }
      rowUnits.push(row);
      colUnits.push(col);
    }
    for (let br = 0; br < SIZE; br += BR) {
      for (let bc = 0; bc < SIZE; bc += BC) {
        const box = [];
        for (let dr = 0; dr < BR; dr++) {
          for (let dc = 0; dc < BC; dc++) {
            box.push((br + dr) * SIZE + (bc + dc));
          }
        }
        boxUnits.push(box);
      }
    }
    const all = rowUnits.concat(colUnits).concat(boxUnits);

    const cellUnits = new Array(N);
    const peers     = new Array(N);
    for (let i = 0; i < N; i++) {
      cellUnits[i] = [];
      const peerSet = new Set();
      for (let u = 0; u < all.length; u++) {
        const unit = all[u];
        if (unit.indexOf(i) !== -1) {
          cellUnits[i].push(unit);
          for (let k = 0; k < unit.length; k++) if (unit[k] !== i) peerSet.add(unit[k]);
        }
      }
      peers[i] = Array.from(peerSet);
    }

    return {
      name: 'mini',
      size: SIZE, boxRows: BR, boxCols: BC, cellCount: N,
      ALL_MASK: ALL_MINI,
      digits: [1, 2, 3, 4],
      // Для Mini поле 4×4 = 16 ячеек, всё проще: easy/medium/hard разделяем
      // по количеству givens (открытых клеток).
      givensTarget: {
        easy:   [9, 11],
        medium: [7, 8],
        hard:   [5, 6]
      },
      unitsForCell: function (i) { return cellUnits[i]; },
      peersForCell: function (i) { return peers[i]; },
      allUnits: function () { return all; },
      rowsAndCols: function () { return { rows: rowUnits, cols: colUnits, boxes: boxUnits }; },
      isLegal: function (g, i, d) {
        const us = cellUnits[i];
        for (let u = 0; u < us.length; u++) {
          const unit = us[u];
          for (let k = 0; k < unit.length; k++) {
            if (unit[k] !== i && g[unit[k]] === d) return false;
          }
        }
        return true;
      },
      seedGrid: null
    };
  })();

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
      case 'mini':     return Mini;
      // sugur и chain зависят от свежесгенерированной layout-структуры —
      // конкретный variant создаётся в Game.startNewLevel после генерации
      // змеек/цепочек. byMode для них возвращает Classic как safe-fallback.
      case 'sugur':    return Classic;
      case 'chain':    return Classic;
      case 'classic':
      default:         return Classic;
    }
  }

  return {
    Classic: Classic,
    Diagonal: Diagonal,
    Center: Center,
    Windoku: Windoku,
    Mini: Mini,
    extendClassic: extendClassic,
    byMode: byMode,
    // Kropki API
    computeKropkiDots: computeKropkiDots,
    makeKropki: makeKropki,
    relationOf: relationOf,
    // Sugur API
    generateSnakeLayout: generateSnakeLayout,
    makeSugur: makeSugur,
    // Chain API
    generateChainLayout: generateChainLayout,
    makeChain: makeChain,
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
