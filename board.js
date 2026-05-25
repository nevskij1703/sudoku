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
    boardEl.classList.toggle('sugur-board', !!(state.cellSnake && state.cellSnake.length === 81));
    // Chain: круглые ячейки + SVG-overlay с линиями + приглушённые grid-borders
    const isChain = !!(state.cellChain && state.cellChain.length === 81);
    boardEl.classList.toggle('chain-board', isChain);
    renderChainOverlay(state, size, isChain);

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
    // Peers выбранной ячейки определяет variant — для Diagonal это включает
    // диагональ, для Center — центральные клетки, для Windoku — внутреннюю зону.
    const peers = (sel != null && useHighlight) ? new Set(variant.peersForCell(sel)) : null;

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

      const isSameDigit = useHighlight && selDigit !== 0 && value === selDigit && i !== sel;
      cell.classList.toggle('same-digit', !!isSameDigit);

      cell.classList.toggle('selected', i === sel);
    }
  }

  // Монтирует/обновляет SVG-overlay с линиями для chain-режима.
  // Виде: SVG поверх grid, координаты в "ячейках" (viewBox = "0 0 size size"),
  // линии идут от центра ячейки a к центру ячейки b. Каждая линия покрашена
  // в цвет своей цепочки (data-chain="0..8" → переменная-цвет из CSS).
  // pointer-events: none — клики проходят сквозь и доходят до самих cell-DOM.
  function renderChainOverlay(state, size, enabled) {
    // Снимаем overlay если режим не chain
    if (!enabled) {
      if (chainSvg) {
        chainSvg.remove();
        chainSvg = null;
      }
      return;
    }
    if (!chainSvg) {
      const NS = 'http://www.w3.org/2000/svg';
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
    const NS = 'http://www.w3.org/2000/svg';
    // Один нейтральный серый цвет для всех цепочек — по запросу пользователя.
    // Различие цепочек считывается по их форме (последовательная верёвочка
    // с двумя концами), а не по цвету.
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
      line.setAttribute('stroke', '#8e94a3');
      line.setAttribute('stroke-width', '0.10');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.9');
      chainSvg.appendChild(line);
    }
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

  return {
    mount: mount,
    remount: remount,
    render: render,
    setSelected: setSelected,
    flashError: flashError
  };
})();
