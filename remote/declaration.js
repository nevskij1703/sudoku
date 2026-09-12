// СГЕНЕРИРОВАНО ИЗ remote-config.json — НЕ ПРАВИТЬ ЗДЕСЬ.
// Пересобрать: node tools/sync-client.mjs --write  (из папки admin)
//
// Нужно потому, что импортировать JSON умеет только сборщик: в classic-JS и в
// ES-модулях без сборки объявление обязано быть кодом. Значения не
// дублируются — источник один, этот файл лишь его отражение.

window.RC_DECLARATION = {
  "_": "Что можно крутить БЕЗ выпуска обновления. Этот файл читают оба: игра берёт из него дефолты и рамки, админка (../admin) — какие поля показать и по чему проверять. Второго списка нет намеренно: он разошёлся бы с игрой на первом же новом ключе.",
  "_defaults": "ОБЯЗАНЫ совпадать с константами сборки в config.js (GAME_CONFIG.ADS.interstitial, .GENERATOR, .BALANCE). Расхождение видно в браузере: при открытой дев-панели игра пишет о нём в консоль. Конфиг ПЕРЕБИВАЕТ значения, а не задаёт: недоступный бакет должен означать «игра как была».",
  "_ranges": "Рамки обязательны, ключ без рамки игра не применит. Опечатка вроде 0 в cadence иначе означала бы «межстраничная после каждого уровня у всех».",
  "_scope": "Ритм рекламы, просьба об оценке, генератор уровней, общая сложность (сдвиг открытых клеток, пороги лейбла), сердца на уровень и стартовый запас подсказок. ДВА КЛЮЧА УСТРОЕНЫ НЕ КАК ОСТАЛЬНЫЕ. `hearts_per_level` записывается в НОВЫЙ УРОВЕНЬ полем `heartsAtStart`, и «уровень нетронут» с «шкалой сердец» считаются по нему, а не по текущей настройке: иначе правка из облака между запусками показала бы потерянное сердце там, где его не теряли. `hints_start` правит поле сейва и правит его ОДИН раз, разницей к значению сборки — см. `applyStartGrant` в storage.js, флаг `startAdjusted` и migrations[10]; сейв рождается раньше ответа сети, и ключ, прочитанный при создании, вернул бы значение сборки каждому новому игроку.",
  "defaults": {
    "interstitial_enabled": 0,
    "interstitial_skip_first_levels": 3,
    "interstitial_cadence_levels": 2,
    "interstitial_cooldown_sec": 90,
    "interstitial_min_session_sec": 60,
    "rateus_min_levels": 3,
    "generator_symmetry": "rotational",
    "generator_time_budget_ms": 5000,
    "generator_max_retries": 20,
    "givens_shift_easy": 0,
    "givens_shift_medium": 0,
    "givens_shift_hard": 0,
    "label_easy_max_score": 300,
    "label_easy_max_tech": 2,
    "label_medium_max_score": 1600,
    "label_medium_max_tech": 12,
    "undo_stack_size": 50,
    "hearts_per_level": 3,
    "hints_start": 5
  },
  "ranges": {
    "interstitial_enabled": {
      "oneOf": [
        0,
        1
      ]
    },
    "interstitial_skip_first_levels": {
      "min": 0,
      "max": 50
    },
    "interstitial_cadence_levels": {
      "min": 1,
      "max": 20
    },
    "interstitial_cooldown_sec": {
      "min": 0,
      "max": 3600
    },
    "interstitial_min_session_sec": {
      "min": 0,
      "max": 3600
    },
    "rateus_min_levels": {
      "min": 1,
      "max": 50
    },
    "generator_symmetry": {
      "oneOf": [
        "rotational",
        "mirror",
        "none"
      ]
    },
    "generator_time_budget_ms": {
      "min": 500,
      "max": 30000
    },
    "generator_max_retries": {
      "min": 1,
      "max": 100
    },
    "givens_shift_easy": {
      "min": -10,
      "max": 10
    },
    "givens_shift_medium": {
      "min": -10,
      "max": 10
    },
    "givens_shift_hard": {
      "min": -10,
      "max": 10
    },
    "label_easy_max_score": {
      "min": 50,
      "max": 2000
    },
    "label_easy_max_tech": {
      "min": 1,
      "max": 20
    },
    "label_medium_max_score": {
      "min": 100,
      "max": 5000
    },
    "label_medium_max_tech": {
      "min": 1,
      "max": 40
    },
    "undo_stack_size": {
      "min": 5,
      "max": 500
    },
    "hearts_per_level": {
      "min": 1,
      "max": 10
    },
    "hints_start": {
      "min": 0,
      "max": 50
    }
  },
  "labels": {
    "interstitial_enabled": "Межстраничная включена (0 или 1)",
    "interstitial_skip_first_levels": "Межстраничной нет, пока пройдено меньше N уровней",
    "interstitial_cadence_levels": "Межстраничная каждый N-й пройденный уровень",
    "interstitial_cooldown_sec": "Между двумя показами, секунд",
    "interstitial_min_session_sec": "Не показывать первые N секунд после запуска",
    "rateus_min_levels": "Просьба оценить не раньше N пройденных уровней",
    "generator_symmetry": "Симметрия открытых клеток",
    "generator_time_budget_ms": "Бюджет одной генерации, мс",
    "generator_max_retries": "Попыток подобрать уровень",
    "givens_shift_easy": "Сдвиг открытых клеток: легко",
    "givens_shift_medium": "Сдвиг открытых клеток: средне",
    "givens_shift_hard": "Сдвиг открытых клеток: трудно",
    "label_easy_max_score": "«Легко»: балл не выше",
    "label_easy_max_tech": "«Легко»: вес приёма не выше",
    "label_medium_max_score": "«Средне»: балл не выше",
    "label_medium_max_tech": "«Средне»: вес приёма не выше",
    "undo_stack_size": "Глубина отмены ходов",
    "hearts_per_level": "Сердец на уровень",
    "hints_start": "Подсказок на входе (только новым игрокам)"
  },
  "groups": {
    "interstitial_enabled": "Реклама",
    "interstitial_skip_first_levels": "Реклама",
    "interstitial_cadence_levels": "Реклама",
    "interstitial_cooldown_sec": "Реклама",
    "interstitial_min_session_sec": "Реклама",
    "rateus_min_levels": "Оценка приложения",
    "generator_symmetry": "Генератор уровней",
    "generator_time_budget_ms": "Генератор уровней",
    "generator_max_retries": "Генератор уровней",
    "givens_shift_easy": "Сложность",
    "givens_shift_medium": "Сложность",
    "givens_shift_hard": "Сложность",
    "label_easy_max_score": "Сложность",
    "label_easy_max_tech": "Сложность",
    "label_medium_max_score": "Сложность",
    "label_medium_max_tech": "Сложность",
    "undo_stack_size": "Игра",
    "hearts_per_level": "Сердечки",
    "hints_start": "Подсказки"
  },
  "funnel": {
    "_": "Шаги воронки прохождения. Задаётся ЗДЕСЬ, потому что знать свои события может только игра: угаданный список нарисовал бы правдоподобный график по событиям, которых нет, и обнаружилось бы это по нулям.",
    "_steps": "Имена событий по порядку. Считается число РАЗНЫХ людей, у кого событие было хоть раз, а не «дошедших по порядку»: порядок доставки событий не гарантирован. Доля — от первого шага.",
    "_levels": "Прохождение по уровням: event — событие, param — плоский параметр с номером уровня (его отправляют и выпущенные сборки), max — до какого уровня рисовать. РАЗРЕЗ ПО ГРУППАМ A/B берётся не отсюда, а из вложенного параметра того же события: игра добавляет progress: { \"<уровень>\": \"<группа>\" } рядом с плоским level_num. Вложенного — потому что в дереве параметров отчёта уровень и группа тогда лежат на разных уровнях ОДНОЙ ветви и пересекаются запросом; лежа соседними ветвями (level_num и ab рядом) они не пересекаются, такой запрос отдаёт ноль строк. Форму собирает admin/client/progress.js — один код на игру и на админку.",
    "steps": [
      "session_start",
      "level_start",
      "level_complete",
      "ad_rewarded_shown"
    ],
    "levels": {
      "event": "level_start",
      "param": "level_num",
      "max": 30
    }
  }
};
