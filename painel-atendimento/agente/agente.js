(function () {
  'use strict';

  const BASE = window.AGENTE_IAM_CONFIG || {};
  const TEXT_TIMEOUT_MS = 150000;
  const PDF_TIMEOUT_MS = 280000;
  const HISTORY_LIMIT = 40;
  const REPORT_RE = /(relat[oó]rio|relatorio|\bpdf\b)/i;
  const REPORT_EDIT_RE = /\b(acrescente|adicione|inclua|gere|gera|refa[cç]a|refaz|novamente)\b/i;
  const REPORT_EDIT_TARGET_RE = /\b(gr[aá]fico|chart|tabela|visual|relat)/i;
  const BI_RE = /\b(bi|dashboard|painel de bi|painel de indicadores)\b/i;

  // ---- Contexto (config + URL do iframe + postMessage do sistema hospedeiro) ----
  const ctx = Object.assign({}, BASE);
  const params = new URLSearchParams(location.search);
  ['entidade', 'municipio', 'usuario', 'schema'].forEach(k => { if (params.get(k)) ctx[k] = params.get(k); });
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== 'agente-iam:contexto') return;
    ['entidade', 'municipio', 'usuario', 'schema'].forEach(k => { if (typeof d[k] === 'string' && d[k]) ctx[k] = d[k]; });
  });

  // ---- Elementos ----
  const $ = id => document.getElementById(id);
  const el = {
    app: $('app'), history: $('history'), search: $('search'), newChat: $('new-chat'), sessionId: $('session-id'),
    messages: $('messages'), chips: $('chips'), composer: $('composer'), input: $('input'), send: $('send'),
    chatTitle: $('chat-title'), systemName: $('system-name'), modeBadge: $('mode-badge'), brandTitle: $('brand-title'),
    menuBtn: $('menu-btn'), sidebarClose: $('sidebar-close'), backdrop: $('backdrop'), toast: $('toast'),
    waModal: $('wa-modal'), waForm: $('wa-form'), waPhone: $('wa-phone'), waError: $('wa-error'), waDesc: $('wa-desc'),
    waResult: $('wa-result'), waSubmit: $('wa-submit'), waCancel: $('wa-cancel'), waClose: $('wa-close')
  };

  // ---- Identidade estável do usuário ----
  // ctx.usuario vem do iframe (?usuario=) ou do postMessage; sem ele, usa um id anônimo persistente.
  const USER_KEY = ctx.usuarioStorageKey || 'mgf-agente-usuario';
  let anonUser = null;
  function uuid4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function currentUser() {
    if (ctx.usuario) return String(ctx.usuario);
    if (anonUser) return anonUser;
    try { anonUser = localStorage.getItem(USER_KEY); } catch (e) { anonUser = null; }
    if (!anonUser || !/^anon-[0-9a-f-]{36}$/i.test(anonUser)) {
      anonUser = 'anon-' + uuid4();
      try { localStorage.setItem(USER_KEY, anonUser); } catch (e) { /* fica só em memória nesta sessão */ }
    }
    return anonUser;
  }

  // Ícone oficial do Agente MGF (GESTCOM): WebP com fallback PNG, 1x/2x/3x
  const BRAND_DIR = 'assets/brand/gestcom-icon-';
  function brandIcon(size, sources, lazy) {
    const set = (ext) => sources.map((px, i) => BRAND_DIR + px + '.' + ext + ' ' + (i + 1) + 'x').join(', ');
    return '<picture><source type="image/webp" srcset="' + set('webp') + '">' +
      '<img src="' + BRAND_DIR + sources[0] + '.png" srcset="' + set('png') + '" width="' + size + '" height="' + size +
      '" alt="Agente MGF - GESTCOM" decoding="async"' + (lazy ? ' loading="lazy"' : '') + ' draggable="false"></picture>';
  }
  const BRAND_AVATAR = brandIcon(32, [32, 64, 96], true);
  const BRAND_WELCOME = brandIcon(56, [56, 112, 168]);

  const ICON = {
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    barcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M17 5v14M20 5v14"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 1c-1-.4-2-1.4-2.4-2.4l1-1-1-2z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6M20 3v5.6h-5.6"/></svg>'
  };

  // ---- Estado ----
  const storageKey = (ctx.storageKey || 'mgf-agente-iam') + ':v1';
  const pdfStore = new Map(); // PDFs ficam só em memória (não cabem no localStorage)
  let state = load();
  let sending = null; // { controller, convId }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      const s = raw ? JSON.parse(raw) : null;
      if (s && Array.isArray(s.conversations)) return { conversations: s.conversations, activeId: s.activeId || null, search: '' };
    } catch (e) { /* armazenamento indisponível */ }
    return { conversations: [], activeId: null, search: '' };
  }
  function persist() {
    try {
      const data = { conversations: state.conversations.slice(0, HISTORY_LIMIT), activeId: state.activeId };
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (e) { /* armazenamento indisponível */ }
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const active = () => state.conversations.find(c => c.id === state.activeId) || null;
  const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function newConversation() {
    const c = { id: uid(), sessionId: uid(), title: 'Novo chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.conversations.unshift(c);
    state.activeId = c.id;
    persist();
    return c;
  }

  // ---- Render: histórico ----
  function groupLabel(ts) {
    const d = new Date(ts); const now = new Date();
    const day = 86400000;
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startToday) return 'Hoje';
    if (ts >= startToday - day) return 'Ontem';
    if (ts >= startToday - 7 * day) return 'Últimos 7 dias';
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  function renderHistory() {
    const term = state.search.trim().toLowerCase();
    const list = state.conversations
      .filter(c => c.messages.length)
      .filter(c => !term || c.title.toLowerCase().includes(term) || c.messages.some(m => (m.text || '').toLowerCase().includes(term)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    el.history.innerHTML = '';
    if (!list.length) {
      el.history.innerHTML = '<div class="history-empty">' + (term ? 'Nenhuma conversa encontrada.' : 'Suas conversas aparecem aqui.') + '</div>';
      return;
    }
    let last = '';
    for (const c of list) {
      const g = groupLabel(c.updatedAt);
      if (g !== last) { const h = document.createElement('div'); h.className = 'history-group'; h.textContent = g; el.history.appendChild(h); last = g; }
      const item = document.createElement('div');
      item.className = 'history-item' + (c.id === state.activeId ? ' active' : '');
      item.setAttribute('role', 'listitem');
      item.tabIndex = 0;
      item.title = c.title;
      item.innerHTML = '<span class="h-title"></span><button class="h-del" aria-label="Excluir conversa">' + ICON.trash + '</button>';
      item.querySelector('.h-title').textContent = c.title;
      item.addEventListener('click', () => selectConversation(c.id));
      item.addEventListener('keydown', e => { if (e.key === 'Enter') selectConversation(c.id); });
      item.querySelector('.h-del').addEventListener('click', e => { e.stopPropagation(); deleteConversation(c.id); });
      el.history.appendChild(item);
    }
  }

  // ---- Render: mensagens ----
  function renderMessages() {
    const c = active();
    el.messages.innerHTML = '';
    el.chatTitle.textContent = c && c.messages.length ? c.title : 'Novo chat';
    el.sessionId.textContent = c ? c.sessionId.slice(0, 18) : '—';
    if (!c || !c.messages.length) {
      el.messages.appendChild(renderWelcome());
    } else {
      c.messages.forEach(m => el.messages.appendChild(renderMessage(m, c)));
      if (sending && sending.convId === c.id) el.messages.appendChild(renderTyping());
    }
    renderChips();
    if (c && c.messages.length) scrollToBottom(false);
    else el.messages.scrollTop = 0; // boas-vindas abre no topo (título e "Continuar de onde parou" visíveis)
  }

  function renderWelcome() {
    const w = document.createElement('div');
    w.className = 'welcome';
    w.innerHTML = '<div class="welcome-mark">' + BRAND_WELCOME + '</div><h1></h1><p></p><div class="cards"></div>';
    w.querySelector('h1').textContent = ctx.welcomeTitle || 'Olá!';
    w.querySelector('p').textContent = ctx.welcomeDescription || '';
    const recentes = recentQuestions(3);
    if (recentes.length) w.insertBefore(renderResume(recentes), w.querySelector('.cards'));
    const cards = w.querySelector('.cards');
    (ctx.welcomeSuggestions || []).forEach(s => {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = '<strong></strong><span></span>';
      b.querySelector('strong').textContent = s.titulo;
      b.querySelector('span').textContent = s.texto;
      b.addEventListener('click', () => sendMessage(s.texto));
      cards.appendChild(b);
    });
    return w;
  }

  // Últimas perguntas feitas em outras conversas (a mais recente de cada conversa)
  function recentQuestions(n) {
    const seen = new Set();
    const out = [];
    state.conversations
      .filter(c => c.id !== state.activeId && c.messages.some(m => m.role === 'user'))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach(c => {
        const u = [...c.messages].reverse().find(m => m.role === 'user' && m.text);
        const key = u && u.text.trim().toLowerCase();
        if (!u || seen.has(key) || out.length >= n) return;
        seen.add(key);
        out.push({ convId: c.id, text: u.text.trim(), time: c.updatedAt });
      });
    return out;
  }
  function fmtWhen(ts) {
    const g = groupLabel(ts);
    return (g === 'Hoje' || g === 'Ontem' ? g : new Date(ts).toLocaleDateString('pt-BR')) + ', ' + fmtTime(ts);
  }
  function renderResume(list) {
    const sec = document.createElement('section');
    sec.className = 'resume';
    sec.setAttribute('aria-labelledby', 'resume-title');
    sec.innerHTML = '<h2 class="resume-title" id="resume-title">' + ICON.history + 'Continuar de onde parou</h2><div class="resume-list"></div>';
    const box = sec.querySelector('.resume-list');
    list.forEach(r => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'resume-item';
      b.innerHTML = ICON.history + '<span class="resume-q"></span><span class="resume-when"></span>' + ICON.arrow;
      b.querySelector('.resume-q').textContent = r.text;
      b.querySelector('.resume-when').textContent = fmtWhen(r.time);
      b.setAttribute('aria-label', 'Continuar a conversa: ' + r.text + ' (' + fmtWhen(r.time) + ')');
      b.title = r.text;
      b.addEventListener('click', () => selectConversation(r.convId));
      box.appendChild(b);
    });
    return sec;
  }

  function renderMessage(m, conv) {
    const row = document.createElement('div');
    row.className = 'msg ' + m.role + (m.error ? ' error' : '');
    if (m.role === 'user') {
      row.innerHTML = '<div class="bubble"></div>';
      row.firstChild.textContent = m.text;
      return row;
    }
    row.innerHTML = '<div class="avatar">' + BRAND_AVATAR + '</div><div class="body"><div class="content"></div></div>';
    const body = row.querySelector('.body');
    const content = row.querySelector('.content');
    content.innerHTML = m.html || escapeHtml(m.text || '');

    if (m.pdf) body.appendChild(renderPdfCard(m));
    if (m.biUrl) body.appendChild(renderBiCard(m));
    if (m.acao && m.acao.tipo === 'segunda_via' && !m.error) body.appendChild(renderSegundaVia(m));

    const actions = document.createElement('div');
    actions.className = 'actions';
    const copy = actionButton(ICON.copy, 'Copiar', () => copyText(content.innerText));
    actions.appendChild(copy);
    if (m.error && m.retryText) actions.appendChild(actionButton(ICON.retry, 'Tentar novamente', () => retry(conv, m)));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = fmtTime(m.time);
    actions.appendChild(meta);
    body.appendChild(actions);
    return row;
  }

  function renderPdfCard(m) {
    const card = document.createElement('div');
    card.className = 'attachment';
    const available = pdfStore.has(m.id);
    card.innerHTML = '<div class="att-icon">' + ICON.pdf + '</div><div class="att-text"><strong></strong><span></span></div>';
    card.querySelector('strong').textContent = m.pdfName || 'relatorio.pdf';
    card.querySelector('span').textContent = available ? 'Relatório em PDF' : 'Disponível apenas na sessão em que foi gerado';
    if (available) {
      const b = document.createElement('button');
      b.className = 'btn-primary';
      b.innerHTML = ICON.download + 'Baixar';
      b.addEventListener('click', () => downloadPdf(m));
      card.appendChild(b);
    }
    return card;
  }

  function renderBiCard(m) {
    const card = document.createElement('div');
    card.className = 'attachment';
    card.innerHTML = '<div class="att-icon">' + ICON.chart + '</div><div class="att-text"><strong></strong><span>Painel de BI interativo</span></div><a class="btn-primary" target="_blank" rel="noopener">' + ICON.open + 'Abrir painel</a>';
    card.querySelector('strong').textContent = m.biTitle || 'Painel de BI';
    card.querySelector('a').href = m.biUrl;
    return card;
  }

  // ---- Indicador de etapas ----
  // O backend não envia progresso: as etapas avançam por tempo decorrido (ms) e a última fica
  // "em andamento" até a resposta chegar.
  const PROGRESS = {
    '': {
      titulo: 'Preparando sua resposta',
      etapas: [['Entendendo a pergunta', 0], ['Consultando o banco de dados', 2500], ['Conferindo os números', 9000], ['Montando a resposta', 16000]]
    },
    pdf: {
      titulo: 'Gerando o relatório…',
      dica: 'Relatórios em PDF podem levar até 2 minutos.',
      etapas: [['Entendendo o pedido', 0], ['Consultando o banco de dados', 3000], ['Conferindo os números', 15000], ['Montando o relatório', 30000], ['Preparando o PDF para download', 80000]]
    },
    bi: {
      titulo: 'Montando o painel de BI…',
      dica: 'O painel abre em uma nova aba quando estiver pronto.',
      etapas: [['Entendendo o pedido', 0], ['Consultando o banco de dados', 3000], ['Calculando os indicadores', 12000], ['Publicando o painel', 25000]]
    }
  };
  let progressTimer = null;

  function progressStep(cfg, elapsed) {
    let idx = 0;
    cfg.etapas.forEach(([, at], i) => { if (elapsed >= at) idx = i; });
    return idx;
  }
  function renderTyping() {
    const cfg = PROGRESS[(sending && sending.mode) || ''] || PROGRESS[''];
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.id = 'typing';
    row.innerHTML = '<div class="avatar">' + BRAND_AVATAR + '</div><div class="body"><div class="progress">' +
      '<div class="progress-head"><span class="progress-title"></span><span class="progress-time" aria-hidden="true"></span></div>' +
      '<ol class="steps" aria-hidden="true"></ol>' + (cfg.dica ? '<p class="progress-hint"></p>' : '') +
      '<span class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span></div></div>';
    row.querySelector('.progress-title').textContent = cfg.titulo;
    if (cfg.dica) row.querySelector('.progress-hint').textContent = cfg.dica;
    const ol = row.querySelector('.steps');
    cfg.etapas.forEach(([label]) => {
      const li = document.createElement('li');
      li.className = 'step';
      li.innerHTML = '<span class="step-mark"></span><span class="step-label"></span>';
      li.querySelector('.step-label').textContent = label;
      ol.appendChild(li);
    });
    updateProgress(row);
    return row;
  }
  function updateProgress(root) {
    const row = root || document.getElementById('typing');
    if (!row || !sending) return;
    const cfg = PROGRESS[sending.mode || ''] || PROGRESS[''];
    const elapsed = Date.now() - sending.startedAt;
    const idx = progressStep(cfg, elapsed);
    const secs = Math.floor(elapsed / 1000);
    row.querySelector('.progress-time').textContent = secs < 60 ? secs + ' s' : Math.floor(secs / 60) + ' min ' + String(secs % 60).padStart(2, '0') + ' s';
    if (row.dataset.step === String(idx)) return; // só mexe no DOM (e anuncia) quando a etapa muda
    row.dataset.step = String(idx);
    row.querySelectorAll('.step').forEach((li, i) => {
      li.className = 'step ' + (i < idx ? 'done' : i === idx ? 'current' : 'todo');
      li.querySelector('.step-mark').innerHTML = i < idx ? ICON.check : '';
    });
    row.querySelector('[role="status"]').textContent = 'Etapa ' + (idx + 1) + ' de ' + cfg.etapas.length + ': ' + cfg.etapas[idx][0];
  }

  function actionButton(icon, label, fn) {
    const b = document.createElement('button');
    b.className = 'act';
    b.innerHTML = icon + '<span></span>';
    b.querySelector('span').textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  // ---- Sugestões ----
  function pick(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  }
  function renderChips() {
    const c = active();
    el.chips.innerHTML = '';
    if (!c || !c.messages.length) return;
    const lastUser = [...c.messages].reverse().find(m => m.role === 'user');
    const lastReply = [...c.messages].reverse().find(m => m.role === 'assistant');
    const text = ' ' + (lastUser ? lastUser.text.toLowerCase() : '') + ' ';
    let pool = [];
    (ctx.domainKeywords || []).forEach(g => { if (g.palavrasChave.some(k => text.includes(k))) pool.push(...g.suggestions); });
    pool = pool.concat(pick(ctx.followUpSuggestions || [], 3));
    const seen = new Set(c.messages.filter(m => m.role === 'user').map(m => m.text.trim().toLowerCase()));

    // Sugestões personalizadas pelo servidor (histórico do usuário) vêm primeiro, em destaque
    const personal = [];
    ((lastReply && !lastReply.error && lastReply.sugestoes) || []).forEach(s => {
      const k = s.trim().toLowerCase();
      if (k && !seen.has(k) && personal.length < 3) { seen.add(k); personal.push(s.trim()); }
    });
    if (personal.length) {
      const group = document.createElement('div');
      group.className = 'chip-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-labelledby', 'chips-personal-label');
      group.innerHTML = '<span class="chips-label" id="chips-personal-label">' + ICON.sparkle + 'Sugestões para você</span>';
      personal.forEach(s => group.appendChild(chip(s, 'chip chip-personal')));
      el.chips.appendChild(group);
    }
    const contextual = [...new Set(pool)].filter(s => !seen.has(s.toLowerCase())).slice(0, personal.length ? 3 : 4);
    if (personal.length && contextual.length) {
      const sep = document.createElement('span');
      sep.className = 'chips-sep';
      sep.setAttribute('aria-hidden', 'true');
      el.chips.appendChild(sep);
    }
    contextual.forEach(s => el.chips.appendChild(chip(s, 'chip')));
  }
  function chip(s, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = s;
    b.disabled = !!sending;
    b.addEventListener('click', () => sendMessage(s));
    return b;
  }

  // ---- Envio ----
  function detectMode(text) {
    if (REPORT_RE.test(text) || (REPORT_EDIT_RE.test(text) && REPORT_EDIT_TARGET_RE.test(text) && /relat|pdf/i.test(text))) return 'pdf';
    if (BI_RE.test(text)) return 'bi';
    return '';
  }

  async function sendMessage(raw) {
    const text = String(raw || '').trim();
    if (!text || sending) return;
    let c = active();
    if (!c) c = newConversation();
    const mode = detectMode(text);
    c.messages.push({ id: uid(), role: 'user', text, time: Date.now() });
    if (c.messages.length === 1) c.title = text.length > 60 ? text.slice(0, 57) + '...' : text;
    c.updatedAt = Date.now();
    el.input.value = '';
    autoresize();
    const controller = new AbortController();
    sending = { controller, convId: c.id, mode, startedAt: Date.now() };
    updateComposer();
    persist();
    renderHistory();
    renderMessages();
    clearInterval(progressTimer);
    progressTimer = setInterval(() => updateProgress(), 500);

    const reply = { id: uid(), role: 'assistant', time: Date.now() };
    try {
      const resp = await callAgent(text, c.sessionId, mode, controller, buildHistorico(c));
      Object.assign(reply, toReply(resp, reply.id));
    } catch (e) {
      const aborted = e && e.name === 'AbortError' && !controller.timedOut;
      reply.error = !aborted;
      reply.text = aborted ? 'Resposta interrompida.' : (e && e.message) || 'Não foi possível processar sua solicitação agora.';
      reply.retryText = text;
    } finally {
      reply.time = Date.now();
      c.messages.push(reply);
      c.updatedAt = Date.now();
      clearInterval(progressTimer);
      progressTimer = null;
      sending = null;
      updateComposer();
      persist();
      renderHistory();
      if (state.activeId === c.id) renderMessages();
      el.input.focus();
    }
  }

  function retry(conv, msg) {
    const idx = conv.messages.indexOf(msg);
    if (idx > 0 && conv.messages[idx - 1].role === 'user') conv.messages.splice(idx - 1, 2);
    else conv.messages.splice(idx, 1);
    persist();
    sendMessage(msg.retryText);
  }

  // Conversa até aqui, como o usuário viu (tabelas viram linhas "| a | b |"), para relatórios "da conversa"
  const HISTORY_MAX_MSGS = 16;
  const HISTORY_MAX_CHARS = 20000;
  function buildHistorico(conv) {
    const msgs = conv.messages.slice(0, -1).filter(m => !m.error); // a última é a pergunta atual
    const out = [];
    let total = 0;
    for (let i = msgs.length - 1; i >= 0 && out.length < HISTORY_MAX_MSGS; i--) {
      const m = msgs[i];
      const texto = (m.role === 'user' ? m.text : htmlToPlain(m.html || escapeHtml(m.text || ''))).trim();
      if (!texto) continue;
      total += texto.length;
      if (total > HISTORY_MAX_CHARS) break;
      out.unshift({ papel: m.role === 'user' ? 'usuario' : 'agente', texto });
    }
    return out;
  }
  function htmlToPlain(html) {
    const root = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    root.querySelectorAll('.mf-callout-attention').forEach(n => n.remove()); // avisos de tabela omitida
    root.querySelectorAll('table').forEach(t => {
      const rows = [...t.querySelectorAll('tr')].map(tr => '| ' + [...tr.children].map(td => td.textContent.trim()).join(' | ') + ' |');
      t.replaceWith(document.createTextNode('\n' + rows.join('\n') + '\n'));
    });
    root.querySelectorAll('p,h1,h2,h3,h4,li,div,br').forEach(n => n.after(document.createTextNode('\n')));
    return root.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  }

  async function callAgent(text, sessionId, mode, controller, historico) {
    const payload = {
      sigla: ctx.sigla, sistema: ctx.sigla, sistemaNome: ctx.sistemaNome, schema: ctx.schema,
      entidade: ctx.entidade, municipio: ctx.municipio, username: currentUser(),
      mensagem: text, sessionId, historico: historico || []
    };
    if (mode) payload.formatoSaida = mode;
    const url = ctx.endpoint + (ctx.endpoint.includes('?') ? '&' : '?') + 'sessionId=' + encodeURIComponent(sessionId);
    const timer = setTimeout(() => { controller.timedOut = true; controller.abort(); }, mode === 'pdf' ? PDF_TIMEOUT_MS : TEXT_TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      } catch (e) {
        if (controller.timedOut) throw new Error('Tempo esgotado ao contatar o agente. Tente novamente.');
        if (e.name === 'AbortError') throw e;
        throw new Error('Não foi possível conectar ao agente. Verifique sua conexão.');
      }
      if (!res.ok) throw new Error(res.status >= 500 ? 'O agente está indisponível no momento. Tente novamente em instantes.' : 'Não foi possível processar sua solicitação.');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
        return { pdfBytes: buf, text: res.headers.get('x-chat-message') || '' };
      }
      const raw = new TextDecoder().decode(buf).trim();
      try { return unwrap(JSON.parse(raw)); } catch (e) { return { text: raw }; }
    } finally {
      clearTimeout(timer);
    }
  }

  function unwrap(o) {
    if (Array.isArray(o)) return unwrap(o[0]);
    if (o && typeof o === 'object' && o.json) return unwrap(o.json);
    return o || {};
  }

  function toReply(resp, id) {
    const r = {};
    if (resp.pdfBytes) {
      pdfStore.set(id, resp.pdfBytes);
      r.pdf = true;
      r.pdfName = 'relatorio-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.pdf';
      r.text = resp.text || 'Pronto! Seu relatório em PDF foi gerado.';
      r.html = '<p>' + escapeHtml(r.text) + '</p>';
      return r;
    }
    const b64 = (resp.files && resp.files.pdfBase64) || resp.pdfBase64;
    if (b64) {
      pdfStore.set(id, base64ToBytes(b64));
      r.pdf = true;
      r.pdfName = 'relatorio.pdf';
    }
    const biUrl = (resp.links && resp.links.biUrl) || resp.biUrl;
    if (biUrl && /^https?:\/\//i.test(biUrl)) { r.biUrl = biUrl; r.biTitle = resp.titulo || 'Painel de BI'; }
    r.error = resp.error === true || resp.pdfError === true;
    r.text = String(resp.text || '').replace(/__CHART__[\s\S]*?__ENDCHART__/g, '').trim();
    const html = String(resp.html || '').replace(/__CHART__[\s\S]*?__ENDCHART__/g, '');
    // Contratos novos (opcionais): sugestões personalizadas e ação de 2ª via
    if (Array.isArray(resp.sugestoes)) {
      const s = resp.sugestoes.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 200)).slice(0, 3);
      if (s.length) r.sugestoes = s;
    }
    const acao = resp.acao;
    if (acao && typeof acao === 'object' && acao.tipo === 'segunda_via') {
      const mat = Number(acao.matricula);
      if (Number.isFinite(mat) && mat > 0) r.acao = { tipo: 'segunda_via', matricula: mat };
    }
    if (r.acao && !r.text && !html.trim()) r.text = 'Encontrei os boletos da matrícula ' + r.acao.matricula + '.';
    r.html = html.trim() ? sanitize(html) : markdownToHtml(r.text);
    if (!r.text && !html.trim() && !r.pdf && !r.biUrl) { r.error = true; r.text = 'O agente não retornou resposta. Reformule a pergunta.'; r.html = '<p>' + r.text + '</p>'; }
    return r;
  }

  // ---- HTML/markdown ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.body.firstChild;
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach(n => n.remove());
    root.querySelectorAll('*').forEach(n => {
      [...n.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc') n.removeAttribute(a.name);
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      });
      if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
    });
    root.querySelectorAll('table').forEach(t => {
      if (!t.parentElement.classList.contains('table-wrap')) {
        const w = doc.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.appendChild(t);
      }
      t.querySelectorAll('td').forEach(td => { if (/^\s*-?[\d.,]+%?\s*$/.test(td.textContent) || /^\s*R\$/.test(td.textContent)) td.classList.add('num'); });
    });
    // remove "#" literais que sobram em títulos
    root.querySelectorAll('h1,h2,h3,h4').forEach(h => { h.textContent = h.textContent.replace(/^[#\s]+/, ''); });
    return root.innerHTML;
  }

  function markdownToHtml(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = []; let i = 0; let list = null;
    const inline = s => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        closeList();
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
        const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      let m;
      if ((m = line.match(/^\s*(#{1,4})\s*#*\s*(.+)$/))) { closeList(); const lv = Math.min(3, m[1].length + 1); out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>'); }
      else if ((m = line.match(/^\s*[-*]\s+(.+)$/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.+)$/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
      else if (!line.trim()) closeList();
      else { closeList(); out.push('<p>' + inline(line) + '</p>'); }
      i++;
    }
    closeList();
    return sanitize(out.join(''));
  }

  // ---- Utilidades ----
  function base64ToBytes(b64) {
    const bin = atob(String(b64).replace(/^data:application\/pdf;base64,/i, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function downloadPdf(m) {
    const bytes = pdfStore.get(m.id);
    if (!bytes) return;
    downloadBytes(bytes, m.pdfName || 'relatorio.pdf');
  }
  function downloadBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const isPdf = b => b.length > 3 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

  // ---- 2ª via de boletos ----
  // Chamada genérica aos webhooks auxiliares, com mensagens amigáveis para 404 / rede / tempo.
  async function callService(url, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 45000);
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('O serviço demorou demais para responder. Tente novamente.');
      throw new Error('Não foi possível conectar ao serviço de 2ª via. Ele pode estar indisponível no momento ou sua conexão caiu.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) throw new Error('O serviço de 2ª via ainda não está disponível. Tente novamente mais tarde.');
    if (!res.ok) throw new Error(res.status >= 500 ? 'O serviço de 2ª via está indisponível no momento. Tente novamente em instantes.' : 'O serviço de 2ª via recusou a solicitação (erro ' + res.status + ').');
    return res;
  }
  async function readJson(res) {
    const raw = (await res.text()).trim();
    if (!raw) return {};
    try { return unwrap(JSON.parse(raw)); } catch (e) { throw new Error('O serviço de 2ª via devolveu uma resposta inválida.'); }
  }

  const svCache = new Map();   // msgId -> Promise<dados> (refeito ao reabrir a conversa)
  const svBusy = new Set();    // chaves de ações em andamento (evita clique duplo)
  const svStatus = new Map();  // chave do boleto -> texto de status (ex.: enviado por WhatsApp)
  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function fmtDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
  }
  function fmtRef(r) {
    const s = String(r || '');
    const iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return iso[2] + '/' + iso[1];
    const mm = s.match(/^(\d{1,2})\/(\d{4})$/);
    return mm ? mm[1].padStart(2, '0') + '/' + mm[2] : s;
  }
  function fmtEndereco(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    const linha = [e.logradouro || e.rua, e.numero].filter(Boolean).join(', ');
    return [linha, e.complemento, e.bairro, e.cidade || e.municipio].filter(Boolean).join(' · ');
  }
  function normalizeBoletos(d) {
    const boletos = (Array.isArray(d.boletos) ? d.boletos : []).map(b => ({
      boletoId: b.boletoId != null ? b.boletoId : b.id,
      referencias: (Array.isArray(b.referencias) ? b.referencias : b.referencia ? [b.referencia] : []).map(fmtRef),
      vencimento: b.vencimento || '',
      valor: Number(b.valor) || 0,
      situacao: b.situacao || 'Em aberto',
      diasAtraso: Number(b.diasAtraso) || 0,
      linhaDigitavel: b.linhaDigitavel ? String(b.linhaDigitavel) : '',
      temPix: !!b.temPix
    }));
    const total = d.totalEmAberto != null ? Number(d.totalEmAberto) : boletos.reduce((s, b) => s + b.valor, 0);
    return {
      matricula: d.matricula,
      nome: (d.cliente && d.cliente.nome) || '',
      endereco: fmtEndereco(d.endereco),
      boletos, total,
      sugestao: (d.sugestaoPagamento && d.sugestaoPagamento.texto) || ''
    };
  }
  function loadBoletos(m) {
    if (!svCache.has(m.id)) {
      const p = callService(ctx.boletosEndpoint, { schema: ctx.schema, matricula: m.acao.matricula, usuario: currentUser() })
        .then(readJson).then(normalizeBoletos);
      p.catch(() => svCache.delete(m.id)); // erro não fica em cache: "Tentar novamente" refaz a busca
      svCache.set(m.id, p);
    }
    return svCache.get(m.id);
  }

  function renderSegundaVia(m) {
    const mat = m.acao.matricula;
    const card = document.createElement('section');
    card.className = 'sv-card';
    card.setAttribute('aria-label', '2ª via de boletos da matrícula ' + mat);
    card.innerHTML = '<div class="sv-head"><div class="att-icon" aria-hidden="true">' + ICON.barcode + '</div>' +
      '<div class="sv-head-text"><strong>2ª via de boletos</strong><span></span></div>' +
      '<button type="button" class="icon-btn sv-refresh" aria-label="Atualizar boletos" title="Atualizar">' + ICON.refresh + '</button></div>' +
      '<div class="sv-body" aria-busy="true"><div class="sv-state"><span class="btn-spin" aria-hidden="true"></span>Buscando boletos da matrícula…</div></div>';
    card.querySelector('.sv-head-text span').textContent = 'Matrícula ' + mat;
    card.querySelector('.sv-refresh').addEventListener('click', () => { svCache.delete(m.id); card.replaceWith(renderSegundaVia(m)); });
    const body = card.querySelector('.sv-body');
    loadBoletos(m).then(d => {
      body.removeAttribute('aria-busy');
      fillSegundaVia(body, d, m);
    }, err => {
      body.removeAttribute('aria-busy');
      body.innerHTML = '<div class="sv-error" role="alert"><p></p><button type="button" class="btn-secondary">' + ICON.retry + 'Tentar novamente</button></div>';
      body.querySelector('p').textContent = (err && err.message) || 'Não foi possível consultar os boletos agora.';
      body.querySelector('button').addEventListener('click', () => card.replaceWith(renderSegundaVia(m)));
    });
    return card;
  }

  function fillSegundaVia(body, d, m) {
    body.innerHTML = '';
    if (d.nome || d.endereco) {
      const cli = document.createElement('div');
      cli.className = 'sv-client';
      cli.innerHTML = '<strong></strong><span></span>';
      cli.querySelector('strong').textContent = d.nome || 'Cliente não identificado';
      cli.querySelector('span').textContent = d.endereco;
      body.appendChild(cli);
    }
    if (!d.boletos.length) {
      const p = document.createElement('div');
      p.className = 'sv-state';
      p.textContent = 'Nenhum boleto em aberto para esta matrícula.';
      body.appendChild(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'sv-list';
    d.boletos.forEach(b => ul.appendChild(renderBoleto(b, d, m)));
    body.appendChild(ul);

    const total = document.createElement('div');
    total.className = 'sv-total';
    total.innerHTML = '<span>Total em aberto</span><strong></strong>';
    total.querySelector('strong').textContent = brl(d.total);
    body.appendChild(total);

    if (d.sugestao) {
      const tip = document.createElement('div');
      tip.className = 'sv-tip';
      tip.innerHTML = ICON.calendar + '<p></p>';
      tip.querySelector('p').textContent = d.sugestao;
      body.appendChild(tip);
    }
  }

  function renderBoleto(b, d, m) {
    const mat = m.acao.matricula;
    const ref = b.referencias.join(', ') || fmtRef(String(b.vencimento).slice(0, 7));
    const vencido = /vencid/i.test(b.situacao) || b.diasAtraso > 0;
    const li = document.createElement('li');
    li.className = 'sv-item';
    li.dataset.svKey = ctx.schema + ':' + mat + ':' + b.boletoId;
    li.innerHTML = '<div class="sv-item-head"><div class="sv-item-info"><span class="sv-ref"></span><span class="sv-venc"></span></div>' +
      '<div class="sv-item-val"><strong></strong><span class="sv-badges"><span class="sv-badge"></span></span></div></div>' +
      '<div class="sv-item-actions"></div><p class="sv-item-status" role="status"></p>';
    li.querySelector('.sv-ref').textContent = 'Ref. ' + ref;
    li.querySelector('.sv-venc').textContent = 'Vencimento ' + fmtDate(b.vencimento);
    li.querySelector('.sv-item-val strong').textContent = brl(b.valor);
    const badge = li.querySelector('.sv-badge');
    badge.className = 'sv-badge ' + (vencido ? 'sv-badge-late' : 'sv-badge-open');
    badge.textContent = vencido ? 'Vencido' + (b.diasAtraso ? ' · ' + b.diasAtraso + (b.diasAtraso === 1 ? ' dia' : ' dias') : '') : (b.situacao || 'Em aberto');
    if (b.temPix) {
      const pix = document.createElement('span');
      pix.className = 'sv-badge sv-badge-pix';
      pix.textContent = 'Pix';
      badge.after(pix);
    }
    const key = ctx.schema + ':' + mat + ':' + b.boletoId;
    li.querySelector('.sv-item-status').textContent = svStatus.get(key) || '';
    const desc = 'boleto ' + ref + ' de ' + brl(b.valor);
    const acts = li.querySelector('.sv-item-actions');

    acts.appendChild(svButton(ICON.download, 'Baixar 2ª via (PDF)', 'Gerando PDF…', 'pdf:' + key, 'Baixar 2ª via em PDF do ' + desc, async () => {
      const res = await callService(ctx.segundaViaEndpoint, { schema: ctx.schema, matricula: mat, boletoId: b.boletoId, usuario: currentUser() }, 90000);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!isPdf(bytes)) {
        let msg = '';
        try { const j = unwrap(JSON.parse(new TextDecoder().decode(bytes))); msg = j.mensagem || j.message || ''; } catch (e) { /* não é JSON */ }
        throw new Error(msg || 'O serviço não devolveu um PDF válido para este boleto.');
      }
      const mmaaaa = (b.referencias[0] || fmtRef(String(b.vencimento).slice(0, 7))).replace(/\D/g, '');
      downloadBytes(bytes, '2a-via-' + mat + '-' + (mmaaaa || b.boletoId) + '.pdf');
      toast('2ª via baixada');
    }));

    const copyBtn = svButton(ICON.copy, 'Copiar linha digitável', '', null, 'Copiar linha digitável do ' + desc, () => copyText(b.linhaDigitavel));
    if (!b.linhaDigitavel) { copyBtn.disabled = true; copyBtn.title = 'Linha digitável indisponível'; }
    acts.appendChild(copyBtn);

    acts.appendChild(svButton(ICON.whatsapp, 'Enviar por WhatsApp', '', null, 'Enviar por WhatsApp o ' + desc, (ev) => {
      openWhatsapp({ key, mat, boletoId: b.boletoId, resumo: 'Matrícula ' + mat + ' · ' + (d.nome ? d.nome + ' · ' : '') + 'Ref. ' + ref + ' · ' + brl(b.valor) }, ev.currentTarget);
    }));
    return li;
  }

  // Botão com estado de carregamento; a chave é global para sobreviver a re-renderizações.
  function svButton(icon, label, busyLabel, key, aria, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary';
    btn.setAttribute('aria-label', aria || label);
    if (key) btn.dataset.busyKey = key;
    btn.dataset.icon = icon; btn.dataset.label = label; btn.dataset.busyLabel = busyLabel || label;
    paintButton(btn, key && svBusy.has(key));
    btn.addEventListener('click', async ev => {
      if (!key) return fn(ev);
      if (svBusy.has(key)) return;
      svBusy.add(key); setBusyKey(key, true);
      try { await fn(ev); }
      catch (e) { toast((e && e.message) || 'Não foi possível concluir a ação.', 4500); }
      finally { svBusy.delete(key); setBusyKey(key, false); }
    });
    return btn;
  }
  function paintButton(btn, busy) {
    btn.disabled = !!busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.innerHTML = (busy ? '<span class="btn-spin" aria-hidden="true"></span>' : btn.dataset.icon) + '<span></span>';
    btn.lastChild.textContent = busy ? btn.dataset.busyLabel : btn.dataset.label;
  }
  function setBusyKey(key, busy) {
    document.querySelectorAll('[data-busy-key]').forEach(b => { if (b.dataset.busyKey === key) paintButton(b, busy); });
  }

  // ---- Modal do WhatsApp ----
  let wa = null; // { key, mat, boletoId, resumo, opener, sending }
  const phoneDigits = v => String(v || '').replace(/\D/g, '').slice(0, 11);
  function maskPhone(v) {
    const d = phoneDigits(v);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function validatePhone(d) {
    if (!d) return 'Informe o telefone com DDD.';
    if (d.length >= 2 && !/^[1-9][1-9]/.test(d)) return 'DDD inválido.';
    if (d.length >= 3 && d[2] !== '9') return 'Para WhatsApp, informe um celular (começa com 9 depois do DDD).';
    if (d.length < 11) return 'Número incompleto: informe o DDD e os 9 dígitos do celular.';
    return '';
  }
  function setWaError(msg) {
    el.waError.textContent = msg;
    el.waPhone.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function setWaSending(on) {
    wa.sending = on;
    el.waSubmit.disabled = on;
    el.waPhone.readOnly = on;
    el.waSubmit.innerHTML = on ? '<span class="btn-spin" aria-hidden="true"></span><span>Enviando…</span>' : '<span>Enviar pelo WhatsApp</span>';
  }
  function openWhatsapp(info, opener) {
    wa = Object.assign({ opener, sending: false }, info);
    el.waDesc.textContent = info.resumo;
    el.waPhone.value = '';
    setWaError('');
    el.waResult.textContent = ''; el.waResult.className = 'modal-result';
    setWaSending(false);
    el.waModal.classList.remove('hidden');
    el.app.inert = true;
    el.app.setAttribute('aria-hidden', 'true');
    el.waPhone.focus();
  }
  function closeWhatsapp() {
    if (!wa) return;
    const opener = wa.opener;
    el.waModal.classList.add('hidden');
    el.app.inert = false;
    el.app.removeAttribute('aria-hidden');
    wa = null;
    // o botão de origem pode ter sido recriado; volta o foco se ainda estiver na tela
    if (opener && document.body.contains(opener)) opener.focus(); else el.input.focus();
  }
  async function submitWhatsapp(e) {
    e.preventDefault();
    if (!wa || wa.sending) return;
    const d = phoneDigits(el.waPhone.value);
    const err = validatePhone(d);
    setWaError(err);
    if (err) { el.waPhone.focus(); return; }
    const cur = wa;
    setWaSending(true);
    el.waResult.textContent = ''; el.waResult.className = 'modal-result';
    try {
      const res = await callService(ctx.whatsappEndpoint, { schema: ctx.schema, matricula: cur.mat, boletoId: cur.boletoId, telefone: d, usuario: currentUser() }, 45000);
      const j = await readJson(res);
      if (j.ok !== true) throw new Error(j.mensagem || 'O envio não foi confirmado pelo serviço. Tente novamente.');
      const msg = j.mensagem || '2ª via enviada por WhatsApp.';
      svStatus.set(cur.key, 'Enviado por WhatsApp para ' + maskPhone(d) + ' às ' + fmtTime(Date.now()) + '.');
      document.querySelectorAll('.sv-item').forEach(li => {
        if (li.dataset.svKey === cur.key) li.querySelector('.sv-item-status').textContent = svStatus.get(cur.key);
      });
      if (wa === cur) closeWhatsapp();
      toast(msg, 3500);
    } catch (ex) {
      if (wa === cur) {
        setWaSending(false);
        el.waResult.className = 'modal-result err';
        el.waResult.textContent = (ex && ex.message) || 'Não foi possível enviar agora.';
      }
    }
  }
  function trapFocus(e) {
    if (!wa) return;
    if (e.key === 'Escape') { e.preventDefault(); closeWhatsapp(); return; }
    if (e.key !== 'Tab') return;
    const f = [...el.waModal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!el.waModal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copiado'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copiado'); } catch (err) { toast('Não foi possível copiar'); }
      ta.remove();
    }
  }
  let toastTimer;
  function toast(msg, ms) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 1800);
  }
  function scrollToBottom(smooth) {
    requestAnimationFrame(() => el.messages.scrollTo({ top: el.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
  }
  function autoresize() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
  }
  function updateComposer() {
    const busy = !!sending;
    el.send.disabled = busy ? false : !el.input.value.trim();
    el.send.classList.toggle('stop', busy);
    el.send.innerHTML = busy ? ICON.stop : ICON.send;
    el.send.setAttribute('aria-label', busy ? 'Interromper' : 'Enviar');
    const mode = busy ? sending.mode : detectMode(el.input.value);
    el.modeBadge.classList.toggle('hidden', !mode);
    el.modeBadge.textContent = mode === 'pdf' ? 'Relatório PDF' : mode === 'bi' ? 'Painel de BI' : '';
    el.chips.querySelectorAll('.chip').forEach(b => { b.disabled = busy; });
  }

  // ---- Ações de conversa ----
  function selectConversation(id) {
    svCache.clear(); // ao (re)abrir uma conversa, os boletos dos cartões de 2ª via são buscados de novo
    state.activeId = id;
    persist();
    renderHistory();
    renderMessages();
    closeSidebar();
  }
  function deleteConversation(id) {
    const c = state.conversations.find(x => x.id === id);
    if (!c || !confirm('Excluir a conversa "' + c.title + '"?')) return;
    state.conversations = state.conversations.filter(x => x.id !== id);
    if (state.activeId === id) state.activeId = null;
    persist();
    renderHistory();
    renderMessages();
  }
  function startNewChat() {
    const c = active();
    if (!c || c.messages.length) newConversation();
    renderHistory();
    renderMessages();
    closeSidebar();
    el.input.focus();
  }
  const closeSidebar = () => el.app.classList.remove('sidebar-open');

  // ---- Eventos ----
  el.composer.addEventListener('submit', e => {
    e.preventDefault();
    if (sending) { sending.controller.abort(); return; }
    sendMessage(el.input.value);
  });
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!sending) sendMessage(el.input.value); }
  });
  el.input.addEventListener('input', () => { autoresize(); updateComposer(); });
  el.newChat.addEventListener('click', startNewChat);
  el.search.addEventListener('input', () => { state.search = el.search.value; renderHistory(); });
  el.sessionId.addEventListener('click', () => { const c = active(); if (c) copyText(c.sessionId); });
  el.menuBtn.addEventListener('click', () => el.app.classList.add('sidebar-open'));
  el.sidebarClose.addEventListener('click', closeSidebar);
  el.backdrop.addEventListener('click', closeSidebar);
  el.waForm.addEventListener('submit', submitWhatsapp);
  el.waPhone.addEventListener('input', () => {
    el.waPhone.value = maskPhone(el.waPhone.value);
    if (el.waError.textContent) setWaError(validatePhone(phoneDigits(el.waPhone.value)) && el.waError.textContent);
  });
  el.waCancel.addEventListener('click', closeWhatsapp);
  el.waClose.addEventListener('click', closeWhatsapp);
  el.waModal.addEventListener('mousedown', e => { if (e.target === el.waModal) closeWhatsapp(); });
  document.addEventListener('keydown', trapFocus);
  document.addEventListener('keydown', e => {
    if (wa) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); startNewChat(); }
  });

  // ---- Início ----
  el.brandTitle.textContent = ctx.title || 'Agente MGF';
  // Evita repetir a sigla quando a entidade já começa com ela ("SAAE - Água e Esgoto" + "SAAE São João...")
  const sigla = String(ctx.sistemaNome || '').match(/^(\S+)\s*-\s*(.+)$/);
  const sistemaLabel = sigla && String(ctx.entidade || '').startsWith(sigla[1]) ? sigla[2] : ctx.sistemaNome;
  el.systemName.textContent = sistemaLabel + (ctx.entidade ? ' · ' + ctx.entidade : '');
  document.title = ctx.title || 'Agente MGF';
  if (!active() || active().messages.length) {
    const empty = state.conversations.find(c => !c.messages.length);
    if (empty) state.activeId = empty.id; else newConversation();
  }
  state.conversations = state.conversations.filter(c => c.messages.length || c.id === state.activeId);
  renderHistory();
  renderMessages();
  updateComposer();
  el.input.focus();
})();
