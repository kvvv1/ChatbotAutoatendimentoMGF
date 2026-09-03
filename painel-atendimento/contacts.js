// ── Agenda de Contatos ────────────────────────────────────────────────────────
(async () => {
  function authFetch(url, options = {}) {
    return fetch(url, { ...options, headers: { ...(options.headers || {}), ...getOperatorHeaders() } });
  }

  let featuresRes;
  try { featuresRes = await authFetch(API_BASE_URL + '/features'); } catch { return; }
  if (!featuresRes.ok) return;
  const features = await featuresRes.json();
  if (!features.enableContacts) return;

  document.getElementById('contacts-tab-btn').classList.remove('hidden');

  let contactsCache = [];
  let activeContact = null;
  let isSendingContact = false;
  let contactPollInterval = null;
  let lastContactMsgSignature = '';

  const tabBtns = document.querySelectorAll('.sidebar-tab');
  const panelConversations = document.getElementById('panel-conversations');
  const panelContacts = document.getElementById('panel-contacts');
  const contactsListEl = document.getElementById('contacts-list');
  const contactsSearchEl = document.getElementById('contacts-search');
  const contactsAddBtn = document.getElementById('contacts-add-btn');
  const contactModal = document.getElementById('contact-modal');
  const contactModalClose = document.getElementById('contact-modal-close');
  const contactNameInput = document.getElementById('contact-name-input');
  const contactPhoneInput = document.getElementById('contact-phone-input');
  const contactDescInput = document.getElementById('contact-desc-input');
  const contactSaveBtn = document.getElementById('contact-save-btn');
  const contactCancelBtn = document.getElementById('contact-cancel-btn');

  function switchTab(tab) {
    tabBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
    if (tab === 'contacts') {
      panelConversations.classList.add('hidden');
      panelContacts.classList.remove('hidden');
      showContactEmpty();
    } else {
      stopContactPoll();
      panelContacts.classList.add('hidden');
      panelConversations.classList.remove('hidden');
    }
  }

  tabBtns.forEach(function(btn) { btn.addEventListener('click', function() { switchTab(btn.dataset.tab); }); });

  async function loadContacts() {
    try {
      const res = await authFetch(API_BASE_URL + '/contacts');
      const data = await res.json();
      contactsCache = data.contacts || [];
      renderContacts();
    } catch (e) { /* silencioso */ }
  }

  function renderContacts(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = contactsCache.filter(function(c) {
      return c.name.toLowerCase().includes(q) || c.phone.includes(q);
    });
    if (!filtered.length) {
      contactsListEl.innerHTML = '<div class="chat-empty">Nenhum contato encontrado.</div>';
      return;
    }
    contactsListEl.innerHTML = filtered.map(function(c) {
      return '<div class="contact-item' + (activeContact && activeContact.id === c.id ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<div class="contact-avatar">' + c.name.charAt(0).toUpperCase() + '</div>' +
        '<div class="contact-info">' +
          '<div class="contact-name">' + c.name + '</div>' +
          '<div class="contact-phone">' + c.phone + '</div>' +
        '</div>' +
        '<button class="contact-delete" data-id="' + c.id + '" title="Remover">🗑</button>' +
      '</div>';
    }).join('');

    contactsListEl.querySelectorAll('.contact-item').forEach(function(el) {
      el.addEventListener('click', function() {
        const contact = contactsCache.find(function(c) { return c.id === el.dataset.id; });
        if (contact) openContactChat(contact);
      });
    });

    contactsListEl.querySelectorAll('.contact-delete').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const contact = contactsCache.find(function(c) { return c.id === btn.dataset.id; });
        if (!confirm('Remover contato "' + (contact ? contact.name : '') + '"?')) return;
        await authFetch(API_BASE_URL + '/contacts/' + btn.dataset.id, { method: 'DELETE' });
        if (activeContact && activeContact.id === btn.dataset.id) showContactEmpty();
        await loadContacts();
      });
    });
  }

  contactsSearchEl.addEventListener('input', function() { renderContacts(contactsSearchEl.value); });

  function showContactEmpty() {
    stopContactPoll();
    activeContact = null;
    chatTitleEl.textContent = 'Selecione um contato';
    chatSubtitleEl.textContent = 'Escolha um contato na agenda';
    chatAttendantEl.textContent = '';
    chatMessagesEl.innerHTML = '<div class="chat-empty">Escolha um contato na agenda para iniciar uma conversa.</div>';
    messageInputEl.disabled = true;
    sendButtonEl.disabled = true;
    ticketStatusEl.disabled = true;
    notesToggleButtonEl.disabled = true;
  }

  // ── Renderiza mensagens reutilizando renderMessages do app.js ──────────────
  function renderContactMessages(messages, scrollToBottom) {
    const sig = (messages || []).map(function(m) { return m.id; }).join(',');
    if (sig === lastContactMsgSignature) return;
    lastContactMsgSignature = sig;

    const saved = currentTicket;
    currentTicket = null;
    renderMessages(messages || []);
    currentTicket = saved;

    if (scrollToBottom) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // ── Área de composição fixada no footer ────────────────────────────────────
  function mountContactFooter(contact) {
    messageInputEl.disabled = false;
    messageInputEl.placeholder = 'Mensagem para ' + contact.name + '...';
    sendButtonEl.disabled = false;

    // Substitui handler do botão enviar
    const newSend = sendButtonEl.cloneNode(true);
    sendButtonEl.parentNode.replaceChild(newSend, sendButtonEl);

    newSend.addEventListener('click', async function() {
      const message = messageInputEl.value.trim();
      if (!message || isSendingContact) return;
      isSendingContact = true;
      newSend.disabled = true;
      try {
        const res = await authFetch(API_BASE_URL + '/contacts/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: contact.phone, message: message }),
        });
        if (res.ok) {
          messageInputEl.value = '';
          lastContactMsgSignature = '';
          await refreshContactMessages(contact, true);
        } else {
          showToast('Erro ao enviar mensagem.', 'error');
        }
      } catch (err) {
        showToast('Erro de conexao.', 'error');
      } finally {
        isSendingContact = false;
        newSend.disabled = false;
      }
    });

    messageInputEl.onkeydown = function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); newSend.click(); }
    };
  }

  async function refreshContactMessages(contact, scrollToBottom) {
    try {
      const res = await authFetch(API_BASE_URL + '/contacts/messages?phone=' + contact.phone);
      if (!res.ok) return;
      const data = await res.json();
      renderContactMessages(data.messages || [], scrollToBottom);
    } catch (e) { /* silencioso */ }
  }

  function stopContactPoll() {
    if (contactPollInterval) { clearInterval(contactPollInterval); contactPollInterval = null; }
    lastContactMsgSignature = '';
    messageInputEl.onkeydown = null;
  }

  async function openContactChat(contact) {
    stopContactPoll();
    activeContact = contact;
    renderContacts(contactsSearchEl.value);

    chatTitleEl.textContent = contact.name;
    chatSubtitleEl.textContent = contact.phone;
    chatAttendantEl.textContent = contact.description || '';
    ticketStatusEl.disabled = true;
    notesToggleButtonEl.disabled = true;
    chatMessagesEl.innerHTML = '<div class="chat-empty">Carregando mensagens...</div>';

    await refreshContactMessages(contact, true);
    mountContactFooter(contact);

    contactPollInterval = setInterval(async function() {
      if (activeContact && activeContact.id === contact.id) {
        await refreshContactMessages(contact, false);
      }
    }, 3000);
  }

  // ── Modal novo contato ──────────────────────────────────────────────────────
  contactsAddBtn.addEventListener('click', function() {
    contactNameInput.value = '';
    contactPhoneInput.value = '';
    contactDescInput.value = '';
    contactModal.classList.remove('hidden');
    contactNameInput.focus();
  });

  function closeContactModal() { contactModal.classList.add('hidden'); }
  contactModalClose.addEventListener('click', closeContactModal);
  contactCancelBtn.addEventListener('click', closeContactModal);
  contactModal.addEventListener('click', function(e) { if (e.target === contactModal) closeContactModal(); });

  contactSaveBtn.addEventListener('click', async function() {
    const name = contactNameInput.value.trim();
    const phone = contactPhoneInput.value.trim();
    const description = contactDescInput.value.trim();
    if (!name || !phone) { showToast('Nome e telefone sao obrigatorios.', 'error'); return; }
    try {
      const res = await authFetch(API_BASE_URL + '/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, phone: phone, description: description }),
      });
      if (res.ok) {
        showToast('Contato salvo!', 'success');
        closeContactModal();
        await loadContacts();
      } else {
        showToast('Erro ao salvar contato.', 'error');
      }
    } catch (err) { showToast('Erro de conexao.', 'error'); }
  });

  await loadContacts();
})();
// ── fim Agenda de Contatos ────────────────────────────────────────────────────
