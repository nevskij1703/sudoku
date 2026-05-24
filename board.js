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
  let cells = [];        // массив DOM-нодов длиной 81
  let onClickCb = null;

  function mount(rootEl, onCellClick) {
    boardEl = rootEl;
    onClickCb = onCellClick;
    boardEl.innerHTML = '';
    cells = [];
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = String(i);
      const p = Core.rc(i);
      cell.dataset.row = String(p.r);
      cell.dataset.col = String(p.c);
      cell.dataset.box = String(Core.boxOf(p.r, p.c));
      if (p.r === 8) cell.classList.add('row-last');
      if (p.c === 8) cell.classList.add('col-last');
      // Жирная граница после 3-й и 6-й строки
      if (p.r === 2 || p.r === 5) cell.classList.add('row-edge-bottom');
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
    const selDigit = sel != null ? state.board[sel] : 0;
    const useHighlight = settings && settings.highlighter !== false;

    // Сначала сбрасываем все Kropki-классы (могут остаться от предыдущего mode).
    for (let i = 0; i < 81; i++) {
      cells[i].classList.remove(
        'dot-right-consec', 'dot-right-double',
        'dot-bottom-consec', 'dot-bottom-double'
      );
    }
    // Применяем dots если есть
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

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const value = state.board[i];
      const isGiven = state.givens[i];
      const isHint = state.hintCells && state.hintCells[i];
      const isError = state.mistakes && state.mistakes[i];

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

  function setSelected(idx) {
    // Лёгкая версия — только обновить selected класс (без полного render).
    // Использовать когда state не менялся, только выбор.
    for (let i = 0; i < 81; i++) cells[i].classList.toggle('selected', i === idx);
  }

  function flashError(idx) {
    const cell = cells[idx];
    if (!cell) return;
    cell.classList.add('error');
    // Не убираем — error снимается явно через render(), когда mistakes[idx] = false
  }

  return {
    mount: mount,
    render: render,
    setSelected: setSelected,
    flashError: flashError
  };
})();
