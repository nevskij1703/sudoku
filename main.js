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
  // Параметры, которые будут применены после ответа в save-confirm модалке
  // (если для выбранного режима есть сейв — мы показываем модалку и ждём
  // выбора между «Продолжить» и «Начать заново»).
  let pendingStartDifficulty = null;
  let pendingStartMode = null;

  // Ссылка на смонтированный slider — нужна вне init() (backToHome и т.п.).
  let diffSliderRef = null;

  // Короткие caps-имена режимов для большого заголовка игрового экрана
  // (раньше там всегда было «СУДОКУ»; пользователь попросил показывать
  // конкретный текущий режим). Подбирали значения с прицелом на ≤9 букв,
  // чтобы влезало в brand-шрифт 36px с летрингом без переноса.
  const MODE_TITLE = {
    mini:     'МИНИ 4×4',
    classic:  'СУДОКУ',
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
      name: 'Судоку',
      rules: [
        'Расставляй цифры от 1 до 9 в пустых клетках.',
        'Цифры не должны повторяться по горизонтали, вертикали и в каждом блоке 3×3.',
        'Используй карандаш для заметок, если сомневаешься.'
      ]
    },
    diagonal: {
      name: 'Диагональ',
      rules: [
        'Те же правила, что в классическом Судоку.',
        'Дополнительно: на двух главных диагоналях (от угла к углу) цифры тоже не должны повторяться.',
        'Места для манёвра меньше — нужно больше думать на каждом шаге.'
      ]
    },
    kropki: {
      name: 'Точки (Kropki)',
      rules: [
        'Те же правила, что в классическом Судоку.',
        'Пустой кружочек между двумя соседними клетками: цифры в них отличаются ровно на 1.',
        'Закрашенный кружочек: одна цифра вдвое больше другой.'
      ]
    },
    center: {
      name: 'Центр',
      rules: [
        'Те же правила, что в классическом Судоку.',
        'Дополнительно: 9 центральных клеток каждого блока 3×3 образуют свой «уникальный» набор — там тоже не должно быть повторов.',
        'Это даёт игроку дополнительный ориентир в середине доски.'
      ]
    },
    windoku: {
      name: 'Виндоку',
      rules: [
        'Те же правила, что в классическом Судоку.',
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
      onErase:  function ()  { window.Game.handleErase(); },
      onFastToggle: function () { requestFastToggle(); }
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

    // Difficulty — кастомный ползунок 0..2 (easy/medium/hard) с магнитной
    // фиксацией к ближайшему значению. Подробности в mountDiffSlider() ниже.
    const DIFF_ORDER = ['easy', 'medium', 'hard'];
    diffSliderRef = mountDiffSlider({
      onChange: function (idx) {
        selectedDifficulty = DIFF_ORDER[idx];
      }
    });
    // Кликабельные ярлыки под ползунком — анимированно подъезжают к нужному.
    document.querySelectorAll('.diff-label').forEach(function (lbl) {
      lbl.addEventListener('click', function () {
        const v = lbl.dataset.difficulty;
        const idx = DIFF_ORDER.indexOf(v);
        if (idx >= 0) diffSliderRef.setValue(idx);
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
      // Старт с главного меню. Если есть сейв для (mode, difficulty) — сразу
      // загружаем сохранённое состояние и показываем доску, а модалку
      // «Сохранение» открываем поверх него. Так игрок видит на что
      // именно он будет возвращаться или начинать заново.
      const existing = window.Storage.getActiveByMode(selectedMode, selectedDifficulty);
      if (existing) {
        pendingStartDifficulty = selectedDifficulty;
        pendingStartMode = selectedMode;
        if (window.Game.resumeMode(selectedMode, selectedDifficulty)) {
          window.UI.showScreen('game');
        }
        window.UI.showModal('save-confirm');
      } else {
        proceedToNextLevel(selectedDifficulty, selectedMode);
      }
    });

    // Save-confirm: «Продолжить» → доска уже загружена (resume произошёл
    // в btn-start-level), показываем interstitial по cadence-правилу и
    // оставляем юзера на сохранённом уровне.
    // «Начать заново» → удаляем сейв, новый уровень через proceedToNextLevel
    // (он тоже триггерит interstitial по cadence). Оба варианта — триггер
    // interstitial-рекламы.
    document.getElementById('btn-save-continue').addEventListener('click', function () {
      window.UI.hideModal('save-confirm');
      // Game state уже восстановлен. Показываем рекламу по cadence — иначе
      // просто остаёмся на загруженном уровне.
      const completed = window.Storage.getCompletedLevels();
      if (window.AdManager.shouldShowInterstitial(completed)) {
        window.AdManager.showInterstitialAd();
      }
      pendingStartDifficulty = null;
      pendingStartMode = null;
    });
    document.getElementById('btn-save-restart').addEventListener('click', function () {
      const diff = pendingStartDifficulty || selectedDifficulty;
      const mode = pendingStartMode || selectedMode;
      window.Storage.clearActiveByMode(mode, diff);
      window.UI.hideModal('save-confirm');
      // proceedToNextLevel сам решает про cadence interstitial — нам не
      // нужно делать show вручную, иначе будет double-ad.
      proceedToNextLevel(diff, mode);
      pendingStartDifficulty = null;
      pendingStartMode = null;
    });

    // ===== 6. Игровой экран =====
    document.getElementById('btn-game-home').addEventListener('click', function () {
      window.UI.showModal('confirm-exit');
    });
    document.getElementById('btn-game-info').addEventListener('click', function () {
      // ВАЖНО: содержимое info-модалки кешируется между вызовами (последняя
      // нажатая info-кнопка перезаписывает #info-rules). На игровом экране
      // надо явно перезагрузить контент под АКТИВНЫЙ режим, иначе показываются
      // правила того режима, который последним просматривали на главной.
      const a = window.Game.getActive();
      const modeKey = (a && a.mode) ? a.mode : 'classic';
      showInfoModal(modeKey);
    });
    document.getElementById('btn-game-settings').addEventListener('click', openSettings);

    // ===== 7. Подтверждение выхода =====
    // Прогресс сохраняется (см. Game.leaveToMenu) — юзер может вернуться
    // в этот режим и продолжить через save-confirm.
    document.getElementById('btn-confirm-exit-yes').addEventListener('click', function () {
      window.UI.hideModal('confirm-exit');
      window.Game.leaveToMenu();
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
    // Кнопка «Оценить приложение» удалена из settings — оценивать игроки
    // будут только через автоматическую rate-modal между уровнями (см.
    // shouldShowRateModal в этом файле).

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
    // При запуске приложения — всегда показываем home. Сейвы лежат в
    // activeByMode[mode]: если юзер кликнет «Начать» на режиме с сейвом,
    // save-confirm модалка предложит «Продолжить» / «Начать заново».
    // Это более consistent UX чем auto-resume первого попавшегося mode'а
    // (теперь у нас сейв на каждый режим).
    updateHomeStats();
    window.UI.showScreen('home');
  }

  function backToHome() {
    // Главный экран совмещён с выбором сложности — обновляем статистику
    // и подсветку выбранного режима/сложности через тот же API слайдера,
    // что и кликабельные ярлыки. Тильное анимация подгонит thumb.
    const idx = ['easy', 'medium', 'hard'].indexOf(selectedDifficulty);
    if (idx >= 0 && diffSliderRef) diffSliderRef.setValue(idx);
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
    // Блок статистики на home-экране убран — позже она появится в новом
    // месте/виде. Сейчас просто no-op для сохранения вызовов из других
    // функций (backToHome / win-flow и т.д.).
    const c = document.getElementById('stat-completed');
    const d = document.getElementById('stat-by-diff');
    if (c) window.UI.setText('stat-completed', String(window.Storage.getCompletedLevels()));
    if (d) {
      const byDiff = window.Storage.getCompletedByDifficulty();
      window.UI.setText('stat-by-diff', (byDiff.easy || 0) + ' / ' + (byDiff.medium || 0) + ' / ' + (byDiff.hard || 0));
    }
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
  // Toggle быстрого режима. Если фича в текущем уровне ещё не разблокирована
  // (active.fastModeUnlocked === false) — сначала просим юзера посмотреть
  // rewarded ad; при успехе помечаем unlock + сразу включаем. Если уже
  // unlocked — обычный toggle без рекламы. См. game.js → setFastModeActive.
  function requestFastToggle() {
    const a = window.Game.getActive();
    if (!a) return;
    if (a.fastModeUnlocked) {
      // Toggle on/off без рекламы — уже разблокирован на этот уровень.
      // UI обновится через renderAll (см. game.js → setFastModeActive).
      window.Game.setFastModeActive(!a.fastModeActive);
      return;
    }
    // Ещё не unlocked — запрашиваем rewarded ad. На watched: unlock + on.
    window.AdManager.showRewardedAd({ kind: 'fast-mode' }).then(function (result) {
      if (result && result.watched) {
        window.Game.unlockFastMode();
        window.Game.setFastModeActive(true);
      } else {
        console.log('[fast] rewarded ad not watched, unlock skipped');
      }
    }).catch(function (e) {
      console.warn('[fast] showRewardedAd threw:', e);
    });
  }

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

  // Кастомный slider сложности с «резиновой» физикой.
  //
  // Поведение:
  // * pointerdown — захват, thumb сразу под пальцем (никакого ease в этот
  //   момент — лёгкий «snap-к-пальцу» при первом тапе ОК).
  // * pointermove — thumb идёт за пальцем с нелинейной зависимостью
  //   (ease-in power 1.5): чем дальше от текущего snap-point, тем сильнее
  //   ускоряется. При движении на ~75% между двумя значениями визуальное
  //   положение уже перевалит за середину и приблизится к новому
  //   значению (но не залипнет — отслеживает курсор continuously).
  //   При малейшем движении thumb уже отделяется — никакой «магнитной
  //   точки залипания» нет.
  // * pointerup — Math.round(rawCursor) даёт ближайший snap-point.
  //   CSS transition анимированно подъезжает.
  // * Клавиатура: ←/↓ Home / → ↑ End — обычный snap.
  function mountDiffSlider(opts) {
    const onChange = (opts && opts.onChange) || function () {};
    const track = document.getElementById('diff-track');
    if (!track) return { setValue: function(){}, getValue: function(){ return 1; } };

    let continuousRaw = 1;         // позиция курсора в [0..2], float
    let snapValue = 1;             // последний committed snap (0/1/2)
    let pointerId = null;

    // Параметр крутизны sigmoid-«резинки». Чем больше — тем сильнее
    // ощущается «прилипание» к текущему уровню и тем резче «выскакивание»
    // к следующему после преодоления зоны притяжения.
    //   K=4   — мягкая ease-in-out (как было).
    //   K=8   — заметное прилипание + быстрый перенос.
    //   K=10  — почти бинарное переключение (магнит).
    //   K=12  — экстремально тягучий, может вызвать «прыжок».
    // Подобрано на ощупь: 10 даёт чёткое сопротивление в начале и быстрый
    // «перекат» после точки инфлексии (frac ≈ 0.5).
    const RUBBER_K = 10;
    // Пред-вычисленные edge-значения sigmoid для нормализации.
    const SIG_S0 = 1 / (1 + Math.exp(RUBBER_K * 0.5));
    const SIG_S1 = 1 / (1 + Math.exp(-RUBBER_K * 0.5));
    const SIG_RANGE = SIG_S1 - SIG_S0;

    function setPct(pct) {
      track.style.setProperty('--diff-pct', pct + '%');
    }
    // Sigmoid (логистическая) функция, отображающая x ∈ [0, 1] → [0, 1]
    // через S-кривую с центром в x=0.5. При малых x — почти ноль (магнит
    // к текущему уровню), при x ≈ 0.5 — резкий рост (зона перехода),
    // при x → 1 — почти 1 (магнит к следующему уровню).
    function sigmoidEase(x) {
      const s = 1 / (1 + Math.exp(-RUBBER_K * (x - 0.5)));
      return (s - SIG_S0) / SIG_RANGE;
    }
    // Нелинейная функция «резинки». Принимает реальное смещение курсора
    // относительно реперного snap-а и возвращает визуальное смещение.
    //
    // ВАЖНО: используем Math.floor (целая часть пройденных snap-границ),
    // а не Math.round (ближайший snap). С Math.round две sigmoid-кривые
    // встречались бы в зоне их пологих краёв (вблизи frac=±0.5), создавая
    // ВИЗУАЛЬНОЕ ПЛАТО около середины — пользователь воспринимал бы это
    // как лишний промежуточный stop. С Math.floor — одна непрерывная
    // sigmoid на каждом [snap_N, snap_{N+1}) интервале, без плато.
    function easeRubber(rawDelta) {
      const sign = rawDelta < 0 ? -1 : 1;
      const absD = Math.abs(rawDelta);
      const intPart = Math.floor(absD);                // 0 / 1 / 2 (пройденные snap)
      const frac = absD - intPart;                     // в [0, 1)
      const easedFrac = sigmoidEase(frac);             // в [0, 1)
      return sign * (intPart + easedFrac);
    }
    function setVisualFromRaw(rawValue) {
      // Реперный snap — последний committed (snapValue). Движение
      // считается относительно него, ease применяется к разнице.
      const delta = rawValue - snapValue;
      const visual = snapValue + easeRubber(delta);
      // Clamp до диапазона [0..2] на случай overshoot при отпускании курсора.
      const clamped = Math.max(0, Math.min(2, visual));
      setPct((clamped / 2) * 100);
    }
    function fromClientX(clientX) {
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return continuousRaw;
      const x = clientX - rect.left;
      const f = Math.max(0, Math.min(1, x / rect.width));
      return f * 2;
    }
    function commitSnap(value) {
      snapValue = value;
      continuousRaw = value;
      setPct((value / 2) * 100);
      track.setAttribute('aria-valuenow', String(value));
      updateDiffLabels(value);
      onChange(value);
    }
    function updateDiffLabels(idx) {
      const order = ['easy', 'medium', 'hard'];
      document.querySelectorAll('.diff-label').forEach(function (lbl) {
        lbl.classList.toggle('active', lbl.dataset.difficulty === order[idx]);
      });
    }

    track.addEventListener('pointerdown', function (e) {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      track.setPointerCapture(pointerId);
      track.classList.add('dragging');
      const raw = fromClientX(e.clientX);
      continuousRaw = raw;
      setVisualFromRaw(raw);
      e.preventDefault();
    });
    track.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pointerId) return;
      const raw = fromClientX(e.clientX);
      continuousRaw = raw;
      setVisualFromRaw(raw);
    });
    function endDrag(e) {
      if (e.pointerId !== pointerId) return;
      track.classList.remove('dragging');
      try { track.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
      // Snap к ближайшему snap-point (Math.round). CSS transition
      // в .diff-thumb сделает плавную анимацию.
      const nearest = Math.max(0, Math.min(2, Math.round(continuousRaw)));
      commitSnap(nearest);
    }
    track.addEventListener('pointerup',     endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('keydown', function (e) {
      let next = snapValue;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  next = Math.max(0, snapValue - 1);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   next = Math.min(2, snapValue + 1);
      if (e.key === 'Home') next = 0;
      if (e.key === 'End')  next = 2;
      if (next !== snapValue) {
        commitSnap(next);
        e.preventDefault();
      }
    });

    commitSnap(1);

    return {
      setValue: function (idx) {
        const v = Math.max(0, Math.min(2, idx | 0));
        commitSnap(v);
      },
      getValue: function () { return snapValue; }
    };
  }
})();
