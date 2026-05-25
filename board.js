/**
 * board.js — рендер 9×9 сетки и обработка кликов по ячейкам.
 *
 * API:
 *   Board.mount(boardEl, onCellClick)
 *   Board.render(state, settings)       — полная отрисовка из game state
 *   Board.setSelected(idx)               — обновить только выделение/подсветку
 *   Board.flashError(idx)                — короткий «всплеск» неправильной цифры
 *
 * State (передаётся render):
 *   { puzzle, board, notes (number[81]), mistakes (boolean[81]),
 *     givens (boolean[81]), hintCells (boolean[81]), selectedIdx }
 *
 * Подсветка (см. ТЗ):
 *   - peer: вся строка/столбец/блок выбранной ячейки
 *   - same-digit: все ячейки с той же цифрой что в выбранной
 *   - selected: выбранная ячейка
 *   - error: красная подсветка для ошибок (поверх любой другой)
 */
window.Board = (function () {
  const Core = window.SudokuCore;

  let boardEl = null;
  let cells = [];           // массив DOM-нодов (N×N длиной)
  let chainSvg = null;      // <svg> overlay для chain-режима (линии между ячейками)
  let sugurSvg = null;      // <svg> overlay для sugur (границы между змейками)
  let blockSvg = null;      // <svg> overlay для accent-периметра выбранного блока
  let onClickCb = null;
  let currentSize = 0;

  function mount(rootEl, onCellClick) {
    boardEl = rootEl;
    onClickCb = onCellClick;
    remount(9);
  }

  // Пересоздаёт grid под заданный размер (9 для классики и расширенных, 4 для Mini).
  // Все cells заново создаются с правильными data-row/col, классами и обработчиками.
  function remount(size) {
    if (!boardEl) return;
    if (size === currentSize) return;
    currentSize = size;
    boardEl.dataset.size = String(size);
    boardEl.innerHTML = '';
    cells = [];
    const boxR = (size === 4) ? 2 : 3;
    const boxC = (size === 4) ? 2 : 3;
    const N = size * size;
    for (let i = 0; i < N; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = String(i);
      const r = Math.floor(i / size), c = i % size;
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.dataset.box = String(Math.floor(r / boxR) * (size / boxC) + Math.floor(c / boxC));
      if (r === size - 1) cell.classList.add('row-last');
      if (c === size - 1) cell.classList.add('col-last');
      // Жирная граница между блоками
      if (((r + 1) % boxR) === 0 && r !== size - 1) cell.classList.add('row-edge-bottom');
      cell.addEventListener('click', function () {
        if (onClickCb) onClickCb(i);
      });
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  function notesMaskToHtml(mask) {
    // 9-битная маска. Отрисуем 3×3 сетку из цифр 1..9 (или пустоту).
    const cells9 = [];
    for (let d = 0; d < 9; d++) {
      cells9.push('<span>' + ((mask >> d) & 1 ? String(d + 1) : '') + '</span>');
    }
    return '<div class="notes">' + cells9.join('') + '</div>';
  }

  function render(state, settings) {
    if (!boardEl) return;
    const sel = state.selectedIdx;
    const variant = state.variant || Core.ClassicVariant;
    const size = variant.size || 9;
    const N = variant.cellCount || (size * size);
    // Пересоздаём grid если variant сменил размер (Mini ↔ 9×9)
    if (size !== currentSize) remount(size);
    const selDigit = sel != null ? state.board[sel] : 0;
    const useHighlight = settings && settings.highlighter !== false;

    // Sugur: добавляем/убираем класс на board чтобы CSS приглушил block-borders
    const isSugur = !!(state.cellSnake && state.cellSnake.length === 81);
    boardEl.classList.toggle('sugur-board', isSugur);
    // Выбранная змейка (id 0..8) — её граница рисуется ярче, у остальных
    // тоньше. См. renderSugurOverlay.
    var selSnakeId = isSugur && sel != null && state.cellSnake[sel] >= 0
      ? state.cellSnake[sel] : -1;
    renderSugurOverlay(state, size, isSugur, selSnakeId);
    // Chain: круглые ячейки + SVG-overlay с линиями + приглушённые grid-borders
    var isChain = !!(state.cellChain && state.cellChain.length === 81);
    boardEl.classList.toggle('chain-board', isChain);
    // Какая цепочка содержит выбранную ячейку (для увеличенной обводки/линий)
    var selChainId = isChain && sel != null && state.cellChain[sel] >= 0
      ? state.cellChain[sel] : -1;
    renderChainOverlay(state, size, isChain, selChainId);

    // Сбрасываем Kropki-классы (могут остаться от предыдущего mode)
    for (let i = 0; i < N; i++) {
      cells[i].classList.remove(
        'dot-right-consec', 'dot-right-double',
        'dot-bottom-consec', 'dot-bottom-double'
      );
    }
    if (state.dots && state.dots.length) {
      for (let k = 0; k < state.dots.length; k++) {
        const d = state.dots[k];
        const cls = 'dot-' + d.side + '-' + d.type;
        cells[d.idx1].classList.add(cls);
      }
    }
    // Peers (голубая подсветка) — ТОЛЬКО строка и столбец выбранной cell.
    // Никакие extra-зоны (диагонали в Diagonal, центральные cells в Center,
    // 4 внутренние 3×3-зоны в Windoku, змейки в Sugur, цепочки в Chain) НЕ
    // добавляются в peer-set: их визуальная связь с выбранной cell
    // показывается отдельно — через block-highlight rectangle (boxed
    // variants), sugur-overlay (змейки) или chain-overlay (цепочки).
    // Это даёт игроку чистое разделение: «голубой = row/col-conflict
    // candidate», «рамка = вторая constraint-группа».
    let peers;
    if (sel == null || !useHighlight) {
      peers = null;
    } else {
      peers = new Set();
      const r = Math.floor(sel / size), c = sel % size;
      for (let k = 0; k < size; k++) {
        if (k !== c) peers.add(r * size + k);
        if (k !== r) peers.add(k * size + c);
      }
    }
    // Accent-периметр выбранного блока для variants с boxes (Classic, Mini,
    // Diagonal, Center, Windoku, Kropki). Sugur/Chain используют свой
    // overlay (см. renderSugurOverlay / renderChainOverlay).
    const showBlockHighlight = !isChain && !isSugur
                            && sel != null && useHighlight
                            && variant.boxRows > 0 && variant.boxCols > 0;
    renderBlockHighlight(state, size, variant, sel, showBlockHighlight);
    // Когда block-highlight активен — все «общие» block-borders cell'ов
    // делаем тоньше, чтобы selected-периметр заметно толще их.
    boardEl.classList.toggle('has-block-highlight', showBlockHighlight);

    for (let i = 0; i < N; i++) {
      const cell = cells[i];
      const value = state.board[i];
      const isGiven = state.givens[i];
      const isHint = state.hintCells && state.hintCells[i];
      const isError = state.mistakes && state.mistakes[i];

      // Sugur — каждая змейка имеет свой data-snake (0..8); CSS не красит
      // фон (по запросу пользователя — отделяем толстыми бордерами а не
      // цветами). data-snake оставляем чтобы тесты/dev-panel могли по нему
      // искать ячейки. Снизу/справа добавляем класс snake-edge-* когда сосед
      // в другой змейке — это и даёт «толстые границы между зонами».
      if (state.cellSnake && state.cellSnake.length === 81) {
        const sCell = state.cellSnake[i];
        cell.dataset.snake = String(sCell);
        const r = Math.floor(i / 9), c = i % 9;
        const right  = (c < 8) ? state.cellSnake[i + 1] : sCell;
        const bottom = (r < 8) ? state.cellSnake[i + 9] : sCell;
        cell.classList.toggle('snake-edge-right',  right  !== sCell);
        cell.classList.toggle('snake-edge-bottom', bottom !== sCell);
      } else {
        if (cell.dataset.snake !== undefined) delete cell.dataset.snake;
        cell.classList.remove('snake-edge-right', 'snake-edge-bottom');
      }
      // Chain — каждая цепочка имеет свой data-chain (0..8); CSS красит группу.
      // Цвета зеркалят sugur-палитру.
      if (state.cellChain && state.cellChain.length === 81) {
        cell.dataset.chain = String(state.cellChain[i]);
      } else if (cell.dataset.chain !== undefined) {
        delete cell.dataset.chain;
      }

      if (value !== 0) {
        cell.textContent = String(value);
      } else if (state.notes[i] && state.notes[i] !== 0) {
        cell.innerHTML = notesMaskToHtml(state.notes[i]);
      } else {
        cell.textContent = '';
      }

      cell.classList.toggle('given', !!isGiven);
      cell.classList.toggle('hint', !!isHint && !isGiven);
      cell.classList.toggle('error', !!isError);

      // Тонировка ячеек по variant — чтобы юзер видел где именно работает
      // дополнительное ограничение (диагональ / центр / зоны виндоку).
      if (window.SudokuVariants) {
        const META = window.SudokuVariants.META;
        const vname = variant.name;
        if (vname === 'diagonal' && META.diagonal) {
          const d = META.diagonal.diagCells(i);
          cell.classList.toggle('on-main-diag', d.main);
          cell.classList.toggle('on-anti-diag', d.anti);
        } else {
          cell.classList.remove('on-main-diag', 'on-anti-diag');
        }
        if (vname === 'center' && META.center) {
          cell.classList.toggle('center-cell', META.center.isCenterCell(i));
        } else {
          cell.classList.remove('center-cell');
        }
        if (vname === 'windoku' && META.windoku) {
          const z = META.windoku.zoneOf(i);
          cell.classList.toggle('windoku-zone', z >= 0);
        } else {
          cell.classList.remove('windoku-zone');
        }
      }

      const isPeer = peers ? peers.has(i) : false;
      cell.classList.toggle('peer', !!isPeer);

      // Same-digit подсветка — все ячейки с такой же цифрой как у sel
      // подсвечиваются. Работает во всех режимах: классических, Mini,
      // Diagonal, Center, Windoku, Kropki, Sugur, Chain. Включается также
      // когда юзер ставит цифру в пустую selected — после handleNumber
      // selDigit становится новой цифрой и same-digit cells подхватываются.
      const isSameDigit = useHighlight && selDigit !== 0
                       && value === selDigit && i !== sel;
      cell.classList.toggle('same-digit', !!isSameDigit);

      // Chain — особый маркер для ячеек выбранной цепочки: «жирная» обводка
      // вокруг каждого круга цепочки (см. CSS .in-selected-chain::after).
      if (isChain && selChainId >= 0 && state.cellChain[i] === selChainId && i !== sel) {
        cell.classList.add('in-selected-chain');
      } else {
        cell.classList.remove('in-selected-chain');
      }

      cell.classList.toggle('selected', i === sel);
    }
  }

  // Монтирует/обновляет SVG-overlay с линиями для chain-режима.
  // viewBox = "0 0 size size", т.е. координаты в «единицах ячеек».
  // pointer-events: none — клики проходят сквозь и достигают cell-DOM.
  // Если selChainId >= 0, рисуем линии этой цепочки толще для визуальной
  // подсветки выбранной цепочки.
  function renderChainOverlay(state, size, enabled, selChainId) {
    if (!enabled) {
      if (chainSvg) { chainSvg.remove(); chainSvg = null; }
      return;
    }
    const NS = 'http://www.w3.org/2000/svg';
    if (!chainSvg) {
      chainSvg = document.createElementNS(NS, 'svg');
      chainSvg.setAttribute('class', 'chain-overlay');
      chainSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      chainSvg.setAttribute('preserveAspectRatio', 'none');
      boardEl.appendChild(chainSvg);
    } else {
      chainSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      while (chainSvg.firstChild) chainSvg.removeChild(chainSvg.firstChild);
    }
    const edges = state.chainEdges || [];
    const cellChain = state.cellChain || [];
    const NORMAL = '0.028';
    const THICK  = '0.035';   // тоньше прежних 0.045
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k];
      const a = e[0], b = e[1];
      const ar = Math.floor(a / size), ac = a % size;
      const br = Math.floor(b / size), bc = b % size;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(ac + 0.5));
      line.setAttribute('y1', String(ar + 0.5));
      line.setAttribute('x2', String(bc + 0.5));
      line.setAttribute('y2', String(br + 0.5));
      line.setAttribute('stroke', '#1a2540');
      const inSel = (selChainId >= 0 && cellChain[a] === selChainId);
      line.setAttribute('stroke-width', inSel ? THICK : NORMAL);
      line.setAttribute('stroke-linecap', 'round');
      // Линии чуть полупрозрачные — не отвлекают от цифр в кругах.
      // У selected-цепочки выводим непрозрачно — она и должна вылезать.
      line.setAttribute('opacity', inSel ? '1' : '0.4');
      chainSvg.appendChild(line);
    }
  }

  // SVG-overlay границ змеек для Sugur. Рисует каждую внутреннюю границу
  // (вертикальную или горизонтальную) между ячейками разных змеек одной
  // непрерывной line — без CSS-border'ов на cell'ах, поэтому никаких
  // micro-gap'ов в углах. Если selSnakeId >= 0, граница ВЫБРАННОЙ змейки
  // рисуется заметно толще, остальные — тоньше. Цвет всех границ
  // одинаковый чёрный — выделение только толщиной.
  function renderSugurOverlay(state, size, enabled, selSnakeId) {
    if (!enabled) {
      if (sugurSvg) { sugurSvg.remove(); sugurSvg = null; }
      return;
    }
    const NS = 'http://www.w3.org/2000/svg';
    if (!sugurSvg) {
      sugurSvg = document.createElementNS(NS, 'svg');
      sugurSvg.setAttribute('class', 'sugur-overlay');
      sugurSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      sugurSvg.setAttribute('preserveAspectRatio', 'none');
      boardEl.appendChild(sugurSvg);
    } else {
      sugurSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      while (sugurSvg.firstChild) sugurSvg.removeChild(sugurSvg.firstChild);
    }
    const snake = state.cellSnake;
    // Все границы одного чёрного цвета. Выбранная змейка — толще,
    // остальные — заметно тоньше. Цвет везде одинаковый.
    const STROKE_NORMAL = '#1a2540';
    const STROKE_SELECT = '#1a2540';
    const W_NORMAL = '0.022';   // ≈ 1.2px на 480-доске
    const W_SELECT = '0.035';   // ≈ 1.9px (тоньше прежних 0.05/2.7px)

    function drawEdge(x1, y1, x2, y2, sA, sB) {
      const isSel = (selSnakeId >= 0) && (sA === selSnakeId || sB === selSnakeId);
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', String(x1));
      ln.setAttribute('y1', String(y1));
      ln.setAttribute('x2', String(x2));
      ln.setAttribute('y2', String(y2));
      ln.setAttribute('stroke', isSel ? STROKE_SELECT : STROKE_NORMAL);
      ln.setAttribute('stroke-width', isSel ? W_SELECT : W_NORMAL);
      ln.setAttribute('stroke-linecap', 'square');
      sugurSvg.appendChild(ln);
    }

    // Сначала «обычные» рёбра, потом selected — чтобы accent-границы
    // рисовались поверх и не перекрывались соседними тёмными линиями.
    const selEdges = [];
    // Вертикальные внутренние границы
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size - 1; c++) {
        const a = r * size + c, b = a + 1;
        const sA = snake[a], sB = snake[b];
        if (sA === sB) continue;
        const isSel = (selSnakeId >= 0) && (sA === selSnakeId || sB === selSnakeId);
        if (isSel) {
          selEdges.push([c + 1, r, c + 1, r + 1, sA, sB]);
        } else {
          drawEdge(c + 1, r, c + 1, r + 1, sA, sB);
        }
      }
    }
    // Горизонтальные внутренние границы
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size; c++) {
        const a = r * size + c, b = a + size;
        const sA = snake[a], sB = snake[b];
        if (sA === sB) continue;
        const isSel = (selSnakeId >= 0) && (sA === selSnakeId || sB === selSnakeId);
        if (isSel) {
          selEdges.push([c, r + 1, c + 1, r + 1, sA, sB]);
        } else {
          drawEdge(c, r + 1, c + 1, r + 1, sA, sB);
        }
      }
    }
    // Внешние границы доски для cells выбранной змейки — чтобы accent-
    // граница была непрерывной даже если змейка касается края. Сдвигаем
    // координату вглубь на HALF_SEL (половина толщины stroke), иначе
    // половина линии оказывается за viewBox и обрезается — внешние
    // границы выглядят тоньше внутренних.
    if (selSnakeId >= 0) {
      const HALF_SEL = 0.025;
      for (let i = 0; i < size * size; i++) {
        if (snake[i] !== selSnakeId) continue;
        const r = Math.floor(i / size), c = i % size;
        if (r === 0)        selEdges.push([c, HALF_SEL, c + 1, HALF_SEL, selSnakeId, selSnakeId]);
        if (r === size - 1) selEdges.push([c, size - HALF_SEL, c + 1, size - HALF_SEL, selSnakeId, selSnakeId]);
        if (c === 0)        selEdges.push([HALF_SEL, r, HALF_SEL, r + 1, selSnakeId, selSnakeId]);
        if (c === size - 1) selEdges.push([size - HALF_SEL, r, size - HALF_SEL, r + 1, selSnakeId, selSnakeId]);
      }
    }
    // Поверх — accent-рёбра выбранной змейки.
    for (let k = 0; k < selEdges.length; k++) {
      const e = selEdges[k];
      drawEdge(e[0], e[1], e[2], e[3], e[4], e[5]);
    }
  }

  // Возвращает unit (массив cell-индексов), который представляет «box»
  // (блок) для cell sel в данном variant. Идентифицируется по геометрии:
  // unit, чьи cells точно покрывают прямоугольник boxRows×boxCols вокруг sel.
  // Возвращает null если у variant'а нет box-структуры (или sel вне неё).
  function findBoxUnitFor(sel, variant, size) {
    if (!variant.boxRows || !variant.boxCols) return null;
    const r = Math.floor(sel / size), c = sel % size;
    const boxR0 = Math.floor(r / variant.boxRows) * variant.boxRows;
    const boxC0 = Math.floor(c / variant.boxCols) * variant.boxCols;
    const expected = new Set();
    for (let br = boxR0; br < boxR0 + variant.boxRows; br++) {
      for (let bc = boxC0; bc < boxC0 + variant.boxCols; bc++) {
        expected.add(br * size + bc);
      }
    }
    const units = variant.unitsForCell(sel);
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      if (unit.length !== expected.size) continue;
      let match = true;
      for (let k = 0; k < unit.length; k++) {
        if (!expected.has(unit[k])) { match = false; break; }
      }
      if (match) return unit;
    }
    return null;
  }

  // SVG-overlay accent-периметра вокруг блока выбранной ячейки.
  // Используется для всех variants с boxRows/boxCols > 0 (Classic, Mini,
  // Diagonal, Center, Windoku, Kropki). Рисует 4 линии по периметру
  // блока в синий цвет accent. Внешние границы (которые касаются краёв
  // доски) сдвигаются вглубь на половину stroke-width — иначе обрезаются
  // viewBox-ом и выглядят тоньше внутренних.
  function renderBlockHighlight(state, size, variant, sel, enabled) {
    if (!enabled) {
      if (blockSvg) { blockSvg.remove(); blockSvg = null; }
      return;
    }
    const NS = 'http://www.w3.org/2000/svg';
    if (!blockSvg) {
      blockSvg = document.createElementNS(NS, 'svg');
      blockSvg.setAttribute('class', 'block-highlight-overlay');
      blockSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      blockSvg.setAttribute('preserveAspectRatio', 'none');
      boardEl.appendChild(blockSvg);
    } else {
      blockSvg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      while (blockSvg.firstChild) blockSvg.removeChild(blockSvg.firstChild);
    }
    const r = Math.floor(sel / size), c = sel % size;
    const boxR0 = Math.floor(r / variant.boxRows) * variant.boxRows;
    const boxC0 = Math.floor(c / variant.boxCols) * variant.boxCols;
    const x1 = boxC0;
    const x2 = boxC0 + variant.boxCols;
    const y1 = boxR0;
    const y2 = boxR0 + variant.boxRows;
    const STROKE = '#1a2540';   // чёрный (var(--grid-line-thick))
    const W = '0.035';           // ≈ 1.9px (тоньше прежних 0.05/2.7px)
    const HALF = 0.0175;
    // Сдвиг для внешних краёв (касающихся края доски):
    const ty = (y1 === 0)    ? HALF        : y1;
    const by = (y2 === size) ? size - HALF : y2;
    const lx = (x1 === 0)    ? HALF        : x1;
    const rx = (x2 === size) ? size - HALF : x2;
    function line(x1, y1, x2, y2) {
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('x1', String(x1));
      ln.setAttribute('y1', String(y1));
      ln.setAttribute('x2', String(x2));
      ln.setAttribute('y2', String(y2));
      ln.setAttribute('stroke', STROKE);
      ln.setAttribute('stroke-width', W);
      ln.setAttribute('stroke-linecap', 'square');
      blockSvg.appendChild(ln);
    }
    line(lx, ty, rx, ty);   // top
    line(lx, by, rx, by);   // bottom
    line(lx, ty, lx, by);   // left
    line(rx, ty, rx, by);   // right
  }

  function setSelected(idx) {
    for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('selected', i === idx);
  }

  function flashError(idx) {
    const cell = cells[idx];
    if (!cell) return;
    cell.classList.add('error');
    // Не убираем — error снимается явно через render(), когда mistakes[idx] = false
  }

  // Кратковременная анимация появления цифры при каскадном заполнении в
  // Быстром режиме. Класс снимается через 400ms, после чего ячейка
  // выглядит обычно (цифру нарисовал render).
  function flashFastFill(idx) {
    const cell = cells[idx];
    if (!cell) return;
    cell.classList.add('fast-fill');
    setTimeout(function () { cell.classList.remove('fast-fill'); }, 420);
  }

  return {
    mount: mount,
    remount: remount,
    render: render,
    setSelected: setSelected,
    flashError: flashError,
    flashFastFill: flashFastFill
  };
})();
