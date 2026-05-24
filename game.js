/**
 * game.js — state machine текущего уровня Sudoku.
 *
 * Хранит in-memory state.active (с дублированием в Storage для resume).
 * Отвечает за: установку цифр, заметки карандашом, ластик, подсказки,
 * сердца, undo-стек, проверка win/lose.
 *
 * API:
 *   Game.startNewLevel(difficulty, mode)  → начинает свежий уровень
 *   Game.resumeActive()                    → восстанавливает active из Storage
 *   Game.handleCellClick(idx)
 *   Game.handleNumber(d)
 *   Game.handleErase()
 *   Game.handleHint()
 *   Game.handleUndo()
 *   Game.setPencilMode(bool)
 *   Game.getActive()                       → текущий state.active (read-only)
 *   Game.applyAdReward(reward)             → +1 сердце после rewarded ad
 *   Game.abandon()                         → выйти из уровня без сохранения прогресса
 */
window.Game = (function () {
  const Core   = window.SudokuCore;
  const Gen    = window.SudokuGenerator;
  const CFG    = window.GAME_CONFIG;

  // ===== State =====
  let active = null;            // см. структуру в storage.js → DEFAULTS().active
  let selectedIdx = null;
  let undoStack = [];           // массив снапшотов {board, notes, mistakes, hearts, hintsUsed}
  let timerInterval = null;
  let timerBaseMs = 0;          // active.elapsedMs на момент resume / 0 для нового
  let timerStartedAt = 0;
  let pencilMode = false;
  let listeners = {};           // подписки: 'change', 'win', 'gameover', 'heartLost'

  function on(event, cb) { listeners[event] = (listeners[event] || []).concat(cb); }
  function emit(event, payload) { (listeners[event] || []).forEach(function (cb) { cb(payload); }); }

  function clone(arr) { return arr.slice(); }

  function startTimer() {
    stopTimer();
    timerStartedAt = Date.now();
    // Таймер считает elapsedMs всегда (нужен для статистики), но визуальное
    // отображение убрано из игрового экрана. Если когда-нибудь снова появится
    // элемент #game-timer — он начнёт обновляться сам.
    const tickEl = document.getElementById('game-timer');
    if (tickEl) {
      timerInterval = setInterval(function () {
        tickEl.textContent = window.UI.formatTime(getElapsedMs());
      }, 1000);
    }
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function getElapsedMs() {
    if (!timerStartedAt) return timerBaseMs;
    return timerBaseMs + (Date.now() - timerStartedAt);
  }

  function persist() {
    if (!active) return;
    active.elapsedMs = getElapsedMs();
    window.Storage.setActive(active);
  }

  function makeSnapshot() {
    return {
      board: clone(active.board),
      notes: clone(active.notes),
      mistakes: clone(active.mistakes),
      hearts: active.hearts,
      hintsUsed: active.hintsUsed,
      hintCells: clone(active.hintCells || new Array(81).fill(false))
    };
  }

  function pushUndo() {
    undoStack.push(makeSnapshot());
    if (undoStack.length > CFG.BALANCE.undoStackSize) undoStack.shift();
    if (window.NumberPad) window.NumberPad.setUndoEnabled(true);
  }

  function applySnapshot(s) {
    active.board    = s.board;
    active.notes    = s.notes;
    active.mistakes = s.mistakes;
    active.hearts   = s.hearts;
    active.hintsUsed = s.hintsUsed;
    active.hintCells = s.hintCells;
  }

  function renderAll() {
    const settings = window.Storage.getSettings();
    window.Board.render({
      board:     active.board,
      notes:     active.notes,
      mistakes:  active.mistakes,
      givens:    active.givens,
      hintCells: active.hintCells || new Array(81).fill(false),
      selectedIdx: selectedIdx
    }, settings);
    window.NumberPad.updateCounts({ board: active.board });
    window.NumberPad.setHintsLeft(CFG.BALANCE.hintsPerLevel - active.hintsUsed);
    window.UI.setHearts(active.hearts, CFG.BALANCE.heartsPerLevel);
  }

  // ===== Старт нового уровня =====

  function startNewLevel(difficulty, mode) {
    mode = mode || 'classic';
    const t0 = Date.now();
    const gen = Gen.generate(difficulty);
    console.log('[game] generated in', Date.now() - t0, 'ms, score=', Math.round(gen.score),
                'label=', gen.difficulty, 'techniques=', gen.techniques);

    active = {
      difficulty: difficulty,
      mode: mode,
      puzzle:    gen.puzzle,
      solution:  gen.solution,
      givens:    gen.givens,
      board:     gen.puzzle.slice(),
      notes:     new Array(81).fill(0),
      mistakes:  new Array(81).fill(false),
      hintCells: new Array(81).fill(false),
      hearts:    CFG.BALANCE.heartsPerLevel,
      hintsUsed: 0,
      elapsedMs: 0,
      score:     gen.score
    };
    selectedIdx = null;
    undoStack = [];
    timerBaseMs = 0;
    pencilMode = false;
    if (window.NumberPad) {
      window.NumberPad.setPencilMode(false);
      window.NumberPad.setUndoEnabled(false);
    }

    persist();
    startTimer();
    renderAll();
    emit('change');
  }

  function resumeActive() {
    const stored = window.Storage.getActive();
    if (!stored) return false;
    active = stored;
    selectedIdx = null;
    undoStack = [];
    timerBaseMs = active.elapsedMs || 0;
    pencilMode = false;
    if (window.NumberPad) {
      window.NumberPad.setPencilMode(false);
      window.NumberPad.setUndoEnabled(false);
    }
    startTimer();
    renderAll();
    emit('change');
    return true;
  }

  function abandon() {
    stopTimer();
    window.Storage.clearActive();
    active = null;
    selectedIdx = null;
    undoStack = [];
  }

  // ===== Обработчики ввода =====

  function handleCellClick(idx) {
    if (!active) return;
    selectedIdx = idx;
    window.AudioFX.click();
    renderAll();
  }

  function handleNumber(d) {
    if (!active || selectedIdx == null) return;
    const idx = selectedIdx;

    // Given-ячейку нельзя менять. Hint-ячейку тоже (она заблочена).
    if (active.givens[idx]) return;
    if (active.hintCells && active.hintCells[idx]) return;

    if (pencilMode) {
      // Если в ячейке уже стоит цифра — карандаш не работает поверх.
      if (active.board[idx] !== 0) return;
      pushUndo();
      const bit = 1 << (d - 1);
      active.notes[idx] = (active.notes[idx] ^ bit) & 0x1FF;
      window.AudioFX.note();
    } else {
      // Если ячейка уже содержит ровно эту цифру — повторный клик сотрёт её.
      if (active.board[idx] === d) {
        pushUndo();
        active.board[idx] = 0;
        active.mistakes[idx] = false;
        persist();
        renderAll();
        emit('change');
        return;
      }
      pushUndo();
      active.board[idx] = d;
      active.notes[idx] = 0;

      const isCorrect = active.solution[idx] === d;
      if (isCorrect) {
        active.mistakes[idx] = false;
        window.AudioFX.place();
        // Auto-clean заметок
        if (window.Storage.getSettings().autoNotesClean) {
          const bit = 1 << (d - 1);
          const peers = Core.ClassicVariant.peersForCell(idx);
          for (let k = 0; k < peers.length; k++) {
            if (active.notes[peers[k]] & bit) active.notes[peers[k]] &= ~bit;
          }
        }
        // Победа?
        if (isWin()) {
          persist();
          renderAll();
          onWin();
          return;
        }
      } else {
        active.mistakes[idx] = true;
        active.hearts--;
        window.AudioFX.mistake();
        emit('heartLost', { hearts: active.hearts });
        if (active.hearts <= 0) {
          persist();
          renderAll();
          onGameOver();
          return;
        }
      }
    }

    persist();
    renderAll();
    emit('change');
  }

  function handleErase() {
    if (!active || selectedIdx == null) return;
    const idx = selectedIdx;
    if (active.givens[idx]) return;
    if (active.hintCells && active.hintCells[idx]) return;
    if (active.board[idx] === 0 && active.notes[idx] === 0 && !active.mistakes[idx]) return;
    pushUndo();
    active.board[idx] = 0;
    active.notes[idx] = 0;
    active.mistakes[idx] = false;
    window.AudioFX.click();
    persist();
    renderAll();
    emit('change');
  }

  function handleHint() {
    if (!active || selectedIdx == null) return;
    const remaining = CFG.BALANCE.hintsPerLevel - active.hintsUsed;
    if (remaining <= 0) return;
    const idx = selectedIdx;
    if (active.givens[idx]) return;
    if (active.board[idx] === active.solution[idx]) return;  // уже правильная

    pushUndo();
    active.board[idx] = active.solution[idx];
    active.notes[idx] = 0;
    active.mistakes[idx] = false;
    if (!active.hintCells) active.hintCells = new Array(81).fill(false);
    active.hintCells[idx] = true;
    active.hintsUsed++;
    window.AudioFX.hint();

    // Auto-clean заметок после подсказки
    if (window.Storage.getSettings().autoNotesClean) {
      const bit = 1 << (active.solution[idx] - 1);
      const peers = Core.ClassicVariant.peersForCell(idx);
      for (let k = 0; k < peers.length; k++) {
        if (active.notes[peers[k]] & bit) active.notes[peers[k]] &= ~bit;
      }
    }

    if (isWin()) {
      persist();
      renderAll();
      onWin();
      return;
    }
    persist();
    renderAll();
    emit('change');
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const snap = undoStack.pop();
    applySnapshot(snap);
    if (undoStack.length === 0 && window.NumberPad) window.NumberPad.setUndoEnabled(false);
    persist();
    renderAll();
    emit('change');
  }

  function setPencilMode(v) {
    pencilMode = !!v;
  }

  // ===== Win / Lose =====

  function isWin() {
    for (let i = 0; i < 81; i++) {
      if (active.board[i] === 0) return false;
      if (active.board[i] !== active.solution[i]) return false;
    }
    return true;
  }

  function onWin() {
    stopTimer();
    window.AudioFX.win();
    const elapsed = getElapsedMs();
    const mistakesCount = active.mistakes.reduce(function (s, m) { return s + (m ? 1 : 0); }, 0);
    window.Storage.incrementCompleted(active.difficulty);
    const data = {
      difficulty: active.difficulty,
      elapsedMs: elapsed,
      mistakes: mistakesCount,
      hintsUsed: active.hintsUsed
    };
    window.Storage.clearActive();
    emit('win', data);
  }

  function onGameOver() {
    stopTimer();
    window.AudioFX.lose();
    emit('gameover');
  }

  function applyAdReward(reward) {
    if (!active) return;
    active.hearts++;
    persist();
    startTimer();
    renderAll();
    emit('change');
  }

  function getActive() { return active; }
  function getSelected() { return selectedIdx; }

  return {
    on: on,
    startNewLevel: startNewLevel,
    resumeActive: resumeActive,
    abandon: abandon,
    handleCellClick: handleCellClick,
    handleNumber: handleNumber,
    handleErase: handleErase,
    handleHint: handleHint,
    handleUndo: handleUndo,
    setPencilMode: setPencilMode,
    applyAdReward: applyAdReward,
    getActive: getActive,
    getSelected: getSelected,
    // dev-helpers
    _renderAll: renderAll,
    _stopTimer: stopTimer,
    _startTimer: startTimer
  };
})();
