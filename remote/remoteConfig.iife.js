// СОБРАННЫЙ ФАЙЛ — НЕ ПРАВИТЬ РУКАМИ.
// Источники: abTest.js, milestones.js, remoteConfig.js. Пересобрать: node client/build-iife.mjs
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


// ===== milestones.js =====
// Рубежи прохождения: отдельное событие на каждый значимый уровень.
//
// ЗАЧЕМ ОТДЕЛЬНЫЕ ИМЕНА СОБЫТИЙ, А НЕ ПАРАМЕТР С НОМЕРОМ УРОВНЯ. Потому что
// иначе прохождение нельзя разрезать по группам A/B, а именно для этого оно и
// нужно. Параметры событий в отчётном API ПЛОСКИЕ: одна строка ответа описывает
// один параметр — уровень 1 это имя, уровень 2 это значение. Поэтому «номер
// уровня И группа» одной строкой не выражаются, и разрез по группам для
// `level_complete{level_num}` недостижим в принципе. А связка «событие ×
// user_id» достижима — значит, если рубеж это ОТДЕЛЬНОЕ СОБЫТИЕ, группа
// восстанавливается по user_id тем же кодом, что делит игроков в игре.
//
// ПОВТОРЫ БЕЗВРЕДНЫ И ПОТОМУ НИЧЕГО НЕ ЗАПОМИНАЕМ. Событие уходит при каждом
// прохождении рубежа, в том числе при переигровке, но воронка считает РАЗНЫХ
// людей — второе событие того же человека в неё не добавляется. Хранить в сейве
// «о каком рубеже уже сообщили» значило бы завести миграцию сейва и новый
// источник расхождений ради числа, которое и так верное.
//
// Список рубежей — в `<игра>/remote-config.json`, поле `funnel.milestones`.
// Оттуда его читают ОБА: игра — чтобы знать, когда отправлять, админка — чтобы
// знать, какие шаги рисовать. Два списка разошлись бы на первом же изменении, и
// разошлись бы молча: воронка просто перестала бы заполняться.

/**
 * Рубежи по умолчанию, если игра своих не объявила.
 *
 * ПЕРВЫЙ ДЕСЯТОК — ПОШТУЧНО, дальше реже. Отваливаются в основном на первых
 * уровнях, и разрешение «1, 3, 5» именно там и подводит: между третьим и пятым
 * теряется столько же людей, сколько на всём остатке, а шага, который бы это
 * показал, нет. Дальше поштучно уже не нужно — разница между сороковым и
 * сорок первым уровнем никого не интересует, а событий стало бы сто.
 *
 * Список ОДИН НА ВСЕ ИГРЫ намеренно: воронки разных игр иначе не сравнить
 * между собой, а сравнение — единственное, зачем в админке есть таблица.
 */
const DEFAULT_MILESTONES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  15, 20, 25, 30, 40, 50, 75, 100,
];

/** Имя события рубежа. Формат один на все игры, иначе воронку не собрать. */
function milestoneName(level) {
  return `level_${level}_done`;
}

function clean(milestones) {
  const list = Array.isArray(milestones) ? milestones : DEFAULT_MILESTONES;
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b);
}

/**
 * Событие, которое надо отправить при прохождении уровня, или `null`.
 *
 * @param {number} level      — номер пройденного уровня, начиная с 1
 * @param {number[]} [milestones] — из `funnel.milestones` игры
 */
function milestoneEvent(level, milestones) {
  const n = Number(level);
  if (!Number.isInteger(n) || n <= 0) return null;
  return clean(milestones).includes(n) ? milestoneName(n) : null;
}

/** Имена всех рубежных событий по порядку — для шагов воронки в админке. */
function milestoneEvents(milestones) {
  return clean(milestones).map(milestoneName);
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
let cohorts = [];
let ready = false;

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
  return rcAll();
}

/**
 * Значение настройки. До загрузки и после провала сети отдаёт дефолт, поэтому
 * вызывать можно откуда угодно и когда угодно — проверять «а загрузился ли
 * конфиг» на каждом обращении не нужно.
 */
function rc(key) {
  return key in values ? values[key] : defaults[key];
}

/** Все значения — для дев-панели и отладки. Не для игровой логики. */
function rcAll() {
  return { ...defaults, ...values };
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
function sanitize(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const range = ranges[key];
    if (!range) continue;

    if (range.oneOf) {
      if (range.oneOf.includes(value)) out[key] = value;
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    if (num < range.min || num > range.max) continue;
    out[key] = num;
  }
  return out;
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

  return rcAll();
}


  global.RemoteConfig = { initRemoteConfig, rc, rcAll, rcReady, rcCohorts, installId, configure, pickGroups, groupLabel, milestoneEvent, milestoneEvents };
})(typeof window !== "undefined" ? window : globalThis);
