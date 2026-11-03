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
    waResult: $('wa-result'), waSubmit: $('wa-submit'), waCancel: $('wa-cancel'), waClose: $('wa-close'),
    acList: $('ac-list'), acStatus: $('ac-status')
  };

  // ---- Operador do iframe: ?token=<payload base64url>.<assinatura>, como o login do painel (src/human/auth.ts) ----
  // A tela só lê o payload para identificar; quem confere a assinatura é o webhook. Base64 sem assinatura só identifica.
  const OPERADOR_KEY = 'mgf-agente-operador';
  function lerTokenOperador(rawToken) {
    if (!rawToken) return null;
    try {
      const partes = rawToken.split('.');
      const b64 = partes[0].replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4;
      const bin = atob(pad ? b64 + '='.repeat(4 - pad) : b64);
      const json = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); // nomes com acento
      const op = limparOperador(JSON.parse(json));
      if (op && partes.length === 2 && partes[1]) op.token = rawToken;
      return op;
    } catch (e) { return null; }
  }
  function limparOperador(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nome = typeof raw.nome === 'string' ? raw.nome.trim().slice(0, 120) : '';
    const email = typeof raw.email === 'string' ? raw.email.trim().slice(0, 120) : '';
    const bruto = raw.id != null ? raw.id : raw.sub;
    const id = bruto != null ? String(bruto).trim().slice(0, 60) : '';
    if (!nome && !email && !id) return null;
    const exp = Number(raw.exp) || 0;
    if (exp && exp * 1000 < Date.now()) return null; // sessão vencida não identifica mais
    return { nome, email, id, exp, token: typeof raw.token === 'string' ? raw.token : '' };
  }
  function carregarOperador() {
    const doToken = lerTokenOperador(params.get('token'));
    try {
      if (doToken) { localStorage.setItem(OPERADOR_KEY, JSON.stringify(doToken)); return doToken; }
      return limparOperador(JSON.parse(localStorage.getItem(OPERADOR_KEY) || 'null'));
    } catch (e) { return doToken; }
  }
  const operador = carregarOperador();
  const identidadeOperador = () => (operador ? operador.email || operador.id || operador.nome : '');
  if (operador) ctx.usuario = identidadeOperador();
  // Sem sessão assinada a tela não abre: os webhooks recusariam tudo mesmo (quem decide é o servidor)
  if (ctx.exigirLogin !== false && !(operador && operador.token)) {
    const aviso = document.getElementById('acesso-bloqueado');
    if (aviso) aviso.classList.remove('hidden');
  }

  // ---- Identidade estável do usuário ----
  // ctx.usuario vem do token do iframe, de ?usuario= ou do postMessage; sem ele, usa um id anônimo persistente.
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
    if (operador) return identidadeOperador(); // o postMessage não troca a identidade do token
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
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6M20 3v5.6h-5.6"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>',
    track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 8v8M11 6h9M11 12h9M11 18h9"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><path d="m17 15 3 3-3 3"/></svg>'
  };

  // ---- Estado ----
  // Histórico separado por operador: no mesmo computador, um atendente não vê a conversa do outro
  const escopoOperador = operador ? ':' + identidadeOperador() : '';
  const storageKey = (ctx.storageKey || 'mgf-agente-iam') + escopoOperador + ':v1';
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
    if (m.acao && !m.error) { const card = renderAcao(m); if (card) body.appendChild(card); }

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
    const lastReply = [...c.messages].reverse().find(m => m.role === 'assistant');
    const seen = new Set(c.messages.filter(m => m.role === 'user').map(m => fold(m.text.trim())));

    // Sugestões personalizadas pelo servidor (histórico do usuário) vêm primeiro, em destaque
    const personal = [];
    ((lastReply && !lastReply.error && lastReply.sugestoes) || []).forEach(s => {
      const k = fold(s.trim());
      if (k && !seen.has(k) && personal.length < 3) { seen.add(k); personal.push(s.trim()); }
    });
    if (personal.length) el.chips.appendChild(chipGroup('chips-personal-label', ICON.sparkle + 'Sugestões para você', personal, 'chip chip-personal'));

    // Próximos passos ligados ao assunto da última resposta (2 a 3, sem repetir o que já foi perguntado)
    const next = nextSteps(c, seen);
    if (personal.length && next.list.length) {
      const sep = document.createElement('span');
      sep.className = 'chips-sep';
      sep.setAttribute('aria-hidden', 'true');
      el.chips.appendChild(sep);
    }
    if (next.byTopic) el.chips.appendChild(chipGroup('chips-next-label', ICON.arrow + 'Próximos passos', next.list, 'chip chip-next'));
    else next.list.forEach(s => el.chips.appendChild(chip(s, 'chip')));
  }
  function chipGroup(id, label, items, cls) {
    const group = document.createElement('div');
    group.className = 'chip-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', id);
    group.innerHTML = '<span class="chips-label" id="' + id + '">' + label + '</span>';
    items.forEach(s => group.appendChild(chip(s, cls)));
    return group;
  }

  // Assunto da conversa: pontua cada assunto do config pela pergunta (3), resposta (1) e cartão (5).
  function nextSteps(conv, seen) {
    const lastUser = [...conv.messages].reverse().find(m => m.role === 'user');
    const lastReply = [...conv.messages].reverse().find(m => m.role === 'assistant');
    const q = ' ' + fold(lastUser ? lastUser.text : '') + ' ';
    const replyOk = lastReply && !lastReply.error;
    const r = replyOk ? ' ' + fold(htmlToPlain(lastReply.html || escapeHtml(lastReply.text || '')).slice(0, 3000)) + ' ' : '';
    const acaoTipo = replyOk && lastReply.acao ? lastReply.acao.tipo : '';
    const ent = conversationEntities(conv);
    const ranked = (ctx.assuntos || []).map((a, i) => {
      let score = 0;
      (a.palavrasChave || []).forEach(k => { const f = fold(k); if (q.includes(f)) score += 3; else if (r.includes(f)) score += 1; });
      if (acaoTipo && (a.acoes || []).includes(acaoTipo)) score += 5;
      return { a, score, i };
    }).filter(x => x.score > 0).sort((x, y) => y.score - x.score || x.i - y.i);

    const out = [];
    const used = new Set(seen);
    const add = s => { const k = fold(s); if (!used.has(k) && out.length < 3) { used.add(k); out.push(s); } };
    ranked.slice(0, 2).forEach(({ a }, idx) => {
      (a.proximos || []).forEach(t => {
        if (idx > 0 && out.length >= 2) return; // o 2º assunto só completa até 2 sugestões
        const s = fillPlaceholders(t, ent);
        if (s) add(s);
      });
    });
    if (out.length >= 2) return { list: out, byTopic: true };
    // Sem assunto reconhecido: comportamento anterior (sugestões gerais)
    pick(ctx.followUpSuggestions || [], 4).forEach(add);
    return { list: out, byTopic: false };
  }
  function fillPlaceholders(t, ent) {
    let ok = true;
    const s = t.replace(/\{(\w+)\}/g, (_, k) => { if (ent[k]) return ent[k]; ok = false; return ''; });
    return ok ? s : '';
  }
  // Entidades citadas na conversa (a mais recente vence): matrícula, bairro, protocolo e ano.
  function conversationEntities(conv) {
    const ent = {};
    const msgs = [...conv.messages].reverse().slice(0, 8);
    for (const m of msgs) {
      if (m.error) continue;
      if (m.acao) {
        if (!ent.matricula && m.acao.matricula) ent.matricula = String(m.acao.matricula);
        if (!ent.protocolo && m.acao.protocolo) ent.protocolo = m.acao.protocolo;
        if (!ent.bairro && m.acao.filtros && m.acao.filtros.bairro) ent.bairro = m.acao.filtros.bairro;
      }
      if (!ent.protocolo && m.chamado && m.chamado.protocolo) ent.protocolo = m.chamado.protocolo;
      const text = m.role === 'user' ? m.text : htmlToPlain(m.html || escapeHtml(m.text || '')).slice(0, 3000);
      const found = extractEntities(text, m.role !== 'user'); // bairro só do que o usuário escreveu (ou da tabela)
      Object.keys(found).forEach(k => { if (!ent[k]) ent[k] = found[k]; });
      if (!ent.bairro && m.role === 'assistant' && m.html) {
        const b = firstColumnValue(m.html, 'bairro');
        if (b) ent.bairro = b;
      }
    }
    return ent;
  }
  // Primeira célula da coluna "Bairro" de uma tabela da resposta (ex.: dívida por bairro)
  function firstColumnValue(html, header) {
    const root = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    for (const t of root.querySelectorAll('table')) {
      const ths = [...t.querySelectorAll('thead th, tr:first-child th')];
      const idx = ths.findIndex(th => fold(th.textContent.trim()) === header);
      if (idx < 0) continue;
      const row = t.querySelector('tbody tr');
      const cell = row && row.children[idx];
      const v = cell && cell.textContent.trim();
      if (v && v.length <= 40 && !/^\d+$/.test(v)) return v;
    }
    return '';
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
    acClose();
    rememberQuestion(text);
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
      tokenOperador: operador && operador.token ? operador.token : undefined,
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
    const parsed = acao && typeof acao === 'object' ? parseAcao(acao) : null;
    if (parsed) r.acao = parsed;
    if (r.acao && !r.text && !html.trim()) r.text = ACAO_TEXTO_PADRAO[r.acao.tipo](r.acao);
    r.html = html.trim() ? sanitize(html) : markdownToHtml(r.text);
    if (!r.text && !html.trim() && !r.pdf && !r.biUrl) { r.error = true; r.text = 'O agente não retornou resposta. Reformule a pergunta.'; r.html = '<p>' + r.text + '</p>'; }
    return r;
  }

  // Contrato das ações (guardadas na mensagem para recriar o cartão ao reabrir a conversa)
  const posInt = v => { const n = Number(v); return Number.isFinite(n) && n > 0 && Math.floor(n) === n ? n : null; };
  const cleanStr = (v, max) => (typeof v === 'string' || typeof v === 'number') ? String(v).trim().slice(0, max) : '';
  function parseAcao(a) {
    if (a.tipo === 'segunda_via') {
      const mat = posInt(a.matricula);
      return mat ? { tipo: 'segunda_via', matricula: mat } : null;
    }
    if (a.tipo === 'rota_os') {
      const f = a.filtros && typeof a.filtros === 'object' ? a.filtros : {};
      return { tipo: 'rota_os', filtros: { tipo: cleanStr(f.tipo, 60), bairro: cleanStr(f.bairro, 60) } };
    }
    if (a.tipo === 'chamado_abrir') return { tipo: 'chamado_abrir', matricula: posInt(a.matricula), tipoChamado: cleanStr(a.tipoChamado, 40) };
    if (a.tipo === 'chamado_consultar') return { tipo: 'chamado_consultar', protocolo: cleanStr(a.protocolo, 40), matricula: posInt(a.matricula) };
    return null;
  }
  const ACAO_TEXTO_PADRAO = {
    segunda_via: a => 'Encontrei os boletos da matrícula ' + a.matricula + '.',
    rota_os: () => 'Montei uma rota sugerida para a equipe de campo com as ordens de serviço pendentes.',
    chamado_abrir: () => 'Preencha os dados abaixo para registrar o chamado.',
    chamado_consultar: a => 'Este é o acompanhamento ' + (a.protocolo ? 'do chamado ' + a.protocolo : a.matricula ? 'dos chamados da matrícula ' + a.matricula : 'dos chamados') + '.'
  };

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
  async function callService(url, body, timeoutMs, nome) {
    nome = nome || 'serviço de 2ª via';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 45000);
    let res;
    try {
      const comToken = { ...body, tokenOperador: operador && operador.token ? operador.token : undefined };
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(comToken), signal: controller.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('O serviço demorou demais para responder. Tente novamente.');
      throw new Error('Não foi possível conectar ao ' + nome + '. Ele pode estar indisponível no momento ou sua conexão caiu.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) throw new Error('O ' + nome + ' ainda não está disponível. Tente novamente mais tarde.');
    if (!res.ok) throw new Error(res.status >= 500 ? 'O ' + nome + ' está indisponível no momento. Tente novamente em instantes.' : 'O ' + nome + ' recusou a solicitação (erro ' + res.status + ').');
    return res;
  }
  async function readJson(res, nome) {
    const raw = (await res.text()).trim();
    if (!raw) return {};
    try { return unwrap(JSON.parse(raw)); } catch (e) { throw new Error('O ' + (typeof nome === 'string' ? nome : 'serviço de 2ª via') + ' devolveu uma resposta inválida.'); }
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

  // ---- Cartões de campo e atendimento: rota de OS, abrir chamado e acompanhamento ----
  // Mesmo modelo da 2ª via: a ação fica guardada na mensagem, os dados são buscados ao exibir
  // (svCache por mensagem, refeito ao reabrir a conversa) e erros mostram "Tentar novamente".
  function renderAcao(m) {
    let card = null;
    if (m.acao.tipo === 'segunda_via') card = renderSegundaVia(m);
    else if (m.acao.tipo === 'rota_os') card = renderRotaOs(m);
    else if (m.acao.tipo === 'chamado_abrir') card = renderChamadoAbrir(m);
    else if (m.acao.tipo === 'chamado_consultar') card = renderChamadoConsultar(m);
    if (card) card.dataset.cardMsg = m.id;
    return card;
  }
  // Recria o cartão de uma mensagem que está na tela (ex.: quando um envio termina)
  function rerenderCard(m) {
    let novo = null;
    document.querySelectorAll('[data-card-msg]').forEach(n => {
      if (n.dataset.cardMsg !== m.id) return;
      novo = renderAcao(m);
      n.replaceWith(novo);
    });
    return novo;
  }
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function cardShell(icon, title, sub, aria) {
    const card = node('section', 'sv-card');
    card.setAttribute('aria-label', aria);
    card.innerHTML = '<div class="sv-head"><div class="att-icon" aria-hidden="true">' + icon + '</div>' +
      '<div class="sv-head-text"><strong></strong><span></span></div></div><div class="sv-body"></div>';
    card.querySelector('.sv-head-text strong').textContent = title;
    card.querySelector('.sv-head-text span').textContent = sub;
    return { card, head: card.querySelector('.sv-head'), body: card.querySelector('.sv-body') };
  }
  function cardLoading(box, text) {
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = '<div class="sv-state"><span class="btn-spin" aria-hidden="true"></span><span></span></div>';
    box.querySelector('.sv-state span:last-child').textContent = text;
  }
  function cardError(box, err, fallback, onRetry) {
    box.removeAttribute('aria-busy');
    box.innerHTML = '<div class="sv-error" role="alert"><p></p><button type="button" class="btn-secondary">' + ICON.retry + 'Tentar novamente</button></div>';
    box.querySelector('p').textContent = (err && err.message) || fallback;
    box.querySelector('button').addEventListener('click', onRetry);
  }
  // Consulta com cache por chave; erro não fica em cache ("Tentar novamente" refaz a chamada)
  function loadService(key, url, payload, nome, timeoutMs) {
    if (!svCache.has(key)) {
      const p = callService(url, payload, timeoutMs || 45000, nome)
        .then(res => readJson(res, nome))
        .then(j => {
          if (j.ok === false) throw new Error(j.mensagem || j.message || 'O ' + nome + ' não conseguiu concluir a consulta.');
          return j;
        });
      p.catch(() => svCache.delete(key));
      svCache.set(key, p);
    }
    return svCache.get(key);
  }
  function addRow(dl, label, value) {
    const r = node('div');
    r.appendChild(node('dt', null, label));
    r.appendChild(node('dd', null, value));
    dl.appendChild(r);
  }

  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  function fmtMin(min) {
    const n = Math.max(0, Math.round(Number(min) || 0));
    if (n < 60) return n + ' min';
    return Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + String(n % 60).padStart(2, '0') + ' min' : '');
  }
  // DD/MM/AAAA HH:MM (horário só quando vier); datas com fuso viram horário local
  function fmtDateTime(v) {
    const s = String(v == null ? '' : v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return s || '—';
    if (m[4] && /(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    return m[3] + '/' + m[2] + '/' + m[1] + (m[4] && !(m[4] === '00' && m[5] === '00') ? ' ' + m[4] + ':' + m[5] : '');
  }
  const fmtDia = v => (v ? fmtDate(v) || '—' : '—');

  function prioridade(v) {
    const f = fold(String(v || '')).trim();
    if (!f) return null;
    if (f.startsWith('alt')) return { rotulo: 'Alta', cls: 'sv-badge-late' };
    if (f.startsWith('med')) return { rotulo: 'Média', cls: 'sv-badge-mid' };
    if (f.startsWith('baix')) return { rotulo: 'Baixa', cls: 'sv-badge-open' };
    return { rotulo: String(v), cls: 'sv-badge-open' };
  }
  // Situações das ordens de serviço e status de chamados (códigos do sistema -> texto)
  const SITUACAO_OS = Object.assign({
    P: 'Pendente', PENDENTE: 'Pendente', A: 'Aberta', ABERTA: 'Aberta', E: 'Executada', EXECUTADA: 'Executada',
    B: 'Baixada', BAIXADA: 'Baixada', C: 'Cancelada', CANCELADA: 'Cancelada', N: 'Não executada', NAO_EXECUTADA: 'Não executada',
    PROGRAMADA: 'Programada', AGENDADA: 'Agendada', EM_ANDAMENTO: 'Em andamento', EM_EXECUCAO: 'Em execução'
  }, ctx.situacoesOs || {});
  const STATUS_CHAMADO = {
    ABERTO: 'Aberto', REGISTRADO: 'Registrado', RECEBIDO: 'Recebido', EM_ANALISE: 'Em análise', EM_ATENDIMENTO: 'Em atendimento',
    EM_ANDAMENTO: 'Em andamento', ENCAMINHADO: 'Encaminhado', AGUARDANDO: 'Aguardando', AGUARDANDO_CLIENTE: 'Aguardando o cliente',
    OS_GERADA: 'OS gerada', CONCLUIDO: 'Concluído', RESOLVIDO: 'Resolvido', FECHADO: 'Fechado', CANCELADO: 'Cancelado'
  };
  const tiposChamado = () => (ctx.tiposChamado && ctx.tiposChamado.length ? ctx.tiposChamado : [{ valor: 'outro', rotulo: 'Outro' }]);
  const TIPO_CHAMADO = {};
  tiposChamado().forEach(t => { TIPO_CHAMADO[fold(t.valor).toUpperCase().replace(/[\s-]+/g, '_')] = t.rotulo; });
  function traduz(v, map) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '—';
    const k = fold(raw).toUpperCase().replace(/[\s-]+/g, '_');
    if (map[k]) return map[k];
    const s = raw.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function statusClass(rotulo) {
    const f = fold(rotulo);
    if (/conclu|resolv|fechad|execut|baixad/.test(f) && !/nao exec/.test(f)) return 'sv-badge-done';
    if (/cancel|nao exec/.test(f)) return 'sv-badge-muted';
    if (/aguard|pendent/.test(f)) return 'sv-badge-mid';
    return 'sv-badge-open';
  }

  // ---- Cartão: rota sugerida para a equipe ----
  const rotaSub = f => (f.tipo || 'Todos os tipos') + ' · ' + (f.bairro ? 'Bairro ' + f.bairro : 'Todos os bairros');
  function renderRotaOs(m) {
    const f = m.acao.filtros || (m.acao.filtros = { tipo: '', bairro: '' });
    const { card, head, body } = cardShell(ICON.route, 'Rota sugerida para a equipe', rotaSub(f), 'Rota sugerida para a equipe de campo');
    const key = 'rota:' + m.id + ':' + (f.tipo || '') + '|' + (f.bairro || '');
    const refresh = node('button', 'icon-btn sv-refresh');
    refresh.type = 'button';
    refresh.title = 'Recalcular';
    refresh.setAttribute('aria-label', 'Recalcular rota');
    refresh.innerHTML = ICON.refresh;
    refresh.addEventListener('click', () => { svCache.delete(key); card.replaceWith(renderAcao(m)); });
    head.appendChild(refresh);
    body.appendChild(rotaFilters(m, f, card));
    const out = node('div', 'rt-out');
    body.appendChild(out);
    const load = () => {
      cardLoading(out, 'Calculando a melhor ordem de visita…');
      loadService(key, ctx.rotaOsEndpoint, {
        schema: ctx.schema, usuario: currentUser(), tipo: f.tipo || null, bairro: f.bairro || null, limite: ctx.rotaLimite || 15
      }, 'serviço de rotas', 60000).then(normalizeRota).then(d => {
        out.removeAttribute('aria-busy');
        fillRota(out, d, f, card);
      }, err => cardError(out, err, 'Não foi possível calcular a rota agora.', () => { svCache.delete(key); load(); }));
    };
    load();
    return card;
  }
  function rotaFilters(m, f, card) {
    const id = 'rt-' + m.id;
    const form = node('form', 'rt-filters');
    form.noValidate = true;
    form.setAttribute('aria-label', 'Filtros da rota');
    form.innerHTML =
      '<div class="rt-field"><label class="field-label" for="' + id + '-tipo">Tipo de serviço</label><select class="field-input" id="' + id + '-tipo" name="tipo"></select></div>' +
      '<div class="rt-field"><label class="field-label" for="' + id + '-bairro">Bairro</label><input class="field-input" id="' + id + '-bairro" name="bairro" type="text" maxlength="60" autocomplete="off" placeholder="Todos os bairros" list="' + id + '-bairros" /><datalist id="' + id + '-bairros"></datalist></div>' +
      '<button type="submit" class="btn-secondary rt-apply">' + ICON.search + '<span>Aplicar filtros</span></button>';
    const sel = form.elements.tipo;
    const tipos = (ctx.tiposServicoOs || []).slice();
    if (f.tipo && !tipos.some(t => fold(t) === fold(f.tipo))) tipos.unshift(f.tipo);
    [['', 'Todos os tipos']].concat(tipos.map(t => [t, t])).forEach(([v, l]) => {
      const o = node('option', null, l);
      o.value = v;
      if (fold(v) === fold(f.tipo || '')) o.selected = true;
      sel.appendChild(o);
    });
    form.elements.bairro.value = f.bairro || '';
    form.addEventListener('submit', e => {
      e.preventDefault();
      m.acao.filtros = { tipo: sel.value.trim(), bairro: form.elements.bairro.value.trim().slice(0, 60) };
      persist(); // os filtros voltam ao reabrir a conversa
      const novo = renderAcao(m);
      card.replaceWith(novo);
      novo.querySelector('.rt-apply').focus();
    });
    return form;
  }
  function normalizeRota(d) {
    const paradas = (Array.isArray(d.paradas) ? d.paradas : []).map((p, i) => ({
      ordem: Number(p.ordem) || i + 1,
      osId: p.osId != null ? String(p.osId) : '',
      matricula: p.matricula != null ? String(p.matricula) : '',
      tipo: p.tipo ? String(p.tipo) : '',
      endereco: fmtEndereco(p.endereco),
      bairro: p.bairro ? String(p.bairro) : '',
      diasPendente: p.diasPendente != null && p.diasPendente !== '' && isFinite(Number(p.diasPendente)) ? Number(p.diasPendente) : null,
      prioridade: prioridade(p.prioridade)
    })).sort((a, b) => a.ordem - b.ordem);
    const sc = d.semCoordenada;
    const semLista = Array.isArray(sc) ? sc.map(x => (x && typeof x === 'object')
      ? [x.osId != null ? 'OS ' + x.osId : '', x.matricula != null ? 'Matrícula ' + x.matricula : '', fmtEndereco(x.endereco), x.bairro || ''].filter(Boolean).join(' · ')
      : String(x)).filter(Boolean) : [];
    let criterio = d.criterio ? String(d.criterio).trim() : '';
    if (criterio && !/tr[aá]fego|tr[aâ]nsito/i.test(criterio)) criterio += ' A estimativa não considera o trânsito em tempo real.';
    const num = v => (v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
    return {
      paradas, semLista, semQtd: Array.isArray(sc) ? sc.length : Math.max(0, Number(sc) || 0),
      distanciaKm: num(d.distanciaKm), tempo: num(d.tempoEstimadoMin), criterio,
      linkMaps: typeof d.linkMaps === 'string' && /^https:\/\//i.test(d.linkMaps) ? d.linkMaps : '',
      // o Google Maps aceita até 10 pontos por link: rotas maiores vêm em trechos
      lotes: (Array.isArray(d.lotes) ? d.lotes : []).filter(l => l && typeof l.linkMaps === 'string' && /^https:\/\//i.test(l.linkMaps))
        .map(l => ({ de: Number(l.de) || null, ate: Number(l.ate) || null, linkMaps: l.linkMaps }))
    };
  }
  function fillRota(out, d, f, card) {
    out.innerHTML = '';
    const dl = card.querySelector('datalist');
    if (dl) {
      dl.innerHTML = '';
      [...new Set(d.paradas.map(p => p.bairro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(b => {
        const o = document.createElement('option'); o.value = b; dl.appendChild(o);
      });
    }
    if (!d.paradas.length) {
      out.appendChild(node('div', 'sv-state', 'Nenhuma ordem de serviço pendente com localização para esses filtros.'));
      if (d.semQtd) out.appendChild(rotaSemCoord(d));
      if (d.criterio) out.appendChild(rotaCriterio(d.criterio));
      return;
    }
    const resumo = node('dl', 'rt-summary');
    addRow(resumo, 'Paradas', String(d.paradas.length));
    addRow(resumo, 'Distância', d.distanciaKm != null ? nf1.format(d.distanciaKm) + ' km' : '—');
    addRow(resumo, 'Tempo estimado', d.tempo != null ? '≈ ' + fmtMin(d.tempo) : '—');
    out.appendChild(resumo);

    const ol = node('ol', 'rt-list');
    ol.setAttribute('aria-label', 'Paradas na ordem sugerida');
    d.paradas.forEach(p => {
      const li = node('li', 'rt-stop');
      li.innerHTML = '<span class="rt-num" aria-hidden="true"></span><div class="rt-info"><span class="sr-only"></span>' +
        '<strong class="rt-addr"></strong><span class="rt-meta"></span><span class="sv-badges rt-badges"></span></div>';
      li.querySelector('.rt-num').textContent = p.ordem;
      li.querySelector('.sr-only').textContent = 'Parada ' + p.ordem + ': ';
      li.querySelector('.rt-addr').textContent = (p.endereco || 'Endereço não informado') + (p.bairro ? ' — ' + p.bairro : '');
      li.querySelector('.rt-meta').textContent = [p.osId ? 'OS ' + p.osId : '', p.matricula ? 'Matrícula ' + p.matricula : '', p.tipo].filter(Boolean).join(' · ');
      const badges = li.querySelector('.rt-badges');
      if (p.prioridade) badges.appendChild(node('span', 'sv-badge ' + p.prioridade.cls, 'Prioridade ' + p.prioridade.rotulo));
      if (p.diasPendente != null) badges.appendChild(node('span', 'sv-badge sv-badge-muted', 'Pendente há ' + p.diasPendente + (p.diasPendente === 1 ? ' dia' : ' dias')));
      ol.appendChild(li);
    });
    out.appendChild(ol);
    if (d.semQtd) out.appendChild(rotaSemCoord(d));
    if (d.criterio) out.appendChild(rotaCriterio(d.criterio));

    const acts = node('div', 'rt-actions');
    if (d.lotes.length > 1) {
      d.lotes.forEach(l => {
        const a = node('a', 'btn-primary');
        const trecho = 'paradas ' + l.de + ' a ' + l.ate;
        a.href = l.linkMaps; a.target = '_blank'; a.rel = 'noopener';
        a.setAttribute('aria-label', 'Abrir no Google Maps as ' + trecho + ' (abre em nova aba)');
        a.innerHTML = ICON.map + '<span></span>';
        a.querySelector('span').textContent = 'Mapa: ' + trecho;
        acts.appendChild(a);
      });
    } else if (d.linkMaps) {
      const a = node('a', 'btn-primary');
      a.href = d.linkMaps; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', 'Abrir no Google Maps (abre em nova aba)');
      a.innerHTML = ICON.map + '<span>Abrir no Google Maps</span>';
      acts.appendChild(a);
    }
    acts.appendChild(svButton(ICON.copy, 'Copiar roteiro', '', null, 'Copiar roteiro da rota', () => copyText(rotaTexto(d, f))));
    out.appendChild(acts);
  }
  function rotaSemCoord(d) {
    const box = node('div', 'rt-warn');
    box.innerHTML = ICON.warn + '<div><p></p></div>';
    box.querySelector('p').textContent = d.semQtd === 1
      ? '1 imóvel está sem coordenada e ficou fora da rota. Programe essa visita à parte.'
      : d.semQtd + ' imóveis estão sem coordenada e ficaram fora da rota. Programe essas visitas à parte.';
    if (d.semLista.length) {
      const det = node('details');
      det.appendChild(node('summary', null, 'Ver imóveis sem coordenada'));
      const ul = node('ul');
      d.semLista.forEach(t => ul.appendChild(node('li', null, t)));
      det.appendChild(ul);
      box.lastChild.appendChild(det);
    }
    return box;
  }
  function rotaCriterio(t) {
    const box = node('div', 'sv-tip rt-crit');
    box.innerHTML = ICON.info + '<p><strong>Critério: </strong><span></span></p>';
    box.querySelector('span').textContent = t;
    return box;
  }
  function rotaTexto(d, f) {
    const L = ['Rota sugerida para a equipe — ' + (ctx.entidade || ctx.sistemaNome || '') + ' — ' + new Date().toLocaleDateString('pt-BR'), 'Filtros: ' + rotaSub(f)];
    L.push(d.paradas.length + ' paradas' + (d.distanciaKm != null ? ' · ' + nf1.format(d.distanciaKm) + ' km' : '') + (d.tempo != null ? ' · ≈ ' + fmtMin(d.tempo) : ''), '');
    d.paradas.forEach(p => L.push(p.ordem + '. ' + (p.endereco || 'Endereço não informado') + (p.bairro ? ' — ' + p.bairro : '') + ' | ' +
      [p.osId ? 'OS ' + p.osId : '', p.matricula ? 'Mat. ' + p.matricula : '', p.tipo, p.prioridade ? 'Prioridade ' + p.prioridade.rotulo : '',
        p.diasPendente != null ? 'pendente há ' + p.diasPendente + (p.diasPendente === 1 ? ' dia' : ' dias') : ''].filter(Boolean).join(' · ')));
    if (d.semQtd) { L.push('', 'Sem coordenada (fora da rota): ' + d.semQtd); d.semLista.forEach(t => L.push('- ' + t)); }
    if (d.criterio) L.push('', 'Critério: ' + d.criterio);
    if (d.lotes.length > 1) { L.push(''); d.lotes.forEach(l => L.push('Mapa (paradas ' + l.de + ' a ' + l.ate + '): ' + l.linkMaps)); }
    else if (d.linkMaps) L.push('', 'Mapa: ' + d.linkMaps);
    return L.join('\n');
  }

  // ---- Cartão-formulário: abrir chamado ----
  const chamadoDrafts = new Map(); // msgId -> rascunho (sobrevive às re-renderizações da conversa)
  const chamadoEnvios = new Map(); // msgId -> Promise do registro em andamento
  const saaeNome = () => ctx.entidade || 'SAAE';
  const rotuloTipo = v => (tiposChamado().find(t => t.valor === v) || { rotulo: traduz(v, TIPO_CHAMADO) }).rotulo;
  function tipoChamadoValor(v) {
    const f = fold(String(v || '')).replace(/[^a-z0-9]+/g, '');
    if (!f) return '';
    const t = tiposChamado().find(x => {
      const a = fold(x.valor).replace(/[^a-z0-9]+/g, ''), b = fold(x.rotulo).replace(/[^a-z0-9]+/g, '');
      return a === f || b === f || b.startsWith(f) || f.startsWith(a);
    });
    return t ? t.valor : 'outro';
  }
  function renderChamadoAbrir(m) {
    const { card, body } = cardShell(ICON.ticket, 'Abrir chamado', 'Registro para o atendimento do ' + saaeNome(), 'Abrir chamado para o atendimento do SAAE');
    if (m.chamado) { fillChamadoResultado(body, m.chamado); return card; }
    let d = chamadoDrafts.get(m.id);
    if (!d) {
      d = { matricula: m.acao.matricula ? String(m.acao.matricula) : '', tipo: tipoChamadoValor(m.acao.tipoChamado), descricao: '', contato: '', etapa: 'form', erro: '' };
      chamadoDrafts.set(m.id, d);
    }
    if (chamadoEnvios.has(m.id) || d.etapa === 'confirm') fillChamadoConfirm(body, m, d, card);
    else fillChamadoForm(body, m, d, card);
    return card;
  }
  function chField(id, name, label, control, help) {
    return '<div class="ch-field"><label class="field-label" for="' + id + '">' + label + '</label>' + control + (help || '') +
      '<p class="field-error" id="' + id + '-err" role="alert" data-err="' + name + '"></p></div>';
  }
  function fillChamadoForm(body, m, d, card) {
    const id = 'ch-' + m.id;
    body.innerHTML = '';
    const note = node('div', 'sv-tip ch-note');
    note.innerHTML = ICON.info + '<p></p>';
    note.querySelector('p').textContent = 'O chamado é registrado para o atendimento do ' + saaeNome() + ', que dá andamento à solicitação. O protocolo gerado permite acompanhar o chamado depois.';
    body.appendChild(note);
    const form = node('form', 'ch-form');
    form.noValidate = true;
    form.setAttribute('aria-label', 'Dados do chamado');
    form.innerHTML =
      chField(id + '-mat', 'matricula', 'Matrícula do imóvel',
        '<input class="field-input" id="' + id + '-mat" name="matricula" type="text" inputmode="numeric" maxlength="10" autocomplete="off" aria-required="true" aria-invalid="false" aria-describedby="' + id + '-mat-err" />') +
      chField(id + '-tipo', 'tipo', 'Tipo do chamado',
        '<select class="field-input" id="' + id + '-tipo" name="tipo" aria-required="true" aria-invalid="false" aria-describedby="' + id + '-tipo-err"><option value="">Selecione…</option></select>') +
      chField(id + '-desc', 'descricao', 'Descrição',
        '<textarea class="field-input ch-desc" id="' + id + '-desc" name="descricao" rows="4" maxlength="500" aria-required="true" aria-invalid="false" aria-describedby="' + id + '-desc-count ' + id + '-desc-err" placeholder="Descreva o problema: local exato, desde quando, pontos de referência…"></textarea>',
        '<p class="field-help ch-count" id="' + id + '-desc-count"></p>') +
      chField(id + '-cont', 'contato', 'Contato <span class="ch-opt">(opcional)</span>',
        '<input class="field-input" id="' + id + '-cont" name="contato" type="text" maxlength="80" autocomplete="off" placeholder="Telefone com DDD ou e-mail" aria-invalid="false" aria-describedby="' + id + '-cont-err" />') +
      '<div class="ch-actions"><button type="submit" class="btn-primary">' + ICON.arrow + '<span>Revisar e registrar</span></button></div>';
    const els = form.elements;
    tiposChamado().forEach(t => { const o = node('option', null, t.rotulo); o.value = t.valor; els.tipo.appendChild(o); });
    els.matricula.value = d.matricula;
    els.tipo.value = d.tipo;
    els.descricao.value = d.descricao;
    els.contato.value = d.contato;
    const count = form.querySelector('.ch-count');
    const updCount = () => { count.textContent = els.descricao.value.length + ' de 500 caracteres'; };
    updCount();
    const showErrors = (errs, only) => {
      ['matricula', 'tipo', 'descricao', 'contato'].forEach(k => {
        if (only && only !== k) return;
        form.querySelector('[data-err="' + k + '"]').textContent = errs[k] || '';
        els[k].setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
      });
    };
    const sync = () => {
      d.matricula = els.matricula.value; d.tipo = els.tipo.value; d.descricao = els.descricao.value; d.contato = els.contato.value;
    };
    form.addEventListener('input', e => {
      if (e.target === els.matricula) els.matricula.value = els.matricula.value.replace(/\D/g, '').slice(0, 10);
      if (e.target === els.descricao) updCount();
      sync();
      // erro já exibido some assim que o campo fica válido
      const k = e.target.name;
      if (k && e.target.getAttribute('aria-invalid') === 'true') showErrors(validateChamado(d), k);
    });
    form.addEventListener('change', sync);
    form.addEventListener('submit', e => {
      e.preventDefault();
      sync();
      const errs = validateChamado(d);
      showErrors(errs);
      const first = ['matricula', 'tipo', 'descricao', 'contato'].find(k => errs[k]);
      if (first) { els[first].focus(); return; }
      d.etapa = 'confirm';
      d.erro = '';
      fillChamadoConfirm(body, m, d, card);
      const t = body.querySelector('.ch-confirm-title');
      if (t) t.focus();
    });
    body.appendChild(form);
  }
  function validateChamado(d) {
    const e = {};
    const mat = String(d.matricula || '').trim();
    if (!mat) e.matricula = 'Informe a matrícula do imóvel.';
    else if (!/^\d{1,10}$/.test(mat) || Number(mat) <= 0) e.matricula = 'A matrícula deve ter apenas números.';
    if (!d.tipo) e.tipo = 'Selecione o tipo do chamado.';
    const desc = String(d.descricao || '').trim();
    if (!desc) e.descricao = 'Descreva o problema.';
    else if (desc.length < 10) e.descricao = 'Descreva com um pouco mais de detalhe (mínimo de 10 caracteres).';
    else if (desc.length > 500) e.descricao = 'A descrição pode ter no máximo 500 caracteres.';
    const c = String(d.contato || '').trim();
    if (c) {
      if (c.includes('@')) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) e.contato = 'E-mail inválido.';
      } else {
        let dig = c.replace(/\D/g, '');
        if (/^55\d{10,11}$/.test(dig)) dig = dig.slice(2);
        if (/[^\d\s()+.-]/.test(c) || dig.length < 10 || dig.length > 11) e.contato = 'Informe um telefone com DDD (10 ou 11 dígitos) ou um e-mail.';
      }
    }
    return e;
  }
  function fillChamadoConfirm(body, m, d, card) {
    const busy = chamadoEnvios.has(m.id);
    body.innerHTML = '';
    const box = node('div', 'ch-confirm');
    const title = node('p', 'ch-confirm-title', 'Confirme os dados do chamado');
    title.tabIndex = -1;
    box.appendChild(title);
    const dl = node('dl', 'ch-review');
    addRow(dl, 'Matrícula', d.matricula.trim());
    addRow(dl, 'Tipo', rotuloTipo(d.tipo));
    addRow(dl, 'Descrição', d.descricao.trim());
    addRow(dl, 'Contato', d.contato.trim() || 'Não informado');
    box.appendChild(dl);
    const warn = node('div', 'modal-warn');
    warn.innerHTML = ICON.warn + '<span></span>';
    warn.querySelector('span').textContent = 'O chamado será registrado para o atendimento do ' + saaeNome() + '. Confira os dados com o solicitante antes de confirmar.';
    box.appendChild(warn);
    const result = node('p', 'modal-result err');
    result.setAttribute('role', 'alert');
    result.textContent = busy ? '' : d.erro || '';
    box.appendChild(result);
    const acts = node('div', 'ch-actions');
    const back = node('button', 'btn-secondary', 'Voltar e editar');
    back.type = 'button';
    back.disabled = busy;
    back.addEventListener('click', () => {
      d.etapa = 'form'; d.erro = '';
      fillChamadoForm(body, m, d, card);
      const f = body.querySelector('textarea');
      if (f) f.focus();
    });
    const ok = node('button', 'btn-primary ch-confirm-btn');
    ok.type = 'button';
    ok.disabled = busy;
    ok.setAttribute('aria-busy', busy ? 'true' : 'false');
    ok.innerHTML = busy ? '<span class="btn-spin" aria-hidden="true"></span><span>Registrando…</span>'
      : ICON.check + '<span>' + (d.erro ? 'Tentar novamente' : 'Confirmar e registrar') + '</span>';
    ok.addEventListener('click', () => enviarChamado(m, d));
    acts.appendChild(back);
    acts.appendChild(ok);
    box.appendChild(acts);
    body.appendChild(box);
  }
  function enviarChamado(m, d) {
    if (chamadoEnvios.has(m.id) || m.chamado) return;
    const nome = 'serviço de chamados';
    const p = callService(ctx.chamadoAbrirEndpoint, {
      schema: ctx.schema, usuario: currentUser(), matricula: Number(d.matricula), tipo: d.tipo,
      descricao: d.descricao.trim(), contato: d.contato.trim() || null
    }, 45000, nome).then(res => readJson(res, nome)).then(j => {
      if (j.ok !== true || j.protocolo == null || j.protocolo === '') throw new Error(j.mensagem || 'O registro do chamado não foi confirmado pelo serviço. Tente novamente.');
      return j;
    });
    chamadoEnvios.set(m.id, p);
    rerenderCard(m);
    p.then(j => {
      m.chamado = {
        protocolo: String(j.protocolo), status: j.status ? String(j.status) : '', prioridade: j.prioridade ? String(j.prioridade) : '',
        prazoEstimado: j.prazoEstimado ? String(j.prazoEstimado) : '', mensagem: j.mensagem ? String(j.mensagem) : '',
        matricula: Number(d.matricula), tipo: d.tipo, registradoEm: Date.now()
      };
      chamadoDrafts.delete(m.id);
      persist(); // o protocolo fica salvo: ao reabrir a conversa o cartão mostra o resultado, não o formulário
      toast('Chamado registrado · protocolo ' + m.chamado.protocolo, 3500);
    }, err => {
      d.erro = (err && err.message) || 'Não foi possível registrar o chamado agora.';
    }).then(() => {
      chamadoEnvios.delete(m.id);
      const novo = rerenderCard(m);
      if (novo) {
        const alvo = novo.querySelector(m.chamado ? '.ch-proto' : '.ch-confirm-btn');
        if (alvo) alvo.focus();
      }
      if (m.chamado) renderChips();
    });
  }
  function fillChamadoResultado(body, r) {
    body.innerHTML = '';
    const proto = node('div', 'ch-proto');
    proto.tabIndex = -1;
    proto.innerHTML = '<div class="ch-proto-text"><span class="ch-proto-label">Protocolo</span><strong class="ch-proto-value"></strong></div>';
    proto.querySelector('.ch-proto-value').textContent = r.protocolo;
    proto.setAttribute('aria-label', 'Chamado registrado. Protocolo ' + r.protocolo);
    proto.appendChild(svButton(ICON.copy, 'Copiar protocolo', '', null, 'Copiar protocolo ' + r.protocolo, () => copyText(r.protocolo)));
    body.appendChild(proto);
    const dl = node('dl', 'ch-review ch-review-grid');
    addRow(dl, 'Status', traduz(r.status || 'aberto', STATUS_CHAMADO));
    if (r.prioridade) addRow(dl, 'Prioridade', (prioridade(r.prioridade) || {}).rotulo || r.prioridade);
    if (r.prazoEstimado) addRow(dl, 'Prazo estimado', /^\d{4}-\d{2}-\d{2}/.test(r.prazoEstimado) ? fmtDateTime(r.prazoEstimado) : r.prazoEstimado);
    addRow(dl, 'Matrícula', String(r.matricula));
    addRow(dl, 'Tipo', rotuloTipo(r.tipo));
    body.appendChild(dl);
    if (r.mensagem) body.appendChild(node('p', 'ch-msg', r.mensagem));
    const note = node('div', 'sv-tip');
    note.innerHTML = ICON.info + '<p></p>';
    note.querySelector('p').textContent = 'Chamado registrado para o atendimento do ' + saaeNome() + ' em ' + new Date(r.registradoEm || Date.now()).toLocaleDateString('pt-BR') + ' às ' + fmtTime(r.registradoEm || Date.now()) + '. Informe o protocolo ao solicitante.';
    body.appendChild(note);
    const acts = node('div', 'ch-actions');
    const follow = node('button', 'btn-secondary');
    follow.type = 'button';
    follow.innerHTML = ICON.track + '<span>Acompanhar este chamado</span>';
    follow.addEventListener('click', () => sendMessage('acompanhar o chamado protocolo ' + r.protocolo));
    acts.appendChild(follow);
    body.appendChild(acts);
  }

  // ---- Cartão: acompanhamento de chamados e ordens de serviço ----
  function renderChamadoConsultar(m) {
    const a = m.acao;
    const sub = a.protocolo ? 'Protocolo ' + a.protocolo : a.matricula ? 'Matrícula ' + a.matricula : 'Chamados recentes';
    const { card, head, body } = cardShell(ICON.track, 'Acompanhamento', sub, 'Acompanhamento de chamados: ' + sub);
    const key = 'consulta:' + m.id;
    const btn = node('button', 'btn-secondary ch-refresh');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Atualizar acompanhamento');
    btn.innerHTML = ICON.refresh + '<span>Atualizar</span>';
    btn.addEventListener('click', () => {
      svCache.delete(key);
      const novo = renderAcao(m);
      card.replaceWith(novo);
      novo.querySelector('.ch-refresh').focus();
    });
    head.appendChild(btn);
    const load = () => {
      cardLoading(body, 'Consultando chamados e ordens de serviço…');
      loadService(key, ctx.chamadoConsultarEndpoint, {
        schema: ctx.schema, usuario: currentUser(), protocolo: a.protocolo || null, matricula: a.matricula || null
      }, 'serviço de chamados', 45000).then(normalizeConsulta).then(d => {
        body.removeAttribute('aria-busy');
        fillConsulta(body, d);
      }, err => cardError(body, err, 'Não foi possível consultar os chamados agora.', () => { svCache.delete(key); load(); }));
    };
    load();
    return card;
  }
  function normalizeConsulta(d) {
    const iso = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || ''));
    const chamados = (Array.isArray(d.chamados) ? d.chamados : []).map(c => {
      let hist = (Array.isArray(c.historico) ? c.historico : []).map(h => ({
        status: traduz(h && h.status, STATUS_CHAMADO), em: (h && h.em) || '', observacao: h && h.observacao ? String(h.observacao) : ''
      }));
      if (hist.every(h => iso(h.em))) hist = hist.sort((x, y) => String(x.em).localeCompare(String(y.em))); // ordem cronológica
      return {
        protocolo: c.protocolo != null ? String(c.protocolo) : '', matricula: c.matricula != null ? String(c.matricula) : '',
        tipo: c.tipo ? traduz(c.tipo, TIPO_CHAMADO) : '', status: traduz(c.status, STATUS_CHAMADO), prioridade: prioridade(c.prioridade),
        abertoEm: c.abertoEm || '', atualizadoEm: c.atualizadoEm || '', historico: hist
      };
    });
    const ordens = (Array.isArray(d.ordensServico) ? d.ordensServico : []).map(o => ({
      osId: o.osId != null ? String(o.osId) : '—', tipo: o.tipo ? String(o.tipo) : '—', situacao: traduz(o.situacao, SITUACAO_OS),
      emissao: fmtDia(o.emissao), execucao: fmtDia(o.execucao), baixa: fmtDia(o.baixa)
    }));
    return { chamados, ordens };
  }
  function fillConsulta(body, d) {
    body.innerHTML = '';
    const secCh = node('section', 'ch-sec');
    secCh.appendChild(node('h3', 'ch-sec-title', 'Chamados' + (d.chamados.length ? ' (' + d.chamados.length + ')' : '')));
    if (!d.chamados.length) secCh.appendChild(node('div', 'sv-state', 'Nenhum chamado encontrado.'));
    d.chamados.forEach(c => secCh.appendChild(renderChamadoItem(c)));
    body.appendChild(secCh);

    const secOs = node('section', 'ch-sec');
    secOs.appendChild(node('h3', 'ch-sec-title', 'Ordens de serviço no sistema' + (d.ordens.length ? ' (' + d.ordens.length + ')' : '')));
    if (!d.ordens.length) secOs.appendChild(node('div', 'sv-state', 'Nenhuma ordem de serviço encontrada.'));
    else {
      const wrap = node('div', 'table-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Ordens de serviço (role para o lado para ver todas as colunas)');
      const table = node('table', 'ch-table');
      table.innerHTML = '<thead><tr><th scope="col">OS</th><th scope="col">Tipo</th><th scope="col">Situação</th><th scope="col">Emissão</th><th scope="col">Execução</th><th scope="col">Baixa</th></tr></thead><tbody></tbody>';
      const tb = table.querySelector('tbody');
      d.ordens.forEach(o => {
        const tr = node('tr');
        tr.appendChild(node('td', 'num', o.osId));
        tr.appendChild(node('td', null, o.tipo));
        const td = node('td');
        td.appendChild(node('span', 'sv-badge ' + statusClass(o.situacao), o.situacao));
        tr.appendChild(td);
        [o.emissao, o.execucao, o.baixa].forEach(v => tr.appendChild(node('td', 'num', v)));
        tb.appendChild(tr);
      });
      wrap.appendChild(table);
      secOs.appendChild(wrap);
    }
    body.appendChild(secOs);
    body.appendChild(node('p', 'ch-updated', 'Consultado às ' + fmtTime(Date.now())));
  }
  function renderChamadoItem(c) {
    const art = node('article', 'ch-item');
    art.setAttribute('aria-label', 'Chamado ' + (c.protocolo || ''));
    art.innerHTML = '<div class="ch-item-head"><div class="ch-item-id"><strong></strong><span></span></div><span class="sv-badges"></span></div><p class="ch-dates"></p>';
    art.querySelector('.ch-item-id strong').textContent = c.protocolo ? 'Protocolo ' + c.protocolo : 'Chamado';
    art.querySelector('.ch-item-id span').textContent = [c.tipo, c.matricula ? 'Matrícula ' + c.matricula : ''].filter(Boolean).join(' · ');
    const badges = art.querySelector('.sv-badges');
    badges.appendChild(node('span', 'sv-badge ' + statusClass(c.status), c.status));
    if (c.prioridade) badges.appendChild(node('span', 'sv-badge ' + c.prioridade.cls, 'Prioridade ' + c.prioridade.rotulo));
    art.querySelector('.ch-dates').textContent = [c.abertoEm ? 'Aberto em ' + fmtDateTime(c.abertoEm) : '', c.atualizadoEm ? 'Atualizado em ' + fmtDateTime(c.atualizadoEm) : ''].filter(Boolean).join(' · ');
    if (c.historico.length) {
      const ol = node('ol', 'ch-timeline');
      ol.setAttribute('aria-label', 'Histórico do chamado');
      c.historico.forEach((h, i) => {
        const li = node('li', 'ch-tl' + (i === c.historico.length - 1 ? ' current' : ''));
        li.innerHTML = '<span class="ch-tl-dot" aria-hidden="true"></span><div class="ch-tl-body"><div class="ch-tl-head"><strong></strong><span></span></div></div>';
        li.querySelector('strong').textContent = h.status;
        li.querySelector('.ch-tl-head span').textContent = h.em ? fmtDateTime(h.em) : '';
        if (h.observacao) li.querySelector('.ch-tl-body').appendChild(node('p', null, h.observacao));
        ol.appendChild(li);
      });
      art.appendChild(ol);
    } else art.appendChild(node('p', 'ch-dates', 'Sem movimentações registradas.'));
    const form = renderMudarStatus(c);
    if (form) art.appendChild(form);
    return art;
  }

  // ---- Atendente muda o status do chamado (só com token assinado; o webhook confere a assinatura) ----
  // Mesmas transições do webhook mgf-chamado-atualizar, que continua sendo quem decide.
  const TRANSICOES = {
    'Aberto': ['Em análise', 'Encaminhado ao setor', 'Cancelado'],
    'Em análise': ['Encaminhado ao setor', 'Concluído', 'Cancelado'],
    'Encaminhado ao setor': ['Em análise', 'Concluído', 'Cancelado']
  };
  function renderMudarStatus(c) {
    const destinos = TRANSICOES[c.status];
    if (!operador || !operador.token || !ctx.chamadoAtualizarEndpoint || !c.protocolo || !destinos) return null;
    const det = node('details', 'ch-status');
    det.appendChild(node('summary', null, 'Mudar status'));
    const id = 'st-' + c.protocolo;
    const form = node('form', 'ch-status-form');
    form.noValidate = true;
    form.innerHTML =
      '<div class="ch-field"><label class="field-label" for="' + id + '-novo">Novo status</label><select class="field-input" id="' + id + '-novo" name="novo"></select></div>' +
      '<div class="ch-field"><label class="field-label" for="' + id + '-obs">Observação</label><textarea class="field-input" id="' + id + '-obs" name="obs" rows="2" maxlength="500" aria-describedby="' + id + '-err"></textarea></div>' +
      '<p class="field-error" id="' + id + '-err" role="alert"></p>' +
      '<div class="ch-actions"><button type="submit" class="btn-primary"><span>Salvar status</span></button></div>';
    destinos.forEach(s => { const o = node('option', null, s); o.value = s; form.elements.novo.appendChild(o); });
    const erro = form.querySelector('.field-error');
    const btn = form.querySelector('button');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const novo = form.elements.novo.value;
      const obs = form.elements.obs.value.trim();
      if ((novo === 'Concluído' || novo === 'Cancelado') && !obs) {
        erro.textContent = 'Informe a observação para ' + (novo === 'Concluído' ? 'concluir' : 'cancelar') + ' o chamado.';
        form.elements.obs.focus();
        return;
      }
      erro.textContent = '';
      btn.disabled = true;
      const nome = 'serviço de chamados';
      try {
        const res = await callService(ctx.chamadoAtualizarEndpoint, {
          schema: ctx.schema, usuario: currentUser(), protocolo: c.protocolo, status: novo, observacao: obs || null
        }, 45000, nome);
        const j = await readJson(res, nome);
        if (j.ok !== true) throw new Error(j.mensagem || 'A mudança de status não foi confirmada pelo serviço.');
        toast('Chamado ' + c.protocolo + ': ' + novo, 2600);
        const card = form.closest('.sv-card');
        const atualizar = card && card.querySelector('.ch-refresh');
        if (atualizar) atualizar.click();
      } catch (err) {
        erro.textContent = err.message || 'Não foi possível mudar o status. Tente novamente.';
        btn.disabled = false;
      }
    });
    det.appendChild(form);
    return det;
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

  // ---- Autocompletar do campo de pergunta (combobox ARIA) ----
  // Fontes, nesta ordem: perguntas já feitas pelo usuário (localStorage), catálogo do config e modelos com entidades.
  const AC_MIN = 3, AC_MAX = 6, AC_DEBOUNCE = 150;
  const ASKED_KEY = (ctx.storageKey || 'mgf-agente-iam') + escopoOperador + ':perguntas:v1';
  const ASKED_MAX = 100;
  const STOP = new Set(['a', 'o', 'e', 'as', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'por', 'para', 'pra', 'com', 'que', 'qual', 'quais', 'me', 'se', 'ao']);
  const SRC_LABEL = { recente: 'Recente', catalogo: 'Sugestão', modelo: 'Modelo' };
  const ac = { open: false, items: [], index: -1, timer: null, dismissed: null, announced: '' };

  // Minúsculas e sem acento, preservando o tamanho do texto (o índice serve para pôr o trecho em negrito)
  function fold(s) {
    const str = String(s == null ? '' : s);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === 'ª') { out += 'a'; continue; }
      if (ch === 'º' || ch === '°') { out += 'o'; continue; }
      const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      out += f.length === 1 ? f : (f.charAt(0) || ' ');
    }
    return out;
  }
  const CATALOGO = [...new Set([].concat(
    ...Object.values(ctx.catalogoPerguntas || {}),
    (ctx.welcomeSuggestions || []).map(s => s.texto),
    ctx.followUpSuggestions || []
  ).filter(x => typeof x === 'string' && x.trim()))];

  // Entidades digitadas ou citadas: matrícula, protocolo, bairro e ano
  const ENTIDADES = {
    matricula: /\bmatr[ií]cula\s*(?:n[º°o.]*\s*)?(\d{1,10})/i,
    protocolo: /\bprotocolo\s*(?:n[º°o.]*\s*)?([a-z0-9][\w./-]{2,30})/i,
    bairro: /\bbairro\s+([a-zà-ú0-9][a-zà-ú0-9' ]{0,40})/i,
    ano: /\b(20\d{2})\b/
  };
  const BAIRRO_CORTE = /\s+(?:com|e|em|por|para|que|nos|no|na|nas|desde|ultimos|últimos|neste|nesse|este|esse|ate|até)\b.*$/i;
  function extractEntities(text, semBairro) {
    const out = {};
    Object.keys(ENTIDADES).forEach(k => {
      if (k === 'bairro' && semBairro) return;
      const m = String(text || '').match(ENTIDADES[k]);
      if (!m) return;
      let v = m[1].trim();
      if (k === 'bairro') {
        if (/^(?:com|e|em|por|para|que|nos|no|na|nas|desde|ultimos|últimos)\b/i.test(v) || /^\d+$/.test(v)) return;
        v = v.replace(BAIRRO_CORTE, '').replace(/[\s']+$/, '').trim();
        if (!v) return;
      }
      if (k === 'protocolo' && !/\d/.test(v)) return; // "protocolo do chamado" não é um número de protocolo
      out[k] = v;
    });
    return out;
  }

  function loadAsked() {
    try {
      const a = JSON.parse(localStorage.getItem(ASKED_KEY) || 'null');
      if (Array.isArray(a)) return a.filter(x => x && typeof x.t === 'string' && x.t.trim()).slice(0, ASKED_MAX);
    } catch (e) { /* armazenamento indisponível */ }
    // Primeira vez: começa com as perguntas das conversas já salvas
    const map = new Map();
    state.conversations.forEach(c => c.messages.forEach(m => {
      if (m.role !== 'user' || !m.text) return;
      const t = m.text.trim();
      const k = fold(t);
      const ts = m.time || c.updatedAt || 0;
      const cur = map.get(k);
      if (cur) { cur.n++; cur.ts = Math.max(cur.ts, ts); } else map.set(k, { t, n: 1, ts });
    }));
    return [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, ASKED_MAX);
  }
  let asked = loadAsked();
  function rememberQuestion(raw) {
    const t = String(raw || '').trim();
    if (!t || t.length > 300) return;
    const k = fold(t);
    const prev = asked.find(x => fold(x.t) === k);
    asked = [{ t, n: prev ? prev.n + 1 : 1, ts: Date.now() }].concat(asked.filter(x => x !== prev)).slice(0, ASKED_MAX);
    try { localStorage.setItem(ASKED_KEY, JSON.stringify(asked)); } catch (e) { /* armazenamento indisponível */ }
  }

  const tokensOf = fq => fq.split(/[^a-z0-9]+/).filter(t => t && (t.length >= 2 || /\d/.test(t)) && !STOP.has(t));
  // Pontuação: começa com o texto > contém o texto (início de palavra) > contém > contém todas as palavras
  function matchScore(ft, fq, toks, numeroExato) {
    if (ft.startsWith(fq)) return 100;
    const i = ft.indexOf(fq);
    if (i >= 0 && !(numeroExato && /\d$/.test(fq) && /\d/.test(ft[i + fq.length] || ''))) return /[a-z0-9]/.test(ft[i - 1] || ' ') ? 60 : 80;
    if (!toks.length) return 0;
    for (const t of toks) {
      if (/^\d+$/.test(t) && numeroExato) { if (!new RegExp('(^|\\D)' + t + '(\\D|$)').test(ft)) return 0; }
      else if (!ft.includes(t)) return 0;
    }
    return 40 + toks.length;
  }
  function templateSuggestions(text, fq) {
    const ent = extractEntities(text);
    const out = [];
    Object.keys(ent).forEach(k => {
      const list = (ctx.modelosAutocompletar || []).filter(t => t.entidade === k).map((t, i) => ({
        text: t.modelo.replace('{valor}', ent[k]), i,
        hits: (t.chaves || []).filter(c => fq.includes(fold(c))).length
      }));
      const comChave = list.filter(x => x.hits > 0);
      // ano sozinho não define o assunto: só entra quando alguma palavra-chave combina
      (comChave.length || k === 'ano' ? comChave : list).forEach(x => out.push(x));
    });
    return out.sort((a, b) => b.hits - a.hits || a.i - b.i);
  }
  function buildSuggestions(text) {
    const q = String(text || '').trim();
    const fq = fold(q).replace(/\s+/g, ' ');
    if (fq.length < AC_MIN || q.includes('\n')) return [];
    const toks = tokensOf(fq);
    const out = [];
    const seen = new Set([fq]);
    const push = (t, src) => {
      const k = fold(t).trim();
      if (seen.has(k) || out.length >= AC_MAX) return;
      seen.add(k);
      out.push({ text: t, src });
    };
    asked.map((x, i) => ({ t: x.t, s: matchScore(fold(x.t), fq, toks, false), i }))
      .filter(o => o.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 3)
      .forEach(o => push(o.t, 'recente'));
    // No catálogo a matrícula 1234 é só um exemplo: troca pela matrícula digitada
    const mat = (q.match(ENTIDADES.matricula) || [])[1];
    CATALOGO.map((t, i) => {
      const txt = mat ? t.replace(/\b1234\b/g, mat) : t;
      return { t: txt, s: matchScore(fold(txt), fq, toks, true), i };
    }).filter(o => o.s > 0).sort((a, b) => b.s - a.s || a.i - b.i)
      .forEach(o => push(o.t, 'catalogo'));
    templateSuggestions(q, fq).forEach(o => push(o.text, 'modelo'));
    return out;
  }
  function highlight(text, q) {
    const t = String(text).normalize('NFC');
    const ft = fold(t);
    const fq = fold(String(q).normalize('NFC')).replace(/\s+/g, ' ').trim();
    const ranges = [];
    const i = fq ? ft.indexOf(fq) : -1;
    if (i >= 0) ranges.push([i, i + fq.length]);
    else tokensOf(fq).forEach(tk => {
      const m = new RegExp('(^|[^a-z0-9])' + tk).exec(ft);
      const s = m ? m.index + m[1].length : ft.indexOf(tk);
      if (s >= 0) ranges.push([s, s + tk.length]);
    });
    ranges.sort((a, b) => a[0] - b[0]);
    let html = '', pos = 0;
    ranges.forEach(([s, e]) => {
      s = Math.max(s, pos);
      if (e <= s) return;
      html += escapeHtml(t.slice(pos, s)) + '<strong>' + escapeHtml(t.slice(s, e)) + '</strong>';
      pos = e;
    });
    return html + escapeHtml(t.slice(pos));
  }

  function acAnnounce(msg) {
    if (ac.announced === msg) return;
    ac.announced = msg;
    el.acStatus.textContent = msg;
  }
  function acOpen(items, q) {
    if (!items.length) { acClose(); return; }
    ac.items = items;
    el.acList.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = 'ac-opt-' + i;
      li.className = 'ac-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.innerHTML = '<span class="ac-ico" aria-hidden="true">' + (it.src === 'recente' ? ICON.history : it.src === 'modelo' ? ICON.template : ICON.search) + '</span>' +
        '<span class="ac-text">' + highlight(it.text, q) + '</span><span class="ac-src">' + SRC_LABEL[it.src] + '</span>';
      // mousedown sem foco: o campo continua focado (o teclado do celular não fecha)
      li.addEventListener('mousedown', e => e.preventDefault());
      li.addEventListener('click', () => acAccept(i));
      li.addEventListener('mousemove', () => { if (ac.index !== i) acSetIndex(i, false); });
      el.acList.appendChild(li);
    });
    ac.open = true;
    ac.index = -1;
    el.acList.classList.remove('hidden');
    el.input.setAttribute('aria-expanded', 'true');
    el.input.removeAttribute('aria-activedescendant');
    acAnnounce(items.length + (items.length === 1 ? ' sugestão disponível' : ' sugestões disponíveis') + '. Use as setas para navegar.');
  }
  function acClose() {
    clearTimeout(ac.timer);
    if (!ac.open) return;
    ac.open = false;
    ac.items = [];
    ac.index = -1;
    el.acList.classList.add('hidden');
    el.acList.innerHTML = '';
    el.input.setAttribute('aria-expanded', 'false');
    el.input.removeAttribute('aria-activedescendant');
    ac.announced = '';
  }
  function acSetIndex(i, scroll) {
    ac.index = i;
    [...el.acList.children].forEach((li, j) => {
      li.classList.toggle('active', j === i);
      li.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (i >= 0) {
      el.input.setAttribute('aria-activedescendant', 'ac-opt-' + i);
      if (scroll) el.acList.children[i].scrollIntoView({ block: 'nearest' });
    } else el.input.removeAttribute('aria-activedescendant');
  }
  // As setas passam pelos itens e voltam ao texto digitado (índice -1)
  function acMove(delta) {
    const n = ac.items.length;
    if (!n) return;
    let i = ac.index + delta;
    if (i >= n) i = -1;
    else if (i < -1) i = n - 1;
    acSetIndex(i, true);
  }
  function acAccept(i) {
    const it = ac.items[i];
    if (!it) return;
    el.input.value = it.text;
    ac.dismissed = it.text; // não reabre a lista para o texto que acabou de ser aceito
    acClose();
    autoresize();
    updateComposer();
    el.input.focus();
    const n = el.input.value.length;
    el.input.setSelectionRange(n, n);
    acAnnounce('Sugestão aplicada. Pressione Enter para enviar.');
  }
  function acSchedule() {
    clearTimeout(ac.timer);
    const v = el.input.value;
    if (ac.dismissed !== null && v === ac.dismissed) return;
    ac.dismissed = null;
    if (fold(v.trim()).length < AC_MIN || v.includes('\n')) { acClose(); return; }
    ac.timer = setTimeout(() => {
      if (document.activeElement !== el.input) return;
      acOpen(buildSuggestions(el.input.value), el.input.value.trim());
    }, AC_DEBOUNCE);
  }
  function acKeydown(e) {
    if (e.isComposing) return false;
    if (ac.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acMove(e.key === 'ArrowDown' ? 1 : -1); return true; }
      if (e.key === 'Escape') { e.preventDefault(); ac.dismissed = el.input.value; acClose(); return true; }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && ac.index >= 0) { e.preventDefault(); acAccept(ac.index); return true; }
      if (e.key === 'Tab') acClose();
      return false;
    }
    if (e.key === 'ArrowDown' && !el.input.value.includes('\n') && fold(el.input.value.trim()).length >= AC_MIN) {
      const items = buildSuggestions(el.input.value);
      if (items.length) { e.preventDefault(); acOpen(items, el.input.value.trim()); acSetIndex(0, true); return true; }
    }
    return false;
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
    if (acKeydown(e)) return; // setas, Esc e Enter/Tab sobre uma sugestão selecionada
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); acClose(); if (!sending) sendMessage(el.input.value); }
  });
  el.input.addEventListener('input', () => { autoresize(); updateComposer(); acSchedule(); });
  el.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== el.input) acClose(); }, 120));
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
