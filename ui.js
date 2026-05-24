/**
 * ui.js — переключение экранов и модалок.
 *
 * Экраны: 'home' | 'difficulty' | 'game'.
 * Модалки: 'win' | 'gameover' | 'pause' | 'settings' (показываются поверх экранов).
 */
window.UI = (function () {
  const SCREEN_IDS  = ['home', 'game'];
  const MODAL_IDS   = ['win', 'gameover', 'pause', 'settings'];

  function showScreen(name) {
    for (const id of SCREEN_IDS) {
      const el = document.getElementById('screen-' + id);
      if (!el) continue;
      if (id === name) el.classList.add('active');
      else el.classList.remove('active');
    }
  }

  function showModal(name) {
    const el = document.getElementById('modal-' + name);
    if (el) el.classList.remove('hidden');
  }

  function hideModal(name) {
    const el = document.getElementById('modal-' + name);
    if (el) el.classList.add('hidden');
  }

  function hideAllModals() {
    for (const id of MODAL_IDS) hideModal(id);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Утилита: «01:23» из миллисекунд
  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setHearts(remaining, max) {
    const wrap = document.getElementById('game-hearts');
    if (!wrap) return;
    // Каждое сердечко — это <svg><use href="#icon-heart"/></svg> (svg-sprite
    // в index.html, всегда доступен). Класс .lost для потерянных.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XLINK = 'http://www.w3.org/1999/xlink';
    wrap.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'heart' + (i >= remaining ? ' lost' : ''));
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', '#icon-heart');
      use.setAttributeNS(XLINK, 'xlink:href', '#icon-heart'); // legacy WebView
      svg.appendChild(use);
      wrap.appendChild(svg);
    }
  }

  function setHintBadge(remaining) {
    const badge = document.getElementById('hint-count');
    if (!badge) return;
    badge.textContent = String(remaining);
    const btn = document.getElementById('btn-hint');
    if (btn) btn.classList.toggle('depleted', remaining <= 0);
  }

  return {
    showScreen: showScreen,
    showModal: showModal,
    hideModal: hideModal,
    hideAllModals: hideAllModals,
    setText: setText,
    formatTime: formatTime,
    setHearts: setHearts,
    setHintBadge: setHintBadge
  };
})();
