import { getSupabaseAdmin } from './client.js';
function logDbError(scope, error) {
    try {
        if (!error)
            return;
        console.error(`[humanTickets:${scope}]`, error);
    }
    catch {
        // noop
    }
}
function isMissingTableError(error, tableName) {
    const e = error;
    const code = typeof e?.code === 'string' ? e.code : '';
    const message = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
    return code === 'PGRST205' && message.includes(String(tableName || '').toLowerCase());
}
function phoneVariants(value) {
    const digits = (value || '').replace(/\D/g, '');
    if (!digits)
        return [];
    const out = new Set();
    out.add(digits);
    if (digits.startsWith('55') && digits.length > 2)
        out.add(digits.slice(2));
    if (!digits.startsWith('55'))
        out.add(`55${digits}`);
    return Array.from(out);
}
function normalizeName(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function extractNameFromGreetingText(text) {
    const raw = String(text || '').trim();
    if (!raw)
        return null;
    const starred = raw.match(/ol[áa]\s*,?\s*\*+\s*([^*\n!,.]{2,80})\s*\*+/i);
    if (starred && starred[1]) {
        const n = normalizeName(starred[1]);
        if (n)
            return n;
    }
    const plain = raw.match(/ol[áa]\s*,?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,80})[!,.]/i);
    if (plain && plain[1]) {
        const n = normalizeName(plain[1]);
        if (n)
            return n;
    }
    return null;
}
function extractNameFromContent(content) {
    const raw = (content ?? '').trim();
    if (!raw)
        return null;
    const direct = extractNameFromGreetingText(raw);
    if (direct)
        return direct;
    if (raw.startsWith('{') || raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            const candidates = [parsed.message, parsed.text, parsed.caption, parsed.title];
            for (const c of candidates) {
                if (typeof c !== 'string')
                    continue;
                const name = extractNameFromGreetingText(c);
                if (name)
                    return name;
            }
        }
        catch {
            // noop
        }
    }
    return null;
}
function guessCustomerNameFromMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0)
        return null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i];
        if (!m || typeof m.content !== 'string')
            continue;
        if (m.direction !== 'out')
            continue;
        const name = extractNameFromContent(m.content);
        if (name)
            return name;
    }
    return null;
}
export async function listHumanTickets(config, params) {
    const supabase = getSupabaseAdmin(config);
    let query = supabase
        .from('human_tickets')
        .select('*')
        .order('created_at', { ascending: false });
    if (params?.status === 'abertos') {
        query = query.in('status', ['pendente', 'em_atendimento']);
    }
    else if (params?.status) {
        query = query.eq('status', params.status);
    }
    const { data, error } = await query;
    if (error) {
        logDbError('listHumanTickets.query', error);
        return [];
    }
    if (!data || data.length === 0)
        return [];
    const tickets = data;
    const phones = [...new Set(tickets.map((t) => t.phone).filter(Boolean))];
    const phoneCandidates = new Set();
    for (const p of phones) {
        for (const v of phoneVariants(p))
            phoneCandidates.add(v);
    }
    const phoneList = Array.from(phoneCandidates);
    const minTicketStart = tickets
        .map((t) => new Date(t.created_at).getTime())
        .filter((ts) => !Number.isNaN(ts))
        .reduce((min, ts) => Math.min(min, ts), Number.POSITIVE_INFINITY);
    const sinceIso = Number.isFinite(minTicketStart)
        ? new Date(minTicketStart - 2 * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
    let messagesQuery = supabase
        .from('messages')
        .select('phone, direction, content, created_at')
        .in('phone', phoneList)
        .order('created_at', { ascending: true });
    if (sinceIso) {
        messagesQuery = messagesQuery.gte('created_at', sinceIso);
    }
    const [customersRes, messagesRes] = await Promise.all([
        supabase.from('customers').select('name, whatsapp_phone').in('whatsapp_phone', phoneList),
        messagesQuery
    ]);
    if (customersRes.error)
        logDbError('listHumanTickets.customers', customersRes.error);
    if (messagesRes.error)
        logDbError('listHumanTickets.messages', messagesRes.error);
    const customerNameByPhone = new Map();
    if (!customersRes.error && Array.isArray(customersRes.data)) {
        for (const c of customersRes.data) {
            if (typeof c.whatsapp_phone === 'string' && typeof c.name === 'string' && c.name.trim()) {
                for (const v of phoneVariants(c.whatsapp_phone)) {
                    customerNameByPhone.set(v, c.name.trim());
                }
            }
        }
    }
    const messagesByPhone = new Map();
    if (!messagesRes.error && Array.isArray(messagesRes.data)) {
        for (const m of messagesRes.data) {
            const list = messagesByPhone.get(m.phone);
            if (list)
                list.push(m);
            else
                messagesByPhone.set(m.phone, [m]);
        }
    }
    return tickets.map((t) => {
        const msgs = messagesByPhone.get(t.phone) ??
            phoneVariants(t.phone).map((v) => messagesByPhone.get(v) ?? []).find((arr) => arr.length > 0) ??
            [];
        const ticketStart = new Date(t.created_at).getTime();
        let lastMessageAt = null;
        let lastMessagePreview = null;
        let lastAgentOutAt = 0;
        let unreadCount = 0;
        for (const m of msgs) {
            const msgTime = new Date(m.created_at).getTime();
            if (Number.isNaN(msgTime))
                continue;
            // Última mensagem geral para prévia/lista.
            lastMessageAt = m.created_at;
            lastMessagePreview = buildMessagePreview(m.content);
            // Mensagens anteriores ao ticket atual não entram na regra de não lidas.
            if (msgTime < ticketStart)
                continue;
            // Considera "lida pelo atendente" quando houve resposta humana (out após abertura do ticket).
            if (m.direction === 'out' && msgTime > lastAgentOutAt) {
                lastAgentOutAt = msgTime;
            }
        }
        for (const m of msgs) {
            const msgTime = new Date(m.created_at).getTime();
            if (Number.isNaN(msgTime) || msgTime < ticketStart)
                continue;
            if (m.direction !== 'in')
                continue;
            if (msgTime > lastAgentOutAt)
                unreadCount += 1;
        }
        const guessedName = guessCustomerNameFromMessages(msgs);
        return {
            ...t,
            customer_name: customerNameByPhone.get(t.phone) ??
                phoneVariants(t.phone).map((v) => customerNameByPhone.get(v)).find((n) => typeof n === 'string' && n.trim().length > 0) ??
                guessedName ??
                null,
            last_message_preview: lastMessagePreview,
            last_message_at: lastMessageAt ?? t.created_at,
            unread_count: unreadCount
        };
    });
}
export async function getHumanTicketById(config, id) {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
        .from('human_tickets')
        .select('*')
        .eq('id', id)
        .limit(1)
        .maybeSingle();
    if (error) {
        logDbError('getHumanTicketById', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function updateHumanTicketAssignee(config, id, assignedAttendant) {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
        .from('human_tickets')
        .update({ assigned_attendant: assignedAttendant })
        .eq('id', id)
        .select('*')
        .limit(1)
        .maybeSingle();
    if (error) {
        logDbError('updateHumanTicketAssignee', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function getMessagesByPhone(config, phone, options) {
    const supabase = getSupabaseAdmin(config);
    const normalized = (phone || '').replace(/\D/g, '');
    const phoneCandidates = new Set();
    if (phone)
        phoneCandidates.add(phone);
    if (normalized) {
        phoneCandidates.add(normalized);
        if (normalized.startsWith('55') && normalized.length > 2) {
            phoneCandidates.add(normalized.slice(2));
        }
        else {
            phoneCandidates.add(`55${normalized}`);
        }
    }
    const candidateList = Array.from(phoneCandidates).filter(Boolean);
    const limit = Math.max(50, Math.min(options?.limit ?? 300, 1000));
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .in('phone', candidateList)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        logDbError('getMessagesByPhone', error);
        return [];
    }
    if (!data)
        return [];
    return [...data].sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return ta - tb;
    });
}
function buildMessagePreview(content) {
    const raw = (content ?? '').trim();
    if (!raw)
        return '';
    if (!raw.startsWith('{') && !raw.startsWith('[')) {
        return truncate(raw);
    }
    try {
        const parsed = JSON.parse(raw);
        const type = String(parsed.type ?? '');
        if (type === 'audio')
            return '[Audio]';
        if (type === 'video')
            return '[Video]';
        if (type === 'document')
            return '[Documento]';
        if (type === 'location')
            return '[Localização]';
        const textCandidates = [
            parsed.message,
            parsed.text,
            parsed.caption,
            parsed.title
        ];
        for (const c of textCandidates) {
            if (typeof c === 'string' && c.trim())
                return truncate(c);
        }
    }
    catch {
        // Fallback para conteudo textual bruto.
    }
    return truncate(raw);
}
function truncate(value, max = 72) {
    const v = value.replace(/\s+/g, ' ').trim();
    if (v.length <= max)
        return v;
    return `${v.slice(0, max - 1)}…`;
}
export async function updateHumanTicketStatus(config, id, status) {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
        .from('human_tickets')
        .update({ status })
        .eq('id', id)
        .select('*')
        .limit(1)
        .maybeSingle();
    if (error) {
        logDbError('updateHumanTicketStatus', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function ensureOpenHumanTicket(config, phone) {
    const supabase = getSupabaseAdmin(config);
    const { data: existing, error: existingError } = await supabase
        .from('human_tickets')
        .select('*')
        .eq('phone', phone)
        .in('status', ['pendente', 'em_atendimento'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (existingError) {
        logDbError('ensureOpenHumanTicket.selectExisting', existingError);
        return null;
    }
    if (existing) {
        return existing;
    }
    const { data, error } = await supabase
        .from('human_tickets')
        .insert({ phone, status: 'pendente' })
        .select('*')
        .limit(1)
        .maybeSingle();
    if (error) {
        logDbError('ensureOpenHumanTicket.insert', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function listHumanTicketNotes(config, ticketId) {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
        .from('human_ticket_notes')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
    if (error) {
        if (isMissingTableError(error, 'human_ticket_notes'))
            return [];
        logDbError('listHumanTicketNotes', error);
        return [];
    }
    if (!data)
        return [];
    return data;
}
export async function addHumanTicketNote(config, params) {
    const supabase = getSupabaseAdmin(config);
    const { data, error } = await supabase
        .from('human_ticket_notes')
        .insert({
        ticket_id: params.ticketId,
        author: params.author,
        note: params.note
    })
        .select('*')
        .limit(1)
        .maybeSingle();
    if (error) {
        if (isMissingTableError(error, 'human_ticket_notes'))
            return null;
        logDbError('addHumanTicketNote', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function getCustomerByPhone(config, phone) {
    const supabase = getSupabaseAdmin(config);
    const candidates = phoneVariants(phone);
    if (!candidates.length)
        return null;
    const { data, error } = await supabase
        .from('customers')
        .select('id, cpf, email, name, whatsapp_phone')
        .in('whatsapp_phone', candidates)
        .limit(1)
        .maybeSingle();
    if (error) {
        logDbError('getCustomerByPhone', error);
        return null;
    }
    if (!data)
        return null;
    return data;
}
export async function listLigacoesByCustomerId(config, customerId) {
    const supabase = getSupabaseAdmin(config);
    if (!customerId)
        return [];
    const { data, error } = await supabase
        .from('ligacoes')
        .select('id, numero_ligacao, categoria, servicos, situacao_abastecimento, endereco_imovel, endereco_correspondencia, titular, numero_hidrometro, data_ativacao')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) {
        logDbError('listLigacoesByCustomerId', error);
        return [];
    }
    if (!data)
        return [];
    return data;
}
function mediaFromContent(content) {
    const raw = (content ?? '').trim();
    if (!raw)
        return null;
    if (raw === '[Imagem recebida]')
        return { type: 'image', label: 'Imagem recebida' };
    if (raw === '[Vídeo recebido]' || raw === '[Video recebido]')
        return { type: 'video', label: 'Vídeo recebido' };
    if (raw === '[Documento recebido]')
        return { type: 'document', label: 'Documento recebido' };
    if (raw === '[Audio recebido]' || raw === '[Áudio recebido]')
        return { type: 'audio', label: 'Áudio recebido' };
    if (raw.startsWith('{') || raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            const t = String(parsed.type || '').toLowerCase();
            if (!t)
                return null;
            const urlCandidate = [parsed.url, parsed.linkUrl, parsed.document, parsed.video, parsed.image]
                .find((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
            if (t === 'image')
                return { type: 'image', label: 'Imagem', url: urlCandidate };
            if (t === 'video')
                return { type: 'video', label: 'Vídeo', url: urlCandidate };
            if (t === 'document')
                return { type: 'document', label: 'Documento', url: urlCandidate };
            if (t === 'audio')
                return { type: 'audio', label: 'Áudio', url: urlCandidate };
            return { type: 'other', label: 'Mídia', url: urlCandidate };
        }
        catch {
            return null;
        }
    }
    return null;
}
export async function listUserMediaByPhone(config, phone, limit = 120) {
    const supabase = getSupabaseAdmin(config);
    const candidates = phoneVariants(phone);
    if (!candidates.length)
        return [];
    const { data, error } = await supabase
        .from('messages')
        .select('id, content, created_at, direction')
        .in('phone', candidates)
        .eq('direction', 'in')
        .order('created_at', { ascending: false })
        .limit(Math.max(20, Math.min(limit, 300)));
    if (error) {
        logDbError('listUserMediaByPhone', error);
        return [];
    }
    if (!data)
        return [];
    const items = [];
    for (const row of data) {
        const media = mediaFromContent(row.content);
        if (!media)
            continue;
        items.push({
            id: row.id,
            type: media.type,
            label: media.label,
            created_at: row.created_at,
            content: row.content,
            url: media.url
        });
    }
    return items;
}
