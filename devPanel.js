/**
 * devPanel.js — отладочная панель. ВЕСЬ файл обёрнут в HTML2APK:DEV_ONLY-маркеры —
 * html2apk -Release вырежет содержимое целиком (см. CLAUDE.md проекта).
 *
 * Активация: открыть приложение с параметром ?dev=1.
 *
 * Структура: 3 вкладки.
 *   • Game      — быстрые игровые манипуляции (открыть ячейку, +сердце, +подсказка, instant-win, restart)
 *   • Generator — генерация уровней с настраиваемыми параметрами (симметрия, givens), статистика
 *   • Progress  — сейв-стейт: mock ads, сброс прогресса, factory reset
 *
 * Drag: панель и её свёрнутая версия перетаскиваются за header.
 */

// HTML2APK:DEV_ONLY_BEGIN
window.DevPanel = (function () {

  let panel = null;
  let collapsed = false;
  let activeTab = 'game';

  function mount() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'dev-panel';
    panel.innerHTML = renderHtml();
    document.body.appendChild(panel);
    wire();
    enableDrag();
  }

  function renderHtml() {
    return ''
      + '<div class="dev-panel-header">'
      + '  <span>DEV</span>'
      + '  <button id="dev-toggle" style="width:auto;padding:2px 6px">_</button>'
      + '</div>'
      + '<div class="dev-tabs">'
      + '  <button class="dev-tab active" data-tab="game">Game</button>'
      + '  <button class="dev-tab" data-tab="generator">Generator</button>'
      + '  <button class="dev-tab" data-tab="progress">Progress</button>'
      + '</div>'

      // ── Tab: Game ─────────────────────────────────────────────────
      + '<div class="dev-tab-content" data-tab-content="game">'
      + '  <button id="dev-open-cell">🔓 Открыть выбранную ячейку</button>'
      + '  <button id="dev-add-heart">♥+ Сердце</button>'
      + '  <button id="dev-add-hint">💡+ Подсказка</button>'
      + '  <button id="dev-instant-win">✓ Заполнить решением</button>'
      + '  <button id="dev-restart">⟳ Перезапустить уровень</button>'
      + '  <button id="dev-verify-current">🔬 Проверить текущий (unique + solvable)</button>'
      + '  <button id="dev-show-rating">📊 Score / техники текущего</button>'
      + '</div>'

      // ── Tab: Generator ────────────────────────────────────────────
      + '<div class="dev-tab-content hidden" data-tab-content="generator">'
      + '  <label>Сложность'
      + '    <select id="dev-gen-difficulty">'
      + '      <option value="easy">Простой</option>'
      + '      <option value="medium" selected>Средний</option>'
      + '      <option value="hard">Сложный</option>'
      + '    </select>'
      + '  </label>'
      + '  <label>Симметрия'
      + '    <select id="dev-gen-symmetry">'
      + '      <option value="rotational" selected>Поворотная (180°)</option>'
      + '      <option value="mirror">Зеркальная</option>'
      + '      <option value="none">Без симметрии</option>'
      + '    </select>'
      + '  </label>'
      + '  <div class="dev-row">'
      + '    <label class="dev-row-item">givens min<input id="dev-gen-min" type="number" min="17" max="80" value="30"/></label>'
      + '    <label class="dev-row-item">max<input id="dev-gen-max" type="number" min="17" max="80" value="35"/></label>'
      + '  </div>'
      + '  <button id="dev-gen-new">▶ Сгенерировать и запустить</button>'
      + '  <button id="dev-gen-stats">📈 Стат. по 50 уровням</button>'
      + '  <button id="dev-gen-uniqueness">🔬 Uniqueness check 50</button>'
      + '</div>'

      // ── Tab: Progress ─────────────────────────────────────────────
      + '<div class="dev-tab-content hidden" data-tab-content="progress">'
      + '  <button id="dev-toggle-ads">🎬 Toggle Mock Ads</button>'
      + '  <button id="dev-reset-progress">📉 Сбросить прогресс (счётчики)</button>'
      + '  <button id="dev-reset">🗑 Полный сброс (factory)</button>'
      + '</div>'

      + '<pre id="dev-output"></pre>';
  }

  function wire() {
    // Tabs
    panel.querySelectorAll('.dev-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.tab);
      });
    });

    document.getElementById('dev-toggle').addEventListener('click', function (e) {
      e.stopPropagation();
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
    });

    // ───── Game tab ─────
    document.getElementById('dev-open-cell').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      const idx = window.Game.getSelected();
      if (idx == null) { out('Сначала выберите ячейку на доске'); return; }
      if (a.givens[idx]) { out('Эта ячейка уже задана'); return; }
      if (a.board[idx] === a.solution[idx]) { out('Уже правильно стоит'); return; }
      // Идём через game logic чтобы win-emit сработал автоматически
      window.Game.handleCellClick(idx);
      window.Game.handleNumber(a.solution[idx]);
      // Помечаем как hint (визуально отличается от обычного ввода)
      const after = window.Game.getActive();
      if (after) {
        after.hintCells[idx] = true;
        window.Storage.setActive(after);
        window.Game._renderAll();
      }
      out('Ячейка #' + idx + ' открыта: ' + a.solution[idx]);
    });

    document.getElementById('dev-add-heart').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      a.hearts = Math.min(a.hearts + 1, 9);
      window.Storage.setActive(a);
      window.Game._renderAll();
      out('Сердца: ' + a.hearts);
    });

    document.getElementById('dev-add-hint').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      a.hintsUsed = Math.max(0, a.hintsUsed - 1);
      window.Storage.setActive(a);
      window.Game._renderAll();
      out('Подсказок осталось: ' + (window.GAME_CONFIG.BALANCE.hintsPerLevel - a.hintsUsed));
    });

    document.getElementById('dev-instant-win').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      // Заполняем все не-given ячейки решением, оставляем одну на handleNumber
      // чтобы триггернуть win корректно.
      let target = -1;
      for (let i = 0; i < 81; i++) if (!a.givens[i]) { target = i; break; }
      if (target === -1) { out('Все ячейки уже given'); return; }
      for (let i = 0; i < 81; i++) {
        if (!a.givens[i]) {
          a.board[i] = (i === target) ? 0 : a.solution[i];
          a.mistakes[i] = false;
        }
      }
      window.Storage.setActive(a);
      window.Game._renderAll();
      window.Game.handleCellClick(target);
      window.Game.handleNumber(a.solution[target]);
    });

    document.getElementById('dev-restart').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      a.board = a.puzzle.slice();
      a.notes = new Array(81).fill(0);
      a.mistakes = new Array(81).fill(false);
      a.hintCells = new Array(81).fill(false);
      a.hearts = window.GAME_CONFIG.BALANCE.heartsPerLevel;
      a.hintsUsed = 0;
      a.elapsedMs = 0;
      window.Storage.setActive(a);
      window.Game._renderAll();
      out('Уровень перезапущен (puzzle сохранён)');
    });

    document.getElementById('dev-verify-current').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      const res = window.SudokuGenerator.verifyPuzzle(a.puzzle, a.solution);
      out(JSON.stringify(res, null, 2));
    });

    document.getElementById('dev-show-rating').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      const rating = window.SudokuGenerator.rateDifficulty(a.puzzle);
      out('Score: ' + Math.round(rating.score) + '\nЛейбл: ' + rating.label +
          '\nhumanSolvable: ' + rating.humanSolvable +
          '\nТехники:\n' + JSON.stringify(rating.techniques, null, 2));
    });

    // ───── Generator tab ─────
    document.getElementById('dev-gen-new').addEventListener('click', function () {
      const diff = document.getElementById('dev-gen-difficulty').value;
      const sym  = document.getElementById('dev-gen-symmetry').value;
      const gMin = parseInt(document.getElementById('dev-gen-min').value, 10);
      const gMax = parseInt(document.getElementById('dev-gen-max').value, 10);

      // Временно подменяем givensTarget в CONFIG, чтобы не пересоздавать generator API.
      const cfg = window.GAME_CONFIG.GENERATOR.givensTarget;
      const original = cfg[diff].slice();
      cfg[diff] = [Math.min(gMin, gMax), Math.max(gMin, gMax)];

      const t0 = Date.now();
      let gen;
      try {
        gen = window.SudokuGenerator.generate(diff, { symmetry: sym });
      } finally {
        cfg[diff] = original;
      }

      window.Game.startNewLevel(diff, 'classic');
      // Game.startNewLevel сам делает свежий generate. Здесь подменим active
      // на наш конкретный puzzle с нашими настройками:
      const active = window.Game.getActive();
      active.puzzle = gen.puzzle;
      active.solution = gen.solution;
      active.givens = gen.givens;
      active.board = gen.puzzle.slice();
      active.score = gen.score;
      active.difficulty = gen.difficulty;
      window.Storage.setActive(active);
      window.Game._renderAll();
      window.UI.showScreen('game');

      const verify = window.SudokuGenerator.verifyPuzzle(gen.puzzle, gen.solution);
      out('▶ Generate: ' + diff + ' / ' + sym + ' / [' + gMin + ',' + gMax + ']\n' +
          'Time: ' + (Date.now() - t0) + 'ms, attempts: ' + gen.attempts + '\n' +
          'Score: ' + Math.round(gen.score) + ', label: ' + gen.difficulty + '\n' +
          'Verify: ' + JSON.stringify(verify, null, 2));
    });

    document.getElementById('dev-gen-stats').addEventListener('click', function () {
      const d = document.getElementById('dev-gen-difficulty').value;
      out('Генерация 50 уровней (' + d + ')...');
      setTimeout(function () {
        const stats = window.SudokuGenerator.batchStats(50, d);
        out(
          'Времени всего: ' + stats.totalMs + ' мс (среднее ' + Math.round(stats.totalMs / 50) + ' мс/уровень)\n' +
          'По лейблам: easy=' + stats.byLabel.easy + ', medium=' + stats.byLabel.medium + ', hard=' + stats.byLabel.hard + '\n' +
          'Uniqueness: ok=' + stats.uniqueness.ok + ', fail=' + stats.uniqueness.fail + '\n' +
          'Scores: min=' + Math.min.apply(null, stats.scores) + ', max=' + Math.max.apply(null, stats.scores) +
          ', median=' + stats.scores.slice().sort(function (a, b) { return a - b; })[25]
        );
      }, 10);
    });

    document.getElementById('dev-gen-uniqueness').addEventListener('click', function () {
      out('Проверка uniqueness 50 уровней...');
      setTimeout(function () {
        let ok = 0, fail = 0;
        const failedExamples = [];
        for (let i = 0; i < 50; i++) {
          const g = window.SudokuGenerator.generate(document.getElementById('dev-gen-difficulty').value);
          const cnt = window.SudokuCore.countSolutions(g.puzzle, 2);
          if (cnt === 1) ok++;
          else { fail++; failedExamples.push(window.SudokuCore.gridToString(g.puzzle)); }
        }
        out('OK=' + ok + ' / FAIL=' + fail +
            (failedExamples.length ? '\nПример битого: ' + failedExamples[0] : ''));
      }, 10);
    });

    // ───── Progress tab ─────
    document.getElementById('dev-toggle-ads').addEventListener('click', function () {
      const v = !window.Storage.getMockAds();
      window.Storage.setMockAds(v);
      out('Mock Ads: ' + v + ' (применится после перезагрузки)');
    });

    document.getElementById('dev-reset-progress').addEventListener('click', function () {
      if (!confirm('Сбросить прогресс (счётчики пройденных уровней)? Активный уровень и настройки сохранятся.')) return;
      window.Storage.resetProgress();
      out('Прогресс сброшен (completedLevels=0)');
      if (document.getElementById('screen-home').classList.contains('active')) {
        const total = window.Storage.getCompletedLevels();
        const byDiff = window.Storage.getCompletedByDifficulty();
        window.UI.setText('stat-completed', String(total));
        window.UI.setText('stat-by-diff',
          (byDiff.easy || 0) + ' / ' + (byDiff.medium || 0) + ' / ' + (byDiff.hard || 0));
      }
    });

    document.getElementById('dev-reset').addEventListener('click', function () {
      if (!confirm('Полный сброс (factory reset)? Будут стёрты прогресс, настройки и активный уровень.')) return;
      window.Storage.resetAll();
      out('localStorage сброшен');
      setTimeout(function () { location.reload(); }, 500);
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    panel.querySelectorAll('.dev-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    panel.querySelectorAll('.dev-tab-content').forEach(function (c) {
      c.classList.toggle('hidden', c.dataset.tabContent !== tab);
    });
  }

  function out(text) {
    const el = document.getElementById('dev-output');
    if (el) el.textContent = text;
    console.log('[dev]', text);
  }

  // Drag: на handle (header) — двигает всю панель. Mouse + touch.
  function enableDrag() {
    const handle = panel.querySelector('.dev-panel-header');
    if (!handle) return;
    let startX = 0, startY = 0, baseX = 0, baseY = 0, dragging = false;
    let downAt = 0, moved = false;

    function getRect() { return panel.getBoundingClientRect(); }

    function applyPos(x, y) {
      const w = panel.offsetWidth, h = panel.offsetHeight;
      const maxX = window.innerWidth  - w - 4;
      const maxY = window.innerHeight - h - 4;
      x = Math.max(4, Math.min(maxX, x));
      y = Math.max(4, Math.min(maxY, y));
      panel.style.left = x + 'px';
      panel.style.top  = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    function onDown(clientX, clientY) {
      const r = getRect();
      baseX = r.left; baseY = r.top;
      startX = clientX; startY = clientY;
      dragging = true; moved = false;
      downAt = Date.now();
      panel.classList.add('dragging');
    }
    function onMove(clientX, clientY) {
      if (!dragging) return;
      const dx = clientX - startX, dy = clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      applyPos(baseX + dx, baseY + dy);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
    }

    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('#dev-toggle')) return;
      e.preventDefault();
      onDown(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    document.addEventListener('mouseup', onUp);

    handle.addEventListener('touchstart', function (e) {
      if (e.target.closest('#dev-toggle')) return;
      const t = e.touches[0];
      onDown(t.clientX, t.clientY);
    }, { passive: true });
    handle.addEventListener('touchmove', function (e) {
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
      if (moved) e.preventDefault();
    }, { passive: false });
    handle.addEventListener('touchend', onUp);

    panel.addEventListener('click', function () {
      if (!panel.classList.contains('collapsed')) return;
      if (Date.now() - downAt > 300) return;
      if (moved) return;
      collapsed = false;
      panel.classList.remove('collapsed');
    });
  }

  return { mount: mount };
})();
// HTML2APK:DEV_ONLY_END
