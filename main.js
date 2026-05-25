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

  // URL политики конфиденциальности на Cloud.Mail.ru. Указывает на
  // актуальный Store_Info/PRIVACY_POLICY.pdf, залитый на облако
  // (привязано к почте terekh-spb@mail.ru). При обновлении .pdf файл
  // перезаливается на тот же URL — ссылка не меняется.
  //
  // Эта константа должна быть в синхроне с `privacyUrl` в
  // Store_Info/STORE_LISTING.md. Пайплайн `prepare-release-candidate`
  // проверяет это (шаг 4.5d/e/f).
  const PRIVACY_URL = 'https://cloud.mail.ru/public/WA8V/yWzV4VV7n';

  // Сохраняем выбор сложности/режима между показами экрана
  let selectedDifficulty = 'medium';
  let selectedMode = 'classic';
  // Параметры только что завершённого уровня — для «Следующий уровень»
  // в win-модалке (запускаем такой же ещё раз без захода на главный экран).
  let lastCompletedDifficulty = null;
  let lastCompletedMode = null;

  // Короткие caps-имена режимов для большого заголовка игрового экрана
  // (раньше там всегда было «СУДОКУ»; пользователь попросил показывать
  // конкретный текущий режим). Подбирали значения с прицелом на ≤9 букв,
  // чтобы влезало в brand-шрифт 36px с летрингом без переноса.
  const MODE_TITLE = {
    mini:     'МИНИ 4×4',
    classic:  'КЛАССИКА',
    diagonal: 'ДИАГОНАЛЬ',
    kropki:   'ТОЧКИ',
    center:   'ЦЕНТР',
    windoku:  'ВИНДОКУ',
    sugur:    'СУГУРУ',
    chain:    'ЦЕПОЧКИ'
  };

  // Текстовые правила для каждого режима. info-modal динамически берёт
  // отсюда контент по data-mode-info нажатой кнопки. Картинок пока нет —
  // добавим как только конкретные режимы будут визуально готовы.
  const MODE_INFO = {
    mini: {
      name: 'Мини 4×4',
      rules: [
        'Поле 4×4 разбито на 4 блока 2×2 — режим для начинающих и быстрых партий.',
        'Цифры 1–4 не должны повторяться по горизонтали, вертикали и в каждом блоке 2×2.',
        'Идеально подходит, чтобы освоить логику Sudoku за пару минут.'
      ]
    },
    classic: {
      name: 'Классика',
      rules: [
        'Расставляй цифры от 1 до 9 в пустых клетках.',
        'Цифры не должны повторяться по горизонтали, вертикали и в каждом блоке 3×3.',
        'Используй карандаш для заметок, если сомневаешься.'
      ]
    },
    diagonal: {
      name: 'Диагональ',
      rules: [
        'Те же правила, что в Классике.',
        'Дополнительно: на двух главных диагоналях (от угла к углу) цифры тоже не должны повторяться.',
        'Места для манёвра меньше — нужно больше думать на каждом шаге.'
      ]
    },
    kropki: {
      name: 'Точки (Kropki)',
      rules: [
        'Те же правила, что в Классике.',
        'Пустой кружочек между двумя соседними клетками: цифры в них отличаются ровно на 1.',
        'Закрашенный кружочек: одна цифра вдвое больше другой.'
      ]
    },
    center: {
      name: 'Центр',
      rules: [
        'Те же правила, что в Классике.',
        'Дополнительно: 9 центральных клеток каждого блока 3×3 образуют свой «уникальный» набор — там тоже не должно быть повторов.',
        'Это даёт игроку дополнительный ориентир в середине доски.'
      ]
    },
    windoku: {
      name: 'Виндоку',
      rules: [
        'Те же правила, что в Классике.',
        'Дополнительно: 4 внутренние зоны 3×3 (на пересечении строк 2–4 и 6–8 со столбцами 2–4 и 6–8) не должны содержать повторов.',
        'Эти 4 зоны видны на доске лёгкой тонировкой.'
      ]
    },
    sugur: {
      name: 'Сугуру',
      rules: [
        'Поле 9×9 разбито на 9 ломаных «змеек» по 9 клеток вместо квадратов 3×3.',
        'Цифры не должны повторяться по строкам, столбцам и в каждой змейке.',
        'Змейки могут изгибаться только по сторонам и не пересекают друг друга.'
      ]
    },
    chain: {
      name: 'Цепочки',
      rules: [
        'Поле 9×9, но ячейки нарисованы как круги и связаны цветными линиями в 9 цепочек по 9 кругов.',
        'Цифры 1–9 не должны повторяться по строкам, столбцам и в каждой цепочке.',
        'В отличие от Сугуру, соседние круги одной цепочки могут быть и по диагонали — линии часто пересекают друг друга, что и даёт характерный визуал.'
      ]
    }
  };

  // Sessional флаг для модалки «Нравится игра?». Сбрасывается при перезапуске
  // приложения, поэтому юзер, нажавший «Может позже» в одной сессии, увидит
  // её снова в следующей — даёт ещё одну возможность спросить про оценку.
  // Если уже нажимал «Оценить» (Storage.rateGiven === true) — больше не
  // показываем НИКОГДА. См. shouldShowRateModal().
  let rateModalShownThisSession = false;

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
      onHint:   function ()  {
        // Клик по кнопке «Подсказка». Если глобальных подсказок > 0 —
        // обычное поведение. Если 0 — кнопка превращена в «+1 ▶» бэйдж
        // (см. numberPad.js setHintsLeft), и тот же клик уходит в
        // rewarded-ad branch: +1 подсказка после успешного просмотра.
        if (window.Storage.getHints() > 0) {
          window.Game.handleHint();
        } else {
          requestHintRefill();
        }
      },
      onUndo:   function ()  { window.Game.handleUndo(); }
    });

    // ===== 3. Game callbacks =====
    window.Game.on('win', function (data) {
      lastCompletedDifficulty = data.difficulty;
      lastCompletedMode = data.mode || 'classic';
      window.UI.setText('win-difficulty', difficultyLabel(data.difficulty));
      window.UI.setText('win-mistakes', String(data.mistakes));
      window.UI.setText('win-hints', String(data.hintsUsed));
      window.UI.showModal('win');
    });

    window.Game.on('gameover', function () {
      window.UI.showModal('gameover');
    });

    window.Game.on('change', function () {
      // Обновляем заголовок и подзаголовок игрового экрана. Заголовок —
      // имя текущего режима (или «СУДОКУ» если режим неизвестен), подзаголовок
      // — лейбл сложности (Простой/Средний/Сложный).
      const a = window.Game.getActive();
      if (a) {
        window.UI.setText('game-mode-title', MODE_TITLE[a.mode] || 'СУДОКУ');
        window.UI.setText('game-subtitle', difficultyLabel(a.difficulty));
      }
    });

    // ===== 4. Главный экран (выбор сложности + статистика на одном экране) =====
    document.getElementById('btn-home-settings').addEventListener('click', openSettings);

    // Info-кнопки в карточках режимов: открывают info-модалку с правилами
    // конкретного режима (data-mode-info → MODE_INFO).
    document.querySelectorAll('.mode-info-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();              // не дёргаем выбор mode-tile
        showInfoModal(btn.dataset.modeInfo);
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
      // Старт с главного меню — без rate-modal (он только между уровнями
      // после win). Обычная cadence-логика interstitial.
      proceedToNextLevel(selectedDifficulty, selectedMode);
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
      // Запускаем свежий puzzle с теми же difficulty+mode что у только что пройденного.
      // Если данных нет (что не должно случаться) — fallback на текущий выбор в UI.
      const diff = lastCompletedDifficulty || selectedDifficulty;
      const mode = lastCompletedMode || selectedMode;
      // Синхронизируем UI-выбор, чтобы на главном экране он отражал актуальное состояние
      selectedDifficulty = diff;
      selectedMode = mode;
      // Ветвление: показываем rate-modal (только один раз за сессию и только
      // если юзер ещё не оценивал), либо сразу переходим на следующий уровень.
      // Когда rate-modal показалась — она сама решит что делать дальше
      // (см. обработчики btn-rate-now / btn-rate-later ниже).
      if (shouldShowRateModal()) {
        rateModalShownThisSession = true;
        // Запоминаем параметры следующего уровня в замыкании. После решения
        // юзера обработчики btn-rate-* запустят startNewLevel(diff, mode).
        window.UI.showModal('rate');
      } else {
        proceedToNextLevel(diff, mode);
      }
    });
    document.getElementById('btn-win-home').addEventListener('click', function () {
      window.UI.hideModal('win');
      window.UI.showScreen('home');
      updateHomeStats();
    });

    // ===== 8b. Модалка Rate Us (между уровнями) =====
    //
    // «Оценить» — запускаем нативный RuStore Review SDK (или fallback на
    // deep-link, если bridge'а нет — см. rustoreReview.js). Помечаем
    // rateGiven=true чтобы больше никогда не показывать. Interstitial при
    // этом ПРОПУСКАЕМ — юзер сделал доброе дело, не теребим его рекламой.
    document.getElementById('btn-rate-now').addEventListener('click', function () {
      window.Storage.setRateGiven(true);
      window.UI.hideModal('rate');
      const diff = lastCompletedDifficulty || selectedDifficulty;
      const mode = lastCompletedMode || selectedMode;
      // Fire-and-forget: SDK сам нарисует свой диалог поверх; на устройстве
      // без RuStore — откроется browser tab с deep-link.
      window.RuStoreReviewClient.launch().then(function (r) {
        console.log('[rate] RuStore review result:', r);
      }).catch(function (e) {
        console.warn('[rate] RuStore review threw:', e);
      });
      // Без interstitial — сразу следующий уровень.
      window.Game.startNewLevel(diff, mode);
      window.UI.showScreen('game');
    });

    // «Может позже» — закрываем модалку и идём дальше по обычной cadence
    // interstitial-логике. Sessional флаг уже взведён выше (rateModalShownThisSession),
    // больше в этой сессии rate-modal не появится.
    document.getElementById('btn-rate-later').addEventListener('click', function () {
      window.UI.hideModal('rate');
      const diff = lastCompletedDifficulty || selectedDifficulty;
      const mode = lastCompletedMode || selectedMode;
      proceedToNextLevel(diff, mode);
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

    // Политика конфиденциальности — внешняя ссылка на PDF в облаке.
    // URL единственная константа PRIVACY_URL ниже; меняется при обновлении
    // PDF на Cloud.Mail.ru. Пайплайн `prepare-release-candidate` проверяет
    // что URL не содержит TODO/placeholder перед release-сборкой.
    //
    // В Capacitor WebView target='_blank' → Intent.ACTION_VIEW, открывается
    // в системном браузере (или приложении Mail.ru Cloud если установлено).
    // В browser dev — обычная новая вкладка.
    document.getElementById('btn-privacy-policy').addEventListener('click', function () {
      try {
        window.open(PRIVACY_URL, '_blank', 'noopener,noreferrer');
      } catch (e) {
        console.warn('[settings] privacy open failed', e);
      }
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

  function showInfoModal(modeKey) {
    const info = MODE_INFO[modeKey] || MODE_INFO.classic;
    document.getElementById('info-mode-name').textContent = info.name;
    const list = document.getElementById('info-rules');
    list.innerHTML = '';
    for (let i = 0; i < info.rules.length; i++) {
      const r = info.rules[i];
      if (!r) continue;
      const div = document.createElement('div');
      div.className = 'rule';
      const num = document.createElement('div');
      num.className = 'rule-num';
      num.textContent = String(i + 1);
      const txt = document.createElement('div');
      txt.className = 'rule-text';
      txt.textContent = r;
      div.appendChild(num);
      div.appendChild(txt);
      list.appendChild(div);
    }
    window.UI.showModal('info');
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

  // Условие показа модалки «Нравится игра?» между уровнями.
  // 1. Не показываем если юзер уже оценивал — флаг rateGiven persisted в Storage.
  // 2. Не показываем повторно в текущей сессии (sessional in-memory флаг).
  //    После «Может позже» юзер увидит её снова при следующем запуске
  //    приложения — даём ещё одну попытку, но не назойливо.
  // 3. Показываем только когда юзер уже прошёл достаточно уровней чтобы
  //    сформировать впечатление: completedLevels >= 3. Согласовано с
  //    01_GlitterSort / 02_Words (L3 trigger).
  function shouldShowRateModal() {
    if (window.Storage.getRateGiven()) return false;
    if (rateModalShownThisSession) return false;
    if (window.Storage.getCompletedLevels() < 3) return false;
    return true;
  }

  // Универсальный переход на следующий уровень с учётом cadence-логики
  // interstitial-рекламы. Вызывается из:
  //   • btn-start-level (старт с главного меню)
  //   • btn-win-next когда rate-modal не показалась
  //   • btn-rate-later после клика «Может позже»
  // Если AdManager.shouldShowInterstitial() → true, сначала показываем
  // interstitial, потом грузим уровень. Иначе — сразу.
  function proceedToNextLevel(diff, mode) {
    const completed = window.Storage.getCompletedLevels();
    const shouldShow = window.AdManager.shouldShowInterstitial(completed);
    const launch = function () {
      window.Game.startNewLevel(diff, mode);
      window.UI.showScreen('game');
    };
    if (shouldShow) {
      window.AdManager.showInterstitialAd().then(launch);
    } else {
      launch();
    }
  }

  // Запрос на восстановление подсказки за rewarded ad. Вызывается из
  // onHint callback в NumberPad когда Storage.getHints() === 0. Если юзер
  // досмотрел рекламу до конца (result.watched === true), Game.applyHintReward()
  // увеличивает Storage.hints на 1 и перерисовывает UI. Если не досмотрел
  // (закрыл рекламу, нет fill, нет сети) — ничего не происходит.
  //
  // Защита от двойного клика: AdManager уже умеет игнорить параллельные
  // вызовы (см. busy в showRewardedAd), плюс UI блокирует клик пока показ
  // рекламы идёт. Так что здесь дополнительный mutex не нужен.
  function requestHintRefill() {
    window.AdManager.showRewardedAd({ kind: 'hint' }).then(function (result) {
      if (result && result.watched) {
        window.Game.applyHintReward();
      } else {
        console.log('[hint-refill] rewarded ad not watched, no reward granted');
      }
    }).catch(function (e) {
      console.warn('[hint-refill] showRewardedAd threw:', e);
    });
  }
})();
