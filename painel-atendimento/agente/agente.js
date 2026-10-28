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
    menuBtn: $('menu-btn'), sidebarClose: $('sidebar-close'), backdrop: $('backdrop'), toast: $('toast')
  };

  const ICON = {
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
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
    scrollToBottom(false);
  }

  function renderWelcome() {
    const w = document.createElement('div');
    w.className = 'welcome';
    w.innerHTML = '<div class="welcome-mark">' + ICON.spark + '</div><h1></h1><p></p><div class="cards"></div>';
    w.querySelector('h1').textContent = ctx.welcomeTitle || 'Olá!';
    w.querySelector('p').textContent = ctx.welcomeDescription || '';
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

  function renderMessage(m, conv) {
    const row = document.createElement('div');
    row.className = 'msg ' + m.role + (m.error ? ' error' : '');
    if (m.role === 'user') {
      row.innerHTML = '<div class="bubble"></div>';
      row.firstChild.textContent = m.text;
      return row;
    }
    row.innerHTML = '<div class="avatar">' + ICON.spark + '</div><div class="body"><div class="content"></div></div>';
    const body = row.querySelector('.body');
    const content = row.querySelector('.content');
    content.innerHTML = m.html || escapeHtml(m.text || '');

    if (m.pdf) body.appendChild(renderPdfCard(m));
    if (m.biUrl) body.appendChild(renderBiCard(m));

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

  function renderTyping() {
    const row = document.createElement('div');
    row.className = 'msg assistant';
    row.id = 'typing';
    const label = sending && sending.mode === 'pdf' ? 'Gerando relatório, pode levar até 2 minutos...'
      : sending && sending.mode === 'bi' ? 'Montando o painel de BI...' : 'Consultando o sistema...';
    row.innerHTML = '<div class="avatar">' + ICON.spark + '</div><div class="body"><div class="typing"><span></span><span></span><span></span><em class="typing-label"></em></div></div>';
    row.querySelector('.typing-label').textContent = label;
    return row;
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
    const text = ' ' + (lastUser ? lastUser.text.toLowerCase() : '') + ' ';
    let pool = [];
    (ctx.domainKeywords || []).forEach(g => { if (g.palavrasChave.some(k => text.includes(k))) pool.push(...g.suggestions); });
    pool = pool.concat(pick(ctx.followUpSuggestions || [], 3));
    const asked = new Set(c.messages.filter(m => m.role === 'user').map(m => m.text.trim().toLowerCase()));
    [...new Set(pool)].filter(s => !asked.has(s.toLowerCase())).slice(0, 4).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s;
      b.disabled = !!sending;
      b.addEventListener('click', () => sendMessage(s));
      el.chips.appendChild(b);
    });
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
    sending = { controller, convId: c.id, mode };
    updateComposer();
    persist();
    renderHistory();
    renderMessages();

    const reply = { id: uid(), role: 'assistant', time: Date.now() };
    try {
      const resp = await callAgent(text, c.sessionId, mode, controller);
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

  async function callAgent(text, sessionId, mode, controller) {
    const payload = {
      sigla: ctx.sigla, sistema: ctx.sigla, sistemaNome: ctx.sistemaNome, schema: ctx.schema,
      entidade: ctx.entidade, municipio: ctx.municipio, username: ctx.usuario || '',
      mensagem: text, sessionId
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
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = m.pdfName || 'relatorio.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
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
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); startNewChat(); }
  });

  // ---- Início ----
  el.brandTitle.textContent = ctx.title || 'Agente I.A.M.';
  el.systemName.textContent = ctx.sistemaNome + (ctx.entidade ? ' · ' + ctx.entidade : '');
  document.title = (ctx.title || 'Agente I.A.M.') + ' · ' + (ctx.sigla || '');
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
