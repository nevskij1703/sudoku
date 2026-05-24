/**
 * sudokuTechniques.js — human-style solver через применение техник.
 * См. docs/SUDOKU_GENERATOR.md.
 *
 * Используется для:
 *   1. Оценки сложности puzzle'а (какие техники нужны, сколько шагов).
 *   2. Подтверждения «решаемости вручную» — если ни одна техника не сдвигает
 *      состояние, puzzle требует guess-логики и попадает в hard.
 *
 * Идея:
 *   На каждом шаге держим для каждой пустой ячейки 9-битную маску кандидатов.
 *   Применяем техники в порядке возрастания «стоимости»; при успехе
 *   обнуляем итерацию и пробуем самую дешёвую снова (greedy).
 *   Когда никакая техника не сдвинула состояние — возвращаем log.
 *
 * Техники (по возрастанию стоимости):
 *   1. nakedSingle       — единственный кандидат в ячейке → ставим.
 *   2. hiddenSingle      — цифра встречается ровно в одной ячейке юнита → ставим.
 *   3. nakedPair         — две ячейки в юните с одинаковой парой кандидатов → удаляем эту пару у остальных.
 *   4. pointingPair      — в боксе цифра возможна только в одной строке/столбце → удаляем её из этой строки/столбца за пределами бокса.
 *   5. boxLineReduction  — в строке/столбце цифра возможна только в одном боксе → удаляем её из бокса за пределами строки/столбца.
 *   6. nakedTriple       — три ячейки с тремя кандидатами на троих → удаляем из остальных.
 *   7. xWing             — цифра в 2 строках возможна ровно в 2 одинаковых колонках → удаляем из этих колонок в других строках.
 *
 * Веса для score (см. config.js / sudokuGenerator.js):
 *   nakedSingle=1, hiddenSingle=2, nakedPair=8, pointingPair=10,
 *   boxLineReduction=12, nakedTriple=20, xWing=50.
 */
window.SudokuTechniques = (function () {
  const Core = window.SudokuCore;
  const ALL = Core.ALL_MASK;

  const TECH_WEIGHTS = {
    nakedSingle: 1,
    hiddenSingle: 2,
    nakedPair: 8,
    pointingPair: 10,
    boxLineReduction: 12,
    nakedTriple: 20,
    xWing: 50
  };

  function buildCandidates(grid, variant) {
    // Для каждой ячейки — маска кандидатов. Если в grid уже стоит цифра — маска = 0.
    const cand = new Array(81);
    const rowMask = new Array(9).fill(ALL);
    const colMask = new Array(9).fill(ALL);
    const boxMask = new Array(9).fill(ALL);
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) {
        const p = Core.rc(i);
        const bit = 1 << (grid[i] - 1);
        rowMask[p.r] &= ~bit;
        colMask[p.c] &= ~bit;
        boxMask[Core.boxOf(p.r, p.c)] &= ~bit;
      }
    }
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) { cand[i] = 0; continue; }
      const p = Core.rc(i);
      cand[i] = rowMask[p.r] & colMask[p.c] & boxMask[Core.boxOf(p.r, p.c)];
    }
    return cand;
  }

  function eliminate(cand, i, digitBit) {
    if (cand[i] & digitBit) {
      cand[i] &= ~digitBit;
      return true;
    }
    return false;
  }

  // ===== Техники =====
  // Каждая возвращает {progress: bool, eliminations: int}. При progress=true
  // мы перезапускаем циклом по возрастанию стоимости.

  function nakedSingle(grid, cand, variant) {
    let progress = false, elim = 0;
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue;
      if (Core.bitCount(cand[i]) === 1) {
        const d = Core.lowestBit(cand[i]) + 1;
        grid[i] = d;
        cand[i] = 0;
        const bit = 1 << (d - 1);
        const peers = variant.peersForCell(i);
        for (let k = 0; k < peers.length; k++) {
          if (cand[peers[k]] & bit) {
            cand[peers[k]] &= ~bit;
            elim++;
          }
        }
        progress = true;
      }
    }
    return { progress: progress, eliminations: elim };
  }

  function hiddenSingle(grid, cand, variant) {
    let progress = false, elim = 0;
    const units = variant.allUnits();
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      // Для каждой цифры d=1..9 ищем, в скольких ячейках юнита она ещё возможна.
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        let count = 0, pos = -1;
        for (let k = 0; k < unit.length; k++) {
          const i = unit[k];
          if (grid[i] === 0 && (cand[i] & bit)) { count++; pos = i; if (count > 1) break; }
        }
        if (count === 1) {
          // Ставим цифру d в ячейку pos
          grid[pos] = d;
          cand[pos] = 0;
          const peers = variant.peersForCell(pos);
          for (let k = 0; k < peers.length; k++) {
            if (cand[peers[k]] & bit) {
              cand[peers[k]] &= ~bit;
              elim++;
            }
          }
          progress = true;
        }
      }
    }
    return { progress: progress, eliminations: elim };
  }

  function nakedPair(grid, cand, variant) {
    let progress = false, elim = 0;
    const units = variant.allUnits();
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      // Ищем пары ячеек с одинаковой 2-битной маской
      const twoBit = [];
      for (let k = 0; k < unit.length; k++) {
        const i = unit[k];
        if (grid[i] === 0 && Core.bitCount(cand[i]) === 2) twoBit.push(i);
      }
      for (let a = 0; a < twoBit.length; a++) {
        for (let b = a + 1; b < twoBit.length; b++) {
          if (cand[twoBit[a]] === cand[twoBit[b]]) {
            const pairMask = cand[twoBit[a]];
            // Удаляем эти биты из всех остальных ячеек юнита
            for (let k = 0; k < unit.length; k++) {
              const i = unit[k];
              if (i === twoBit[a] || i === twoBit[b]) continue;
              if (grid[i] !== 0) continue;
              if (cand[i] & pairMask) {
                const before = cand[i];
                cand[i] &= ~pairMask;
                if (cand[i] !== before) { progress = true; elim += Core.bitCount(before & pairMask); }
              }
            }
          }
        }
      }
    }
    return { progress: progress, eliminations: elim };
  }

  function nakedTriple(grid, cand, variant) {
    let progress = false, elim = 0;
    const units = variant.allUnits();
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      // Ищем тройки ячеек, у которых объединение кандидатов ровно 3 цифры.
      // Каждая ячейка должна иметь 2..3 кандидата.
      const cells = [];
      for (let k = 0; k < unit.length; k++) {
        const i = unit[k];
        if (grid[i] !== 0) continue;
        const bc = Core.bitCount(cand[i]);
        if (bc === 2 || bc === 3) cells.push(i);
      }
      for (let a = 0; a < cells.length; a++) {
        for (let b = a + 1; b < cells.length; b++) {
          for (let c2 = b + 1; c2 < cells.length; c2++) {
            const ms = cand[cells[a]] | cand[cells[b]] | cand[cells[c2]];
            if (Core.bitCount(ms) === 3) {
              // Triple. Удаляем биты ms из всех остальных в юните.
              for (let k = 0; k < unit.length; k++) {
                const i = unit[k];
                if (i === cells[a] || i === cells[b] || i === cells[c2]) continue;
                if (grid[i] !== 0) continue;
                if (cand[i] & ms) {
                  const before = cand[i];
                  cand[i] &= ~ms;
                  if (cand[i] !== before) { progress = true; elim += Core.bitCount(before & ms); }
                }
              }
            }
          }
        }
      }
    }
    return { progress: progress, eliminations: elim };
  }

  function pointingPair(grid, cand, variant) {
    let progress = false, elim = 0;
    const { rows, cols, boxes } = variant.rowsAndCols();
    // Для каждого бокса, для каждой цифры — если цифра возможна только в одной
    // строке (или столбце) бокса, то её можно убрать из этой строки/столбца
    // за пределами бокса.
    for (let bi = 0; bi < boxes.length; bi++) {
      const box = boxes[bi];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        let rowsSeen = new Set(), colsSeen = new Set(), count = 0;
        for (let k = 0; k < box.length; k++) {
          const i = box[k];
          if (grid[i] === 0 && (cand[i] & bit)) {
            const p = Core.rc(i);
            rowsSeen.add(p.r); colsSeen.add(p.c); count++;
          }
        }
        if (count < 2) continue;
        if (rowsSeen.size === 1) {
          const r = rowsSeen.values().next().value;
          const row = rows[r];
          for (let k = 0; k < row.length; k++) {
            const i = row[k];
            if (Core.boxOf(Core.rc(i).r, Core.rc(i).c) === bi) continue;
            if (grid[i] !== 0) continue;
            if (cand[i] & bit) { cand[i] &= ~bit; progress = true; elim++; }
          }
        }
        if (colsSeen.size === 1) {
          const c = colsSeen.values().next().value;
          const col = cols[c];
          for (let k = 0; k < col.length; k++) {
            const i = col[k];
            if (Core.boxOf(Core.rc(i).r, Core.rc(i).c) === bi) continue;
            if (grid[i] !== 0) continue;
            if (cand[i] & bit) { cand[i] &= ~bit; progress = true; elim++; }
          }
        }
      }
    }
    return { progress: progress, eliminations: elim };
  }

  function boxLineReduction(grid, cand, variant) {
    let progress = false, elim = 0;
    const { rows, cols } = variant.rowsAndCols();
    // Если в строке (или столбце) цифра возможна только внутри одного бокса —
    // её можно убрать из этого бокса в других строках/столбцах.
    function reduce(lines, isRow) {
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        for (let d = 1; d <= 9; d++) {
          const bit = 1 << (d - 1);
          const boxesSeen = new Set();
          let count = 0;
          for (let k = 0; k < line.length; k++) {
            const i = line[k];
            if (grid[i] === 0 && (cand[i] & bit)) {
              const p = Core.rc(i);
              boxesSeen.add(Core.boxOf(p.r, p.c));
              count++;
            }
          }
          if (count < 2) continue;
          if (boxesSeen.size === 1) {
            const bi = boxesSeen.values().next().value;
            // Удаляем bit из всех ячеек бокса bi, КРОМЕ ячеек в этой строке/столбце.
            for (let r2 = 0; r2 < 9; r2++) {
              for (let c2 = 0; c2 < 9; c2++) {
                const i = Core.idx(r2, c2);
                if (Core.boxOf(r2, c2) !== bi) continue;
                if (isRow && r2 === li) continue;
                if (!isRow && c2 === li) continue;
                if (grid[i] !== 0) continue;
                if (cand[i] & bit) { cand[i] &= ~bit; progress = true; elim++; }
              }
            }
          }
        }
      }
    }
    reduce(rows, true);
    reduce(cols, false);
    return { progress: progress, eliminations: elim };
  }

  function xWing(grid, cand, variant) {
    let progress = false, elim = 0;
    // Для каждой цифры: ищем 2 строки, в которых цифра встречается ровно в 2
    // одних и тех же столбцах. Тогда в этих столбцах цифру можно убрать из
    // других строк. Симметричный поиск по столбцам.
    function find(linesA, linesB, getOtherIdx, removeOnB) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const cols2 = [];   // массив пар [lineIdxA, [posB1, posB2]]
        for (let a = 0; a < linesA.length; a++) {
          const positions = [];
          for (let k = 0; k < linesA[a].length; k++) {
            const i = linesA[a][k];
            if (grid[i] === 0 && (cand[i] & bit)) positions.push(getOtherIdx(i));
          }
          if (positions.length === 2) cols2.push([a, positions]);
        }
        for (let a = 0; a < cols2.length; a++) {
          for (let b = a + 1; b < cols2.length; b++) {
            if (cols2[a][1][0] === cols2[b][1][0] && cols2[a][1][1] === cols2[b][1][1]) {
              // X-wing найден. Убираем bit из линий-B в позициях, кроме строк-A.
              const lineA1 = cols2[a][0], lineA2 = cols2[b][0];
              const bPos = cols2[a][1];
              for (let p = 0; p < 2; p++) {
                const lineB = linesB[bPos[p]];
                for (let k = 0; k < lineB.length; k++) {
                  const i = lineB[k];
                  if (!removeOnB(i, lineA1, lineA2)) continue;
                  if (grid[i] !== 0) continue;
                  if (cand[i] & bit) { cand[i] &= ~bit; progress = true; elim++; }
                }
              }
            }
          }
        }
      }
    }

    const { rows, cols } = variant.rowsAndCols();
    // По строкам: для каждой пары строк находим 2 общих столбца.
    find(rows, cols,
      function (i) { return Core.rc(i).c; },
      function (i, r1, r2) { const r = Core.rc(i).r; return r !== r1 && r !== r2; }
    );
    // По столбцам: для каждой пары столбцов находим 2 общих строки.
    find(cols, rows,
      function (i) { return Core.rc(i).r; },
      function (i, c1, c2) { const c = Core.rc(i).c; return c !== c1 && c !== c2; }
    );

    return { progress: progress, eliminations: elim };
  }

  // ===== humanSolve — главная функция =====

  const PIPELINE = [
    { name: 'nakedSingle',      fn: nakedSingle },
    { name: 'hiddenSingle',     fn: hiddenSingle },
    { name: 'nakedPair',        fn: nakedPair },
    { name: 'pointingPair',     fn: pointingPair },
    { name: 'boxLineReduction', fn: boxLineReduction },
    { name: 'nakedTriple',      fn: nakedTriple },
    { name: 'xWing',            fn: xWing }
  ];

  function humanSolve(puzzle, variant) {
    if (!variant) variant = window.SudokuCore.ClassicVariant;
    const grid = Core.cloneGrid(puzzle);
    let cand = buildCandidates(grid, variant);
    const log = [];

    while (true) {
      let stepped = false;
      for (let t = 0; t < PIPELINE.length; t++) {
        const tech = PIPELINE[t];
        const res = tech.fn(grid, cand, variant);
        if (res.progress) {
          log.push({ tech: tech.name, eliminations: res.eliminations });
          stepped = true;
          break; // перезапускаем поиск с самой дешёвой техники
        }
      }
      if (!stepped) break;
      if (Core.isComplete(grid)) break;
    }

    return {
      solved: Core.isComplete(grid),
      grid: grid,
      log: log
    };
  }

  // Сворачивает log в { nakedSingle: 12, hiddenSingle: 3, ... } для удобства rateDifficulty.
  function summariseLog(log) {
    const counts = {};
    for (let i = 0; i < log.length; i++) {
      counts[log[i].tech] = (counts[log[i].tech] || 0) + 1;
    }
    return counts;
  }

  return {
    humanSolve: humanSolve,
    summariseLog: summariseLog,
    TECH_WEIGHTS: TECH_WEIGHTS,
    // выставляем отдельные техники для dev-панели / unit-тестов
    _internals: {
      buildCandidates: buildCandidates,
      nakedSingle: nakedSingle,
      hiddenSingle: hiddenSingle,
      nakedPair: nakedPair,
      nakedTriple: nakedTriple,
      pointingPair: pointingPair,
      boxLineReduction: boxLineReduction,
      xWing: xWing
    }
  };
})();
