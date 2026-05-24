/**
 * numberPad.js — нижняя панель: цифры, карандаш, подсказка, отмена.
 *
 * API:
 *   NumberPad.mount(handlers)
 *     handlers: {
 *       onNumber(d): функция, вызывается при клике на цифру 1..9
 *       onPencilToggle(active): toggle режима заметок
 *       onHint():    запросить подсказку
 *       onUndo():    отменить последнее действие
 *     }
 *
 *   NumberPad.updateDepleted(state) — пометить цифры, которых уже 9 на поле
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

    const pencilBtn = document.getElementById('btn-pencil');
    if (pencilBtn) {
      pencilBtn.addEventListener('click', function () {
        pencilMode = !pencilMode;
        pencilBtn.classList.toggle('active', pencilMode);
        if (handlers && handlers.onPencilToggle) handlers.onPencilToggle(pencilMode);
      });
    }

    const hintBtn = document.getElementById('btn-hint');
    if (hintBtn) hintBtn.addEventListener('click', function () {
      if (handlers && handlers.onHint) handlers.onHint();
    });

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', function () {
      if (handlers && handlers.onUndo) handlers.onUndo();
    });
  }

  function isPencilMode() { return pencilMode; }

  function setPencilMode(v) {
    pencilMode = !!v;
    const pencilBtn = document.getElementById('btn-pencil');
    if (pencilBtn) pencilBtn.classList.toggle('active', pencilMode);
  }

  function updateDepleted(state) {
    // Считаем для каждой цифры 1..9 сколько штук уже выставлено на поле.
    // Если выставлено 9 — кнопка depleted (полупрозрачна).
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 81; i++) {
      const v = state.board[i];
      if (v >= 1 && v <= 9) counts[v]++;
    }
    document.querySelectorAll('.num-btn').forEach(function (btn) {
      const d = parseInt(btn.dataset.num, 10);
      btn.classList.toggle('depleted', counts[d] >= 9);
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
    updateDepleted: updateDepleted,
    // Алиас для совместимости со старым именованием:
    updateCounts: updateDepleted,
    setHintsLeft: setHintsLeft,
    setUndoEnabled: setUndoEnabled
  };
})();
