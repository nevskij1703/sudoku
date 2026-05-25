/**
 * tools/preview-layouts.js — генерация и визуализация layouts ДЛЯ АПРУВА.
 *
 * Запуск:
 *   node tools/preview-layouts.js
 *
 * Результат:
 *   - stdout: ASCII-grids всех 6 примеров.
 *   - tools/preview-layouts.html — визуализация в браузере.
 *     Открыть в http://localhost:8776/tools/preview-layouts.html
 */

const fs = require('fs');
const path = require('path');

// Force flush stdout (Windows pipe buffering otherwise)
function log(s) { process.stdout.write(s + '\n'); }

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ===== Linear-preferred snake growth =====
//
// Без vm context — алгоритм генерации не нуждается в SudokuCore/Variants.
// Только grid 9×9 и регионы.

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

// Растит snake длиной length, начиная от seed, без backtrack.
// Стратегия: continuity-bonus + Warnsdorff + max cells per row/col constraint.
// MAX_PER_ROW/COL = 4 предотвращает «целые строки/столбцы» — snake должна
// делать минимум 1 turn за 9 cells (так как 9 > 4 в обеих dimensions).
function growStretchedSnake(seed, length, connectivity, occupied, rng, params) {
  params = params || {};
  const CONTINUITY_BONUS = params.continuity || 8;
  const WARNSDORFF_WEIGHT = params.warnsdorff || 5;
  const RANDOM_NOISE = params.noise || 3;
  const MAX_PER_ROW = params.maxPerRow || 4;
  const MAX_PER_COL = params.maxPerCol || 4;
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
    // Отфильтровываем cells, нарушающие row/col cap для текущей snake
    const allowed = free.filter(function (n) {
      const nr = n / 9 | 0, nc = n % 9;
      return rowCount[nr] < MAX_PER_ROW && colCount[nc] < MAX_PER_COL;
    });
    const candidates = allowed.length > 0 ? allowed : free;  // если совсем тупик, разрешаем
    if (candidates.length === 0) {
      for (const c of path) occupied[c] = false;
      return null;
    }
    const scored = candidates.map(function (n) {
      const dir = dirIdx(head, n, DR, DC);
      let s = 0;
      if (dir === prevDir && prevDir !== -1) s += CONTINUITY_BONUS;
      const nFree = freeNeighbors(n, occupied, DR, DC).filter(function (x) {
        return x !== head;
      }).length;
      s += (DR.length - nFree) * WARNSDORFF_WEIGHT;
      s += rng() * RANDOM_NOISE;
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
  // Min-free-degree seed: corner/edge first, гарантирует hard cells сначала.
  // Random tiebreak среди cells с минимальной degree — даёт variation
  // позиций seed на каждый attempt.
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

// Проверки качества layouts:
//   isStretched — bounding box хотя бы 4 cells в одном измерении.
//     Запрещает компактные 3×3 квадраты, которые визуально равны классике.
//   hasDiagonal — хотя бы 1 диагональный edge в path (только для chain).
//     Гарантирует что cell в цепочке использует диагональное соседство.
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

function generateStretchedLayout(connectivity, rng, params) {
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
      const path = growStretchedSnake(seed, 9, connectivity, occupied, rng, params);
      if (!path) { ok = false; break; }
      // Quality check
      if (!isStretched(path)) { ok = false; break; }
      if (requireDiagonal && !hasDiagonal(path)) { ok = false; break; }
      regions.push(path);
    }
    if (!ok) {
      // Очищаем occupied (мы могли уже занять cells неудачных regions)
      for (let i = 0; i < 81; i++) occupied[i] = false;
      continue;
    }
    let cnt = 0;
    for (let i = 0; i < 81; i++) if (occupied[i]) cnt++;
    if (cnt === 81) return { regions: regions, attempts: attempts };
  }
  return null;
}

// ===== Render =====

function regionsToCellArr(regions) {
  const arr = new Array(81).fill(-1);
  for (let s = 0; s < regions.length; s++) {
    for (const i of regions[s]) arr[i] = s;
  }
  return arr;
}

function asciiGrid(cellArr) {
  const lines = [];
  for (let r = 0; r < 9; r++) {
    const row = [];
    for (let c = 0; c < 9; c++) row.push(cellArr[r * 9 + c]);
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

function svgGrid(regions, edges) {
  const cellArr = regionsToCellArr(regions);
  const colors = [
    '#FFE4E1', '#E0FFE4', '#E0E4FF', '#FFF0E0', '#F0E0FF',
    '#E0FFF8', '#FFE8F8', '#F8FFE0', '#E8F0FF'
  ];
  const CELL = 50;
  const PAD = 10;
  const W = 9 * CELL + 2 * PAD;
  const H = 9 * CELL + 2 * PAD;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  svg += `<rect width="${W}" height="${H}" fill="white"/>`;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const s = cellArr[r * 9 + c];
      svg += `<rect x="${PAD + c * CELL}" y="${PAD + r * CELL}" width="${CELL}" height="${CELL}" fill="${colors[s]}" stroke="#ddd" stroke-width="0.5"/>`;
    }
  }
  // Region borders
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const s = cellArr[r * 9 + c];
      const x = PAD + c * CELL, y = PAD + r * CELL;
      if (c + 1 < 9 && cellArr[r * 9 + c + 1] !== s) {
        svg += `<line x1="${x + CELL}" y1="${y}" x2="${x + CELL}" y2="${y + CELL}" stroke="#222" stroke-width="2.5"/>`;
      }
      if (r + 1 < 9 && cellArr[(r + 1) * 9 + c] !== s) {
        svg += `<line x1="${x}" y1="${y + CELL}" x2="${x + CELL}" y2="${y + CELL}" stroke="#222" stroke-width="2.5"/>`;
      }
    }
  }
  svg += `<rect x="${PAD}" y="${PAD}" width="${9 * CELL}" height="${9 * CELL}" fill="none" stroke="#222" stroke-width="3"/>`;
  // Edges (chain only)
  if (edges) {
    for (const [a, b] of edges) {
      const ar = a / 9 | 0, ac = a % 9, br = b / 9 | 0, bc = b % 9;
      const x1 = PAD + ac * CELL + CELL / 2, y1 = PAD + ar * CELL + CELL / 2;
      const x2 = PAD + bc * CELL + CELL / 2, y2 = PAD + br * CELL + CELL / 2;
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a4dc8" stroke-width="2.5" opacity="0.6"/>`;
    }
  }
  svg += '</svg>';
  return svg;
}

// ===== Main =====

log('Generating layouts...');

// Параметры: умеренное continuity (тяга к прямой линии, но не absolute),
// средний warnsdorff (избегаем изоляции), сильный noise (variation между
// attempts). MAX_PER_ROW/COL=4 гарантирует turn хотя бы 1 раз за 9 cells.
const PARAMS = { continuity: 10, warnsdorff: 3, noise: 10, maxPerRow: 4, maxPerCol: 4 };

const sugurSamples = [];
for (let i = 0; i < 3; i++) {
  log('  sugur ' + (i + 1) + '/3');
  const result = generateStretchedLayout('4', Math.random, PARAMS);
  if (!result) { log('    FAILED'); continue; }
  log('    OK (attempts=' + result.attempts + ')');
  log(asciiGrid(regionsToCellArr(result.regions)));
  log('');
  sugurSamples.push({ regions: result.regions, edges: null, title: `Сугуру ${i + 1}` });
}

const chainSamples = [];
for (let i = 0; i < 3; i++) {
  log('  chain ' + (i + 1) + '/3');
  const result = generateStretchedLayout('8', Math.random, PARAMS);
  if (!result) { log('    FAILED'); continue; }
  log('    OK (attempts=' + result.attempts + ')');
  log(asciiGrid(regionsToCellArr(result.regions)));
  log('');
  const edges = [];
  for (const region of result.regions) {
    for (let k = 1; k < region.length; k++) edges.push([region[k - 1], region[k]]);
  }
  chainSamples.push({ regions: result.regions, edges: edges, title: `Цепочки ${i + 1}` });
}

const htmlOut = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Preview layouts</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; padding: 16px; max-width: 1900px; margin: 0 auto; }
  h1 { color: #333; }
  h2 { color: #555; margin-top: 32px; border-bottom: 2px solid #ccc; padding-bottom: 8px; }
  .grid-row { display: flex; gap: 20px; flex-wrap: wrap; }
  .sample { background: white; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .sample h3 { margin: 0 0 12px; color: #333; }
  p { color: #555; line-height: 1.5; }
</style>
</head>
<body>
<h1>Новые layouts — вытянутые змейки/цепочки</h1>
<p>Алгоритм: linear-preferred growth — каждый next-cell выбирается с continuity-бонусом (бонус +15 за продолжение того же направления) и Warnsdorff-весом (-5 за каждый свободный сосед, чтобы избегать изоляции). Это даёт более линейные змейки, чем модифицированные 3×3-блоки.</p>
<p><b>Если ОК — апрувите, и сделаю bake 25 болванок с этим алгоритмом для каждого режима.</b></p>

<h2>Сугуру (4-связность — без диагоналей)</h2>
<div class="grid-row">
${sugurSamples.map(s => `<div class="sample"><h3>${s.title}</h3>${svgGrid(s.regions, null)}</div>`).join('\n')}
</div>

<h2>Цепочки (8-связность — с диагональными edges)</h2>
<div class="grid-row">
${chainSamples.map(s => `<div class="sample"><h3>${s.title}</h3>${svgGrid(s.regions, s.edges)}</div>`).join('\n')}
</div>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'preview-layouts.html'), htmlOut, 'utf8');
log('\nWritten: tools/preview-layouts.html');
log('Open: http://localhost:8776/tools/preview-layouts.html');
