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
  // Таймер каскадного заполнения в Быстром режиме. Сбрасывается при
  // выключении режима, win, gameover, abandon, startNewLevel.
  let fastTimer = null;

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
    if (active.mode === 'chain' && active.cellChain && active.cellChain.length === 81) {
      const chainCells = [[], [], [], [], [], [], [], [], []];
      for (let i = 0; i < 81; i++) {
        const s = active.cellChain[i];
        if (s >= 0 && s < 9) chainCells[s].push(i);
      }
      return SV.makeChain(chainCells, active.cellChain, active.chainEdges || []);
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
    // Сохраняем в слот своего режима. Слоты других режимов не трогаем —
    // юзер может переключаться между ними и каждый сохраняет своё состояние.
    window.Storage.setActiveByMode(active.mode || 'classic', active);
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
      cellSnake: active.cellSnake || null,
      cellChain: active.cellChain || null,
      chainEdges: active.chainEdges || null
    }, settings);
    window.NumberPad.updateCounts({ board: active.board });
    // Источник правды для счётчика подсказок — Storage.getHints() (глобально,
    // переносится между уровнями). active.hintsUsed остаётся как per-level
    // статистика для модалки win, в UI не отображается.
    window.NumberPad.setHintsLeft(window.Storage.getHints());
    // Синхронизируем UI быстрого режима с active state. Делается на каждый
    // renderAll — поэтому setFastModeActive/unlockFastMode не обязаны сами
    // дёргать NumberPad: достаточно что они вызывают renderAll/emit('change').
    window.NumberPad.setFastState({
      unlocked: !!active.fastModeUnlocked,
      active:   !!active.fastModeActive
    });
    window.NumberPad.setPencilEnabled(!active.fastModeActive);
    window.UI.setHearts(active.hearts, CFG.BALANCE.heartsPerLevel);
  }

  // ===== Старт нового уровня =====

  function startNewLevel(difficulty, mode) {
    mode = mode || 'classic';
    const SV = window.SudokuVariants;
    const t0 = Date.now();

    // Mode-specific generation paths.
    let gen, dots = null, snakeCells = null, cellSnake = null;
    let cellChain = null, chainEdges = null;
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
    } else if (mode === 'chain' && SV && SV.generateChainLayout) {
      // Chain: 9 цепочек с 8-связностью + simplified puzzle generation
      // (тот же UX trade-off что у Sugur — без строгой uniqueness-проверки
      // на каждом удалении, т.к. countSolutions на random chains может
      // занимать секунды). Решаем пустую сетку → удаляем N random cells.
      const layout = SV.generateChainLayout();
      if (!layout) {
        console.warn('[game] chain layout generation failed, fallback to classic');
        gen = Gen.generate(difficulty, { variant: SV.Classic });
      } else {
        const chainVariant = SV.makeChain(layout.chainCells, layout.cellChain, layout.edges);
        const t1 = Date.now();
        const sol = Core.solve(new Array(81).fill(0), chainVariant, Math.random);
        const t2 = Date.now();
        if (!sol) {
          console.warn('[game] chain solve failed, fallback to classic');
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
          console.log('[game] chain built: solveMs=' + (t2 - t1) + ' totalMs=' + (Date.now() - t1));
        }
        if (gen) {
          cellChain  = layout.cellChain;
          chainEdges = layout.edges;
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
      cellChain: cellChain,
      chainEdges: chainEdges,
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
      score:     gen.score,
      // Быстрый режим — per-level, сбрасывается при каждом startNewLevel.
      fastModeUnlocked: false,
      fastModeActive:   false
    };
    selectedIdx = null;
    undoStack = [];
    timerBaseMs = 0;
    pencilMode = false;
    clearFastTimer();
    if (window.NumberPad) {
      window.NumberPad.setPencilMode(false);
      window.NumberPad.setUndoEnabled(false);
      window.NumberPad.setPencilEnabled(true);
      window.NumberPad.setFastState({ unlocked: false, active: false });
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

  // Загружает в память сейв выбранного режима из Storage. Используется при
  // нажатии «Продолжить» в save-modal на главном экране.
  function resumeMode(mode) {
    const stored = window.Storage.getActiveByMode(mode);
    if (!stored) return false;
    active = stored;
    selectedIdx = null;
    undoStack = [];
    timerBaseMs = active.elapsedMs || 0;
    pencilMode = false;
    clearFastTimer();
    if (window.NumberPad) {
      window.NumberPad.setPencilMode(false);
      window.NumberPad.setUndoEnabled(false);
      const variantForLevel = (window.SudokuVariants && window.SudokuVariants.byMode)
        ? window.SudokuVariants.byMode(active.mode || 'classic') : Core.ClassicVariant;
      window.NumberPad.setMaxDigit(variantForLevel.size || 9);
      // Восстанавливаем UI быстрого режима: бэйдж скрыт если уже unlocked,
      // подсветка кнопки — если был активен. Карандаш — disabled если active.
      const fastUnlocked = !!active.fastModeUnlocked;
      const fastActive   = !!active.fastModeActive;
      window.NumberPad.setFastState({ unlocked: fastUnlocked, active: fastActive });
      window.NumberPad.setPencilEnabled(!fastActive);
      // Если уровень был сохранён в активной фазе быстрого режима —
      // продолжаем каскад с того места.
      if (fastActive) scheduleFastStep(300);
    }
    startTimer();
    renderAll();
    emit('change');
    return true;
  }

  // Legacy: первый попавшийся сейв (если есть). Используется в обработчике
  // auto-resume на старте — он же показывает home-экран, если ничего не нашёл.
  function resumeActive() {
    const modes = window.Storage.getAllActiveModes();
    if (!modes.length) return false;
    return resumeMode(modes[0]);
  }

  // Выходим из текущего уровня в меню. ВАЖНО: сейв НЕ удаляем — слот
  // соответствующего режима остаётся в Storage, и юзер может вернуться к
  // нему через «Продолжить» на home-экране. Это и есть «выйти в меню,
  // потом продолжить» сценарий.
  function leaveToMenu() {
    if (active) persist();   // зафиксировать текущее состояние
    stopTimer();
    clearFastTimer();
    active = null;
    selectedIdx = null;
    undoStack = [];
  }

  // Полный отказ от уровня — сейв этого режима удаляется. Используется при
  // нажатии «Начать заново» (модалка save-confirm) и при «Новый уровень» в
  // game-over (юзер хочет именно свежий уровень, не продолжать старый).
  function abandon() {
    const m = active ? (active.mode || 'classic') : null;
    stopTimer();
    clearFastTimer();
    if (m) window.Storage.clearActiveByMode(m);
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

    // В быстром режиме pencil заблокирован (см. NumberPad.setPencilEnabled),
    // но если кто-то всё-таки взвёл pencilMode — игнорируем pencil-ввод.
    if (active.fastModeActive && pencilMode) return;

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
        // Если включён быстрый режим — после ручного хода игрока могут
        // открыться новые single-candidate ячейки. Продолжаем каскад.
        if (active.fastModeActive) scheduleFastStep(180);
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
    const hasNotes  = active.notes[idx] !== 0;
    const isMistake = !!active.mistakes[idx];
    const hasValue  = active.board[idx] !== 0;
    // Стереть НЕЛЬЗЯ если стоит правильная цифра (mistake=false при заполненной
    // ячейке означает корректное значение). Так пользователь не сотрёт случайно
    // свою же верную работу. Можно стереть только когда есть что-то «спорное»:
    // заметки или ошибочная цифра.
    if (!hasNotes && !isMistake) return;
    pushUndo();
    if (isMistake) {
      active.board[idx] = 0;
      active.mistakes[idx] = false;
    }
    // Заметки чистим всегда — даже если поверх стоит правильная цифра, чистая
    // ячейка визуально удобнее. (При правильной цифре заметки и так не видны,
    // но логически их лучше убрать, чтобы не остаться скрытыми.)
    if (hasNotes) active.notes[idx] = 0;
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
    clearFastTimer();
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
    // Сейв пройденного режима удаляем — следующий заход в этот режим
    // не предложит «Продолжить».
    window.Storage.clearActiveByMode(active.mode || 'classic');
    emit('win', data);
  }

  function onGameOver() {
    stopTimer();
    clearFastTimer();
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

  // === Быстрый режим (fast mode) ===
  //
  // Активация — через rewarded ad ОДИН РАЗ за уровень (main.js обрабатывает
  // флоу рекламы и зовёт setFastModeActive(true)). После активации флаг
  // `active.fastModeUnlocked = true` сохраняется в Storage вместе со всем
  // активом, и в рамках уровня кнопка свободно toggle'ится. При новом
  // уровне (startNewLevel) флаг сбрасывается → юзер снова должен смотреть
  // рекламу.
  //
  // При включении: пересчитываются заметки всех пустых ячеек до полного
  // набора кандидатов (с учётом variant peers и исключая mistakes). Если
  // образуются single-candidate ячейки — стартует каскадная цепочка
  // автозаполнения (`runFastModeStep`), которая может полностью решить
  // уровень за пару секунд.
  //
  // При выключении: notes остаются как есть, дальше игрок работает руками.

  function getFastState() {
    if (!active) return { unlocked: false, active: false };
    return {
      unlocked: !!active.fastModeUnlocked,
      active:   !!active.fastModeActive
    };
  }

  function setFastModeActive(on) {
    if (!active) return;
    on = !!on;
    if (on) {
      // Активация всегда требует unlocked. Если ещё не — это баг вызывающего.
      if (!active.fastModeUnlocked) {
        console.warn('[fast] setFastModeActive(true) called before unlock');
        return;
      }
      active.fastModeActive = true;
      recomputeAllNotes();
      persist();
      renderAll();
      emit('change');
      scheduleFastStep(150);   // короткий лаг до первого автозаполнения
    } else {
      active.fastModeActive = false;
      clearFastTimer();
      persist();
      renderAll();
      emit('change');
    }
  }

  // Помечает что юзер уже посмотрел rewarded-ad (или иначе разблокировал
  // фичу) в текущем уровне. Дальше setFastModeActive можно дёргать без ads.
  function unlockFastMode() {
    if (!active) return;
    active.fastModeUnlocked = true;
    persist();
    renderAll();
    emit('change');
  }

  function clearFastTimer() {
    if (fastTimer) { clearTimeout(fastTimer); fastTimer = null; }
  }

  function scheduleFastStep(delayMs) {
    clearFastTimer();
    fastTimer = setTimeout(runFastModeStep, delayMs);
  }

  // Пересчитывает заметки для всех пустых не-given ячеек, основываясь на
  // правилах текущего variant. mistakes игнорируются (они «не считаются» как
  // финальные цифры). hint/given cells получают notes=0.
  function recomputeAllNotes() {
    if (!active) return;
    const variant = activeVariant();
    const ALL = variant.ALL_MASK || 0x1FF;
    const N = active.board.length;
    for (let i = 0; i < N; i++) {
      if (active.givens[i] || (active.hintCells && active.hintCells[i]) || active.board[i] !== 0) {
        active.notes[i] = 0;
        continue;
      }
      let mask = ALL;
      const peers = variant.peersForCell(i);
      for (let k = 0; k < peers.length; k++) {
        const p = peers[k];
        if (active.mistakes[p]) continue;   // ошибочные цифры не блокируют кандидатов
        const v = active.board[p];
        if (v >= 1 && v <= variant.size) mask &= ~(1 << (v - 1));
      }
      active.notes[i] = mask;
    }
  }

  // Шаг каскада: ищет ПЕРВУЮ пустую ячейку с ровно 1 candidate в notes,
  // ставит туда цифру, чистит соответствующий бит у peer'ов, проигрывает
  // звук, шлёт board flash-анимацию, и планирует следующий шаг с задержкой.
  // Если single-candidate не нашлось — цепочка останавливается.
  function runFastModeStep() {
    fastTimer = null;
    if (!active || !active.fastModeActive) return;
    let singleIdx = -1;
    let singleBit = 0;
    for (let i = 0; i < active.board.length; i++) {
      if (active.board[i] !== 0) continue;
      const m = active.notes[i];
      if (m === 0) continue;
      // Точно один бит установлен? m & (m-1) === 0 + m !== 0
      if ((m & (m - 1)) === 0) {
        singleIdx = i;
        singleBit = m;
        break;
      }
    }
    if (singleIdx === -1) return;   // нет одиночек — каскад окончен
    // Преобразуем bit → digit (1..9)
    let d = 0;
    for (let bi = 0; bi < 9; bi++) if (singleBit & (1 << bi)) { d = bi + 1; break; }
    if (d === 0) return;

    active.board[singleIdx] = d;
    active.notes[singleIdx] = 0;
    active.mistakes[singleIdx] = false;
    // Auto-clean: убираем этот бит из notes peer'ов
    const peers = activeVariant().peersForCell(singleIdx);
    const bit = 1 << (d - 1);
    for (let k = 0; k < peers.length; k++) {
      if (active.notes[peers[k]] & bit) active.notes[peers[k]] &= ~bit;
    }
    window.AudioFX.place();
    persist();
    renderAll();
    if (window.Board && window.Board.flashFastFill) window.Board.flashFastFill(singleIdx);
    if (isWin()) { onWin(); return; }
    scheduleFastStep(180);
  }

  function getActive() { return active; }
  function getSelected() { return selectedIdx; }

  return {
    on: on,
    startNewLevel: startNewLevel,
    resumeActive: resumeActive,
    resumeMode: resumeMode,
    leaveToMenu: leaveToMenu,
    abandon: abandon,
    handleCellClick: handleCellClick,
    handleNumber: handleNumber,
    handleErase: handleErase,
    handleHint: handleHint,
    handleUndo: handleUndo,
    setPencilMode: setPencilMode,
    applyAdReward: applyAdReward,
    applyHintReward: applyHintReward,
    // Быстрый режим
    getFastState: getFastState,
    unlockFastMode: unlockFastMode,
    setFastModeActive: setFastModeActive,
    getActive: getActive,
    getSelected: getSelected,
    // dev-helpers
    _renderAll: renderAll,
    _stopTimer: stopTimer,
    _startTimer: startTimer
  };
})();
