/* Compartilhado pelo painel e pelos testes; não altera o telefone armazenado. */
(function (root) {
  function normalizeName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  }

  function phoneVariants(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return [];
    const national = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2) : digits;
    const variants = new Set([digits, national]);
    // Aceita celulares que chegam pelo WhatsApp com ou sem o nono dígito.
    if (national.length === 11 && national[2] === '9' && /[6-9]/.test(national[3])) {
      variants.add(national.slice(0, 2) + national.slice(3));
    } else if (national.length === 10 && /[6-9]/.test(national[2])) {
      variants.add(national.slice(0, 2) + '9' + national.slice(2));
    } else if (national.length === 9 && national[0] === '9' && /[6-9]/.test(national[1])) {
      variants.add(national.slice(1));
    } else if (national.length === 8 && /[6-9]/.test(national[0])) {
      variants.add('9' + national);
    }
    return Array.from(variants);
  }

  function matches(ticket, rawQuery) {
    const query = String(rawQuery || '').normalize('NFKC').trim();
    if (!query) return true;
    if (/^[+\d\s().\-\u2010-\u2015\u2212]+$/.test(query) && /\d/.test(query)) {
      const queries = phoneVariants(query);
      const phones = phoneVariants(ticket.phone);
      return queries.some(q => phones.some(p => p.includes(q)));
    }
    const name = normalizeName(ticket.customer_name);
    const terms = normalizeName(query).split(' ').filter(Boolean);
    return terms.length > 0 && terms.every(term => name.includes(term));
  }

  function formatPhone(value) {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');
    const national = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2) : digits;
    if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
    if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
    if (national.length === 9) return `${national.slice(0, 5)}-${national.slice(5)}`;
    if (national.length === 8) return `${national.slice(0, 4)}-${national.slice(4)}`;
    return raw || 'Sem telefone';
  }

  root.ConversationSearch = Object.freeze({ matches, formatPhone });
})(globalThis);
