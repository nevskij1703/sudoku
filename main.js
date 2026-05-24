/**
 * main.js — bootstrap: подгрузка хранилища, инициализация UI, склейка событий.
 *
 * Порядок:
 *   1. Storage.load() — миграции выполнятся внутри.
 *   2. RuStoreReviewClient.configure(appId).
 *   3. Маунт Board и NumberPad.
 *   4. Развешивание обработчиков на кнопки, экраны, модалки.
 *   5. Подписка на события Game (win/gameover/heartLost).
 *   6. Click-outside для модалок с data-close-outside="1".
 *   7. Если ?dev=1 — DevPanel.mount() (если файл не вырезан release-сборкой).
 *   8. Показать главный экран и обновить статистику.
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);

  // Сохраняем выбор сложности/режима между показами экрана
  let selectedDifficulty = 'medium';
  let selectedMode = 'classic';

  function init() {
    // ===== 1. Storage =====
    window.Storage.load();
    window.RuStoreReviewClient.configure('com.terekh.sudoku');

    // ===== 2. Маунт игровых компонентов =====
    window.Board.mount(document.getElementById('board'), function (idx) {
      window.Game.handleCellClick(idx);
    });

    window.NumberPad.mount({
      onNumber: function (d) { window.Game.handleNumber(d); },
      onPencilToggle: function (active) { window.Game.setPencilMode(active); },
      onHint:   function ()  { window.Game.handleHint(); },
      onUndo:   function ()  { window.Game.handleUndo(); }
    });

    // ===== 3. Game callbacks =====
    window.Game.on('win', function (data) {
      window.UI.setText('win-difficulty', difficultyLabel(data.difficulty));
      window.UI.setText('win-mistakes', String(data.mistakes));
      window.UI.setText('win-hints', String(data.hintsUsed));
      window.UI.showModal('win');
    });

    window.Game.on('gameover', function () {
      window.UI.showModal('gameover');
    });

    window.Game.on('change', function () {
      // Обновляем подзаголовок игрового экрана при каждом изменении состояния
      const a = window.Game.getActive();
      if (a) {
        window.UI.setText('game-subtitle', difficultyLabel(a.difficulty));
      }
    });

    // ===== 4. Главный экран (выбор сложности + статистика на одном экране) =====
    document.getElementById('btn-home-settings').addEventListener('click', openSettings);

    // Info-кнопки в карточках режимов: открывают info-модалку (пока единую,
    // в будущем могут вести в variant-specific объяснения).
    document.querySelectorAll('.mode-info-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();              // не дёргаем выбор mode-tile
        window.UI.showModal('info');
      });
    });

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

    document.getElementById('btn-start-level').addEventListener('click', function () {
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
    document.getElementById('btn-game-home').addEventListener('click', function () {
      window.UI.showModal('confirm-exit');
    });
    document.getElementById('btn-game-info').addEventListener('click', function () {
      window.UI.showModal('info');
    });
    document.getElementById('btn-game-settings').addEventListener('click', openSettings);

    // ===== 7. Подтверждение выхода =====
    document.getElementById('btn-confirm-exit-yes').addEventListener('click', function () {
      window.UI.hideModal('confirm-exit');
      window.Game.abandon();
      window.UI.showScreen('home');
      updateHomeStats();
    });
    document.getElementById('btn-confirm-exit-no').addEventListener('click', function () {
      window.UI.hideModal('confirm-exit');
    });

    // ===== 8. Модалки win / gameover =====
    document.getElementById('btn-win-next').addEventListener('click', function () {
      window.UI.hideModal('win');
      backToHome();
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
          window.UI.showModal('gameover');
        }
      });
    });
    document.getElementById('btn-gameover-restart').addEventListener('click', function () {
      window.UI.hideModal('gameover');
      window.Game.abandon();
      backToHome();
    });
    document.getElementById('btn-gameover-home').addEventListener('click', function () {
      window.UI.hideModal('gameover');
      window.Game.abandon();
      window.UI.showScreen('home');
      updateHomeStats();
    });

    // ===== 9. Settings modal =====
    document.getElementById('btn-rate').addEventListener('click', function () {
      window.RuStoreReviewClient.launch().then(function (r) {
        if (r.shown) window.Storage.setRateGiven(true);
      });
    });
    wireSettingsToggle('setting-sound', 'sound');
    wireSettingsToggle('setting-vibration', 'vibration');
    wireSettingsToggle('setting-highlighter', 'highlighter', function () { window.Game._renderAll && window.Game._renderAll(); });
    wireSettingsToggle('setting-auto-notes', 'autoNotesClean');

    // ===== 10. Универсальные кнопки закрытия модалок + click-outside =====
    document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.closeModal;
        if (id) window.UI.hideModal(id);
      });
    });

    document.querySelectorAll('.modal[data-close-outside="1"]').forEach(function (modal) {
      modal.addEventListener('click', function (e) {
        // Закрываем только когда клик пришёл по самому фону, а не по содержимому
        if (e.target === modal) {
          const id = modal.dataset.modalId;
          if (id) window.UI.hideModal(id);
        }
      });
    });

    // ===== 11. Dev panel =====
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

    // ===== 12. Стартовый экран =====
    //
    // Auto-resume: если в storage есть активный уровень — продолжаем его без
    // показа главного меню. Активный уровень пишется при каждом действии
    // (Game.persist()) и не теряется при закрытии приложения / перезагрузке
    // страницы. Сбросить активный уровень можно только через подтверждение
    // выхода в меню (модалка confirm-exit) или dev-panel.
    updateHomeStats();
    if (window.Storage.getActive() && window.Game.resumeActive()) {
      window.UI.showScreen('game');
    } else {
      window.UI.showScreen('home');
    }
  }

  function backToHome() {
    // Главный экран совмещён с выбором сложности — просто обновляем статистику
    // и подсветку плиток в соответствии с сохранённым выбором.
    document.querySelectorAll('.diff-tile').forEach(function (t) {
      t.classList.toggle('selected', t.dataset.difficulty === selectedDifficulty);
    });
    document.querySelectorAll('.mode-tile').forEach(function (t) {
      t.classList.toggle('selected', t.dataset.mode === selectedMode);
    });
    updateHomeStats();
    window.UI.showScreen('home');
  }

  function difficultyLabel(d) {
    return { easy: 'Простой', medium: 'Средний', hard: 'Сложный' }[d] || d;
  }

  function updateHomeStats() {
    const total = window.Storage.getCompletedLevels();
    const byDiff = window.Storage.getCompletedByDifficulty();
    window.UI.setText('stat-completed', String(total));
    window.UI.setText('stat-by-diff', (byDiff.easy || 0) + ' / ' + (byDiff.medium || 0) + ' / ' + (byDiff.hard || 0));
  }

  function openSettings() {
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
