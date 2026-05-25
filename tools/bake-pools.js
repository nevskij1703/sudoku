/**
 * tools/bake-pools.js — оффлайн-генератор пула уровней для Sugur и Chain.
 *
 * Зачем нужно: on-the-fly генерация sugur/chain с настоящими разнообразными
 * формами регионов медленная и не всегда находит solvable layout за разумное
 * время. Поэтому генерим pool заранее, прямо в node, без time-budget'а
 * — и затем подсовываем готовые puzzles в Game.startNewLevel.
 *
 * Алгоритм:
 *   1. Создаём random layout — 9 регионов по 9 cells, 4-conn (sugur) или
 *      8-conn (chain). Используется BFS-expansion + ham-path для каждого
 *      региона. Жёсткий cap: не более 3 cells одной строки/столбца в
 *      регионе (иначе constraint-conflict со стандартным sudoku).
 *   2. Решаем through stochastic local search: стартуем с random latin
 *      square (правильные rows/cols), считаем конфликты внутри snake-
 *      regions, пытаемся swap внутри row или col для уменьшения конфликтов.
 *      Simulated annealing с тейп-параметром. Намного эффективнее backtracking
 *      для cross-constraint задач.
 *   3. Carve cells пока решение остаётся уникальным.
 *
 * Запуск:
 *   cd 06_Sudoku
 *   node tools/bake-pools.js
 *
 * Результат: пишет в ../precomputedPools.js полный JS-модуль на
 *   window.PrecomputedPools = { sugur: {easy:[],medium:[],hard:[]}, chain: {...} }
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const ctx = {
  window: {},
  console: console,
  Math: Math,
  Date: Date,
  Set: Set,
  Map: Map,
  Array: Array,
  Object: Object,
  Number: Number,
  Infinity: Infinity,
};
vm.createContext(ctx);

['sudokuCore.js', 'sudokuVariants.js'].forEach((f) => {
  const code = fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
});

const SV = ctx.window.SudokuVariants;
const Core = ctx.window.SudokuCore;
if (!SV || !Core) {
  console.error('Failed to load SudokuVariants/SudokuCore');
  process.exit(1);
}

// ===== Helpers =====

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

// ===== Linear-preferred snake growth =====
//
// Стратегия: каждая змейка из 9 cells растится с continuity-бонусом
// (предпочтение продолжать в том же направлении) + Warnsdorff (избегаем
// изоляции остальных) + жёсткий MAX_PER_ROW/COL=4 (минимум 1 turn за 9
// cells). Это даёт ВЫТЯНУТЫЕ змейки разной формы.
//
// Post-checks:
//   isStretched — bbox региона хотя бы в одной dimension ≥ 4 cells.
//                 Исключает 3×3-квадраты (визуально = классика).
//   hasDiagonal — для chain (8-conn): хотя бы 1 диагональный edge
//                 в path. Гарантирует что цепочка использует диагональ.

const DR4 = [-1, 1, 0, 0];
const DC4 = [0, 0, -1, 1];
const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];

function dirIdx(from, to, DR, DC) {
  const dr = (to / 9 | 0) - (from / 9 | 0);
  const dc = (to % 9) - (from % 9);
  for (let d = 0; d < DR.length; d++) {
    if (DR[d] === dr && DC[d] === dc) return d;
  }
  return -1;
}

function freeNeighbors(cell, occupied, DR, DC) {
  const r = cell / 9 | 0, c = cell % 9;
  const out = [];
  for (let d = 0; d < DR.length; d++) {
    const nr = r + DR[d], nc = c + DC[d];
    if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
    const n = nr * 9 + nc;
    if (!occupied[n]) out.push(n);
  }
  return out;
}

// continuity=10 — preference продолжать direction (без полностью прямых линий)
// warnsdorff=3 — предпочитаем cells с малым числом свободных соседей
// noise=10 — случайный tiebreak для variation
// maxPerRow/Col=4 — хотя бы 1 turn за 9 cells (snake не выпрямится в строку)
const SNAKE_PARAMS = { continuity: 10, warnsdorff: 3, noise: 10, maxPerRow: 4, maxPerCol: 4 };

function growStretchedSnake(seed, length, connectivity, occupied, rng) {
  const DR = connectivity === '8' ? DR8 : DR4;
  const DC = connectivity === '8' ? DC8 : DC4;
  const path = [seed];
  occupied[seed] = true;
  const rowCount = new Array(9).fill(0);
  const colCount = new Array(9).fill(0);
  rowCount[seed / 9 | 0] = 1;
  colCount[seed % 9] = 1;
  let prevDir = -1;
  while (path.length < length) {
    const head = path[path.length - 1];
    const free = freeNeighbors(head, occupied, DR, DC);
    const allowed = free.filter(function (n) {
      const nr = n / 9 | 0, nc = n % 9;
      return rowCount[nr] < SNAKE_PARAMS.maxPerRow && colCount[nc] < SNAKE_PARAMS.maxPerCol;
    });
    const candidates = allowed.length > 0 ? allowed : free;
    if (candidates.length === 0) {
      for (const c of path) occupied[c] = false;
      return null;
    }
    const scored = candidates.map(function (n) {
      const dir = dirIdx(head, n, DR, DC);
      let s = 0;
      if (dir === prevDir && prevDir !== -1) s += SNAKE_PARAMS.continuity;
      const nFree = freeNeighbors(n, occupied, DR, DC).filter(function (x) {
        return x !== head;
      }).length;
      s += (DR.length - nFree) * SNAKE_PARAMS.warnsdorff;
      s += rng() * SNAKE_PARAMS.noise;
      return { n: n, s: s, dir: dir };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    const pick = scored[0];
    path.push(pick.n);
    occupied[pick.n] = true;
    rowCount[pick.n / 9 | 0]++;
    colCount[pick.n % 9]++;
    prevDir = pick.dir;
  }
  return path;
}

function chooseSeed(occupied, DR, DC, rng) {
  let bestDeg = 99;
  const candidates = [];
  for (let i = 0; i < 81; i++) {
    if (occupied[i]) continue;
    const deg = freeNeighbors(i, occupied, DR, DC).length;
    if (deg < bestDeg) { bestDeg = deg; candidates.length = 0; candidates.push(i); }
    else if (deg === bestDeg) { candidates.push(i); }
  }
  return candidates.length ? candidates[Math.floor(rng() * candidates.length)] : -1;
}

function isStretched(region) {
  let rMin = 9, rMax = -1, cMin = 9, cMax = -1;
  for (const i of region) {
    const r = i / 9 | 0, c = i % 9;
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (c < cMin) cMin = c; if (c > cMax) cMax = c;
  }
  return Math.max(rMax - rMin, cMax - cMin) + 1 >= 4;
}

function hasDiagonal(path) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dr = Math.abs((a / 9 | 0) - (b / 9 | 0));
    const dc = Math.abs((a % 9) - (b % 9));
    if (dr === 1 && dc === 1) return true;
  }
  return false;
}

function generateStretchedLayout(connectivity, rng) {
  const DR = connectivity === '8' ? DR8 : DR4;
  const DC = connectivity === '8' ? DC8 : DC4;
  const requireDiagonal = connectivity === '8';
  const deadline = Date.now() + 10000;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    const occupied = new Array(81).fill(false);
    const regions = [];
    let ok = true;
    for (let s = 0; s < 9; s++) {
      const seed = chooseSeed(occupied, DR, DC, rng);
      if (seed < 0) { ok = false; break; }
      const path = growStretchedSnake(seed, 9, connectivity, occupied, rng);
      if (!path) { ok = false; break; }
      if (!isStretched(path)) { ok = false; break; }
      if (requireDiagonal && !hasDiagonal(path)) { ok = false; break; }
      regions.push(path);
    }
    if (!ok) {
      for (let i = 0; i < 81; i++) occupied[i] = false;
      continue;
    }
    let cnt = 0;
    for (let i = 0; i < 81; i++) if (occupied[i]) cnt++;
    if (cnt === 81) return { regions: regions, attempts: attempts };
  }
  return null;
}

// ===== Legacy: классические 3×3 + diversify (для совместимости, не используется) =====

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

function isConnected(cells, connectivity) {
  if (cells.length === 0) return true;
  const cellSet = new Set(cells);
  const DR4 = [-1, 1, 0, 0];
  const DC4 = [0, 0, -1, 1];
  const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DR = connectivity === '8' ? DR8 : DR4;
  const DC = connectivity === '8' ? DC8 : DC4;
  const start = cells[0];
  const visited = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    const r = Math.floor(cur / 9), c = cur % 9;
    for (let d = 0; d < DR.length; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      const n = nr * 9 + nc;
      if (cellSet.has(n) && !visited.has(n)) {
        visited.add(n);
        stack.push(n);
      }
    }
  }
  return visited.size === cells.length;
}

// Diversify через two-step migration:
//   Step 1: cell i ∈ sA переходит в соседнюю sB. sA теряет cell, sB
//           получает (sA: 8, sB: 10).
//   Step 2: cell j ∈ sB (новой), не равная i, на границе с sA, переходит
//           обратно в sA. (sA: 9, sB: 9).
// Это правильный способ "swap" между двумя regions, не требующий чтобы i
// и j были непосредственно соседями. Сохраняет connectivity если обе
// промежуточные конфигурации связны (проверяем isConnected на каждом step).
//
// Single-cell migration (одиночный, не пара) разрешён только когда
// размер регионов потом восстанавливается на step 2. Если step 2 не
// удался — revert step 1 целиком.
function diversifyFromBlocks(regions, connectivity, rng, swapCount) {
  rng = rng || Math.random;
  const cellRegion = new Array(81);
  for (let s = 0; s < 9; s++) for (const i of regions[s]) cellRegion[i] = s;
  const DR4 = [-1, 1, 0, 0];
  const DC4 = [0, 0, -1, 1];
  const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DR = connectivity === '8' ? DR8 : DR4;
  const DC = connectivity === '8' ? DC8 : DC4;
  function neighborsOfCell(cell) {
    const r = Math.floor(cell / 9), c = cell % 9;
    const out = [];
    for (let d = 0; d < DR.length; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      out.push(nr * 9 + nc);
    }
    return out;
  }
  let accepted = 0;
  for (let attempt = 0; attempt < swapCount * 100 && accepted < swapCount; attempt++) {
    // Step 1: random cell i ∈ random region sA, move to adjacent region sB.
    const i = Math.floor(rng() * 81);
    const sA = cellRegion[i];
    // Find адекватный sB (соседний регион cell i)
    const otherRegions = new Set();
    for (const n of neighborsOfCell(i)) {
      if (cellRegion[n] !== sA) otherRegions.add(cellRegion[n]);
    }
    if (otherRegions.size === 0) continue;
    const otherArr = Array.from(otherRegions);
    const sB = otherArr[Math.floor(rng() * otherArr.length)];
    // Проверяем что sA остаётся connected после удаления i
    const newA8 = regions[sA].filter(function (x) { return x !== i; });
    if (!isConnected(newA8, connectivity)) continue;
    // Step 2: find cell j ∈ original sB на границе с newA8 (cells of newA8).
    // newA8 + cell j (если j == i, тогда swap=identity и не интересен).
    cellRegion[i] = sB;
    const newAcells = new Set(newA8);
    const boundaryJs = [];
    for (const cell of regions[sB]) {
      // cell должен быть != i (i не в sB изначально, но защитная проверка)
      if (cell === i) continue;
      // cell должен иметь 4-соседа в newAcells
      for (const n of neighborsOfCell(cell)) {
        if (newAcells.has(n)) { boundaryJs.push(cell); break; }
      }
    }
    if (boundaryJs.length === 0) { cellRegion[i] = sA; continue; }
    const j = boundaryJs[Math.floor(rng() * boundaryJs.length)];
    // Проверяем что sB остаётся connected после удаления j (sB сейчас = original sB + i, minus j)
    cellRegion[j] = sA;
    const newB = [], newA = [];
    for (let k = 0; k < 81; k++) {
      if (cellRegion[k] === sA) newA.push(k);
      if (cellRegion[k] === sB) newB.push(k);
    }
    if (newA.length !== 9 || newB.length !== 9) {
      cellRegion[i] = sA; cellRegion[j] = sB; continue;
    }
    if (!isConnected(newB, connectivity)) {
      cellRegion[i] = sA; cellRegion[j] = sB; continue;
    }
    // Accept
    regions[sA] = newA;
    regions[sB] = newB;
    accepted++;
  }
  return { regions: regions, swaps: accepted };
}

function partitionInto9Regions(rng, connectivity) {
  rng = rng || Math.random;
  const FIXED_SEEDS = [10, 13, 16, 37, 40, 43, 64, 67, 70];
  const DR4 = [-1, 1, 0, 0];
  const DC4 = [0, 0, -1, 1];
  const DR8 = [-1, -1, -1,  0, 0,  1, 1, 1];
  const DC8 = [-1,  0,  1, -1, 1, -1, 0, 1];
  const DR = connectivity === '8' ? DR8 : DR4;
  const DC = connectivity === '8' ? DC8 : DC4;
  const MAX_PER_ROW = 3;
  const MAX_PER_COL = 3;
  for (let attempt = 0; attempt < 400; attempt++) {
    const cellRegion = new Array(81).fill(-1);
    const regions = [[], [], [], [], [], [], [], [], []];
    const rowCount = [];
    const colCount = [];
    for (let s = 0; s < 9; s++) {
      rowCount.push(new Array(9).fill(0));
      colCount.push(new Array(9).fill(0));
    }
    for (let s = 0; s < 9; s++) {
      const seed = FIXED_SEEDS[s];
      cellRegion[seed] = s;
      regions[s].push(seed);
      rowCount[s][Math.floor(seed / 9)]++;
      colCount[s][seed % 9]++;
    }
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
        const adj1 = [];
        const adj2 = [];
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
            if (rowCount[s][nr] >= MAX_PER_ROW) continue;
            if (colCount[s][nc] >= MAX_PER_COL) continue;
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
        rowCount[s][Math.floor(next / 9)]++;
        colCount[s][next % 9]++;
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
  const startCandidates = shuffle(region, rng);
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
    const nbrs = shuffle(neighborsInRegion(cur), rng);
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

// Sugur layout: linear-preferred growth (4-conn) + isStretched constraint.
// Каждая змейка имеет bbox ≥ 4 в одной dimension → нет 3×3 квадратов.
function bakeSugurLayout(rng) {
  const result = generateStretchedLayout('4', rng);
  if (!result) return null;
  const paths = result.regions;
  const cellSnake = new Array(81).fill(-1);
  const snakeCells = [];
  for (let s = 0; s < 9; s++) {
    snakeCells.push(paths[s].slice());
    for (let k = 0; k < paths[s].length; k++) cellSnake[paths[s][k]] = s;
  }
  return { cellSnake: cellSnake, snakeCells: snakeCells, attempts: result.attempts };
}

// Chain layout: linear-preferred growth (8-conn) + isStretched + hasDiagonal.
// 8-conn даёт диагональные edges; hasDiagonal constraint гарантирует, что
// каждая цепочка реально использует диагональ (хотя бы 1 edge).
function bakeChainLayout(rng) {
  const result = generateStretchedLayout('8', rng);
  if (!result) return null;
  const paths = result.regions;
  const cellChain = new Array(81).fill(-1);
  const chainCells = [];
  const edges = [];
  for (let s = 0; s < 9; s++) {
    chainCells.push(paths[s].slice());
    for (let k = 0; k < paths[s].length; k++) cellChain[paths[s][k]] = s;
    for (let i = 1; i < paths[s].length; i++) edges.push([paths[s][i - 1], paths[s][i]]);
  }
  return { cellChain: cellChain, chainCells: chainCells, edges: edges, attempts: result.attempts };
}

// ===== Bake-runner =====
// Bakery теперь ПРОЩЕ: только solution + layout (без carve). Game.startNewLevel
// делает random relabel + random carve на лету. Это даёт unlimited unique
// puzzles из конечного пула болванок.

function bakeOne(mode, rng) {
  for (let layoutTry = 0; layoutTry < 30; layoutTry++) {
    const layout = (mode === 'sugur') ? bakeSugurLayout(rng) : bakeChainLayout(rng);
    if (!layout) continue;
    const variant = (mode === 'sugur')
      ? SV.makeSugur(layout.snakeCells, layout.cellSnake)
      : SV.makeChain(layout.chainCells, layout.cellChain, layout.edges);

    // Решаем пустую сетку через generic solver. Большой timeout (60s) —
    // мы оффлайн, можем подождать. С хорошим layout solver обычно
    // находит решение за <1s, плохой layout — никогда. 60s — отсечка.
    const t0 = Date.now();
    const sol = Core.solve(new Array(81).fill(0), variant, rng, {
      maxMs: 60000, maxNodes: 10000000
    });
    const solveMs = Date.now() - t0;
    if (!sol) {
      console.log('  layout ' + layoutTry + ' UNSOLVABLE in ' + solveMs + 'ms, retry');
      continue;
    }
    console.log('  layout ' + layoutTry + ' solved in ' + solveMs + 'ms');

    const result = { solution: sol, mode: mode };
    if (mode === 'sugur') {
      result.cellSnake = layout.cellSnake;
      result.snakeCells = layout.snakeCells;
    } else {
      result.cellChain = layout.cellChain;
      result.chainCells = layout.chainCells;
      result.edges = layout.edges;
    }
    return result;
  }
  return null;
}

function bakeAll() {
  const pools = { sugur: [], chain: [] };
  const COUNT = 25;
  for (const mode of ['sugur', 'chain']) {
    console.log('=== Baking ' + mode + ' (' + COUNT + ' templates) ===');
    for (let n = 0; n < COUNT; n++) {
      console.log('template ' + (n + 1) + '/' + COUNT + '...');
      const t0 = Date.now();
      const tpl = bakeOne(mode, Math.random);
      const t1 = Date.now();
      if (!tpl) {
        console.error('  FAILED');
        continue;
      }
      console.log('  done in ' + (t1 - t0) + 'ms');
      pools[mode].push(tpl);
    }
  }
  return pools;
}

function writeOutput(pools) {
  const outPath = path.join(PROJECT_ROOT, 'precomputedPools.js');
  const header = `/**
 * precomputedPools.js — пре-сгенерированные ШАБЛОНЫ для Sugur и Chain.
 *
 * Создан скриптом tools/bake-pools.js (см. его docstring).
 *
 * Структура:
 *   PrecomputedPools = {
 *     sugur: [25 шаблонов],
 *     chain: [25 шаблонов]
 *   }
 * Каждый шаблон:
 *   { solution: number[81], mode: string,
 *     cellSnake/cellChain: number[81], snakeCells/chainCells: array[9][9],
 *     edges?: array<[number,number]>  // только для chain }
 *
 * Game.startNewLevel берёт шаблон по очереди (counter в Storage), делает
 * random relabel цифр (perm 1-9) и случайно открывает N cells по сложности.
 * Это даёт практически unlimited unique puzzles из конечного пула.
 */
window.PrecomputedPools = `;
  const body = JSON.stringify(pools, null, 2);
  fs.writeFileSync(outPath, header + body + ';\n', 'utf8');
  console.log('\nWritten: ' + outPath + ' (' + fs.statSync(outPath).size + ' bytes)');
}

console.log('Sudoku pool baker started');
console.log('Project root: ' + PROJECT_ROOT);
const totalStart = Date.now();
const pools = bakeAll();
const totalMs = Date.now() - totalStart;
console.log('\n=== Summary ===');
for (const mode of Object.keys(pools)) {
  console.log(mode + ': ' + pools[mode].length + ' templates');
}
console.log('Total time: ' + (totalMs / 1000).toFixed(1) + 's');
writeOutput(pools);
