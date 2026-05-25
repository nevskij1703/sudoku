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

  // Уровень считается «нетронутым», если игрок ничего не сделал
  // (board совпадает со стартовым puzzle, нет заметок/подсказок/ошибок,
  // hearts полные, fast-mode не задействован). Такие сейвы не сохраняем:
  // если игрок просто открыл уровень и вышел, в следующий раз поле
  // должно сгенерироваться с нуля, а не предлагаться продолжить пустой
  // уровень.
  function isUntouched() {
    if (!active) return true;
    for (let i = 0; i < active.board.length; i++) {
      if (active.board[i] !== active.puzzle[i]) return false;
      if (active.notes[i] !== 0) return false;
      if (active.hintCells && active.hintCells[i]) return false;
    }
    if (active.hearts !== CFG.BALANCE.heartsPerLevel) return false;
    if (active.hintsUsed > 0) return false;
    if (active.fastModeUnlocked || active.fastModeActive) return false;
    return true;
  }

  function persist() {
    if (!active) return;
    const mode = active.mode || 'classic';
    const diff = active.difficulty || 'medium';
    if (isUntouched()) {
      // Untouched уровень — не сохраняем (и подчищаем слот если он там был).
      window.Storage.clearActiveByMode(mode, diff);
      return;
    }
    active.elapsedMs = getElapsedMs();
    window.Storage.setActiveByMode(mode, diff, active);
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

    // ===== Sugur/Chain: pre-baked pool болванок + on-the-fly relabel-carve =====
    // Sugur и Chain — режимы с произвольной геометрией регионов. Generation
    // на лету (variant-solver) уходит в долгий поиск, особенно с 8-связностью.
    // Поэтому 25 болванок (solution+layout) пред-сгенерены оффлайн в
    // tools/bake-pools.js → precomputedPools.js. При каждом старте уровня:
    //   1. Берём template по индексу (Storage.getNextTemplateIndex, циклично).
    //   2. Делаем random relabel — permutation 1..9 (например 3→7, 7→9, 9→3).
    //      Это сохраняет valid solution и даёт визуально разные цифры на тех
    //      же layouts.
    //   3. Случайно открываем N cells (puzzle = solution с дырами): 45/35/28
    //      givens для easy/medium/hard. Без uniqueness check — UX trade-off
    //      приемлемый, layouts уже валидные.
    //
    // Это даёт практически unlimited unique puzzles из 25 болванок: 25 × 9!
    // (≈9 миллионов) комбинаций для одного режима.
    //
    // При недоступности пула — fallback на старую логику (classic blocks для
    // sugur, random walk для chain).
    if ((mode === 'sugur' || mode === 'chain')
        && window.PrecomputedPools
        && window.PrecomputedPools[mode]
        && window.PrecomputedPools[mode].length) {
      const pool = window.PrecomputedPools[mode];
      const idx = window.Storage.getNextTemplateIndex(mode, pool.length);
      const tpl = pool[idx];
      // Random relabel — permutation цифр 1..9
      const perm = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
      }
      // map[d] = новая цифра для d (d ∈ 1..9). perm[d-1] = новая цифра.
      const relabeled = tpl.solution.map(function (v) {
        return v >= 1 && v <= 9 ? perm[v - 1] : 0;
      });
      // Случайный carve до target givens по сложности
      const givensTarget = { easy: 45, medium: 35, hard: 28 }[difficulty] || 35;
      const puzzle = relabeled.slice();
      const idxs = Array.from({ length: 81 }, function (_, i) { return i; });
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
      }
      const removeCount = Math.max(0, 81 - givensTarget);
      for (let k = 0; k < removeCount; k++) puzzle[idxs[k]] = 0;

      gen = {
        puzzle:    puzzle,
        solution:  relabeled,
        givens:    puzzle.map(function (v) { return v !== 0; }),
        difficulty: difficulty,
        score:     removeCount,
        techniques: {},
        elapsedMs: 0,
        attempts:  1
      };
      if (mode === 'sugur') {
        snakeCells = tpl.snakeCells.map(function (s) { return s.slice(); });
        cellSnake  = tpl.cellSnake.slice();
      } else {
        cellChain  = tpl.cellChain.slice();
        chainEdges = (tpl.edges || []).map(function (e) { return e.slice(); });
      }
      console.log('[game] ' + mode + ' template #' + idx + '/' + pool.length +
                  ' relabeled (perm=' + perm.join('') + ') carved to ' + givensTarget + ' givens');
    } else if (mode === 'kropki' && SV && SV.computeKropkiDots) {
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
        // Снейк-регионы у нас совпадают с классическими 3×3 блоками
        // (внутри них ham-path даёт zigzag-визуал). Поэтому snake-
        // constraint = block-constraint, и решение можно искать быстрым
        // classic-solve. Если в будущем добавим diversify-swaps —
        // понадобится либо sugur-solve, либо validation/fallback.
        const t1 = Date.now();
        const sol = Core.solve(new Array(81).fill(0), SV.Classic, Math.random);
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
      // Chain: настоящие path-shape цепочки с 8-связностью (диагональные
      // связи). Каждая цепочка — линейная верёвочка из 9 cells разной
      // формы. Алгоритм: генерируем layout (random walk + Warnsdorff,
      // ≤300ms), затем решаем пустую сетку через chain-variant solver
      // с iteration limit (защита от exponential). Если решение не
      // найдено за лимит — пробуем новый layout (до 5 attempts). Если
      // все попытки fail — fallback на classic.
      const t0 = Date.now();
      let layout = null;
      let sol = null;
      let usedChainVariant = null;
      // Solve лимиты: maxNodes защищает от глубокого backtracking,
      // maxMs — от любых slow-paths. 200ms на попытку × 5 попыток =
      // worst-case 1 секунда (но fail-fast — обычно первый layout solves
      // за <100ms если он solvable).
      const SOLVE_NODE_LIMIT = 800000;
      const SOLVE_MS_LIMIT = 400;
      for (let attempt = 0; attempt < 4; attempt++) {
        const ly = SV.generateChainLayout();
        if (!ly) continue;
        const chainVariant = SV.makeChain(ly.chainCells, ly.cellChain, ly.edges);
        const ts = Date.now();
        const s = Core.solve(new Array(81).fill(0), chainVariant, Math.random,
                              { maxNodes: SOLVE_NODE_LIMIT, maxMs: SOLVE_MS_LIMIT });
        const solveMs = Date.now() - ts;
        console.log('[chain] attempt ' + attempt + ' solve=' + solveMs + 'ms result=' + (s ? 'ok' : 'aborted'));
        if (s) {
          layout = ly;
          sol = s;
          usedChainVariant = chainVariant;
          break;
        }
      }
      if (!layout || !sol) {
        console.warn('[game] chain layout/solve failed after retries, fallback to classic');
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
          elapsedMs: Date.now() - t0,
          attempts: 1
        };
        console.log('[game] chain built in ' + (Date.now() - t0) + 'ms');
        cellChain  = layout.cellChain;
        chainEdges = layout.edges;
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

  // Загружает в память сейв выбранной пары (режим, сложность) из Storage.
  // Используется при нажатии «Продолжить» в save-modal на главном экране.
  function resumeMode(mode, difficulty) {
    const stored = window.Storage.getActiveByMode(mode, difficulty);
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
    const slots = window.Storage.getAllActiveModes();
    if (!slots.length) return false;
    return resumeMode(slots[0].mode, slots[0].difficulty);
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
    const d = active ? (active.difficulty || 'medium') : null;
    stopTimer();
    clearFastTimer();
    if (m) window.Storage.clearActiveByMode(m, d);
    active = null;
    selectedIdx = null;
    undoStack = [];
  }

  // ===== Обработчики ввода =====

  function handleCellClick(idx) {
    if (!active) return;
    // === Быстрый режим: тап по ячейке с единственным candidate =====
    // Если включён Быстрый режим и в выбранной ячейке (пустая, не-given,
    // не-hint) осталась ровно ОДНА possible цифра в заметках — мы её
    // ставим автоматически, без необходимости вводить цифру через num-pad.
    // Это и есть «полу-ручной» каскад: каждый ход требует тапа игрока.
    if (active.fastModeActive
        && active.board[idx] === 0
        && !active.givens[idx]
        && !(active.hintCells && active.hintCells[idx])) {
      const d = singleCandidate(idx);
      if (d > 0) {
        // Делегируем handleNumber — он всё сделает чисто: place, auto-clean
        // peers' notes, mistake-check, win-check, persist, render, audio.
        selectedIdx = idx;
        handleNumber(d);
        return;
      }
    }
    // Обычное поведение — toggle selection. Повторный тап по той же ячейке
    // снимает выделение.
    selectedIdx = (selectedIdx === idx) ? null : idx;
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
    // Сейв пройденной пары (режим, сложность) удаляем — следующий заход
    // в эту пару не предложит «Продолжить». Слоты других difficulty этого
    // режима остаются.
    window.Storage.clearActiveByMode(active.mode || 'classic', active.difficulty || 'medium');
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
  // набора кандидатов (с учётом variant peers и исключая mistakes). Авто-
  // каскада больше нет — тап игрока по ячейке с ровно ОДНОЙ заметкой
  // автоматически превращается в установку цифры (см. handleCellClick).
  // Цифра выбирается без необходимости тапа по цифровой клавише.
  //
  // При выключении: notes остаются как есть, дальше игрок работает руками
  // и pencil снова доступен.

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
      if (!active.fastModeUnlocked) {
        console.warn('[fast] setFastModeActive(true) called before unlock');
        return;
      }
      active.fastModeActive = true;
      recomputeAllNotes();
    } else {
      active.fastModeActive = false;
    }
    persist();
    renderAll();
    emit('change');
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

  // Legacy stubs: раньше быстрый режим запускал каскадный таймер автозаполнения.
  // В новой механике (тап = установка single-candidate) каскада нет, но
  // вызовы остались в нескольких местах (startNewLevel, win, gameover,
  // abandon, leaveToMenu) для будущей совместимости. No-op.
  function clearFastTimer() {}
  function scheduleFastStep() {}

  // Возвращает единственный candidate (1..9) для ячейки idx если её notes
  // содержат ровно один бит, иначе 0. Используется в fast-mode-click.
  function singleCandidate(idx) {
    if (!active) return 0;
    const m = active.notes[idx] | 0;
    if (m === 0) return 0;
    if ((m & (m - 1)) !== 0) return 0;
    for (let b = 0; b < 9; b++) if (m & (1 << b)) return b + 1;
    return 0;
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
