/**
 * main.js — bootstrap: подгрузка хранилища, инициализация UI, склейка событий.
 *
 * Порядок:
 *   1. Storage.load() — миграции выполнятся внутри.
 *   2. RuStoreReviewClient.configure(appId).
 *   3. Маунт Board и NumberPad.
 *   4. Развешивание обработчиков на кнопки, экраны, модалки.
 *   5. Подписка на события Game (win/gameover/heartLost).
 *   6. Если ?dev=1 — DevPanel.mount() (если файл не вырезан release-сборкой).
 *   7. Показать главный экран и обновить статистику.
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);

  // Сохраняем выбор сложности/режима между показами экрана
  let selectedDifficulty = 'medium';
  let selectedMode = 'classic';

  function init() {
    // ===== 1. Storage и базовая инициализация =====
    window.Storage.load();
    window.RuStoreReviewClient.configure(window.GAME_CONFIG_APP_ID || 'com.terekh.sudoku');

    // ===== 2. Маунт игровых компонентов =====
    window.Board.mount(document.getElementById('board'), function (idx) {
      window.Game.handleCellClick(idx);
    });

    window.NumberPad.mount({
      onNumber: function (d) { window.Game.handleNumber(d); },
      onErase:  function ()  { window.Game.handleErase(); },
      onPencilToggle: function (active) { window.Game.setPencilMode(active); },
      onHint:   function ()  { window.Game.handleHint(); },
      onUndo:   function ()  { window.Game.handleUndo(); }
    });

    // ===== 3. Game callbacks =====
    window.Game.on('win', function (data) {
      window.UI.setText('win-difficulty', difficultyLabel(data.difficulty));
      window.UI.setText('win-time', window.UI.formatTime(data.elapsedMs));
      window.UI.setText('win-mistakes', String(data.mistakes));
      window.UI.setText('win-hints', String(data.hintsUsed));
      window.UI.showModal('win');
      // Триггер RuStore review после первого win'а
      if (!window.Storage.getRateGiven()) {
        setTimeout(function () { /* отложим до явного запроса в settings */ }, 0);
      }
    });

    window.Game.on('gameover', function () {
      window.UI.showModal('gameover');
    });

    window.Game.on('heartLost', function (data) {
      // Уже отрендерили в Game.renderAll() через UI.setHearts. Можно добавить shake-эффект если захочется.
    });

    // ===== 4. Главный экран =====
    document.getElementById('btn-play').addEventListener('click', function () {
      gotoDifficultyScreen();
    });

    document.getElementById('btn-continue').addEventListener('click', function () {
      if (window.Game.resumeActive()) {
        window.UI.showScreen('game');
      } else {
        gotoDifficultyScreen();
      }
    });

    document.getElementById('btn-home-settings').addEventListener('click', function () {
      openSettings(/*fromGame=*/false);
    });

    // ===== 5. Экран выбора сложности и режима =====
    document.querySelectorAll('.diff-tile').forEach(function (tile) {
      tile.addEventListener('click', function () {
        document.querySelectorAll('.diff-tile').forEach(function (t) { t.classList.remove('selected'); });
        tile.classList.add('selected');
        selectedDifficulty = tile.dataset.difficulty;
      });
    });

    document.querySelectorAll('.mode-tile').forEach(function (tile) {
      tile.addEventListener('click', function () {
        if (tile.classList.contains('locked')) return;
        document.querySelectorAll('.mode-tile').forEach(function (t) { t.classList.remove('selected'); });
        tile.classList.add('selected');
        selectedMode = tile.dataset.mode;
      });
    });

    document.getElementById('btn-back-diff').addEventListener('click', function () {
      window.UI.showScreen('home');
      updateHomeStats();
    });

    document.getElementById('btn-start-level').addEventListener('click', function () {
      // Возможно покажем interstitial перед стартом
      const completed = window.Storage.getCompletedLevels();
      const shouldShow = window.AdManager.shouldShowInterstitial(completed);
      const launch = function () {
        window.Game.startNewLevel(selectedDifficulty, selectedMode);
        window.UI.showScreen('game');
      };
      if (shouldShow) {
        window.AdManager.showInterstitialAd().then(launch);
      } else {
        launch();
      }
    });

    // ===== 6. Игровой экран =====
    document.getElementById('btn-game-back').addEventListener('click', function () {
      // Сейчас сохраняем active, чтобы юзер мог вернуться через «Продолжить»
      window.Game._stopTimer();
      window.UI.showScreen('home');
      updateHomeStats();
    });

    document.getElementById('btn-game-pause').addEventListener('click', function () {
      window.Game._stopTimer();
      window.UI.showModal('pause');
    });

    // ===== 7. Модалки =====
    document.getElementById('btn-win-next').addEventListener('click', function () {
      window.UI.hideModal('win');
      gotoDifficultyScreen();
    });
    document.getElementById('btn-win-home').addEventListener('click', function () {
      window.UI.hideModal('win');
      window.UI.showScreen('home');
      updateHomeStats();
    });

    document.getElementById('btn-gameover-ad').addEventListener('click', function () {
      window.AdManager.showRewardedAd({ kind: 'extra-heart' }).then(function (result) {
        window.UI.hideModal('gameover');
        if (result.watched) {
          window.Game.applyAdReward(result.reward);
        } else {
          // Реклама не доиграла. Показываем сообщение и оставляем модалку открытой.
          window.UI.showModal('gameover');
        }
      });
    });
    document.getElementById('btn-gameover-restart').addEventListener('click', function () {
      window.UI.hideModal('gameover');
      window.Game.abandon();
      gotoDifficultyScreen();
    });
    document.getElementById('btn-gameover-home').addEventListener('click', function () {
      window.UI.hideModal('gameover');
      window.Game.abandon();
      window.UI.showScreen('home');
      updateHomeStats();
    });

    document.getElementById('btn-pause-resume').addEventListener('click', function () {
      window.UI.hideModal('pause');
      window.Game._startTimer();
    });
    document.getElementById('btn-pause-settings').addEventListener('click', function () {
      openSettings(/*fromGame=*/true);
    });
    document.getElementById('btn-pause-home').addEventListener('click', function () {
      window.UI.hideModal('pause');
      window.UI.showScreen('home');
      updateHomeStats();
    });

    document.getElementById('btn-settings-close').addEventListener('click', function () {
      window.UI.hideModal('settings');
    });
    document.getElementById('btn-rate').addEventListener('click', function () {
      window.RuStoreReviewClient.launch().then(function (r) {
        if (r.shown) window.Storage.setRateGiven(true);
      });
    });

    // ===== 8. Settings toggles =====
    wireSettingsToggle('setting-sound', 'sound');
    wireSettingsToggle('setting-vibration', 'vibration');
    wireSettingsToggle('setting-highlighter', 'highlighter', function () { window.Game._renderAll && window.Game._renderAll(); });
    wireSettingsToggle('setting-auto-notes', 'autoNotesClean');

    // ===== 9. Dev panel =====
    const params = new URLSearchParams(window.location.search);
    const devEnabled = (params.get('dev') === '1') && !window.__BUILD_RELEASE__;
    if (devEnabled) {
      window.GAME_CONFIG.DEV.enabled = true;
      if (window.DevPanel && window.DevPanel.mount) {
        window.DevPanel.mount();
      } else {
        console.warn('[main] ?dev=1 set but DevPanel is not available (probably stripped by html2apk -Release)');
      }
    }

    // ===== 10. Стартовый экран =====
    updateHomeStats();
    window.UI.showScreen('home');

    // Кнопка Continue видна только если есть active save
    const active = window.Storage.getActive();
    document.getElementById('btn-continue').classList.toggle('hidden', !active);
  }

  function gotoDifficultyScreen() {
    // Восстанавливаем визуальное выделение в плитках
    document.querySelectorAll('.diff-tile').forEach(function (t) {
      t.classList.toggle('selected', t.dataset.difficulty === selectedDifficulty);
    });
    document.querySelectorAll('.mode-tile').forEach(function (t) {
      t.classList.toggle('selected', t.dataset.mode === selectedMode);
    });
    window.UI.showScreen('difficulty');
  }

  function difficultyLabel(d) {
    return { easy: 'Простой', medium: 'Средний', hard: 'Сложный' }[d] || d;
  }

  function updateHomeStats() {
    const total = window.Storage.getCompletedLevels();
    const byDiff = window.Storage.getCompletedByDifficulty();
    window.UI.setText('stat-completed', String(total));
    window.UI.setText('stat-by-diff', (byDiff.easy || 0) + ' / ' + (byDiff.medium || 0) + ' / ' + (byDiff.hard || 0));
    const active = window.Storage.getActive();
    document.getElementById('btn-continue').classList.toggle('hidden', !active);
  }

  function openSettings(fromGame) {
    const s = window.Storage.getSettings();
    document.getElementById('setting-sound').checked       = !!s.sound;
    document.getElementById('setting-vibration').checked   = !!s.vibration;
    document.getElementById('setting-highlighter').checked = !!s.highlighter;
    document.getElementById('setting-auto-notes').checked  = !!s.autoNotesClean;
    window.UI.showModal('settings');
  }

  function wireSettingsToggle(elId, settingKey, onChange) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', function () {
      const patch = {};
      patch[settingKey] = el.checked;
      window.Storage.setSettings(patch);
      if (onChange) onChange();
    });
  }
})();
