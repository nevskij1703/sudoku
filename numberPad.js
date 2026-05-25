/**
 * numberPad.js — нижняя панель: цифры, ластик, карандаш, быстрый режим,
 * подсказка.
 *
 * API:
 *   NumberPad.mount(handlers)
 *     handlers: {
 *       onNumber(d): функция, вызывается при клике на цифру 1..9
 *       onPencilToggle(active): toggle режима заметок
 *       onHint():    запросить подсказку
 *       onErase():   очистить выбранную ячейку (цифра + заметки + ошибка)
 *       onFastToggle(): toggle быстрого режима (см. main.js — там логика
 *                       rewarded-ad и Game.setFastModeActive)
 *     }
 *
 *   NumberPad.updateDepleted(state)
 *   NumberPad.setPencilMode(bool)
 *   NumberPad.setPencilEnabled(bool)  — отключает кнопку карандаша
 *   NumberPad.setHintsLeft(n)
 *   NumberPad.setFastState({unlocked, active}) — статус быстрого режима
 *   NumberPad.setUndoEnabled(bool) — no-op, для обратной совместимости
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

    const eraseBtn = document.getElementById('btn-erase');
    if (eraseBtn) eraseBtn.addEventListener('click', function () {
      if (handlers && handlers.onErase) handlers.onErase();
    });

    const fastBtn = document.getElementById('btn-fast');
    if (fastBtn) fastBtn.addEventListener('click', function () {
      if (handlers && handlers.onFastToggle) handlers.onFastToggle();
    });
  }

  // Управляет UI кнопки «Быстрый режим». unlocked=false → бэйдж «▶»
  // (приглашает посмотреть rewarded ad). unlocked=true → бэйдж скрыт,
  // обычный toggle. active=true → синяя подсветка (.fast-active).
  function setFastState(s) {
    const btn = document.getElementById('btn-fast');
    const badge = document.getElementById('fast-badge');
    if (!btn) return;
    const unlocked = !!(s && s.unlocked);
    const active   = !!(s && s.active);
    btn.classList.toggle('fast-active', active);
    if (badge) badge.style.display = unlocked ? 'none' : '';
  }

  // Включает/выключает кнопку карандаша. Используется когда активен
  // Быстрый режим — там карандашные заметки управляются автоматически,
  // ручное toggle лишь сбивает игрока.
  function setPencilEnabled(enabled) {
    const btn = document.getElementById('btn-pencil');
    if (!btn) return;
    btn.classList.toggle('disabled', !enabled);
  }

  function isPencilMode() { return pencilMode; }

  // Скрывает кнопки старше maxDigit (для Mini 4×4 → maxDigit=4, кнопки 5-9 скрыты).
  // Дополнительно: при max=4 включаем «numpad-compact» — 4 кнопки центрируются
  // по экрану с шире-подложками (см. CSS .number-pad.numpad-compact).
  function setMaxDigit(max) {
    document.querySelectorAll('.num-btn').forEach(function (btn) {
      const d = parseInt(btn.dataset.num, 10);
      btn.style.display = d <= max ? '' : 'none';
    });
    const padEl = document.querySelector('.number-pad');
    if (padEl) padEl.classList.toggle('numpad-compact', max < 9);
  }

  function setPencilMode(v) {
    pencilMode = !!v;
    const pencilBtn = document.getElementById('btn-pencil');
    if (pencilBtn) pencilBtn.classList.toggle('active', pencilMode);
  }

  function updateDepleted(state) {
    // Считаем для каждой цифры сколько штук уже выставлено на поле. Цифра
    // считается «исчерпанной» (depleted, полупрозрачная кнопка), если её
    // экземпляров на поле = size (4 для Mini 4×4, 9 для всех 9×9 режимов).
    // Размер выводим из state.board.length: 16 → Mini (size=4), 81 → 9×9.
    const cellCount = state.board.length;
    const size = (cellCount === 16) ? 4 : 9;
    const counts = new Array(size + 1).fill(0);
    for (let i = 0; i < cellCount; i++) {
      const v = state.board[i];
      if (v >= 1 && v <= size) counts[v]++;
    }
    document.querySelectorAll('.num-btn').forEach(function (btn) {
      const d = parseInt(btn.dataset.num, 10);
      btn.classList.toggle('depleted', d <= size && counts[d] >= size);
    });
  }

  function setHintsLeft(n) {
    const badge = document.getElementById('hint-count');
    const btn = document.getElementById('btn-hint');
    const remaining = Math.max(0, n | 0);
    if (badge) {
      if (remaining === 0) {
        // Подсказки кончились — превращаем бэйдж в круглый «▶» (тот же
        // визуальный паттерн, что у Быстрого режима), который приглашает
        // посмотреть rewarded ad. Клик по кнопке в этом состоянии
        // ловится в main.js: вместо Game.handleHint() уходим в
        // requestHintRefill() (AdManager.showRewardedAd → +1 подсказка).
        badge.innerHTML = '<svg class="ad-play-icon" viewBox="0 0 12 12">'
                       + '<use href="#icon-play-mini"/></svg>';
        badge.classList.add('refill-ad');
      } else {
        badge.textContent = String(remaining);
        badge.classList.remove('refill-ad');
      }
    }
    // Класс .depleted раньше делал кнопку полупрозрачной при 0. Теперь
    // при 0 кнопка остаётся «активной» (юзер может нажать → реклама),
    // .depleted применяем только если refill SDK тоже недоступен —
    // но эту тонкость решаем в main.js, тут оставляем кнопку кликабельной.
    if (btn) btn.classList.remove('depleted');
  }

  function setUndoEnabled(enabled) {
    // Кнопка undo заменена на «Стереть». No-op оставлен для обратной
    // совместимости вызовов из game.js (Game.startNewLevel и pushUndo).
    // Логику undo в Game оставили на месте — может пригодиться в будущем,
    // но больше не привязана к UI.
  }

  return {
    mount: mount,
    isPencilMode: isPencilMode,
    setPencilMode: setPencilMode,
    setPencilEnabled: setPencilEnabled,
    updateDepleted: updateDepleted,
    // Алиас для совместимости со старым именованием:
    updateCounts: updateDepleted,
    setHintsLeft: setHintsLeft,
    setUndoEnabled: setUndoEnabled,
    setMaxDigit: setMaxDigit,
    setFastState: setFastState
  };
})();
