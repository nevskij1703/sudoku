/**
 * numberPad.js — нижняя панель: цифры, ластик, карандаш, подсказка.
 *
 * API:
 *   NumberPad.mount(handlers)
 *     handlers: {
 *       onNumber(d): функция, вызывается при клике на цифру 1..9
 *       onErase():   очистить выбранную ячейку
 *       onPencilToggle(active): toggle режима заметок
 *       onHint():    запросить подсказку
 *       onUndo():    отменить последнее действие
 *     }
 *
 *   NumberPad.updateCounts(state) — счётчики «сколько ещё цифр осталось поставить»
 *   NumberPad.setPencilMode(bool)
 *   NumberPad.setHintsLeft(n)
 *   NumberPad.setUndoEnabled(bool)
 */
window.NumberPad = (function () {
  let pencilMode = false;
  let handlers = null;

  function mount(h) {
    handlers = h;
    document.querySelectorAll('.num-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const d = parseInt(btn.dataset.num, 10);
        if (handlers && handlers.onNumber) handlers.onNumber(d);
      });
    });

    document.getElementById('btn-erase').addEventListener('click', function () {
      if (handlers && handlers.onErase) handlers.onErase();
    });

    const pencilBtn = document.getElementById('btn-pencil');
    pencilBtn.addEventListener('click', function () {
      pencilMode = !pencilMode;
      pencilBtn.classList.toggle('active', pencilMode);
      if (handlers && handlers.onPencilToggle) handlers.onPencilToggle(pencilMode);
    });

    document.getElementById('btn-hint').addEventListener('click', function () {
      if (handlers && handlers.onHint) handlers.onHint();
    });

    document.getElementById('btn-undo').addEventListener('click', function () {
      if (handlers && handlers.onUndo) handlers.onUndo();
    });
  }

  function isPencilMode() { return pencilMode; }

  function setPencilMode(v) {
    pencilMode = !!v;
    const pencilBtn = document.getElementById('btn-pencil');
    if (pencilBtn) pencilBtn.classList.toggle('active', pencilMode);
  }

  function updateCounts(state) {
    // Считаем для каждой цифры 1..9 сколько штук уже выставлено на поле (в board).
    // Если выставлено 9 — кнопка depleted. Счётчик показывает «9 - выставлено».
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // index 1..9
    for (let i = 0; i < 81; i++) {
      const v = state.board[i];
      if (v >= 1 && v <= 9) counts[v]++;
    }
    document.querySelectorAll('.num-btn').forEach(function (btn) {
      const d = parseInt(btn.dataset.num, 10);
      const cnt = counts[d];
      const remaining = 9 - cnt;
      const badge = btn.querySelector('.count');
      if (badge) badge.textContent = remaining > 0 ? String(remaining) : '';
      btn.classList.toggle('depleted', remaining <= 0);
    });
  }

  function setHintsLeft(n) {
    const badge = document.getElementById('hint-count');
    if (badge) badge.textContent = String(Math.max(0, n));
    const btn = document.getElementById('btn-hint');
    if (btn) btn.classList.toggle('depleted', n <= 0);
  }

  function setUndoEnabled(enabled) {
    const btn = document.getElementById('btn-undo');
    if (btn) btn.style.opacity = enabled ? '1' : '0.3';
  }

  return {
    mount: mount,
    isPencilMode: isPencilMode,
    setPencilMode: setPencilMode,
    updateCounts: updateCounts,
    setHintsLeft: setHintsLeft,
    setUndoEnabled: setUndoEnabled
  };
})();
