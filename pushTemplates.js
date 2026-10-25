/**
 * pushTemplates.js — шаблоны push-уведомлений для Судоку.
 *
 * Тон: утром бодро, вечером — релакс.
 *
 * Каждый шаблон:
 *   id (уник), slot, weekdays, title, body, cooldownDays, tail?, requires?, weight?
 *
 * Слоты — утро и вечер (расписание — в pushScheduler.js). `tail: true` —
 * неизменная фраза последнего в очереди: его мост повторяет раз в сутки, пока
 * человек не зайдёт, поэтому в ней нет дня, даты и обещаний.
 *
 * Тексты не обещают того, чего в игре нет: ни джекпотов, ни скрытых наград в
 * сетке в ней нет — значит, нет их и в напоминаниях.
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

  // ===== Вечер (19:30-21:00) — релакс =====
  {
    id: 'evening-bliss',
    slot: 'evening', weekdays: 'any',
    title: '🧘 Вечернее блаженство',
    body: 'Сними стресс одной партией судоку',
    cooldownDays: 3,
    tail: true
  },
  {
    id: 'evening-relax-tea',
    slot: 'evening', weekdays: 'any',
    title: '🍵 Решай для релаксации',
    body: 'Логика + покой = идеальный вечер',
    cooldownDays: 3
  },
  {
    id: 'evening-feeling-stuck',
    slot: 'evening', weekdays: 'weekday',
    title: 'Чувствуешь себя заблокированным❓',
    body: 'Отойди от экрана — реши пару задач судоку',
    cooldownDays: 4
  }
];
