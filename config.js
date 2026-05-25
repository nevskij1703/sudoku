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
      unitId: 'R-M-19325500-1',
      cooldownMs: 90 * 1000,          // не чаще раза в 90 секунд между показами
      minSessionMs: 60 * 1000,        // не показывать в первую минуту сессии (с момента запуска app)
      skipFirstNLevels: 3,            // не показывать пока юзер не прошёл 3 уровня (любого режима/сложности)
      cadenceLevels: 2                // показывать после каждого N-го пройденного уровня
    },
    rewarded: {
      unitId: 'R-M-19325500-2'
    }
  },

  // Генератор уровней (см. sudokuGenerator.js).
  GENERATOR: {
    timeBudgetMs: 5000,               // hard cap на одну попытку генерации
                                       // (Windoku/Diagonal с extra-units имеют медленный countSolutions,
                                       //  требуется больше времени для carve до целевого минимума)
    maxRetries: 20,                   // сколько puzzle'ов сгенерить и отбросить, ища нужный лейбл
    symmetry: 'rotational',           // 'rotational' | 'mirror' | 'none'
    // Диапазон количества «открытых» клеток (givens) для каждой сложности.
    // Это DEFAULT — используется если variant не задал свой targetGivens
    // и нет per-mode override в DIFFICULTY (ниже). Меньше givens = сложнее.
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

  // Per-mode настройки сложности.
  //
  // Логика: разные режимы дают разную «помощь» игроку через extra-constraints.
  // Чтобы СУБЪЕКТИВНАЯ сложность совпадала с лейблом, нужно компенсировать
  // эту помощь — давать МЕНЬШЕ givens в более «помогающих» режимах.
  //
  // Сравнение режимов (количество extra units помимо row+col+box):
  //   classic      0 extra (baseline)
  //   center      +1 unit  (9 центральных cells)         — чуть проще
  //   diagonal    +2 units (2 диагонали × 9 cells)       — заметно проще
  //   windoku     +4 units (4 inner zones × 9 cells)     — намного проще
  //   kropki      +N dots (consec/double подсказки)      — проще
  //   sugur       0 extra (snake вместо box, но same #) — = classic
  //   chain       0 extra (chain вместо box, +diagonal) — = classic, чуть сложнее визуально
  //   mini        отдельная шкала (4×4 = 16 cells)
  //
  // Соответствующие givens-targets компенсируют extra-help: чем сильнее
  // помощь, тем меньше givens нужно для той же difficulty.
  DIFFICULTY: {
    classic: {
      easy:   [38, 45],
      medium: [30, 35],
      hard:   [26, 30]
    },
    center: {
      easy:   [36, 43],     // -2 givens vs classic
      medium: [28, 33],
      hard:   [24, 28]
    },
    diagonal: {
      easy:   [34, 41],     // -4 givens vs classic (2 диагонали = ощутимая помощь)
      medium: [26, 31],
      hard:   [22, 26]
    },
    windoku: {
      // 4 inner zones дают сильную помощь — теоретически hard должен быть
      // 20-24 givens. Но countSolutions для Windoku constraint в 5-10×
      // медленнее classic, и generator не всегда успевает carve до min за
      // timeBudget. Расширяем диапазоны medium/easy чтобы generator
      // принимал candidates даже при slow-carve — реальная сложность
      // компенсируется extra-constraints.
      easy:   [38, 45],
      medium: [30, 38],
      hard:   [22, 28]
    },
    kropki: {
      easy:   [36, 43],     // -2 givens vs classic (dots дают подсказки)
      medium: [28, 33],
      hard:   [24, 28]
    },
    sugur: {
      easy:   [42, 46],     // ≈ classic — змейка == box по constraint structure
      medium: [33, 37],
      hard:   [28, 32]
    },
    chain: {
      easy:   [42, 46],     // ≈ classic + чуть проще из-за диагональных связей
      medium: [33, 37],
      hard:   [28, 32]
    },
    mini: {
      easy:   [10, 12],     // 4×4 = 16 cells, отдельная шкала
      medium: [8, 9],
      hard:   [6, 7]
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
