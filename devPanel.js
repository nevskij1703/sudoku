/**
 * devPanel.js — отладочная панель. ВЕСЬ файл обёрнут в HTML2APK:DEV_ONLY-маркеры —
 * html2apk -Release вырежет содержимое целиком (см. CLAUDE.md проекта).
 *
 * Активация: открыть приложение с параметром ?dev=1.
 *
 * Функции:
 *   - Регенерация уровня с выбранной сложностью
 *   - Перезапуск текущего уровня (сброс прогресса, сохранение puzzle)
 *   - Заполнить решением (instant win)
 *   - Подмена сердец / подсказок
 *   - Просмотр абсолютного score и применённых техник
 *   - Батч-генерация 50 уровней со статистикой (для калибровки порогов)
 *   - Сброс localStorage
 *   - Toggle Mock Ads
 */

// HTML2APK:DEV_ONLY_BEGIN
window.DevPanel = (function () {

  let panel = null;
  let collapsed = false;

  function mount() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'dev-panel';
    panel.innerHTML = renderHtml();
    document.body.appendChild(panel);
    wire();
    refresh();
  }

  function renderHtml() {
    return ''
      + '<div class="dev-panel-header">'
      + '  <span>DEV</span>'
      + '  <button id="dev-toggle" style="width:auto;padding:2px 6px">_</button>'
      + '</div>'
      + '<div class="dev-body">'
      + '  <select id="dev-difficulty">'
      + '    <option value="easy">Простой</option>'
      + '    <option value="medium" selected>Средний</option>'
      + '    <option value="hard">Сложный</option>'
      + '  </select>'
      + '  <button id="dev-new-level">▶ Новый уровень</button>'
      + '  <button id="dev-restart">⟳ Перезапустить</button>'
      + '  <button id="dev-instant-win">✓ Заполнить решением</button>'
      + '  <button id="dev-add-heart">♥+ Сердце</button>'
      + '  <button id="dev-add-hint">💡+ Подсказка</button>'
      + '  <button id="dev-show-rating">📊 Score уровня</button>'
      + '  <button id="dev-stats">📈 Стат. по 50 уровням</button>'
      + '  <button id="dev-uniqueness">🔬 Uniqueness check 50</button>'
      + '  <button id="dev-toggle-ads">🎬 Toggle Mock Ads</button>'
      + '  <button id="dev-reset">🗑 Сбросить localStorage</button>'
      + '  <pre id="dev-output"></pre>'
      + '</div>';
  }

  function wire() {
    document.getElementById('dev-toggle').addEventListener('click', function () {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
    });

    document.getElementById('dev-new-level').addEventListener('click', function () {
      const d = document.getElementById('dev-difficulty').value;
      window.Game.startNewLevel(d, 'classic');
      window.UI.showScreen('game');
      out('Новый уровень: ' + d);
    });

    document.getElementById('dev-restart').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      // Сброс прогресса с сохранением puzzle
      a.board = a.puzzle.slice();
      a.notes = new Array(81).fill(0);
      a.mistakes = new Array(81).fill(false);
      a.hintCells = new Array(81).fill(false);
      a.hearts = window.GAME_CONFIG.BALANCE.heartsPerLevel;
      a.hintsUsed = 0;
      a.elapsedMs = 0;
      window.Storage.setActive(a);
      window.Game._renderAll();
      out('Уровень перезапущен');
    });

    document.getElementById('dev-instant-win').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      a.board = a.solution.slice();
      a.mistakes = new Array(81).fill(false);
      window.Storage.setActive(a);
      window.Game._renderAll();
      // Победа сама не сработает — нужно явно вызвать. Простой путь: handleNumber.
      // Лучше через прямой emit, но он скрыт. Сделаем грязный хак: handleErase на любую non-given пустую — она не пустая. Используем readonly check.
      // Найдём не-given ячейку, очистим и поставим обратно — это триггернёт isWin().
      let target = -1;
      for (let i = 0; i < 81; i++) if (!a.givens[i]) { target = i; break; }
      if (target !== -1) {
        const value = a.solution[target];
        a.board[target] = 0;
        window.Storage.setActive(a);
        // selectedIdx — приватный в Game. Делаем через handleCellClick + handleNumber.
        window.Game.handleCellClick(target);
        window.Game.handleNumber(value);
      } else {
        out('Не найдено ячейки для триггера win');
      }
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

    document.getElementById('dev-show-rating').addEventListener('click', function () {
      const a = window.Game.getActive();
      if (!a) { out('Нет активного уровня'); return; }
      const rating = window.SudokuGenerator.rateDifficulty(a.puzzle);
      out('Score: ' + Math.round(rating.score) + '\nЛейбл: ' + rating.label +
          '\nТехники:\n' + JSON.stringify(rating.techniques, null, 2));
    });

    document.getElementById('dev-stats').addEventListener('click', function () {
      const d = document.getElementById('dev-difficulty').value;
      out('Генерация 50 уровней (' + d + ')...');
      // Запускаем в setTimeout чтобы UI обновился
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

    document.getElementById('dev-uniqueness').addEventListener('click', function () {
      out('Проверка uniqueness 50 уровней...');
      setTimeout(function () {
        let ok = 0, fail = 0;
        const failedExamples = [];
        for (let i = 0; i < 50; i++) {
          const g = window.SudokuGenerator.generate('medium');
          const cnt = window.SudokuCore.countSolutions(g.puzzle, 2);
          if (cnt === 1) ok++;
          else { fail++; failedExamples.push(window.SudokuCore.gridToString(g.puzzle)); }
        }
        out('OK=' + ok + ' / FAIL=' + fail +
            (failedExamples.length ? '\nПример битого: ' + failedExamples[0] : ''));
      }, 10);
    });

    document.getElementById('dev-toggle-ads').addEventListener('click', function () {
      const v = !window.Storage.getMockAds();
      window.Storage.setMockAds(v);
      out('Mock Ads: ' + v + ' (применится после перезагрузки)');
    });

    document.getElementById('dev-reset').addEventListener('click', function () {
      if (!confirm('Сбросить весь сейв?')) return;
      window.Storage.resetAll();
      out('localStorage сброшен');
      setTimeout(function () { location.reload(); }, 500);
    });
  }

  function out(text) {
    const el = document.getElementById('dev-output');
    if (el) el.textContent = text;
    console.log('[dev]', text);
  }

  function refresh() {
    // Может быть позже добавим автообновление status
  }

  return { mount: mount };
})();
// HTML2APK:DEV_ONLY_END
