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

// ===== Партиционирование на 9 регионов =====
//
// Стратегия: стартуем с классических 3×3 blocks (всегда solvable как
// classic sudoku) и делаем N safe-swap'ов между соседними regions.
// Каждый swap сохраняет connectivity обоих regions и наличие ham-path.
// Это даёт layouts ОЧЕНЬ разных форм (после 20-30 swaps), но constraint
// близок к classic и solver работает быстро.

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

// Sugur layout: стартуем с классических 3×3 blocks, делаем swap'ы для
// разнообразия форм. Затем findHamPath по 4-связности.
// Solver на таких layouts работает быстро (constraint близок к classic).
function bakeSugurLayout(rng) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const regions = classicBlockRegions();
    // 8 swap'ов даёт умеренное разнообразие без сильной деформации
    // constraint (≤8 cells меняют region). При большем swap count solver
    // не успевает за 60s.
    const div = diversifyFromBlocks(regions, '4', rng, 8);
    const paths = [];
    let ok = true;
    for (let s = 0; s < 9; s++) {
      const p = findHamPath(div.regions[s], '4', rng);
      if (!p) { ok = false; break; }
      paths.push(p);
    }
    if (!ok) continue;
    const cellSnake = new Array(81).fill(-1);
    const snakeCells = [];
    for (let s = 0; s < 9; s++) {
      snakeCells.push(paths[s].slice());
      for (let k = 0; k < paths[s].length; k++) cellSnake[paths[s][k]] = s;
    }
    return { cellSnake: cellSnake, snakeCells: snakeCells, swaps: div.swaps };
  }
  return null;
}

// Chain layout: то же что Sugur, но 8-связность (диагональные edges).
// Использует diversify-from-blocks с 8-conn, что даёт более экзотические
// формы (regions могут заходить друг в друга по диагонали).
function bakeChainLayout(rng) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const regions = classicBlockRegions();
    // 12 swap'ов с 8-conn (есть диагональные edges) — больше разнообразия
    // чем sugur с 8 swap'ов 4-conn, потому что 8-conn даёт более компактные
    // regions после swap (диагональные cells могут "склеить" растянутый
    // регион).
    const div = diversifyFromBlocks(regions, '8', rng, 12);
    const paths = [];
    let ok = true;
    for (let s = 0; s < 9; s++) {
      const p = findHamPath(div.regions[s], '8', rng);
      if (!p) { ok = false; break; }
      paths.push(p);
    }
    if (!ok) continue;
    const cellChain = new Array(81).fill(-1);
    const chainCells = [];
    const edges = [];
    for (let s = 0; s < 9; s++) {
      chainCells.push(paths[s].slice());
      for (let k = 0; k < paths[s].length; k++) cellChain[paths[s][k]] = s;
      for (let i = 1; i < paths[s].length; i++) edges.push([paths[s][i - 1], paths[s][i]]);
    }
    return { cellChain: cellChain, chainCells: chainCells, edges: edges, swaps: div.swaps };
  }
  return null;
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
