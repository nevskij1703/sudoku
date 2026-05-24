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
    const selRow = sel != null ? Core.rc(sel).r : -1;
    const selCol = sel != null ? Core.rc(sel).c : -1;
    const selBox = sel != null ? Core.boxOf(Core.rc(sel).r, Core.rc(sel).c) : -1;
    const selDigit = sel != null ? state.board[sel] : 0;
    const useHighlight = settings && settings.highlighter !== false;

    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const value = state.board[i];
      const isGiven = state.givens[i];
      const isHint = state.hintCells && state.hintCells[i];
      const isError = state.mistakes && state.mistakes[i];

      // Контент: цифра или заметки
      if (value !== 0) {
        cell.textContent = String(value);
      } else if (state.notes[i] && state.notes[i] !== 0) {
        cell.innerHTML = notesMaskToHtml(state.notes[i]);
      } else {
        cell.textContent = '';
      }

      // Базовые классы
      cell.classList.toggle('given', !!isGiven);
      cell.classList.toggle('hint', !!isHint && !isGiven);
      cell.classList.toggle('error', !!isError);

      // Подсветка
      const p = Core.rc(i);
      const isPeer = useHighlight && sel != null && (p.r === selRow || p.c === selCol || Core.boxOf(p.r, p.c) === selBox);
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
