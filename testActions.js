/**
 * Что умеет тестовый мост в Судоку: состояние, награды, победа, сброс.
 *
 * ТО ЖЕ САМОЕ, ЧТО КНОПКИ ДЕВ-ПАНЕЛИ, и это не совпадение: нужны они по одному
 * поводу — поставить игру в состояние, до которого честной игрой идти долго.
 * Разница в том, кто нажимает: панель — человек, мост — агент по usb-отладке.
 *
 * ПОЧЕМУ ЭТО НЕ ДЫРА, хотя «заполнить решением» здесь есть и в релизной
 * сборке: мост исполняет только ПОДПИСАННУЮ команду, а приватного ключа в APK
 * нет (`admin/secrets`). Дев-панель так защитить нельзя — у неё кнопки, а не
 * подписи, — поэтому её и прячут за `?dev=1`.
 *
 * `state` ВАЖНЕЕ ОСТАЛЬНОГО: действие без чтения состояния нечем подтвердить.
 *
 * Используют: main.js.
 */
window.TestActions = (function () {
  'use strict';

  function active() {
    const a = window.Game ? window.Game.getActive() : null;
    if (!a) throw new Error('нет активного уровня');
    return a;
  }

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function install() {
    if (!window.RemoteConfig || !window.RemoteConfig.registerTestActions) return;
    window.RemoteConfig.registerTestActions({
      state: {
        note: 'снимок: активный уровень, сердца, подсказки, пройдено',
        run: function () {
          const a = window.Game ? window.Game.getActive() : null;
          return {
            completed: window.Storage.getCompletedLevels(),
            byDifficulty: window.Storage.getCompletedByDifficulty(),
            mockAds: window.Storage.getMockAds(),
            active: a ? {
              mode: a.mode,
              difficulty: a.difficulty,
              hearts: a.hearts,
              hintsUsed: a.hintsUsed,
              elapsedMs: a.elapsedMs,
              filled: a.board.filter(function (v) { return v !== 0; }).length
            } : null
          };
        }
      },

      'grant.hearts': {
        note: 'добавить сердец текущему уровню',
        args: { amount: 'число' },
        run: function (args) {
          const a = active();
          a.hearts = Math.min(9, a.hearts + Math.round(num(args.amount, 1)));
          window.Storage.setActive(a);
          window.Game._renderAll();
          return { hearts: a.hearts };
        }
      },

      'grant.hints': {
        note: 'вернуть потраченные подсказки',
        args: { amount: 'число' },
        run: function (args) {
          const a = active();
          a.hintsUsed = Math.max(0, a.hintsUsed - Math.round(num(args.amount, 1)));
          window.Storage.setActive(a);
          window.Game._renderAll();
          return { hintsUsed: a.hintsUsed };
        }
      },

      'level.win': {
        note: 'заполнить решением и засчитать победу',
        run: function () {
          const a = active();
          // Одну ячейку оставляем игре: победа наступает в `handleNumber`, и
          // заполнив всё сами, мы получили бы решённую доску без события победы
          // — то есть проверили бы не то.
          let target = -1;
          for (let i = 0; i < a.board.length; i++) if (!a.givens[i]) { target = i; break; }
          if (target === -1) throw new Error('на уровне нет пустых ячеек');
          for (let i = 0; i < a.board.length; i++) {
            if (!a.givens[i]) {
              a.board[i] = (i === target) ? 0 : a.solution[i];
              a.mistakes[i] = false;
            }
          }
          window.Storage.setActive(a);
          window.Game._renderAll();
          window.Game.handleCellClick(target);
          window.Game.handleNumber(a.solution[target]);
          return { completed: window.Storage.getCompletedLevels() };
        }
      },

      'level.new': {
        note: 'начать новый уровень: mode + difficulty',
        args: { mode: 'classic|center|diagonal|windoku|kropki|sugur|chain|mini', difficulty: 'easy|medium|hard' },
        run: function (args) {
          const mode = String(args.mode || 'classic');
          const difficulty = String(args.difficulty || 'medium');
          // Порядок аргументов у игры (difficulty, mode), а не наоборот.
          window.Game.startNewLevel(difficulty, mode);
          return { mode: mode, difficulty: difficulty };
        }
      },

      'progress.reset': {
        note: 'сбросить счётчики пройденных уровней',
        run: function () {
          window.Storage.resetProgress();
          return { completed: window.Storage.getCompletedLevels() };
        }
      },

      'progress.wipe': {
        note: 'полный сброс localStorage; после этого нужен app.reload',
        run: function () {
          window.Storage.resetAll();
          return { wiped: true };
        }
      }
    });
  }

  return { install: install };
})();
