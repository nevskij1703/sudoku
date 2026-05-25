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

  // Возвращает variant активного режима (или Classic если active нет).
  // Для mode-зависимых variants (sugur, kropki) пересоздаём concrete variant
  // из сохранённых данных каждый раз — variant-объекты не сериализуются.
  function activeVariant() {
    if (!active) return Core.ClassicVariant;
    const SV = window.SudokuVariants;
    if (!SV) return Core.ClassicVariant;
    if (active.mode === 'sugur' && active.cellSnake && active.cellSnake.length === 81) {
      // Восстанавливаем snakeCells из cellSnake
      const snakeCells = [[], [], [], [], [], [], [], [], []];
      for (let i = 0; i < 81; i++) {
        const s = active.cellSnake[i];
        if (s >= 0 && s < 9) snakeCells[s].push(i);
      }
      return SV.makeSugur(snakeCells, active.cellSnake);
    }
    return SV.byMode(active.mode || 'classic');
  }
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
      selectedIdx: selectedIdx,
      variant:   activeVariant(),
      dots:      active.dots || null,
      cellSnake: active.cellSnake || null
    }, settings);
    window.NumberPad.updateCounts({ board: active.board });
    // Источник правды для счётчика подсказок — Storage.getHints() (глобально,
    // переносится между уровнями). active.hintsUsed остаётся как per-level
    // статистика для модалки win, в UI не отображается.
    window.NumberPad.setHintsLeft(window.Storage.getHints());
    window.UI.setHearts(active.hearts, CFG.BALANCE.heartsPerLevel);
  }

  // ===== Старт нового уровня =====

  function startNewLevel(difficulty, mode) {
    mode = mode || 'classic';
    const SV = window.SudokuVariants;
    const t0 = Date.now();

    // Mode-specific generation paths.
    let gen, dots = null, snakeCells = null, cellSnake = null;
    if (mode === 'kropki' && SV && SV.computeKropkiDots) {
      // Kropki: classic puzzle + dots computed from solution
      gen = Gen.generate(difficulty, { variant: SV.Classic });
      dots = SV.computeKropkiDots(gen.solution);
    } else if (mode === 'sugur' && SV && SV.generateSnakeLayout) {
      // Sugur: змейки + simple puzzle generation. Sudoku solver на random snakes
      // ОЧЕНЬ медленный (countSolutions может быть >1s), поэтому используем
      // упрощённый путь: решаем пустую сетку (получаем solution), удаляем
      // random cells без строгой uniqueness-проверки на каждом шаге. UX
      // trade-off: возможны multi-solution puzzles, но игроку дают подсказки
      // через сами правила змеек.
      const layout = SV.generateSnakeLayout();
      if (!layout) {
        console.warn('[game] sugur layout generation failed, fallback to classic');
        gen = Gen.generate(difficulty, { variant: SV.Classic });
      } else {
        const sugurVariant = SV.makeSugur(layout.snakeCells, layout.cellSnake);
        const t1 = Date.now();
        const sol = Core.solve(new Array(81).fill(0), sugurVariant, Math.random);
        const t2 = Date.now();
        if (!sol) {
          console.warn('[game] sugur solve failed, fallback to classic');
          gen = Gen.generate(difficulty, { variant: SV.Classic });
        } else {
          const removeMap = { easy: 35, medium: 45, hard: 52 };
          const targetRemove = removeMap[difficulty] || 40;
          const puzzle = sol.slice();
          const idxs = Array.from({ length: 81 }, function (_, i) { return i; });
          for (let i = idxs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
          }
          for (let k = 0; k < targetRemove; k++) puzzle[idxs[k]] = 0;
          gen = {
            puzzle: puzzle, solution: sol,
            givens: puzzle.map(function (v) { return v !== 0; }),
            difficulty: difficulty,
            score: targetRemove,
            techniques: {},
            elapsedMs: Date.now() - t1,
            attempts: 1
          };
          console.log('[game] sugur built: solveMs=' + (t2 - t1) + ' totalMs=' + (Date.now() - t1));
        }
        if (gen) {
          snakeCells = layout.snakeCells;
          cellSnake = layout.cellSnake;
        }
      }
    } else {
      const variant = (SV && SV.byMode) ? SV.byMode(mode) : Core.ClassicVariant;
      gen = Gen.generate(difficulty, { variant: variant });
    }

    console.log('[game] generated in', Date.now() - t0, 'ms, score=', Math.round(gen.score),
                'label=', gen.difficulty, 'mode=', mode,
                'dots=', dots ? dots.length : 0, 'techniques=', gen.techniques);

    active = {
      difficulty: difficulty,
      mode: mode,
      dots: dots,
      cellSnake: cellSnake,
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
      // Скрываем неподходящие цифры (Mini → 1-4, остальные 1-9)
      const variantForLevel = (window.SudokuVariants && window.SudokuVariants.byMode)
        ? window.SudokuVariants.byMode(active.mode || 'classic') : Core.ClassicVariant;
      window.NumberPad.setMaxDigit(variantForLevel.size || 9);
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
      const variantForLevel = (window.SudokuVariants && window.SudokuVariants.byMode)
        ? window.SudokuVariants.byMode(active.mode || 'classic') : Core.ClassicVariant;
      window.NumberPad.setMaxDigit(variantForLevel.size || 9);
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
          const peers = activeVariant().peersForCell(idx);
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
    // Глобальный счётчик подсказок — Storage.hints. Если 0, ловится в main.js
    // (rewarded-ad-refill branch); сюда мы попадаем только при getHints() > 0.
    // Дублируем проверку defensive — если кто-то вызвал handleHint() напрямую
    // через консоль, не уходим в минусы.
    if (window.Storage.getHints() <= 0) return;
    const idx = selectedIdx;
    if (active.givens[idx]) return;
    if (active.board[idx] === active.solution[idx]) return;  // уже правильная

    pushUndo();
    active.board[idx] = active.solution[idx];
    active.notes[idx] = 0;
    active.mistakes[idx] = false;
    if (!active.hintCells) active.hintCells = new Array(81).fill(false);
    active.hintCells[idx] = true;
    active.hintsUsed++;                              // per-level статистика
    window.Storage.addHints(-1);                     // глобальный остаток
    window.AudioFX.hint();

    // Auto-clean заметок после подсказки
    if (window.Storage.getSettings().autoNotesClean) {
      const bit = 1 << (active.solution[idx] - 1);
      const peers = activeVariant().peersForCell(idx);
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
      mode: active.mode,
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
    // Reward после rewarded ad в gameover-модалке → +1 сердце.
    // Для других кайндов наград есть отдельные методы (например applyHintReward).
    if (!active) return;
    active.hearts++;
    persist();
    startTimer();
    renderAll();
    emit('change');
  }

  function applyHintReward() {
    // Reward после rewarded ad на кнопке «Подсказка» при hints=0.
    // Глобальный счётчик хранится в Storage, не в active — поэтому можно
    // вызывать как во время уровня (active != null), так и теоретически вне его.
    window.Storage.addHints(1);
    if (active) {
      renderAll();
      emit('change');
    }
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
    applyHintReward: applyHintReward,
    getActive: getActive,
    getSelected: getSelected,
    // dev-helpers
    _renderAll: renderAll,
    _stopTimer: stopTimer,
    _startTimer: startTimer
  };
})();
