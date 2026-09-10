// СОБРАННЫЙ ФАЙЛ — НЕ ПРАВИТЬ РУКАМИ.
// Источники: abTest.js, progress.js, params.js, remoteConfig.js, devParams.js, testBridgeKey.js, testBridge.js. Пересобрать: node client/build-iife.mjs
//
// Для classic-JS игр без сборщика. Подключается обычным <script> ДО игрового
// кода и кладёт всё в window.RemoteConfig:
//
//     <script src="remoteConfig.iife.js"></script>
//     ...
//     await RemoteConfig.initRemoteConfig({ appId: "com.terekh.sudoku", defaults: D, ranges: R });

;(function (global) {
  "use strict";

// ===== abTest.js =====
// A/B-тесты: в какую группу попало ЭТО устройство.
//
// РАЗБИЕНИЕ СЧИТАЕТСЯ НА УСТРОЙСТВЕ, а не на сервере. Поэтому конфиг остаётся
// ОДНИМ файлом на всех — его не надо персонализировать, бакету не нужно знать,
// кто спрашивает, и о человеке наружу не уходит ничего. Жребий берётся из UUID
// установки, значит он не меняется от запуска к запуску и не зависит от того,
// была ли сеть.
//
// Схема описания теста:
//
//     "tests": [
//       {
//         "id": "generous",
//         "slot": 3,
//         "groups": [
//           { "name": "control", "share": 70, "values": {} },
//           { "name": "wide",    "share": 30, "values": { "free_hints": 5 } }
//         ]
//       }
//     ]
//
// ДОЛИ — ПРОИЗВОЛЬНЫЕ ЧИСЛА, а не шестнадцатые. Раньше требовалась сумма ровно
// 16, потому что жребий брался из ОДНОЙ шестнадцатеричной цифры UUID. Это
// заставляло думать в шестнадцатых (точной трети не существует) и, главное,
// упиралось в устройство UUID: в версии 4 цифра на позиции 12 всегда `4`, а на
// позиции 16 — только 8, 9, a или b. То есть тест на слоте 12 отправлял ВСЕХ в
// одну группу, а на слоте 16 использовал четыре корзины из шестнадцати — молча
// и с полностью правдоподобным видом.
//
// Поэтому корзина считается ХЕШЕМ от `installId` и слота: тысяча корзин,
// независимость слотов не зависит от строения UUID, доли задаются как угодно.
//
// ПОЛЕ НАЗЫВАЕТСЯ `share`, А НЕ `w`, И ЭТО ЗАЩИТА, А НЕ ВКУСОВЩИНА. Сборки,
// выпущенные до этой правки, содержат прежний разбор: он читает `g.w`, не
// находит его и признаёт тест негодным — то есть ПРОПУСКАЕТ целиком. Оставь
// прежнее имя, и такая сборка разбила бы людей по старому правилу, а новая по
// новому; в отчётах это дало бы одну группу, собранную из двух разных
// жребиев, и заметить это было бы нечем.

/** Корзин тысяча: доля от суммы округляется до одной тысячной. */
const BUCKETS = 1000;

/**
 * FNV-1a с перемешиванием в конце. Стабильный, без зависимостей.
 *
 * ПЕРЕМЕШИВАНИЕ ОБЯЗАТЕЛЬНО, и это не запас прочности. У чистого FNV-1a два
 * входа, различающиеся ПОСЛЕДНИМ символом, дают хеши, отличающиеся почти
 * фиксированной величиной: последний шаг — умножение на простое, и разница в
 * один бит превращается в разницу ровно на это простое. Слоты 0 и 1 в итоге
 * оказались зависимыми — на 2000 устройствах группы совпадали в 24.6 % случаев
 * вместо ожидаемых 50 %, то есть два «независимых» теста мешали друг другу.
 * Поймано тестом «СЛОТЫ НЕЗАВИСИМЫ»; глазами такое не увидеть.
 */
function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Лавина: каждый входной бит влияет на все выходные.
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Номер корзины устройства для данного теста: 0..999.
 *
 * `slot` — своя цифра у каждого теста. На общем слоте два теста разбили бы
 * людей ОДИНАКОВО: кто попал в «щедрую» группу первого, попал бы в «щедрую»
 * группу второго у всех до единого, и различить, что именно подействовало,
 * стало бы невозможно. Слот входит в хеш, поэтому независимость получается
 * сама и не зависит от того, какие цифры в UUID случайны.
 */
function bucketOf(installId, slot) {
  const id = String(installId ?? "");
  if (!id) return 0;
  // Слот ВПЕРЁД: так его отличие проходит через весь id, а не оказывается
  // последним шагом хеша.
  return hashOf(`${slot}|${id}`) % BUCKETS;
}

/** Сумма долей теста. */
function shareSum(test) {
  return test.groups.reduce((a, g) => a + (Number(g.share) || 0), 0);
}

/**
 * Тест разобран правильно? Кривой тест ПРОПУСКАЕТСЯ ЦЕЛИКОМ, а не починяется:
 * тест с потерянной группой — это уже другой тест, и его результат нельзя
 * сравнивать с тем, который задумывали.
 */
function testIsSane(test) {
  if (!test || typeof test.id !== "string" || !test.id) return false;
  if (!Number.isInteger(test.slot) || test.slot < 0) return false;
  if (!Array.isArray(test.groups) || test.groups.length < 2) return false;

  const names = new Set();
  for (const g of test.groups) {
    if (!g || typeof g.name !== "string" || !g.name) return false;
    if (names.has(g.name)) return false;
    names.add(g.name);
    const share = Number(g.share);
    if (!Number.isFinite(share) || share <= 0) return false;
    if (g.values != null && typeof g.values !== "object") return false;
  }
  // Сумма может быть любой, но не нулевой: нулевая означала бы тест, в котором
  // никому ничего не досталось.
  return shareSum(test) > 0;
}

/**
 * Группа, которой досталась корзина.
 *
 * Границы считаются в целых, БЕЗ делений с плавающей точкой: `bucket * sum` и
 * `acc * BUCKETS` — целые числа, поэтому граница одна и та же на всех
 * устройствах. Дробное деление дало бы разные ответы на краю из-за округления,
 * а «на краю» — это ровно те люди, из-за которых доли не сойдутся с задуманным.
 */
function groupForBucket(test, bucket) {
  const sum = shareSum(test);
  let acc = 0;
  for (const g of test.groups) {
    acc += Number(g.share) || 0;
    if (bucket * sum < acc * BUCKETS) return g;
  }
  return test.groups[test.groups.length - 1];
}

/**
 * Сколько корзин из тысячи достанется каждой группе — тем же правилом, что
 * раздаёт их живым людям. Нужно админке: доля «10 из 18» не равна 55.6 %
 * ровно, и показывать надо то, что случится, а не то, что задумано.
 */
function bucketShares(test) {
  const out = {};
  for (const g of test?.groups ?? []) out[g.name] = 0;
  if (!testIsSane(test)) return out;
  for (let b = 0; b < BUCKETS; b++) {
    const g = groupForBucket(test, b);
    out[g.name] = (out[g.name] ?? 0) + 1;
  }
  return out;
}

/** Всего корзин — чтобы считающий проценты не зашивал число у себя. */
const BUCKET_COUNT = BUCKETS;

/**
 * Разложить устройство по всем тестам конфига.
 *
 * @returns {{ values: object, groups: Array<{testId:string, group:string}> }}
 *   `values` — что перебить в конфиге, `groups` — во что попали (для аналитики).
 */
function pickGroups(tests, installId) {
  const values = {};
  const groups = [];
  if (!Array.isArray(tests)) return { values, groups };

  const seenSlots = new Set();
  for (const test of tests) {
    if (!testIsSane(test)) continue;
    // Два теста на одном слоте разбили бы людей одинаково — второй
    // пропускаем, иначе тест тихо теряет смысл, оставаясь на вид рабочим.
    if (seenSlots.has(test.slot)) continue;
    seenSlots.add(test.slot);

    const group = groupForBucket(test, bucketOf(installId, test.slot));
    // ГРУППА МЕНЯЕТ НАБОР КЛЮЧЕЙ, а не один: проверяют обычно замысел
    // («щедрый бесплатный тариф»), а он складывается из нескольких настроек.
    // Двумя тестами такую связку не выразить — два жребия независимы, и
    // четверть людей получила бы половину замысла.
    Object.assign(values, group.values ?? {});
    groups.push({ testId: test.id, group: group.name });
  }
  return { values, groups };
}

/** `generous:wide` — то, что уходит в аналитику параметром `ab`. */
function groupLabel(entry) {
  return `${entry.testId}:${entry.group}`;
}

/**
 * UUID установки. Один на устройство, живёт в том же хранилище, что сейв.
 *
 * Переустановка означает новый id и, значит, возможную новую группу — это
 * известное и осознанное свойство: привязать жребий к чему-то более стойкому
 * можно только собирая идентификаторы устройства, а этого мы не делаем.
 */
function installId(storageKey = "rc.installId") {
  try {
    let id = localStorage.getItem(storageKey);
    if (!id) {
      id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now().toString(16));
      localStorage.setItem(storageKey, id);
    }
    return id;
  } catch {
    // Приватный режим / переполненное хранилище: жребий будет разным от
    // запуска к запуску. Для теста это хуже, чем стабильный id, но лучше,
    // чем упавший запуск игры.
    return "";
  }
}


// ===== progress.js =====
// Прохождение по уровням с разрезом по группам A/B — одним параметром одного
// события.
//
// ЗАЧЕМ ВЛОЖЕННЫЙ ПАРАМЕТР, А НЕ ДВА ПОЛЯ РЯДОМ. Отчётный API показывает
// параметры события деревом: `ym:ce:paramsLevel1` — имя ключа,
// `paramsLevel2` — следующий уровень, и так далее. У плоского объекта
// `{ level_num: 7, ab: "pacing:often" }` получаются две СОСЕДНИЕ ветви, а
// соседние ветви не пересекаются: спросить «уровень 7 И группа often» нечем.
// Проверено на живых данных — такой запрос отдаёт ноль строк.
//
// Стоит вложить группу внутрь уровня, и пересечение появляется само:
//
//     { progress: { "7": "pacing:often" } }
//     → Level1=progress, Level2=7, Level3=pacing:often
//     → группировка по Level2+Level3 даёт людей на пересечении
//
// ПОЧЕМУ УРОВЕНЬ ПЕРВЫМ, А ГРУППА ВТОРОЙ. Если игра однажды перестанет
// передавать группу (ошибка, старый клиент конфига, отключённый тест), третий
// уровень окажется пустым — и останется целой главная ось графика, «сколько
// людей дошло до уровня N». При обратном порядке потерялась бы как раз она.
//
// ПОЧЕМУ НЕ ОТДЕЛЬНЫЕ СОБЫТИЯ НА РУБЕЖИ. Так это и было сделано сначала —
// `level_1_done`, `level_2_done`, … — из неверной посылки, будто разрез по
// группам для параметра недостижим в принципе. Достижим; отдельные события
// давали восемнадцать имён вместо одного, разрешение только по выбранным
// рубежам вместо каждого уровня, и группу приходилось не читать, а
// ВОССТАНАВЛИВАТЬ пересчётом из `user_id` — то есть размечать и тех, кто играл
// до запуска теста.
//
// Здесь же группа — то, по чему игра ДЕЙСТВИТЕЛЬНО работала: не вывод, а факт.

/** Имя параметра. Одно на все игры и на админку, иначе запрос не найдёт данные. */
const PROGRESS_KEY = "progress";

/**
 * Как называется «вне тестов».
 *
 * Пустая строка не годится: это ключ в JSON и значение измерения, и пустое
 * значение в отчёте неотличимо от «параметра не было». `default` читается
 * одинаково и в игре, и в таблице.
 */
const DEFAULT_COHORT = "default";

/**
 * Метка групп этого устройства для аналитики: `pacing:often` или `default`.
 *
 * @param {string[]} [cohorts] — из `rcCohorts()`
 */
function cohortLabel(cohorts) {
  const list = Array.isArray(cohorts) ? cohorts.filter(Boolean) : [];
  return list.length ? list.join(",") : DEFAULT_COHORT;
}

/**
 * Параметры события прохождения — подмешиваются к обычным параметрам
 * `level_start`.
 *
 * Плоский `level_num` игра отправляет КАК И ПРЕЖДЕ, рядом: на нём держатся
 * данные выпущенных сборок, и панель прохождения умеет читать обе формы. Новый
 * параметр ничего не заменяет, он добавляется.
 *
 * @param {number|string} level   — номер уровня, начиная с 1
 * @param {string[]} [cohorts]    — из `rcCohorts()`
 * @returns {object} `{ progress: { "7": "default" } }` либо `{}` на мусорном уровне
 */
function progressParams(level, cohorts) {
  const n = Number(level);
  if (!Number.isInteger(n) || n <= 0) return {};
  return { [PROGRESS_KEY]: { [String(n)]: cohortLabel(cohorts) } };
}


// ===== params.js =====
// Разбивка параметров по темам — ОДНА для админки и для дев-панели игры.
//
// ЗАЧЕМ ОБЩИЙ КОД. Список параметров показывают в двух местах: в админке (что
// уедет людям) и в дев-панели на устройстве (что проверяем сейчас). Разложи их
// по темам двумя разными способами — и «Реклама» в админке перестанет совпадать
// с «Рекламой» в игре, а сверять их глазами придётся вручную на каждой правке.
//
// ТЕМУ ЗАДАЁТ ИГРА, а не угадывает админка: `remote-config.json` → `groups`.
// Раньше тема выводилась только из первого слова имени ключа, и это работало,
// пока ключей было девять и все про рекламу. На шестидесяти живых параметрах
// правило рассыпается: `muzzle_speed`, `ball_mass` и `gravity` — одна тема
// «Баллистика», но общего первого слова у них нет. Угадывание осталось
// запасным путём — для игр, которые тему не объявили.

/** Известные первые слова имён ключей. Только для игр без `groups`. */
const GROUP_NAMES = {
  interstitial: "Межстраничная реклама",
  rewarded: "Реклама за награду",
  banner: "Баннер",
  ad: "Реклама",
  ads: "Реклама",
  rate: "Оценка приложения",
  rateus: "Оценка приложения",
  review: "Оценка приложения",
  notif: "Уведомления",
  notification: "Уведомления",
  notifications: "Уведомления",
  push: "Уведомления",
  level: "Уровни",
  levels: "Уровни",
  hint: "Подсказки",
  hints: "Подсказки",
  difficulty: "Сложность",
  balance: "Баланс",
  coins: "Экономика",
  shop: "Экономика",
  price: "Экономика",
  tutorial: "Обучение",
  onboarding: "Обучение",
  sound: "Звук",
  music: "Звук",
  audio: "Звук",
  haptic: "Вибрация",
  update: "Обновления",
  energy: "Экономика",
  hearts: "Экономика",
  generator: "Генератор уровней",
  tournament: "Турнир",
  daily: "Ежедневные награды",
  wallet: "Экономика",
};

const REST = "Прочее";

/**
 * Темы в порядке ПЕРВОГО ПОЯВЛЕНИЯ ключа, а не по алфавиту.
 *
 * Порядок ключей в `defaults` — авторский: игра перечисляет их так, как о них
 * думает («Баллистика», потом «Блоки», потом «Цены»). Алфавит этот порядок
 * стирал и ставил «Тени» перед «Снарядами» — то есть вкладки шли не так, как
 * устроена игра, и нужную приходилось искать глазами каждый раз.
 *
 * @param {{defaults?: object, ranges?: object, groups?: object}} decl
 * @returns {{title: string, keys: string[]}[]}
 */
function paramGroups(decl) {
  const keys = Object.keys(decl?.defaults ?? decl?.ranges ?? {});
  const named = decl?.groups ?? {};

  // Первое слово имени пригодится дважды: как тема и как признак «слово
  // встречается у нескольких ключей» — одинокий незнакомый префикс темой не
  // делаем, заголовок над единственной строкой выглядит как сбой.
  const prefixCount = new Map();
  for (const key of keys) {
    const p = prefix(key);
    prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
  }

  const order = [];
  const byTitle = new Map();
  for (const key of keys) {
    const title = titleFor(key, named, prefixCount);
    if (!byTitle.has(title)) {
      byTitle.set(title, []);
      order.push(title);
    }
    byTitle.get(title).push(key);
  }

  // «Прочее» всегда последним, где бы ни встретился его первый ключ.
  const titles = order.filter((t) => t !== REST);
  if (byTitle.has(REST)) titles.push(REST);
  return titles.map((title) => ({ title, keys: byTitle.get(title) }));
}

const prefix = (key) => String(key).split("_")[0].toLowerCase();

function titleFor(key, named, prefixCount) {
  const own = named[key];
  if (own) return String(own);
  const p = prefix(key);
  if (GROUP_NAMES[p]) return GROUP_NAMES[p];
  if ((prefixCount.get(p) ?? 0) > 1) return p;
  return REST;
}

/** Подпись поля: человеческая, иначе имя из кода. */
function paramLabel(decl, key) {
  return decl?.labels?.[key] ?? key;
}

/** Рамка словами — одинаково в подсказке админки и в дев-панели. */
function rangeText(range) {
  if (!range) return "рамки не объявлены";
  if (range.oneOf) return `одно из: ${range.oneOf.join(", ")}`;
  const fractional = typeof range.step === "number" && !Number.isInteger(range.step);
  const kind = fractional ? "дробное" : "целое";
  if (range.min == null) return kind === "дробное" ? "дробное число" : "целое число";
  return `${kind} от ${range.min} до ${range.max}`;
}


// ===== remoteConfig.js =====
// Удалённая конфигурация: значения, которые можно менять БЕЗ выпуска обновления.
//
// ДЕФОЛТЫ ЖИВУТ ЗДЕСЬ, В ИГРЕ, А НЕ НА СЕРВЕРЕ. Пустой, недоступный или битый
// конфиг обязан означать «игра работает как была» — иначе упавший бакет
// превращается в упавшую игру у всех сразу. Сервер только ПЕРЕБИВАЕТ значения,
// он их не задаёт.
//
// Читается статический JSON из публичного бакета — функции в этой схеме нет.
// У Interier Planner конфиг раздаёт Cloud Function, но лишь потому, что функция
// там уже была ради платежей: заводить её ради одного JSON значило бы получить
// выкладку, сервисный аккаунт и ключи S3 там, где хватает файла в бакете.
// Клиент знает только адрес, так что появление функции однажды поменяет URL и
// ничего больше.
//
// Использование (ES-модули / Vite):
//
//     import { initRemoteConfig, rc } from "./remoteConfig.js";
//     await initRemoteConfig({ appId: "com.terekh.hole", defaults: RC_DEFAULTS, ranges: RC_RANGES });
//     if (rc("interstitial_every") > 3) ...
//
// В classic-JS проектах подключается собранный `remoteConfig.iife.js`, который
// кладёт то же самое в `window.RemoteConfig` (см. build-iife.mjs).


const CDN = "https://games-config-b1g8r9eo.storage.yandexcloud.net";

/** Сколько ждём сеть. Конфиг — не то, ради чего человек смотрит на пустой экран. */
const TIMEOUT_MS = 4000;

/**
 * Сколько живёт последний удачный ответ, если сеть пропала.
 *
 * Ключ включает appId НЕ ради порядка: под общим ключом кэш одной игры
 * подставляется другой. На устройстве игра одна, поэтому в бою этого не
 * увидеть — зато видно в дев-панели и в сквозных проверках, где за один
 * процесс опрашивают несколько appId, и «взялся конфиг соседней игры»
 * выглядит там как загадочно неверные значения.
 */
const cacheKeyFor = (appId) => `rc.cache.${appId}`;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let values = {};
let defaults = {};
let ranges = {};
let labels = {};
let groups = {};
let cohorts = [];
let ready = false;
let appIdSeen = null;

/**
 * Локальные подмены: дев-панель и тестовый мост.
 *
 * ЛЕЖАТ ПОВЕРХ ВСЕГО, включая значения группы A/B, — потому что для того и
 * нужны: «а если поставить здесь три» проверяют на своём устройстве, не трогая
 * бакет и не мешая живым людям.
 *
 * ЗАПЕРТЫ ПО УМОЛЧАНИЮ. Подмены читаются из localStorage, а localStorage в
 * WebView можно подсунуть с отладочного мостика — поэтому пока никто не позвал
 * `unlockOverrides`, сохранённые подмены НЕ ЧИТАЮТСЯ вовсе. В сборке для
 * магазина замок не открывает никто: дев-панели там нет, а мост требует
 * подписи. То есть подложенный ключ в хранилище не делает ничего.
 */
let overrides = {};
let overridesOn = false;
const overrideKeyFor = (appId) => `rc.override.${appId}`;

/** Кому сообщить, что значения поменялись. Нужно живой дев-панели и мосту. */
const listeners = new Set();

function announce() {
  for (const fn of listeners) {
    try {
      fn(rcAll());
    } catch {
      /* сломавшийся слушатель не повод ронять правку значения */
    }
  }
}

/**
 * Объявить дефолты и рамки — СИНХРОННО, при загрузке модуля игры.
 *
 * Отдельно от `initRemoteConfig` намеренно. Если дефолты приезжают только
 * вместе с загрузкой, то `rc()` между стартом игры и ответом сети отдаёт
 * `undefined` — а это первые кадры, где считается ритм рекламы и лимиты. На
 * быстрой сети такое не воспроизводится, на медленной ломается каждый раз, и
 * выглядит как случайный баг. Поэтому игра объявляет свои значения ДО всякой
 * сети, а сеть потом их только перебивает.
 *
 * Принимает объект прямо из `<игра>/remote-config.json` — того же файла, из
 * которого читает админка.
 */
function configure(decl) {
  defaults = decl?.defaults ?? {};
  ranges = decl?.ranges ?? {};
  labels = decl?.labels ?? {};
  groups = decl?.groups ?? {};
  return rcAll();
}

/**
 * Объявление как есть — дев-панели и мосту, чтобы построить список параметров.
 *
 * Отдаём КОПИЮ: панель, которая случайно допишет ключ в `ranges`, иначе
 * разрешила бы игре применить значение, которого игра не объявляла.
 *
 * Копия делается через JSON, а не `structuredClone`. Это не вкусовщина:
 * `structuredClone` появился в WebView только с 98-го Chrome, а объявление —
 * заведомо простой JSON (числа, строки, списки), для которого разницы нет.
 * Отсутствующая функция здесь означала бы исключение в дев-панели на старом
 * устройстве — то есть панель, которая не открывается, при работающей игре.
 */
function rcDeclaration() {
  return {
    defaults: { ...defaults },
    ranges: JSON.parse(JSON.stringify(ranges)),
    labels: { ...labels },
    groups: { ...groups },
  };
}

/**
 * Значение настройки. До загрузки и после провала сети отдаёт дефолт, поэтому
 * вызывать можно откуда угодно и когда угодно — проверять «а загрузился ли
 * конфиг» на каждом обращении не нужно.
 */
function rc(key) {
  if (overridesOn && key in overrides) return overrides[key];
  return key in values ? values[key] : defaults[key];
}

/** Все значения — для дев-панели и отладки. Не для игровой логики. */
function rcAll() {
  return overridesOn ? { ...defaults, ...values, ...overrides } : { ...defaults, ...values };
}

/** Откуда взялось значение ключа. Нужно ровно дев-панели: править или нет. */
function rcSource(key) {
  if (overridesOn && key in overrides) return "override";
  if (key in values) return "remote";
  return "build";
}

/** Загружен ли живой конфиг. Игровой логике знать это не нужно, дев-панели — да. */
function rcReady() {
  return ready;
}

/**
 * Группы A/B, в которые попало это устройство: `["generous:wide"]`.
 * Уходит в каждое событие аналитики параметром `ab` — без этого тест
 * бессмысленен: разбиение есть, а сравнить группы нечем.
 */
function rcCohorts() {
  return cohorts.slice();
}

/**
 * Значения зажимаются рамками ПЕРЕД применением. Опечатка `"free_hints": 0` в
 * бакете иначе означала бы «завтра ни у кого нет подсказок» — то есть правка
 * конфига становится способом сломать игру всем сразу, а именно от этого
 * удалённая конфигурация и должна страховать.
 *
 * Ключ без объявленной рамки НЕ ПРИМЕНЯЕТСЯ вовсе: незнакомое имя означает либо
 * опечатку, либо конфиг от другой версии игры.
 */
/**
 * Одно значение по правилам его рамки. `undefined` — значение негодное, игра
 * останется на своём.
 *
 * ДРОБЬ РАЗРЕШЕНА ТОЛЬКО ТАМ, ГДЕ ОБЪЯВЛЕН ДРОБНЫЙ ШАГ (`"step": 0.05`), и это
 * не педантизм. Половина параметров игры — счётчики: «ядер в очереди», «побед
 * до рекламы», «сердечек». `2.5` в таком ключе не ошибка ввода, а поломка:
 * цикл `for (i < burstCount)` отработает три раза, а сравнение `wins === 2.5`
 * не совпадёт никогда — то есть реклама не выйдет вовсе. Раньше сюда проходило
 * любое конечное число, и подпись «целое от 1 до 20» была неправдой.
 */
function coerce(key, value) {
  const range = ranges[key];
  if (!range) return undefined;

  if (range.oneOf) return range.oneOf.includes(value) ? value : undefined;

  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  if (num < range.min || num > range.max) return undefined;
  const fractional = typeof range.step === "number" && !Number.isInteger(range.step);
  if (!fractional && !Number.isInteger(num)) return undefined;
  return num;
}

function sanitize(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const ok = coerce(key, value);
    if (ok !== undefined) out[key] = ok;
  }
  return out;
}

// ------------------------------------------------- локальные подмены

/**
 * Открыть замок подмен: с этого мгновения сохранённые подмены действуют.
 *
 * Зовут только дев-панель (её нет в релизной сборке) и тестовый мост (он
 * требует подписи). Игровой код это не вызывает никогда.
 */
function unlockOverrides(appId = appIdSeen) {
  overridesOn = true;
  appIdSeen = appId ?? appIdSeen;
  try {
    const raw = localStorage.getItem(overrideKeyFor(appIdSeen));
    overrides = raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    overrides = {};
  }
  announce();
  return { ...overrides };
}

function overridesUnlocked() {
  return overridesOn;
}

/** Подмены как есть. Пустой объект, пока замок закрыт. */
function rcOverrides() {
  return overridesOn ? { ...overrides } : {};
}

/**
 * Поставить локальную подмену. `undefined` — снять.
 *
 * Значение проходит ТЕ ЖЕ рамки, что и значение из бакета: подмена, которую
 * игра не приняла бы из конфига, не должна проходить и с устройства, иначе
 * проверка на устройстве проверяла бы не то, что случится у людей. Возвращает
 * применённое значение либо `undefined`, если рамки его не пустили.
 */
function setOverride(key, value) {
  if (!overridesOn) return undefined;
  if (value === undefined || value === null) {
    delete overrides[key];
  } else {
    const ok = coerce(key, value);
    if (ok === undefined) return undefined;
    overrides[key] = ok;
  }
  persistOverrides();
  announce();
  return overrides[key];
}

function clearOverrides() {
  if (!overridesOn) return;
  overrides = {};
  persistOverrides();
  announce();
}

function persistOverrides() {
  try {
    const key = overrideKeyFor(appIdSeen);
    if (Object.keys(overrides).length) localStorage.setItem(key, JSON.stringify(overrides));
    else localStorage.removeItem(key);
  } catch {
    /* переполненное хранилище не повод ронять дев-панель */
  }
}

/**
 * Подписаться на смену значений. Нужно тем играм, где параметры разложены по
 * своим структурам (`tuning`): без подписки правка в дев-панели или с моста
 * доехала бы только до следующего запуска.
 */
function onRcChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readCache(appId) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(appId));
    if (!raw) return null;
    const box = JSON.parse(raw);
    if (Date.now() - box.at > CACHE_TTL_MS) return null;
    return box.data;
  } catch {
    return null;
  }
}

function writeCache(appId, data) {
  try {
    localStorage.setItem(cacheKeyFor(appId), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* переполненное хранилище не повод ронять запуск */
  }
}

/**
 * Значения для конкретной версии сборки.
 *
 * У Interier Planner под каждую версию свой ФАЙЛ (`config/v1.0.json`), потому
 * что игра там одна. У нас их одиннадцать, и файл-на-версию означал бы
 * одиннадцать умножить на число версий — поэтому версии живут ВНУТРИ файла
 * игры, в `byVersion`. Заодно исчезает догонка 404: запрос ровно один.
 */
function applyVersionOverride(doc, versionBase) {
  const flat = { ...doc };
  delete flat.tests;
  delete flat.byVersion;
  if (!versionBase || !doc.byVersion) return flat;
  const over = doc.byVersion[versionBase];
  if (!over) return flat;
  // `tests` внутри слоя версии — это тесты, а не значения: их разбирает
  // `testsFor`. Оставить их здесь значило бы завести ключ по имени «tests»,
  // который потом молча отбросит `sanitize` — то есть ошибка, видимая только
  // по отсутствию теста.
  const values = { ...over };
  delete values.tests;
  return { ...flat, ...values };
}

/**
 * Тесты, которые идут на ЭТОЙ сборке.
 *
 * Тест, привязанный к версии, лежит ВНУТРИ `byVersion[версия].tests`, а не
 * полем `version` у самого теста, и это не вкусовщина. Поле старая сборка не
 * знает — и запустила бы тест, который к ней не относится, молча и у всех, а
 * заметно это стало бы через неделю по смешанным цифрам. Вложенный тест старый
 * клиент просто НЕ ВИДИТ: он читает только `doc.tests`. То есть худшее, что
 * даёт рассинхрон версий, — тест не идёт там, где не должен.
 */
function testsFor(doc, versionBase) {
  const own = Array.isArray(doc.tests) ? doc.tests : [];
  const scoped = versionBase ? doc.byVersion?.[versionBase]?.tests : null;
  return Array.isArray(scoped) ? [...own, ...scoped] : own;
}

/**
 * Забрать конфиг. Вызывать ОДИН раз при запуске и дожидаться — но провал сети
 * это не ошибка запуска: игра стартует на дефолтах.
 *
 * @param {object}  opts
 * @param {string}  opts.appId       — `com.terekh.hole`, он же имя файла в бакете
 * @param {object} [opts.defaults]   — если не звали `configure` заранее
 * @param {object} [opts.ranges]     — рамки: `{ key: {min,max} | {oneOf:[...]} }`
 * @param {string} [opts.versionBase] — `"1.1"`, для `byVersion`
 * @param {string} [opts.installId]  — UUID установки; из него считаются группы A/B
 * @param {string} [opts.baseUrl]    — переопределить адрес (дев-панель, тесты)
 */
async function initRemoteConfig(opts) {
  // Не перетираем объявленное `configure`, если тут ничего не передали:
  // иначе вызов без аргументов обнулил бы дефолты игры.
  if (opts.defaults) defaults = opts.defaults;
  if (opts.ranges) ranges = opts.ranges;
  if (opts.labels) labels = opts.labels;
  if (opts.groups) groups = opts.groups;
  appIdSeen = opts.appId ?? appIdSeen;
  // Сбрасываем ПЕРЕД загрузкой, а не после удачи: иначе повторный вызов,
  // который не дошёл до сети, оставил бы значения прошлого — и «конфиг не
  // загрузился» выглядело бы как «загрузился», просто с чужими числами.
  values = {};
  cohorts = [];
  ready = false;

  const base = opts.baseUrl ?? CDN;
  const url = `${base}/config/${opts.appId}.json`;

  let doc = null;
  try {
    // Свой таймаут, а не таймаут браузера: у мобильной сети «отвечу через
    // сорок секунд» — обычное дело, и всё это время игра ждала бы конфиг.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-cache" });
      // 404 — законное состояние: у игры просто нет конфига в бакете, и это
      // означает «как в сборке», а не поломку.
      if (res.ok) doc = await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* нет сети — ниже возьмём последний удачный ответ */
  }

  if (doc) {
    writeCache(opts.appId, doc);
  } else {
    doc = readCache(opts.appId);
  }

  if (doc) {
    const flat = applyVersionOverride(doc, opts.versionBase);
    const chosen = pickGroups(testsFor(doc, opts.versionBase), opts.installId);
    // Значения группы применяются ПОВЕРХ общих: тест и задуман как «этим
    // людям иначе, чем всем».
    values = sanitize({ ...flat, ...chosen.values });
    cohorts = chosen.groups.map(groupLabel);
    ready = true;
  }

  // Подмены могли быть открыты ДО загрузки (дев-панель поднимается раньше сети):
  // тогда их надо просеять заново — рамки к этому времени уже объявлены.
  if (overridesOn) overrides = sanitize(overrides);
  announce();

  return rcAll();
}


// ===== devParams.js =====
// Список ВСЕХ параметров игры в дев-панели — одним куском, для любой игры.
//
// ЗАЧЕМ ОБЩИЙ КОД, А НЕ ПО ПАНЕЛИ В КАЖДОЙ ИГРЕ. Правило простое: что можно
// крутить в админке, то же должно крутиться на устройстве, и наоборот. Пять
// самописных панелей это правило не держат — параметр, добавленный в
// `remote-config.json`, появлялся бы в админке и не появлялся в игре, а узнать
// об этом можно было бы только заметив, что ползунка нет.
//
// ЗДЕСЬ ПРАВЯТСЯ ПОДМЕНЫ, А НЕ КОНФИГ. Значение уходит в локальный слой
// (`setOverride`) и живёт только на этом устройстве: дев-панель — это
// «посмотреть, как будет», а не «выложить людям». Выкладывают из админки.
//
// Подключение (ES-модули):
//
//     import { mountRcParams } from "./remote/devParams.js";
//     mountRcParams(panelElement);            // внутри дев-панели
//
// В classic-JS — `window.RemoteConfig.mountRcParams(panelElement)`.


const mk = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node[k] = v;
    else if (v != null) node.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

const CSS = `
[data-rc-params]{font:13px/1.35 system-ui,sans-serif;color:#e8e8ea}
[data-rc-params] .rcp-tabs{display:flex;gap:4px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none}
[data-rc-params] .rcp-tabs::-webkit-scrollbar{display:none}
[data-rc-params] .rcp-tab{flex:0 0 auto;padding:4px 10px;border:1px solid #3a3a42;border-radius:8px;
  background:transparent;color:#9a9aa4;font:inherit;cursor:pointer;white-space:nowrap}
[data-rc-params] .rcp-tab[aria-selected="true"]{background:#2f2f38;color:#fff;font-weight:600}
[data-rc-params] .rcp-tab .rcp-dot{color:#f0b429}
[data-rc-params] .rcp-row{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #2a2a31}
[data-rc-params] .rcp-key{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
[data-rc-params] .rcp-key small{display:block;color:#8a8a94}
[data-rc-params] .rcp-row input,[data-rc-params] .rcp-row select{
  flex:0 0 92px;width:92px;background:#1b1b21;color:#fff;border:1px solid #3a3a42;border-radius:6px;padding:3px 6px;font:inherit}
[data-rc-params] .rcp-row.rcp-over input,[data-rc-params] .rcp-row.rcp-over select{border-color:#f0b429}
[data-rc-params] .rcp-x{flex:0 0 auto;width:22px;background:transparent;border:0;color:#8a8a94;cursor:pointer;font:inherit}
[data-rc-params] .rcp-head{display:flex;align-items:center;gap:8px;padding:4px 0 6px;color:#8a8a94}
[data-rc-params] .rcp-head button{background:#2f2f38;color:#fff;border:1px solid #3a3a42;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer}
`;

function styleOnce() {
  if (document.getElementById("rc-params-css")) return;
  document.head.append(mk("style", { id: "rc-params-css" }, CSS));
}

/**
 * Построить список параметров внутри `host`.
 *
 * ЗОВЁТ `unlockOverrides` САМА: панель — один из двух мест, которым подмены
 * разрешены (второе — тестовый мост). В сборке для магазина этот модуль не
 * подключён, поэтому замок там не открывает никто.
 *
 * @param {HTMLElement} host  куда вставить
 * @param {{groups?: string[], exceptGroups?: string[]}} [opts]
 *   `groups` — показать только эти темы; `exceptGroups` — все, кроме этих.
 *   Второе нужно играм, у которых часть параметров уже разложена своей панелью
 *   (у Smash Banks ползунки строятся из собственной схемы): второй список тех
 *   же ключей рядом выглядел бы как две разные настройки одного и того же.
 */
function mountRcParams(host, opts = {}) {
  styleOnce();
  unlockOverrides();

  const box = mk("div", { "data-rc-params": "1" });
  const decl = rcDeclaration();
  const groups = paramGroups(decl).filter((g) =>
    (!opts.groups || opts.groups.includes(g.title))
    && !(opts.exceptGroups ?? []).includes(g.title));
  let active = groups.length > 1 ? null : (groups[0]?.title ?? null);

  const tabs = mk("div", { class: "rcp-tabs" });
  const head = mk("div", { class: "rcp-head" });
  const list = mk("div", {});
  box.append(head, tabs, list);
  host.append(box);

  const draw = () => {
    const over = rcOverrides();
    const values = rcAll();

    head.textContent = "";
    head.append(
      mk("span", {}, rcReady() ? "конфиг из бакета" : "конфиг не загружен, значения сборки"),
      Object.keys(over).length
        ? mk("button", { type: "button", onclick: () => clearOverrides() },
            `снять подмены (${Object.keys(over).length})`)
        : null,
    );

    tabs.textContent = "";
    if (groups.length > 1) {
      for (const g of [{ title: null }, ...groups]) {
        const mine = g.title ? groups.find((x) => x.title === g.title).keys : Object.keys(values);
        const touched = mine.some((k) => k in over);
        tabs.append(mk("button", {
          class: "rcp-tab", type: "button", "aria-selected": String(active === g.title),
          onclick: () => { active = g.title; draw(); },
        }, g.title ?? "все", touched ? mk("span", { class: "rcp-dot" }, " ●") : null));
      }
    }

    list.textContent = "";
    for (const g of groups) {
      if (active && g.title !== active) continue;
      if (!active && groups.length > 1) list.append(mk("div", { class: "rcp-head" }, g.title));
      for (const key of g.keys) list.append(row(key, decl, values, over));
    }
  };

  const stop = onRcChange(() => draw());
  draw();
  // Отписка нужна: панель у большинства игр модальная, и живёт она короче игры.
  // Без этого каждое открытие добавляло бы ещё одного слушателя на уже
  // выброшенный DOM, и правка значения обходила бы их всех по кругу.
  box.rcDispose = stop;
  return box;
}

function row(key, decl, values, over) {
  const range = decl.ranges[key] ?? {};
  const label = decl.labels[key];
  const value = values[key];
  const mine = key in over;

  const apply = (raw) => {
    const applied = setOverride(key, raw);
    // Рамки могли не пустить значение — и молчать об этом нельзя: поле
    // показывало бы одно, а игра работала бы по другому.
    if (applied === undefined && raw !== undefined) {
      input.style.borderColor = "#e5484d";
      input.title = `не в рамках: ${rangeText(range)}`;
    }
  };

  const input = range.oneOf
    ? mk("select", { onchange: (e) => apply(coerceOneOf(range, e.target.value)) },
        ...range.oneOf.map((o) =>
          mk("option", { value: String(o), selected: String(o) === String(value) ? "" : null }, String(o))))
    : mk("input", {
        type: "number", value: String(value ?? ""),
        min: range.min, max: range.max, step: range.step ?? 1,
        onchange: (e) => apply(e.target.value === "" ? undefined : Number(e.target.value)),
      });

  return mk("div", { class: mine ? "rcp-row rcp-over" : "rcp-row" },
    mk("div", { class: "rcp-key" },
      label ?? key,
      mk("small", {}, `${key} · ${rangeText(range)} · в сборке ${decl.defaults[key]}`)),
    input,
    mine
      ? mk("button", { class: "rcp-x", type: "button", title: "снять подмену", onclick: () => setOverride(key, undefined) }, "×")
      : mk("span", { class: "rcp-x" }, sourceMark(key)));
}

/** `oneOf` бывает и строковым (`"rotational"`), и числовым — из select приходит строка. */
function coerceOneOf(range, raw) {
  const hit = range.oneOf.find((o) => String(o) === String(raw));
  return hit === undefined ? raw : hit;
}

const sourceMark = (key) => (rcSource(key) === "remote" ? "☁" : "");


// ===== testBridgeKey.js =====
// СГЕНЕРИРОВАНО tools/testbridge-keys.mjs — НЕ ПРАВИТЬ РУКАМИ. created: 2026-09-10
//
// ПУБЛИЧНЫЙ ключ тестового моста. Им игра проверяет, что команда подписана нами.
// Подписать им нельзя — для этого нужен приватный, и он лежит только в
// admin/secrets. Значит, этот файл не секрет: его копия внутри APK не даёт
// никаких прав, и лежать в открытом репозитории игры он может спокойно.

const TEST_BRIDGE_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKydEDx9oQ5rFY0crBsNJFUlEwFaMSPHj6FLTDgrHwFfoQImf7B7D+nJ0SkK76aruPDXFftQqWyAv4iM3eYIXQg==";


// ===== testBridge.js =====
// Тестовый мост: то, что нужно тестировщику, и ничего, что нужно читеру.
//
// ЗАЧЕМ. Проверка на устройстве упирается не в саму проверку, а в подготовку:
// чтобы посмотреть, выйдет ли межстраничная на пятой победе, надо пять раз
// победить; чтобы проверить откат сердечек — подождать час. Руками это делается
// один раз, а нужно каждую сборку. Мост даёт те же самые действия, что дев-панель,
// но вызовом извне: агент по usb-отладке ставит параметр, сдвигает часы,
// прыгает на уровень и смотрит, что игра сделала.
//
// ПОЧЕМУ ОН И В РЕЛИЗНОЙ СБОРКЕ. Дев-панели там нет намеренно (кнопка «+5000
// монет» в опубликованном APK — дыра в экономике), а проверять релизную сборку
// всё равно надо: именно в ней вырезан дев-код, и именно там живут ошибки,
// которых нет в отладочной. Мост оставлен во всех сборках, потому что
// собственных прав он не даёт: КАЖДАЯ команда должна быть подписана приватным
// ключом, которого в APK нет (см. tools/testbridge-keys.mjs). Без подписи не
// работает ни одна, включая чтение.
//
// ЧЕГО ЭТА ЗАЩИТА НЕ ДЕЛАЕТ. Она не защищает игру от владельца устройства.
// Наши игры целиком клиентские: сейв лежит в localStorage, сервера, который
// мог бы не согласиться, нет. Кто дошёл до отладочного мостика, тот и так
// правит сейв напрямую — и вредит этим только себе. Подпись нужна ровно затем,
// чтобы у желающих не появилось ГОТОВОГО одинакового пульта на все наши игры:
// «начисли, пропусти, сбрось» одним вызовом, с описанием.
//
// Использование в игре (один раз при запуске, до первого экрана):
//
//     import { installTestBridge, registerTestActions } from "./remote/testBridge.js";
//     installTestBridge({ appId: APP_ID, versionBase: "1.1" });
//     registerTestActions({
//       "level.set": { note: "перейти на уровень", run: ({ level }) => jumpToLevel(level) },
//     });


/** Версия протокола. Растёт, когда меняется форма команд или ответа. */
const PROTOCOL = 1;

/**
 * НАСТОЯЩИЕ ЧАСЫ, взятые до всякой подмены.
 *
 * Срок годности команды проверяется по ним, и только по ним. Иначе первая же
 * команда «сдвинь время на неделю» сделала бы недействительными все
 * последующие — или, что хуже, действительными просроченные.
 */
const RealDate = Date;

/** Сколько живёт одна команда. Пять минут — с запасом на медленный adb. */
const TTL_MS = 5 * 60 * 1000;

let clockOffset = 0;
let clockPatched = false;
let installed = false;
let opts = {};
let verifyKey = null;

const actions = new Map();
const seenNonces = new Set();
const NONCE_MEMORY = 200;

/** Что игра отправила в аналитику и в рекламу — кольцо последних событий. */
const captured = [];
const CAPTURE_MAX = 200;

// --------------------------------------------------------------- установка

/**
 * Поднять мост. Возвращает `false`, если в этом окружении он невозможен
 * (нет `crypto.subtle` — значит проверить подпись нечем, а без проверки моста
 * быть не должно).
 */
function installTestBridge(options = {}) {
  if (installed) return true;
  opts = { ...options };
  if (typeof globalThis.crypto?.subtle?.verify !== "function") return false;

  captureAnalytics();
  installed = true;
  globalThis.__gameTest = {
    v: PROTOCOL,
    /** Единственное, что отвечает без подписи: «мост есть, версия такая». */
    ping: () => ({ v: PROTOCOL, appId: opts.appId ?? null }),
    run: (msg, sig) => run(msg, sig).catch((err) => ({ ok: false, error: String(err?.message ?? err) })),
  };
  return true;
}

/**
 * Объявить действия своей игры. Имя — `тема.действие`, чтобы список читался.
 *
 * Значение — функция либо `{ run, note, args }`. `note` и `args` уходят в
 * `info`: агент на другой стороне узнаёт, что у игры есть и как это звать, не
 * читая её код.
 */
function registerTestActions(map) {
  for (const [name, def] of Object.entries(map ?? {})) {
    const entry = typeof def === "function" ? { run: def } : def;
    if (typeof entry?.run !== "function") continue;
    actions.set(name, entry);
  }
  return [...actions.keys()];
}

// ----------------------------------------------------------------- подпись

function bytes(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key() {
  if (verifyKey) return verifyKey;
  verifyKey = await globalThis.crypto.subtle.importKey(
    "spki",
    bytes(TEST_BRIDGE_PUBLIC_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return verifyKey;
}

/**
 * Проверить и выполнить.
 *
 * ПОДПИСЬ СТАВИТСЯ НА СТРОКУ, А НЕ НА РАЗОБРАННЫЙ ОБЪЕКТ, и разбираем мы её
 * ТОЛЬКО ПОСЛЕ проверки. Подпись на объекте потребовала бы, чтобы обе стороны
 * складывали ключи в одном порядке и одинаково писали числа, — а любое
 * расхождение в этом означало бы либо неработающий мост, либо, что хуже,
 * проверку не того, что исполняется.
 */
async function run(msg, sig) {
  if (typeof msg !== "string" || typeof sig !== "string") {
    return { ok: false, error: "нужны строка команды и подпись" };
  }
  let ok = false;
  try {
    ok = await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await key(),
      bytes(sig),
      new TextEncoder().encode(msg),
    );
  } catch (err) {
    return { ok: false, error: `подпись не разобралась: ${err.message}` };
  }
  if (!ok) return { ok: false, error: "подпись не подходит" };

  let env;
  try {
    env = JSON.parse(msg);
  } catch {
    return { ok: false, error: "команда не разобралась" };
  }

  const now = RealDate.now();
  // Срок годности отсекает повтор старой подслушанной команды, а `nonce` —
  // повтор свежей. Нужны оба: без срока подпись годилась бы вечно, без nonce
  // одну и ту же команду можно было бы прокрутить сто раз за пять минут.
  if (!Number.isFinite(env?.exp) || env.exp < now) return { ok: false, error: "команда просрочена" };
  if (env.exp - now > TTL_MS * 2) return { ok: false, error: "срок годности слишком велик" };
  if (!env?.nonce || seenNonces.has(env.nonce)) return { ok: false, error: "команда уже выполнялась" };
  if (opts.appId && env.appId && env.appId !== opts.appId) {
    return { ok: false, error: `команда для ${env.appId}, а это ${opts.appId}` };
  }

  seenNonces.add(env.nonce);
  if (seenNonces.size > NONCE_MEMORY) seenNonces.delete(seenNonces.values().next().value);

  try {
    const result = await execute(String(env.cmd), env.args ?? {});
    return { ok: true, result: result === undefined ? null : result };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ----------------------------------------------------------------- команды

async function execute(cmd, args) {
  const builtin = BUILTIN[cmd];
  if (builtin) return builtin(args);

  const own = actions.get(cmd);
  if (!own) throw new Error(`нет команды «${cmd}»; список — в info`);
  return own.run(args ?? {});
}

const BUILTIN = {
  info: () => {
    const decl = rcDeclaration();
    return {
      v: PROTOCOL,
      appId: opts.appId ?? null,
      versionBase: opts.versionBase ?? null,
      release: globalThis.__BUILD_RELEASE__ === true,
      installId: safe(() => installId()),
      rcReady: rcReady(),
      cohorts: rcCohorts(),
      clockOffsetMs: clockOffset,
      params: Object.keys(decl.defaults).map((k) => ({
        key: k,
        label: decl.labels[k] ?? null,
        group: decl.groups[k] ?? null,
        range: decl.ranges[k] ?? null,
        value: rcAll()[k],
        source: rcSource(k),
      })),
      actions: [...actions.entries()].map(([name, def]) => ({
        name,
        note: def.note ?? null,
        args: def.args ?? null,
      })),
    };
  },

  "config.get": () => {
    const values = rcAll();
    return {
      ready: rcReady(),
      values,
      sources: Object.fromEntries(Object.keys(values).map((k) => [k, rcSource(k)])),
    };
  },

  /**
   * Поставить подмену. Принимает один ключ или сразу набор.
   *
   * ОТВЕЧАЕТ ПРИМЕНЁННЫМ ЗНАЧЕНИЕМ, а не «ок». Рамки могут значение не пустить
   * (`burst_count: 2.5` при целом шаге), и тогда игра осталась бы на прежнем —
   * а проверка считала бы, что параметр стоит новый.
   */
  "config.set": (args) => {
    unlockOverrides(opts.appId);
    const pairs = args?.values && typeof args.values === "object"
      ? Object.entries(args.values)
      : [[args?.key, args?.value]];
    const applied = {};
    const rejected = [];
    for (const [k, v] of pairs) {
      if (!k) continue;
      const got = setOverride(k, v);
      if (got === undefined && v !== undefined && v !== null) rejected.push(k);
      else applied[k] = got;
    }
    return { applied, rejected, values: rcAll() };
  },

  "config.clear": () => {
    unlockOverrides(opts.appId);
    clearOverrides();
    return { values: rcAll() };
  },

  /** Забрать конфиг из бакета заново — после выкладки из админки. */
  "config.reload": async () => {
    if (!opts.appId) throw new Error("мост поднят без appId");
    await initRemoteConfig({ ...opts, installId: safe(() => installId()) });
    return { ready: rcReady(), cohorts: rcCohorts(), values: rcAll() };
  },

  /**
   * Сдвинуть часы игры. Так проверяются откаты, кулдауны и суточные награды —
   * то, чего иначе приходится ЖДАТЬ.
   *
   * Подменяется `Date` целиком, а не поле в игре: игры считают время
   * `Date.now()` в двух десятках мест, и требовать от каждой отдельной ручки
   * означало бы двадцать мест, где о ней забыли. `performance.now()` не
   * подменяется намеренно — он измеряет время С ЗАПУСКА, и всё, что на нём
   * держится, обнуляется перезапуском.
   */
  "time.shift": (args) => {
    const ms = Number(args?.ms ?? 0)
      + Number(args?.sec ?? 0) * 1000
      + Number(args?.min ?? 0) * 60000
      + Number(args?.hours ?? 0) * 3600000
      + Number(args?.days ?? 0) * 86400000;
    if (!Number.isFinite(ms)) throw new Error("сдвиг не число");
    patchClock();
    clockOffset += ms;
    return clockState();
  },

  "time.reset": () => {
    clockOffset = 0;
    return clockState();
  },

  "time.get": () => clockState(),

  "app.reload": () => {
    // Отвечаем ДО перезагрузки: после неё отвечать будет некому, и вызывающий
    // получил бы обрыв связи вместо «сделано».
    setTimeout(() => globalThis.location.reload(), 50);
    return { reloading: true };
  },

  "storage.keys": () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out;
  },

  "storage.get": (args) => {
    const raw = localStorage.getItem(String(args?.key ?? ""));
    if (raw == null) return null;
    // Сейвы у нас — JSON. Отдаём разобранным, иначе на другой стороне пришлось
    // бы разбирать строку в строке и терять читаемость в первом же вложении.
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },

  "storage.set": (args) => {
    const value = typeof args?.value === "string" ? args.value : JSON.stringify(args?.value);
    localStorage.setItem(String(args?.key ?? ""), value);
    return { key: args?.key, bytes: value.length };
  },

  "storage.remove": (args) => {
    localStorage.removeItem(String(args?.key ?? ""));
    return { key: args?.key };
  },

  /** Что игра отправила в аналитику и в рекламу — с начала запуска. */
  "events.tail": (args) => {
    const n = Math.max(1, Math.min(CAPTURE_MAX, Number(args?.n ?? 20)));
    const name = args?.name ? String(args.name) : null;
    const list = name ? captured.filter((e) => e.name === name) : captured;
    return list.slice(-n);
  },

  "events.clear": () => {
    captured.length = 0;
    return { cleared: true };
  },
};

function clockState() {
  return {
    offsetMs: clockOffset,
    real: new RealDate(RealDate.now()).toISOString(),
    game: new RealDate(RealDate.now() + clockOffset).toISOString(),
  };
}

/**
 * Подмена `Date`. Ставится по первой команде сдвига, а не при установке моста:
 * пока никто не просил, игра должна работать на настоящих часах.
 *
 * `Date()` БЕЗ `new` после подмены бросает исключение — так работает класс. В
 * играх такого вызова нет (проверено грепом), а `Date.now()` и `new Date()`
 * работают как надо. Снимать подмену обратно нельзя: код, уже прочитавший
 * сдвинутое время, помнит его.
 */
function patchClock() {
  if (clockPatched) return;
  clockPatched = true;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + clockOffset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + clockOffset;
    }
  }
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;
}

/**
 * Ловушка на нативные мосты.
 *
 * СТАВИТСЯ НА ОБЪЕКТ, А НЕ НА МЕТОД. `window.AppMetrica` приходит из Java через
 * `addJavascriptInterface`, и присваивание его свойству молча не срабатывает:
 * после `AppMetrica.reportEvent = fn` вызовы по-прежнему уходят в нативную
 * реализацию, а ловушка остаётся пустой (проверено на устройстве). Свойство
 * самого `window` писать можно.
 */
function captureAnalytics() {
  const note = (kind, name, params) => {
    captured.push({ at: RealDate.now(), kind, name, params });
    if (captured.length > CAPTURE_MAX) captured.shift();
  };

  const wrapMetrica = () => {
    const real = globalThis.AppMetrica;
    if (!real || real.__wrapped) return Boolean(real?.__wrapped);
    globalThis.AppMetrica = {
      __wrapped: true,
      reportEvent: (name, json) => {
        note("event", name, parse(json));
        try {
          real.reportEvent(name, json);
        } catch {
          /* нативная сторона сама себе судья */
        }
      },
      reportError: (m, d) => {
        note("error", m, d);
        try {
          real.reportError(m, d);
        } catch {
          /* см. выше */
        }
      },
      setUserProfileID: (id) => {
        try {
          real.setUserProfileID(id);
        } catch {
          /* см. выше */
        }
      },
    };
    return true;
  };

  const wrapAds = () => {
    const real = globalThis.YandexAds;
    if (!real || real.__wrapped) return Boolean(real?.__wrapped);
    globalThis.YandexAds = {
      __wrapped: true,
      showInterstitial: (unit) => {
        note("ad", "interstitial", { unit });
        try {
          real.showInterstitial(unit);
        } catch {
          /* см. выше */
        }
      },
      showRewarded: (unit) => {
        note("ad", "rewarded", { unit });
        try {
          real.showRewarded(unit);
        } catch {
          /* см. выше */
        }
      },
    };
    return true;
  };

  // Мосты инжектируются до загрузки страницы, но порядок гарантировать нельзя:
  // мост игры может подняться раньше, чем WebView успел добавить интерфейс.
  // Поэтому короткая догонка, а не одна попытка.
  //
  // ОБА ВЫЗОВА БЕЗУСЛОВНЫ, и это не стиль. Здесь стояло `wrapMetrica() &&
  // wrapAds()`, и в сборке без AppMetrica первый возвращал `false` — а значит,
  // второй не звался НИ РАЗУ: реклама оставалась неперехваченной, и `events`
  // отдавал пустой список при полностью рабочей игре. Проверено на устройстве.
  // ТАЙМЕР ОБЪЯВЛЕН ДО ПЕРВОГО ВЫЗОВА, и это не стиль, а исправление аварии.
  // Здесь стояло `const timer = setInterval(...)` ПОСЛЕ `tick()`, а `tick` внутри
  // зовёт `clearInterval(timer)`. Пока хоть один мост отсутствовал, первый вызов
  // до этой строки не доходил, и всё выглядело рабочим. В сборке, где есть ОБА
  // моста (то есть в любой полной — а релизная всегда полная), первый же вызов
  // читал `timer` в мёртвой зоне: ReferenceError вылетал синхронно из
  // `installTestBridge`, и игра умирала на запуске с белым экраном.
  //
  // Поймано только на устройстве: `tsc` и `vite build` о мёртвой зоне молчат, а
  // в отладочной сборке без AppMetrica ошибка не воспроизводится вовсе.
  let timer = null;
  let done = false;
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const tick = () => {
    const metrica = wrapMetrica();
    const ads = wrapAds();
    done = metrica && ads;
    if (done) stop();
  };

  tick();
  // Догонка нужна только если на месте не оба моста: они инжектируются до
  // загрузки страницы, но порядок гарантировать нельзя.
  if (!done) {
    timer = setInterval(tick, 100);
    setTimeout(stop, 5000);
  }
}

const parse = (json) => {
  if (typeof json !== "string") return json ?? null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
};

const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};


  global.RemoteConfig = { initRemoteConfig, rc, rcAll, rcReady, rcCohorts, rcSource, rcDeclaration, installId, configure, pickGroups, groupLabel, progressParams, cohortLabel, paramGroups, unlockOverrides, rcOverrides, setOverride, clearOverrides, onRcChange, mountRcParams, installTestBridge, registerTestActions };
})(typeof window !== "undefined" ? window : globalThis);
