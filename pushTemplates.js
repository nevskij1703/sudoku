/**
 * pushTemplates.js — шаблоны push-уведомлений для Судоку.
 *
 * Тон: вызов, провокация (как у топового Sudoku-app — это работает),
 * утром бодро, обед — челлендж, вечер — релакс.
 *
 * Каждый шаблон:
 *   id (уник), slot, weekdays, title, body, cooldownDays, requires?, weight?
 *
 * Подключается через `<script src="pushTemplates.js">` ПЕРЕД `pushScheduler.js`,
 * чтобы window.PUSH_TEMPLATES существовал до configure(). Далее main.js:
 *   PushScheduler.configure({appName, templates: window.PUSH_TEMPLATES, ...})
 */
window.PUSH_TEMPLATES = [
  // ===== Утро (09:00-10:30) — бодрое, мотивирующее =====
  {
    id: 'morning-brain-daily',
    slot: 'morning', weekdays: 'any',
    title: '🧠 Тренируй мозг ежедневно',
    body: 'Утренний пазл уже ждёт — 5 минут на ясность ума',
    cooldownDays: 3
  },
  {
    id: 'morning-energy',
    slot: 'morning', weekdays: 'any',
    title: '⚡ Утро требует энергии',
    body: 'Судоку пробуждает ум быстрее кофе',
    cooldownDays: 3
  },
  {
    id: 'morning-ready',
    slot: 'morning', weekdays: 'any',
    title: '🌟 Готов к головоломке?',
    body: 'Утренняя порция логики ждёт',
    cooldownDays: 4
  },
  {
    id: 'morning-rainbow-weekend',
    slot: 'morning', weekdays: 'weekend',
    title: '🌈 Радужный судоку-брейк',
    body: 'Воскресная порция логики — самая вкусная',
    cooldownDays: 7
  },

  // ===== Обед (13:00-14:00) — провокация, челлендж =====
  {
    id: 'lunch-too-easy',
    slot: 'lunch', weekdays: 'any',
    title: '😎 Слишком легко для тебя?',
    body: 'Вот настоящий вызов — попробуй сложный уровень',
    cooldownDays: 3
  },
  {
    id: 'lunch-giving-up',
    slot: 'lunch', weekdays: 'any',
    title: '😮 Ты сдаёшься?',
    body: 'Докажи обратное — решай за 5 минут',
    cooldownDays: 4
  },
  {
    id: 'lunch-record',
    slot: 'lunch', weekdays: 'any',
    title: '🏅 Побей сегодняшний рекорд',
    body: 'Время — твой соперник. Решай быстрее',
    cooldownDays: 3
  },
  {
    id: 'lunch-jackpot',
    slot: 'lunch', weekdays: 'any',
    title: '🚨 Оповещение о джекпоте',
    body: 'Реши судоку — сорви бонус',
    cooldownDays: 5
  },

  // ===== Вечер (19:30-21:00) — релакс =====
  {
    id: 'evening-bliss',
    slot: 'evening', weekdays: 'any',
    title: '🧘 Вечернее блаженство',
    body: 'Сними стресс одной партией судоку',
    cooldownDays: 3
  },
  {
    id: 'evening-relax-tea',
    slot: 'evening', weekdays: 'any',
    title: '🍵 Решай для релаксации',
    body: 'Логика + покой = идеальный вечер',
    cooldownDays: 3
  },
  {
    id: 'evening-hidden-rewards',
    slot: 'evening', weekdays: 'any',
    title: '💎 Что в сетке сегодня?',
    body: 'Играй — найди скрытые награды',
    cooldownDays: 5
  },
  {
    id: 'evening-feeling-stuck',
    slot: 'evening', weekdays: 'weekday',
    title: 'Чувствуешь себя заблокированным❓',
    body: 'Отойди от экрана — реши пару задач судоку',
    cooldownDays: 4
  },

  // ===== Ночь (22:30-23:00) — короткая партия перед сном =====
  {
    id: 'night-late-logic',
    slot: 'night', weekdays: 'any',
    title: '🌙 Логика поздней ночи',
    body: 'Короткая партия перед сном',
    cooldownDays: 4
  },
  {
    id: 'night-dream-sudoku',
    slot: 'night', weekdays: 'any',
    title: '🌙 Судоку Мечты',
    body: 'Разблокируй ночную партию прямо сейчас',
    cooldownDays: 5
  }
];
