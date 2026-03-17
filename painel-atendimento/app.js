const appShellEl = document.querySelector('.app-shell');
const statusFilterEl = document.getElementById('filter-status');
const searchConversationEl = document.getElementById('search-conversation');
const ticketsListEl = document.getElementById('tickets-list');
const chatTitleEl = document.getElementById('chat-title');
const chatSubtitleEl = document.getElementById('chat-subtitle');
const chatAttendantEl = document.getElementById('chat-attendant');
const chatHeaderProfileTriggerEl = document.getElementById('chat-header-profile-trigger');
const chatProfilePanelEl = document.getElementById('chat-profile-panel');
const chatProfileCloseEl = document.getElementById('chat-profile-close');
const chatProfileContentEl = document.getElementById('chat-profile-content');
const chatMessagesEl = document.getElementById('chat-messages');
const ticketStatusEl = document.getElementById('ticket-status');
const notesToggleButtonEl = document.getElementById('notes-toggle-button');
const transferButtonEl = document.getElementById('transfer-button');
const closeButtonEl = document.getElementById('close-button');
const mobileBackButtonEl = document.getElementById('mobile-back-button');
const notesPanelEl = document.getElementById('notes-panel');
const notesListEl = document.getElementById('notes-list');
const noteInputEl = document.getElementById('note-input');
const addNoteButtonEl = document.getElementById('add-note-button');
const messageInputEl = document.getElementById('message-input');
const sendButtonEl = document.getElementById('send-button');
const toastRegionEl = document.getElementById('toast-region');

let currentTicket = null;
let ticketsCache = [];
let isLoadingTickets = false;
let isSending = false;
let isSavingNote = false;
let isNotesPanelOpen = false;
let currentMessages = [];
let currentNotes = [];
let pendingOutgoing = [];
let isBootstrapped = false;
let lastMessagesSignature = '';
let ticketsLoadPromise = null;
let shouldReloadTickets = false;
let ticketsLoadSeq = 0;
let selectTicketSeq = 0;
let activeTicketRequest = null;
let profileOpen = false;
let profileCache = new Map();
let realtimeStream = null;
let realtimeConnected = false;
let lastRealtimeEventAt = 0;
let activeSelectPromise = null;
let activeSelectTicketId = null;
let pendingSelectRefresh = false;

const REFRESH_INTERVAL_MS = 3000;
const DETAIL_REFRESH_INTERVAL_MS = 1800;
const API_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 400;
let consecutiveLoadErrors = 0;
let isRefreshingPanel = false;

const DEFAULT_ATTENDANT_NAME = 'Atendente Humano';
const ATTENDANT_STORAGE_KEY = 'human_panel_agent_name';

const attendantFromUrl = new URLSearchParams(window.location.search).get('atendente');
if (attendantFromUrl && attendantFromUrl.trim()) {
  window.localStorage.setItem(ATTENDANT_STORAGE_KEY, attendantFromUrl.trim());
}

function getAttendantName() {
  const saved = window.localStorage.getItem(ATTENDANT_STORAGE_KEY);
  if (saved && saved.trim()) return saved.trim();
  return DEFAULT_ATTENDANT_NAME;
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function openConversationOnMobile() {
  if (!isMobileLayout()) return;
  appShellEl.classList.add('mobile-chat-open');
}

function closeConversationOnMobile() {
  appShellEl.classList.remove('mobile-chat-open');
}

function showToast(message, type = 'info') {
  if (!toastRegionEl) return;

  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  toastRegionEl.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
  }, 2600);

  window.setTimeout(() => {
    toast.remove();
  }, 2950);
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(a, b) {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.startsWith('55') && da.slice(2) === db) return true;
  if (db.startsWith('55') && db.slice(2) === da) return true;
  return false;
}

function initRealtimeStream() {
  if (realtimeStream) {
    try { realtimeStream.close(); } catch {}
  }

  try {
    realtimeStream = new EventSource('/api/human/stream');
  } catch (err) {
    console.error(err);
    return;
  }

  realtimeStream.onopen = () => {
    realtimeConnected = true;
  };

  realtimeStream.onerror = () => {
    realtimeConnected = false;
  };

  realtimeStream.onmessage = async (ev) => {
    let payload = null;
    try {
      payload = JSON.parse(ev.data || '{}');
    } catch {
      return;
    }
    if (!payload || payload.type === 'connected' || payload.type === 'ping') return;
    lastRealtimeEventAt = Date.now();

    try {
      // Atualiza chat aberto imediatamente; lista é atualizada em paralelo.
      if (currentTicket?.id) {
        await refreshCurrentTicket({ keepScroll: true });
      }
      await loadTickets({ silent: true, suppressAbortToast: true });
    } catch (err) {
      console.error(err);
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildMessageSignature(messages) {
  if (!Array.isArray(messages) || !messages.length) return 'empty';
  const last = messages[messages.length - 1];
  return String(messages.length) + '|' + String(last?.id || '') + '|' + String(last?.created_at || '');
}

function normalizeError(err) {
  if (!err) return 'Erro inesperado.';
  if (err.name === 'AbortError') return 'Tempo limite da requisicao.';
  return err.message || String(err);
}

async function fetchJson(url, options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : API_TIMEOUT_MS;
  const retries = typeof options.retries === 'number' ? options.retries : 0;
  const { timeoutMs: _timeoutMs, retries: _retries, ...fetchOptions } = options;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...fetchOptions,
        signal: fetchOptions.signal || controller.signal,
        cache: fetchOptions.cache || 'no-store',
        headers: {
          ...(fetchOptions.headers || {})
        }
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error((body && body.slice(0, 180)) || ('HTTP ' + res.status));
      }
      return await res.json();
    } catch (err) {
      if (attempt >= retries || err?.name === 'AbortError') throw err;
      attempt += 1;
      await delay(RETRY_DELAY_MS * attempt);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
}

function setButtonBusy(button, busy, idleLabel, busyLabel) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setProfileOpen(open) {
  profileOpen = Boolean(open);
  if (chatProfilePanelEl) {
    chatProfilePanelEl.classList.toggle('open', profileOpen);
  }
}

function renderProfilePlaceholder(text) {
  if (!chatProfileContentEl) return;
  chatProfileContentEl.innerHTML = '<div class="chat-empty">' + escapeHtml(text) + '</div>';
}

function renderProfileData(data) {
  if (!chatProfileContentEl) return;
  const customer = data?.customer || null;
  const ligacoes = Array.isArray(data?.ligacoes) ? data.ligacoes : [];
  const media = Array.isArray(data?.media) ? data.media : [];
  const api = data?.api || null;
  const apiCliente = api?.cliente || null;
  const apiLigacoes = Array.isArray(api?.ligacoes) ? api.ligacoes : [];
  const apiIdEletronico = typeof api?.idEletronico === 'string' ? api.idEletronico : null;
  const cadastroIdEletronico =
    apiLigacoes.map((l) => l?.cadastro?.idEletronico).find((v) => typeof v === 'string' && v.trim()) || null;

  const customerRows = [
    ['Nome', apiCliente?.nome || customer?.name || getTicketDisplayName(currentTicket)],
    ['Telefone', getTicketPhone(currentTicket)],
    ['CPF', apiCliente?.cpf || customer?.cpf || '-'],
    ['ID Eletrônico', apiIdEletronico || cadastroIdEletronico || '-'],
    ['E-mail', apiCliente?.email || customer?.email || '-']
  ];

  const ligacaoBase = apiLigacoes.length ? apiLigacoes : ligacoes;
  const ligacaoHtml = ligacaoBase.length
    ? ligacaoBase
        .map((l) => {
          const cadastro = l.cadastro || null;
          const rows = [
            ['Ligação', cadastro?.numeroLigacao || l.numero_ligacao || l.label || '-'],
            ['Titular', cadastro?.nomeTitular || l.titular || '-'],
            ['Categoria', cadastro?.categoria || l.categoria || '-'],
            ['Abastecimento', cadastro?.situacaoAbastecimento || l.situacao_abastecimento || '-'],
            ['Hidrômetro', cadastro?.numeroHidrometro || l.numero_hidrometro || '-'],
            ['Endereço', cadastro?.enderecoImovel || l.endereco_imovel || l.description || '-'],
            ['Correspondência', cadastro?.enderecoCorrespondencia || l.endereco_correspondencia || '-']
          ];
          return `
            <div class="profile-section">
              <h3>Ligação</h3>
              <div class="profile-grid">
                ${rows
                  .map(
                    ([k, v]) => `<div class="profile-row"><div class="profile-key">${escapeHtml(k)}</div><div class="profile-value">${escapeHtml(v)}</div></div>`
                  )
                  .join('')}
              </div>
            </div>
          `;
        })
        .join('')
    : '<div class="profile-section"><h3>Ligação</h3><div class="profile-value">Sem dados de ligação cadastrados.</div></div>';

  const mediaHtml = media.length
    ? `
      <div class="profile-section">
        <h3>Mídias do usuário</h3>
        <div class="media-list">
          ${media
            .map((m) => {
              const link = m.url
                ? `<a class="media-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">Abrir mídia</a>`
                : '';
              return `
                <div class="media-item">
                  <div class="media-meta">${escapeHtml(m.label || 'Mídia')} | ${escapeHtml(formatDateTime(m.created_at))}</div>
                  ${link || '<div class="profile-value">Arquivo sem URL disponível.</div>'}
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `
    : '<div class="profile-section"><h3>Mídias do usuário</h3><div class="profile-value">Nenhuma mídia registrada.</div></div>';

  chatProfileContentEl.innerHTML = `
    <div class="profile-section">
      <h3>Cadastro</h3>
      <div class="profile-grid">
        ${customerRows
          .map(
            ([k, v]) => `<div class="profile-row"><div class="profile-key">${escapeHtml(k)}</div><div class="profile-value">${escapeHtml(v)}</div></div>`
          )
          .join('')}
      </div>
    </div>
    ${ligacaoHtml}
    ${mediaHtml}
  `;
}

async function loadAndRenderProfile(ticketId, force = false) {
  if (!ticketId) return;
  if (!force && profileCache.has(ticketId)) {
    renderProfileData(profileCache.get(ticketId));
    return;
  }

  renderProfilePlaceholder('Carregando detalhes...');
  try {
    const data = await fetchJson('/api/human-tickets/' + encodeURIComponent(ticketId) + '/profile', { retries: 1 });
    profileCache.set(ticketId, data);
    if (currentTicket?.id === ticketId && profileOpen) {
      renderProfileData(data);
    }
  } catch (err) {
    console.error(err);
    renderProfilePlaceholder('Não foi possível carregar os detalhes da conversa.');
  }
}

function setNotesPanelOpen(open) {
  isNotesPanelOpen = Boolean(open);
  if (notesPanelEl) {
    notesPanelEl.classList.toggle('collapsed', !isNotesPanelOpen);
  }
  if (notesToggleButtonEl) {
    notesToggleButtonEl.setAttribute('aria-expanded', isNotesPanelOpen ? 'true' : 'false');
    notesToggleButtonEl.title = isNotesPanelOpen ? 'Fechar anotacoes' : 'Abrir anotacoes';
    notesToggleButtonEl.setAttribute('aria-label', isNotesPanelOpen ? 'Fechar anotacoes internas' : 'Abrir anotacoes internas');
  }
}

function formatStatusLabel(status) {
  return String(status || '').replace('_', ' ');
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ticketCode(id) {
  if (!id) return 'Ticket sem codigo';
  return 'Ticket #' + String(id).slice(0, 8).toUpperCase();
}

function formatPhoneDisplay(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return 'Sem telefone';
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function getTicketPhone(ticket) {
  const raw = typeof ticket?.phone === 'string' ? ticket.phone.trim() : '';
  if (!raw) return 'Sem telefone';
  return formatPhoneDisplay(raw);
}

function getTicketDisplayName(ticket) {
  const candidate = typeof ticket?.customer_name === 'string' ? ticket.customer_name.trim() : '';
  if (candidate) return candidate;
  return 'Cliente';
}

function getTicketPreview(ticket) {
  const raw = typeof ticket?.last_message_preview === 'string' ? ticket.last_message_preview.trim() : '';
  if (raw) return raw;
  return 'Sem mensagens recentes';
}

function getResponsibleName(ticket) {
  const assigned = typeof ticket?.assigned_attendant === 'string' ? ticket.assigned_attendant.trim() : '';
  if (assigned) return assigned;
  return getAttendantName();
}

function applySearchFilter(tickets) {
  const q = (searchConversationEl.value || '').trim().toLowerCase();
  if (!q) return tickets;

  return tickets.filter((t) => {
    const byName = getTicketDisplayName(t).toLowerCase();
    const byPhone = String(t.phone || '').toLowerCase();
    return byName.includes(q) || byPhone.includes(q);
  });
}

function renderTicketList() {
  const visibleTickets = applySearchFilter(ticketsCache);

  if (!visibleTickets.length) {
    ticketsListEl.innerHTML = '<div class="chat-empty">Nenhuma conversa encontrada para o filtro/busca.</div>';
    if (currentTicket) {
      const hasCurrent = ticketsCache.some((t) => t.id === currentTicket.id);
      if (!hasCurrent) {
        currentTicket = null;
        resetConversationPanel('Nenhuma conversa ativa');
      }
    }
    return;
  }

  ticketsListEl.innerHTML = '';
  visibleTickets.forEach((t) => {
    const div = document.createElement('div');
    div.className = 'ticket-item';
    div.dataset.id = t.id;
    div.classList.add('ticket-status-' + t.status);

    const main = document.createElement('div');
    main.className = 'ticket-main';

    const phone = document.createElement('p');
    phone.className = 'ticket-phone';
    phone.textContent = getTicketDisplayName(t);

    const time = document.createElement('span');
    time.className = 'ticket-time';
    time.textContent = formatTime(t.last_message_at || t.created_at);

    main.appendChild(phone);
    main.appendChild(time);

    const meta = document.createElement('div');
    meta.className = 'ticket-meta';

    const preview = document.createElement('span');
    preview.className = 'ticket-preview';
    preview.textContent = getTicketPreview(t);

    const rightMeta = document.createElement('div');
    rightMeta.className = 'ticket-right-meta';

    const statusEl = document.createElement('span');
    statusEl.className = 'status-pill status-' + t.status;
    statusEl.textContent = formatStatusLabel(t.status);
    rightMeta.appendChild(statusEl);

    if (Number(t.unread_count) > 0) {
      const unread = document.createElement('span');
      unread.className = 'unread-badge';
      unread.textContent = String(Math.min(Number(t.unread_count), 99));
      rightMeta.appendChild(unread);
    }

    meta.appendChild(preview);
    meta.appendChild(rightMeta);

    const foot = document.createElement('div');
    foot.className = 'ticket-foot';
    foot.textContent = ticketCode(t.id);

    div.appendChild(main);
    div.appendChild(meta);
    div.appendChild(foot);

    div.addEventListener('click', () => selectTicket(t.id));
    ticketsListEl.appendChild(div);
  });

  markActiveTicket();
}

async function loadTickets(options = {}) {
  const silent = options.silent === true;
  const suppressAbortToast = options.suppressAbortToast !== false;

  if (ticketsLoadPromise) {
    shouldReloadTickets = true;
    return ticketsLoadPromise;
  }

  isLoadingTickets = true;
  const seq = ++ticketsLoadSeq;
  const hadData = Array.isArray(ticketsCache) && ticketsCache.length > 0;
  if (!silent && !hadData) {
    ticketsListEl.innerHTML = '<div class="chat-empty">Carregando conversas...</div>';
  }

  ticketsLoadPromise = (async () => {
    try {
      const status = statusFilterEl.value;
      const qs = status ? ('?status=' + encodeURIComponent(status)) : '';
      const json = await fetchJson('/api/human-tickets' + qs, { retries: 1 });
      if (seq !== ticketsLoadSeq) return;

      ticketsCache = Array.isArray(json.data) ? json.data : [];
      consecutiveLoadErrors = 0;

      if (!ticketsCache.length) {
        ticketsListEl.innerHTML = '<div class="chat-empty">Nenhuma conversa encontrada para este filtro.</div>';
        if (currentTicket) {
          currentTicket = null;
          currentMessages = [];
          currentNotes = [];
          pendingOutgoing = [];
          lastMessagesSignature = '';
          resetConversationPanel('Nenhuma conversa ativa');
        }
        return;
      }

      const selectedId = currentTicket?.id;
      if (selectedId) {
        const updated = ticketsCache.find((t) => t.id === selectedId);
        if (updated) currentTicket = { ...currentTicket, ...updated };
      }

      renderTicketList();
    } catch (err) {
      console.error(err);
      const hadDataAfterError = Array.isArray(ticketsCache) && ticketsCache.length > 0;
      consecutiveLoadErrors += 1;

      if (!hadDataAfterError) {
        ticketsListEl.innerHTML = '<div class="chat-empty">Erro ao carregar conversas.</div>';
      }

      if (err?.name === 'AbortError') {
        if (!suppressAbortToast && !silent && !hadDataAfterError) {
          showToast('Conexao lenta. Tentando novamente...', 'info');
        }
      } else if (!silent || consecutiveLoadErrors >= 3) {
        showToast('Erro ao atualizar lista de conversas: ' + normalizeError(err), 'error');
      }
    } finally {
      isLoadingTickets = false;
    }
  })();

  try {
    await ticketsLoadPromise;
  } finally {
    ticketsLoadPromise = null;
    if (shouldReloadTickets) {
      shouldReloadTickets = false;
      await loadTickets({ silent: true });
    }
  }
}

function resetConversationPanel(subtitle) {
  chatTitleEl.textContent = 'Selecione uma conversa';
  chatSubtitleEl.textContent = subtitle || 'Nenhuma conversa ativa';
  chatAttendantEl.textContent = 'Atendente responsavel: -';
  chatMessagesEl.innerHTML = '<div class="chat-empty">Escolha uma conversa na coluna da esquerda.</div>';
  notesListEl.innerHTML = '<div class="notes-empty">Sem anotacoes para esta conversa.</div>';

  ticketStatusEl.disabled = true;
  ticketStatusEl.value = 'pendente';
  if (notesToggleButtonEl) notesToggleButtonEl.disabled = true;
  setNotesPanelOpen(false);
  noteInputEl.disabled = true;
  noteInputEl.value = '';
  addNoteButtonEl.disabled = true;

  messageInputEl.disabled = true;
  messageInputEl.value = '';
  sendButtonEl.disabled = true;

  markActiveTicket();
  setProfileOpen(false);
  renderProfilePlaceholder('Selecione uma conversa para ver os detalhes.');
}

function markActiveTicket() {
  const items = ticketsListEl.querySelectorAll('.ticket-item');
  items.forEach((item) => {
    if (currentTicket && item.dataset.id === currentTicket.id) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function applyCurrentTicketHeader() {
  if (!currentTicket) return;
  chatTitleEl.textContent = getTicketDisplayName(currentTicket);
  chatSubtitleEl.textContent = getTicketPhone(currentTicket) + ' | ' + ticketCode(currentTicket.id) + ' | Aberto em ' + formatDateTime(currentTicket.created_at);
  chatAttendantEl.textContent = 'Atendente responsavel: ' + getResponsibleName(currentTicket);
  ticketStatusEl.disabled = false;
  ticketStatusEl.value = currentTicket.status;
  if (notesToggleButtonEl) notesToggleButtonEl.disabled = false;
  noteInputEl.disabled = false;
  addNoteButtonEl.disabled = false;
  messageInputEl.disabled = false;
  sendButtonEl.disabled = false;
}

function renderCurrentConversation(force = false) {
  const mergedMessages = currentMessages.concat(pendingOutgoing);
  const signature = buildMessageSignature(mergedMessages) + '|pending:' + String(pendingOutgoing.length);
  if (!force && signature === lastMessagesSignature) return;
  lastMessagesSignature = signature;
  renderMessages(mergedMessages);
  renderNotes(currentNotes);
}

async function selectTicket(id, options = {}) {
  const silent = options.silent === true;
  const keepScroll = options.keepScroll !== false;
  const force = options.force === true;

  if (activeSelectPromise && activeSelectTicketId === id && !force) {
    pendingSelectRefresh = true;
    return activeSelectPromise;
  }

  const seq = ++selectTicketSeq;

  if (activeTicketRequest && activeSelectTicketId !== id) {
    try {
      activeTicketRequest.abort();
    } catch {
      // noop
    }
  }

  const controller = new AbortController();
  activeTicketRequest = controller;

  const run = async () => {
    const previousScrollBottomOffset = keepScroll
      ? chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop
      : 0;

    if (!silent && (!currentTicket || currentTicket.id !== id)) {
      chatMessagesEl.innerHTML = '<div class="chat-empty">Carregando conversa...</div>';
    }

    const json = await fetchJson('/api/human-tickets/' + encodeURIComponent(id), {
      signal: controller.signal,
      retries: 1
    });
    if (seq !== selectTicketSeq) return;
    const ticketFromCache = ticketsCache.find((t) => t.id === id);
    currentTicket = { ...(ticketFromCache || {}), ...(json.ticket || {}) };
    currentMessages = Array.isArray(json.messages) ? json.messages : [];
    currentNotes = Array.isArray(json.notes) ? json.notes : [];
    applyCurrentTicketHeader();
    renderCurrentConversation(true);
    markActiveTicket();
    openConversationOnMobile();
    if (profileOpen) {
      await loadAndRenderProfile(currentTicket.id);
    }

    if (keepScroll && previousScrollBottomOffset > 0) {
      chatMessagesEl.scrollTop = Math.max(0, chatMessagesEl.scrollHeight - previousScrollBottomOffset);
    }
  };

  activeSelectTicketId = id;
  activeSelectPromise = run();

  try {
    await activeSelectPromise;
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err);
    chatMessagesEl.innerHTML = '<div class="chat-empty">Erro ao carregar a conversa selecionada.</div>';
    showToast('Erro ao abrir conversa: ' + normalizeError(err), 'error');
  } finally {
    if (activeTicketRequest === controller) activeTicketRequest = null;
    const shouldRunAgain = pendingSelectRefresh && activeSelectTicketId === id;
    pendingSelectRefresh = false;
    activeSelectPromise = null;
    if (shouldRunAgain) {
      await selectTicket(id, { silent: true, keepScroll: true, force: true });
    }
  }
}

async function refreshCurrentTicket(options = {}) {
  if (!currentTicket?.id) return;
  await selectTicket(currentTicket.id, { silent: true, keepScroll: options.keepScroll !== false });
}

function renderMessages(messages) {
  const wasNearBottom = (chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight) < 80;

  if (!messages.length) {
    chatMessagesEl.innerHTML = '<div class="chat-empty">Nenhuma mensagem registrada para este telefone.</div>';
    return;
  }

  chatMessagesEl.innerHTML = '';

  let dividerInserted = false;
  let ticketStart = null;

  try {
    if (currentTicket?.created_at) {
      ticketStart = new Date(currentTicket.created_at);
    }
  } catch {
    ticketStart = null;
  }

  messages.forEach((m) => {
    const msgDate = new Date(m.created_at);
    const origin = getMessageOrigin(m, ticketStart);

    if (!dividerInserted && ticketStart instanceof Date && !Number.isNaN(ticketStart.getTime()) && msgDate >= ticketStart) {
      const dividerRow = document.createElement('div');
      dividerRow.className = 'divider-row';

      const divider = document.createElement('div');
      divider.className = 'divider';

      const left = document.createElement('div');
      left.className = 'divider-line';

      const text = document.createElement('div');
      text.className = 'divider-text';
      text.textContent = 'Inicio do atendimento humano';

      const right = document.createElement('div');
      right.className = 'divider-line';

      divider.appendChild(left);
      divider.appendChild(text);
      divider.appendChild(right);
      dividerRow.appendChild(divider);
      chatMessagesEl.appendChild(dividerRow);

      dividerInserted = true;
    }

    const row = document.createElement('div');
    row.className = 'msg-row ' + (m.direction === 'in' ? 'in' : 'out');

    const bubble = document.createElement('div');
    bubble.className = 'msg ' + (m.direction === 'in' ? 'in' : 'out') + ' ' + origin.key;

    const originEl = document.createElement('div');
    originEl.className = 'msg-origin ' + origin.key;
    originEl.textContent = origin.label;

    const textEl = document.createElement('div');
    textEl.textContent = formatMessageContent(m);

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = formatDateTime(m.created_at);

    bubble.appendChild(originEl);
    bubble.appendChild(textEl);
    bubble.appendChild(time);

    row.appendChild(bubble);
    chatMessagesEl.appendChild(row);
  });

  if (wasNearBottom) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

function renderNotes(notes) {
  if (!Array.isArray(notes) || !notes.length) {
    notesListEl.innerHTML = '<div class="notes-empty">Sem anotacoes para esta conversa.</div>';
    return;
  }

  notesListEl.innerHTML = '';
  notes.forEach((n) => {
    const item = document.createElement('div');
    item.className = 'note-item';

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    meta.textContent = (n.author || 'Equipe') + ' | ' + formatDateTime(n.created_at);

    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = n.note || '';

    item.appendChild(meta);
    item.appendChild(text);
    notesListEl.appendChild(item);
  });

  notesListEl.scrollTop = notesListEl.scrollHeight;
}

function formatMessageContent(m) {
  const raw = typeof m.content === 'string' ? m.content : '';
  if (!raw) return '';

  let parsed = null;
  if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return raw;
  }

  const type = parsed.type;
  switch (type) {
    case 'buttons': {
      const base = parsed.text || '';
      const buttons = Array.isArray(parsed.buttons)
        ? parsed.buttons.map((b) => (b.text || b.label || '')).filter(Boolean)
        : [];
      if (!buttons.length) return base || raw;
      return base + '\n\n' + buttons.map((t) => '- ' + t).join('\n');
    }
    case 'list':
      return parsed.text || raw;
    case 'link': {
      const msg = parsed.message || '';
      const url = parsed.linkUrl || '';
      return [msg, url].filter(Boolean).join('\n');
    }
    case 'copyCode': {
      const msg = parsed.message || '';
      const code = parsed.code || '';
      return code ? msg + '\n\nCodigo: ' + code : (msg || raw);
    }
    case 'audio':
      return '[Audio enviado pelo bot]';
    case 'video':
      return parsed.caption || '[Video enviado pelo bot]';
    case 'document': {
      const name = parsed.fileName || parsed.document || '';
      return name ? '[Documento: ' + name + ']' : '[Documento enviado pelo bot]';
    }
    case 'location': {
      const title = parsed.title || '';
      const address = parsed.address || '';
      return '[Localizacao] ' + [title, address].filter(Boolean).join(' - ');
    }
    case 'buttonActions':
      return parsed.message || raw;
    default:
      return raw;
  }
}

function getMessageOrigin(message, ticketStart) {
  const isIn = message.direction === 'in';
  const msgDate = new Date(message.created_at);
  const hasValidTicketStart = ticketStart instanceof Date && !Number.isNaN(ticketStart.getTime());

  if (isIn) {
    return { key: 'user', label: getTicketDisplayName(currentTicket) };
  }

  if (hasValidTicketStart && msgDate >= ticketStart) {
    return { key: 'agent', label: 'Atendente' };
  }

  return { key: 'bot', label: 'Bot' };
}

async function changeTicketStatus() {
  if (!currentTicket) return;

  const newStatus = ticketStatusEl.value;

  try {
    const json = await fetchJson('/api/human-tickets/' + encodeURIComponent(currentTicket.id) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
      retries: 1
    });
    currentTicket = json.ticket;
    applyCurrentTicketHeader();
    await loadTickets({ silent: true });
    showToast('Status atualizado para ' + formatStatusLabel(newStatus) + '.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Nao foi possivel atualizar o status: ' + normalizeError(err), 'error');
    ticketStatusEl.value = currentTicket.status;
  }
}

async function transferTicket() {
  if (!currentTicket) return;

  if (!transferButtonEl) return;
  const currentAssignee = getResponsibleName(currentTicket);
  const target = window.prompt('Transferir para qual atendente?', currentAssignee);
  if (!target || !target.trim()) return;

  setButtonBusy(transferButtonEl, true, 'Transferir', 'Transferindo...');

  try {
    const json = await fetchJson('/api/human-tickets/' + encodeURIComponent(currentTicket.id) + '/assignee', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedAttendant: target.trim() }),
      retries: 1
    });
    currentTicket = json.ticket;
    chatAttendantEl.textContent = 'Atendente responsavel: ' + getResponsibleName(currentTicket);
    await loadTickets({ silent: true });
    showToast('Conversa transferida para ' + target.trim() + '.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Nao foi possivel transferir: ' + normalizeError(err), 'error');
  } finally {
    setButtonBusy(transferButtonEl, false, 'Transferir', 'Transferindo...');
  }
}

async function closeTicketOneClick() {
  if (!closeButtonEl) return;
  if (!currentTicket) return;
  const ok = window.confirm('Encerrar atendimento desta conversa?');
  if (!ok) return;

  setButtonBusy(closeButtonEl, true, 'Encerrar', 'Encerrando...');

  try {
    const json = await fetchJson('/api/human-tickets/' + encodeURIComponent(currentTicket.id) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'finalizado' }),
      retries: 1
    });
    currentTicket = json.ticket;
    applyCurrentTicketHeader();
    ticketStatusEl.value = currentTicket.status;
    await loadTickets({ silent: true });
    showToast('Conversa encerrada com sucesso.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Nao foi possivel encerrar: ' + normalizeError(err), 'error');
  } finally {
    setButtonBusy(closeButtonEl, false, 'Encerrar', 'Encerrando...');
  }
}

async function addInternalNote() {
  if (!currentTicket || isSavingNote) return;

  const note = noteInputEl.value.trim();
  if (!note) return;

  isSavingNote = true;
  setButtonBusy(addNoteButtonEl, true, 'Salvar anotacao', 'Salvando...');

  try {
    await fetchJson('/api/human-tickets/' + encodeURIComponent(currentTicket.id) + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note,
        author: getAttendantName()
      }),
      retries: 1
    });
    noteInputEl.value = '';
    await refreshCurrentTicket();
    showToast('Anotacao interna salva.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Nao foi possivel salvar anotacao: ' + normalizeError(err), 'error');
  } finally {
    isSavingNote = false;
    setButtonBusy(addNoteButtonEl, false, 'Salvar anotacao', 'Salvando...');
  }
}

async function sendMessage() {
  if (!currentTicket || isSending) return;

  const text = messageInputEl.value.trim();
  if (!text) return;

  isSending = true;
  setButtonBusy(sendButtonEl, true, 'Enviar', 'Enviando...');
  const optimistic = {
    id: 'tmp-' + String(Date.now()),
    phone: currentTicket.phone,
    direction: 'out',
    content: text,
    created_at: new Date().toISOString()
  };
  pendingOutgoing.push(optimistic);
  renderCurrentConversation();

  try {
    await fetchJson('/api/human-tickets/' + encodeURIComponent(currentTicket.id) + '/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      retries: 1
    });
    messageInputEl.value = '';
    pendingOutgoing = pendingOutgoing.filter((m) => m.id !== optimistic.id);
    await Promise.all([
      refreshCurrentTicket(),
      loadTickets({ silent: true })
    ]);
    showToast('Mensagem enviada.', 'success');
  } catch (err) {
    console.error(err);
    pendingOutgoing = pendingOutgoing.filter((m) => m.id !== optimistic.id);
    renderCurrentConversation(true);
    showToast('Nao foi possivel enviar: ' + normalizeError(err), 'error');
  } finally {
    isSending = false;
    setButtonBusy(sendButtonEl, false, 'Enviar', 'Enviando...');
  }
}

function handleGlobalShortcuts(ev) {
  const key = String(ev.key || '').toLowerCase();
  const hasAlt = ev.altKey;
  const hasCmdEnter = (ev.ctrlKey || ev.metaKey) && key === 'enter';

  if (key === 'escape' && isMobileLayout() && appShellEl.classList.contains('mobile-chat-open')) {
    ev.preventDefault();
    closeConversationOnMobile();
    return;
  }

  if (hasCmdEnter) {
    if (document.activeElement === noteInputEl) {
      ev.preventDefault();
      addInternalNote();
      return;
    }

    if (document.activeElement === messageInputEl) {
      ev.preventDefault();
      sendMessage();
      return;
    }
  }

  if (!hasAlt) return;

  if (key === 'f') {
    ev.preventDefault();
    searchConversationEl.focus();
    searchConversationEl.select();
    return;
  }

  if (key === 'm') {
    ev.preventDefault();
    if (!messageInputEl.disabled) messageInputEl.focus();
    return;
  }

  if (key === 'n') {
    ev.preventDefault();
    if (!noteInputEl.disabled) {
      setNotesPanelOpen(true);
      noteInputEl.focus();
    }
    return;
  }

  if (key === 't') {
    if (!transferButtonEl) return;
    ev.preventDefault();
    if (!transferButtonEl.disabled) transferTicket();
    return;
  }

  if (key === 'e') {
    if (!closeButtonEl) return;
    ev.preventDefault();
    if (!closeButtonEl.disabled) closeTicketOneClick();
  }
}

statusFilterEl.addEventListener('change', async () => {
  await loadTickets({ silent: false });
});
searchConversationEl.addEventListener('input', renderTicketList);
ticketStatusEl.addEventListener('change', changeTicketStatus);
if (transferButtonEl) transferButtonEl.addEventListener('click', transferTicket);
if (closeButtonEl) closeButtonEl.addEventListener('click', closeTicketOneClick);
if (notesToggleButtonEl) {
  notesToggleButtonEl.addEventListener('click', () => {
    setNotesPanelOpen(!isNotesPanelOpen);
    if (isNotesPanelOpen && !noteInputEl.disabled) noteInputEl.focus();
  });
}
mobileBackButtonEl.addEventListener('click', closeConversationOnMobile);
if (chatHeaderProfileTriggerEl) {
  chatHeaderProfileTriggerEl.addEventListener('click', async () => {
    if (!currentTicket?.id) return;
    setProfileOpen(true);
    await loadAndRenderProfile(currentTicket.id);
  });
  chatHeaderProfileTriggerEl.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    if (!currentTicket?.id) return;
    setProfileOpen(true);
    await loadAndRenderProfile(currentTicket.id);
  });
}
if (chatProfileCloseEl) {
  chatProfileCloseEl.addEventListener('click', () => {
    setProfileOpen(false);
  });
}
addNoteButtonEl.addEventListener('click', addInternalNote);
sendButtonEl.addEventListener('click', sendMessage);
window.addEventListener('keydown', handleGlobalShortcuts);
window.addEventListener('resize', () => {
  if (!isMobileLayout()) closeConversationOnMobile();
});

noteInputEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    addInternalNote();
  }
});

messageInputEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendMessage();
  }
});

resetConversationPanel('Nenhuma conversa ativa');
setNotesPanelOpen(false);
loadTickets({ silent: false });
showToast('Painel pronto.', 'info');
isBootstrapped = true;

async function refreshPanel() {
  if (isRefreshingPanel) return;
  if (document.hidden) return;
  isRefreshingPanel = true;

  try {
    await loadTickets({ silent: true, suppressAbortToast: true });

    if (!currentTicket) return;

    const stillExists = ticketsCache.some((t) => t.id === currentTicket.id);
    if (!stillExists) {
      currentTicket = null;
      resetConversationPanel('Nenhuma conversa ativa');
      return;
    }

    await refreshCurrentTicket({ keepScroll: true });
  } finally {
    isRefreshingPanel = false;
  }
}

setInterval(() => {
  if (!isBootstrapped) return;
  // Mantém fallback de polling mesmo com SSE conectado.
  // Se eventos realtime não chegarem por qualquer motivo, ainda atualiza.
  if (realtimeConnected && Date.now() - lastRealtimeEventAt < 8000) return;
  refreshPanel().catch((err) => {
    console.error(err);
  });
}, REFRESH_INTERVAL_MS);

// Refresh dedicado da conversa aberta para manter chat responsivo.
setInterval(() => {
  if (!isBootstrapped) return;
  if (document.hidden) return;
  if (!currentTicket?.id) return;
  refreshCurrentTicket({ keepScroll: true }).catch((err) => {
    console.error(err);
  });
}, DETAIL_REFRESH_INTERVAL_MS);

initRealtimeStream();
