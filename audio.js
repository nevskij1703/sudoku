/**
 * audio.js — Web Audio API звуки для Sudoku.
 * Громкость/состояние читаем из Storage.getSettings().sound / .vibration.
 *
 * Звуки:
 *   click    — выделение ячейки
 *   place    — успешная установка цифры
 *   mistake  — неверная цифра (ошибка → красная подсветка → -1 сердце)
 *   hint     — использована подсказка
 *   win      — уровень пройден
 *   lose     — game over
 *   note     — тихий клик при установке заметки карандашом
 */
window.AudioFX = (function () {
  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { ctx = null; }
    }
    return ctx;
  }

  function settings() { return window.Storage ? window.Storage.getSettings() : { sound: true, vibration: true }; }
  function soundOn()   { return settings().sound; }
  function vibrOn()    { return settings().vibration; }

  function beep(freq, durationMs, type, volume) {
    if (!soundOn()) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(c.destination);
    const now = c.currentTime;
    const peak = (typeof volume === 'number') ? volume : 0.12;
    g.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    o.start(now);
    o.stop(now + durationMs / 1000 + 0.02);
  }

  function chord(freqs, durationMs, type, volume) {
    if (!soundOn()) return;
    for (let i = 0; i < freqs.length; i++) {
      setTimeout(function () { beep(freqs[i], durationMs, type, volume); }, i * 60);
    }
  }

  function vibrate(pattern) {
    if (!vibrOn()) return;
    if (navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {}
  }

  return {
    click:   function () { beep(420, 60,  'square',   0.05); vibrate(8); },
    note:    function () { beep(360, 50,  'triangle', 0.04); vibrate(6); },
    place:   function () { beep(620, 120, 'triangle', 0.10); vibrate(12); },
    mistake: function () { beep(180, 220, 'sawtooth', 0.08); vibrate([20, 30, 20]); },
    hint:    function () { chord([520, 660, 880], 140, 'triangle', 0.10); vibrate(20); },
    win:     function () { chord([523, 659, 784, 1046], 200, 'triangle', 0.12); vibrate([20, 40, 20, 40, 20]); },
    lose:    function () { chord([300, 220, 160], 220, 'sawtooth', 0.10); vibrate([60, 80, 60]); }
  };
})();
