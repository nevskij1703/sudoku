/**
 * config.js — глобальные константы Sudoku.
 * Подгружается ПЕРВЫМ перед всеми остальными скриптами.
 *
 * Структура:
 *   GAME_CONFIG.ADS         — unit-IDs и cadence реклам
 *   GAME_CONFIG.GENERATOR   — параметры генератора уровней
 *   GAME_CONFIG.BALANCE     — игровой баланс (сердца, подсказки)
 *   GAME_CONFIG.DEV         — dev-only флаги
 */
window.GAME_CONFIG = {
  // Реклама. Реальные unit-IDs из RuStore партнёрки заполнит Александр перед первой публикацией.
  // Сейчас стоят placeholder'ы — в браузере и dev APK уйдём в mock backend (см. ads.js).
  ADS: {
    interstitial: {
      unitId: 'R-M-XXXXXXXX-1',
      cooldownMs: 90 * 1000,          // не чаще раза в 90 секунд
      skipFirstNLevels: 2,            // не показывать пока юзер не прошёл 2 уровня
      cadenceLevels: 2                // показывать после каждого N-го пройденного уровня
    },
    rewarded: {
      unitId: 'R-M-XXXXXXXX-2'
    }
  },

  // Генератор уровней (см. sudokuGenerator.js).
  GENERATOR: {
    timeBudgetMs: 1500,               // hard cap на одну попытку генерации
    maxRetries: 20,                   // сколько puzzle'ов сгенерить и отбросить, ища нужный лейбл
    symmetry: 'rotational',           // 'rotational' | 'mirror' | 'none'
    // Диапазон количества «открытых» клеток (givens) для каждой сложности.
    // Меньше givens = сложнее. На уверенно проходимом верхнем хвосте — 26-30.
    givensTarget: {
      easy:   [38, 45],
      medium: [30, 35],
      hard:   [26, 30]
    },
    // Пороги score из rateDifficulty для лейблов.
    // Калибровка (см. devPanel «Стат. по 50 уровням»):
    //   easy puzzles: ~125-230 score.
    //   medium puzzles: ~600-1300 score (один-два pointing pair'а добавляют ~1000).
    //   hard puzzles: ≥1300 (с box-line / nakedTriple) или Infinity (требуется guess).
    labelThresholds: {
      easy:   { maxScore: 300,  maxTechWeight: 2 },   // только naked + hidden singles
      medium: { maxScore: 1600, maxTechWeight: 12 }   // до box-line reduction включительно
      // hard — всё что выше
    }
  },

  // Геймплей-баланс. Меняется тут, gameplay-код читает только отсюда.
  BALANCE: {
    heartsPerLevel: 3,
    hintsPerLevel: 5,
    undoStackSize: 50
  },

  // Dev-режим. Перебивается ?dev=1 в URL (см. main.js).
  DEV: {
    enabled: false
  },

  // Дефолты для settings в новом сейве.
  enableSound: true,
  enableVibration: true,
  mockAds: false
};
