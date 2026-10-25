// Расписание напоминаний (pushScheduler.js) — без браузера и без телефона.
//
//   node --test scripts/pushPlan.test.mjs
//
// Зачем это здесь. Мост html2apk без режима setManaged продлевал на сутки
// каждое сработавшее напоминание, и семидневный план размножался: у того, кто
// не заходит, к неделе приходило 28 в день, а выключившему — по два «Не
// забудь про игру». Увидеть это можно было только на телефоне через неделю.
// Здесь настоящий код планировщика гоняется на подменённых часах с моделью
// моста в режиме setManaged (NotificationReceiver: сработавшее продлевается
// на сутки, только если оно было последним в очереди; досыпа нет).
//
// Скрипты игры классические (window.PUSH_TEMPLATES, window.PushScheduler) и
// исполняются заново на каждый случай: нужны чистое состояние и свои часы.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SOURCE = read('pushTemplates.js') + '\n' + read('pushScheduler.js')
  + '\nreturn Object.assign({ PUSH_TEMPLATES: window.PUSH_TEMPLATES }, window.PushScheduler);';

const H = 3600_000, D = 24 * H;
// Июнь — подальше от переходов на летнее время, если тест гоняют не в Москве.
const MON_21 = new Date(2026, 5, 15, 21, 0).getTime();

function load({ now = MON_21, enabled = true, permission = 'granted', maxPerDay = 4 } = {}) {
  const clock = { now };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  const calls = [];
  const alarms = new Map();
  const bridge = {
    managed: false,
    setManaged(on) { calls.push('setManaged'); this.managed = on; },
    cancelAll() { calls.push('cancelAll'); alarms.clear(); },
    schedule(id, title, body, at, templateId) {
      calls.push('schedule');
      alarms.set(id, { id, title, body, at, templateId });
    },
    getPermissionState: () => permission,
    requestPermission() {},
  };
  const store = new Map();
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const quiet = { log() {}, warn() {}, error() {} };
  const state = { enabled };
  const window = {
    LocalNotifications: bridge,
    __getPushEnabled: () => state.enabled,
    __setPushEnabled: (v) => { state.enabled = v; },
  };
  const api = new Function('window', 'localStorage', 'Date', 'console', 'setTimeout', SOURCE)(
    window, localStorage, FakeDate, quiet, () => 0);
  api.configure({ templates: api.PUSH_TEMPLATES, maxPerDay, storageKey: 'test' });
  return { api, bridge, calls, alarms, clock };
}

const dayIndex = (from, at) => {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(at); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / D);
};
const sorted = (alarms) => [...alarms.values()].sort((a, b) => a.at - b.at);

test('мост — в режиме setManaged, очередь снимается до планирования', () => {
  const { api, bridge, calls } = load();
  api.refresh();
  assert.equal(bridge.managed, true);
  assert.deepEqual(calls.slice(0, 2), ['setManaged', 'cancelAll']);
  assert.ok(calls.slice(2).every((c) => c === 'schedule'));
});

test('выключенному и без разрешения очередь только снимается', () => {
  for (const opts of [{ enabled: false }, { permission: 'denied' }]) {
    const { api, bridge, calls, alarms } = load(opts);
    api.refresh();
    assert.equal(bridge.managed, true);
    assert.ok(calls.includes('cancelAll'));
    assert.equal(alarms.size, 0);
  }
});

test('в день ухода ничего, три дня по два, дальше по одному вечером', () => {
  const { api, alarms } = load();
  api.refresh();
  const perDay = new Map();
  for (const a of alarms.values()) {
    const d = dayIndex(MON_21, a.at);
    perDay.set(d, [...(perDay.get(d) ?? []), new Date(a.at).getHours()]);
  }
  assert.deepEqual([...perDay.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  for (const [d, hours] of perDay) {
    if (d <= 3) {
      assert.equal(hours.length, 2, `день ${d}`);
      assert.ok(hours.some((h) => h >= 9 && h <= 10), `день ${d}: утро`);
    } else {
      assert.equal(hours.length, 1, `день ${d}`);
    }
    assert.ok(hours.some((h) => h >= 19 && h <= 21), `день ${d}: вечер`);
  }
  assert.equal(new Set([...alarms.keys()]).size, alarms.size);
});

test('ушедший после полуночи ушёл «вчера»: наступающий день уже первый', () => {
  const now = new Date(2026, 5, 16, 1, 30).getTime();
  const { api, alarms } = load({ now });
  api.refresh();
  const sameDay = sorted(alarms).filter((a) => dayIndex(now, a.at) === 0);
  assert.equal(sameDay.length, 2);
});

test('последнее в очереди — неизменная фраза (tail)', () => {
  const { api, alarms } = load();
  api.refresh();
  const tail = api.PUSH_TEMPLATES.find((t) => t.tail);
  assert.ok(tail, 'в шаблонах нет tail');
  const last = sorted(alarms).at(-1);
  assert.equal(last.templateId, tail.id);
  assert.equal(last.title, tail.title);
});

test('потолок в день: 1 — только вечер, 0 — ничего', () => {
  const one = load({ maxPerDay: 1 });
  one.api.refresh();
  assert.equal(one.alarms.size, 7);
  assert.ok([...one.alarms.values()].every((a) => new Date(a.at).getHours() >= 19));
  const none = load({ maxPerDay: 0 });
  none.api.refresh();
  assert.equal(none.alarms.size, 0);
});

test('месяц без захода: не больше двух в день, с четвёртого дня по одному', () => {
  const { api, alarms, clock } = load();
  api.refresh();
  const fired = new Map();
  const end = MON_21 + 31 * D;
  for (;;) {
    const next = sorted(alarms)[0];
    if (!next || next.at > end) break;
    clock.now = next.at;
    alarms.delete(next.id);
    const d = dayIndex(MON_21, next.at);
    fired.set(d, (fired.get(d) ?? 0) + 1);
    // NotificationReceiver в режиме setManaged: продлевает только последнее
    if (alarms.size === 0) alarms.set(next.id + 1, { ...next, id: next.id + 1, at: next.at + D });
  }
  for (let d = 1; d <= 30; d++) assert.equal(fired.get(d), d <= 3 ? 2 : 1, `день ${d}`);
});
