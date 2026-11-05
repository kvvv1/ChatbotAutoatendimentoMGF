// Notificações de novas mensagens do cliente no painel de atendimento.
// - Notificação do navegador + som quando a aba está minimizada/sem foco.
// - Botão de sino no topo para ativar/desativar (preferência salva no navegador).
// Detecção 100% no front: compara o unread_count de cada conversa entre atualizações da lista.
(function () {
  'use strict';

  var STORAGE_KEY = 'painel.notificacoes.ativas';
  var NEW_TICKET_WINDOW_MS = 2 * 60 * 1000;

  var enabled = readEnabled();
  var snapshot = null; // Map ticketId -> unread_count
  var snapshotKey = '';
  var pendingCount = 0;
  var originalTitle = document.title;
  var audioCtx = null;
  var openTicketFn = null;

  function readEnabled() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch (e) {
      return true;
    }
  }

  function saveEnabled(v) {
    try { window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (e) {}
  }

  function supported() {
    return typeof window.Notification !== 'undefined';
  }

  function isAway() {
    return document.hidden || !document.hasFocus();
  }

  // ── Botão do sino ───────────────────────────────────────────────────────────
  var BELL_ON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>';
  var BELL_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66a6.9 6.9 0 0 0-2.2.9L19 15.76V16Zm-15.6-13L2 4.4l3.2 3.2A6.9 6.9 0 0 0 5 11v5l-2 2v1h14.6l2 2 1.4-1.4L3.4 3Z"/></svg>';

  var button = null;

  function renderButton() {
    if (!button) return;
    var denied = supported() && Notification.permission === 'denied';
    var on = enabled;
    button.innerHTML = on ? BELL_ON : BELL_OFF;
    button.classList.toggle('is-off', !on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    var title;
    if (!on) title = 'Notificações desativadas — clique para ativar';
    else if (!supported()) title = 'Som de notificação ativo (navegador não suporta notificações)';
    else if (denied) title = 'Som ativo — notificações bloqueadas no navegador (libere no cadeado da barra de endereço)';
    else title = 'Notificações ativas — clique para desativar';
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function createButton() {
    var header = document.querySelector('.sidebar-header');
    if (!header) return;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'notifications-toggle';
    button.className = 'notifications-toggle';
    var logout = document.getElementById('logout-button');
    if (logout) header.insertBefore(button, logout);
    else header.appendChild(button);
    button.addEventListener('click', onToggle);
    renderButton();
  }

  function onToggle() {
    enabled = !enabled;
    saveEnabled(enabled);
    if (enabled) {
      unlockAudio();
      if (supported() && Notification.permission === 'default') {
        try {
          var p = Notification.requestPermission(function () { renderButton(); });
          if (p && typeof p.then === 'function') p.then(renderButton, renderButton);
        } catch (e) {}
      }
      if (typeof window.showToast === 'function') window.showToast('Notificações ativadas.', 'success');
    } else {
      clearTitleBadge();
      if (typeof window.showToast === 'function') window.showToast('Notificações desativadas.', 'success');
    }
    renderButton();
  }

  // Pede permissão no primeiro clique do operador no painel (navegadores exigem gesto do usuário)
  function askOnFirstInteraction() {
    var handler = function () {
      document.removeEventListener('click', handler, true);
      unlockAudio();
      if (enabled && supported() && Notification.permission === 'default') {
        try {
          var p = Notification.requestPermission(function () { renderButton(); });
          if (p && typeof p.then === 'function') p.then(renderButton, renderButton);
        } catch (e) {}
      }
    };
    document.addEventListener('click', handler, true);
  }

  // ── Som ─────────────────────────────────────────────────────────────────────
  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }

  function playSound() {
    try {
      unlockAudio();
      if (!audioCtx) return;
      var now = audioCtx.currentTime;
      [0, 0.18].forEach(function (offset, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = i === 0 ? 880 : 1175;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      });
    } catch (e) {}
  }

  // ── Título da aba ──────────────────────────────────────────────────────────
  function setTitleBadge() {
    if (!/^\(\d+\) /.test(document.title)) originalTitle = document.title;
    document.title = '(' + pendingCount + ') ' + originalTitle.replace(/^\(\d+\) /, '');
  }

  function clearTitleBadge() {
    pendingCount = 0;
    document.title = originalTitle.replace(/^\(\d+\) /, '');
  }

  function onBack() {
    if (!isAway()) clearTitleBadge();
  }
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);

  // ── Notificação ────────────────────────────────────────────────────────────
  function ticketName(t) {
    var name = t && typeof t.customer_name === 'string' && t.customer_name.trim() ? t.customer_name.trim() : '';
    return name || (t && t.phone ? String(t.phone) : 'Cliente');
  }

  function notify(newOnes) {
    pendingCount += newOnes.reduce(function (acc, n) { return acc + n.delta; }, 0);
    setTitleBadge();
    playSound();

    if (!supported() || Notification.permission !== 'granted') return;
    var first = newOnes[0].ticket;
    var title = newOnes.length === 1 ? 'Nova mensagem de ' + ticketName(first) : newOnes.length + ' conversas com novas mensagens';
    var body = newOnes.length === 1
      ? (typeof first.last_message_preview === 'string' && first.last_message_preview.trim() ? first.last_message_preview.trim() : 'Você recebeu uma nova mensagem.')
      : newOnes.slice(0, 3).map(function (n) { return ticketName(n.ticket); }).join(', ');
    try {
      var n = new Notification(title, {
        body: body.length > 140 ? body.slice(0, 137) + '...' : body,
        tag: 'painel-atendimento-nova-mensagem',
        renotify: true
      });
      n.onclick = function () {
        try { window.focus(); } catch (e) {}
        if (newOnes.length === 1 && openTicketFn && first && first.id) {
          try { openTicketFn(first.id); } catch (e) {}
        }
        n.close();
      };
    } catch (e) {}
  }

  // Chamado pelo app.js sempre que a lista de conversas é atualizada.
  function onTickets(tickets, filterKey, openTicket) {
    if (typeof openTicket === 'function') openTicketFn = openTicket;
    if (!Array.isArray(tickets)) return;
    var key = String(filterKey || '');
    var next = new Map();
    var newOnes = [];
    var now = Date.now();

    tickets.forEach(function (t) {
      if (!t || t.id === undefined || t.id === null) return;
      var unread = Number(t.unread_count) || 0;
      next.set(t.id, unread);
      if (!snapshot || key !== snapshotKey) return;
      var prev = snapshot.get(t.id);
      if (prev === undefined) {
        var created = new Date(t.created_at || 0).getTime();
        if (unread > 0 && now - created < NEW_TICKET_WINDOW_MS) newOnes.push({ ticket: t, delta: unread });
      } else if (unread > prev) {
        newOnes.push({ ticket: t, delta: unread - prev });
      }
    });

    snapshot = next;
    snapshotKey = key;

    if (newOnes.length && enabled && isAway()) notify(newOnes);
  }

  window.PanelNotifications = { onTickets: onTickets };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { createButton(); askOnFirstInteraction(); });
  } else {
    createButton();
    askOnFirstInteraction();
  }
})();
