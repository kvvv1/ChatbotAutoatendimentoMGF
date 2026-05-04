import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { getDb } from './client.js';

export type HumanTicketStatus = 'pendente' | 'em_atendimento' | 'finalizado' | 'cancelado';

export type HumanTicket = {
  id: string;
  phone: string;
  status: HumanTicketStatus;
  assigned_attendant: string | null;
  created_at: string;
  updated_at: string;
};

export type HumanTicketListItem = HumanTicket & {
  customer_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type HumanTicketNote = {
  id: string;
  ticket_id: string;
  author: string;
  note: string;
  created_at: string;
};

export type CustomerProfile = {
  id: string;
  cpf: string | null;
  email: string | null;
  name: string | null;
  whatsapp_phone: string;
};

export type LigacaoProfile = {
  id: string;
  numero_ligacao: string | null;
  categoria: string | null;
  servicos: string[] | null;
  situacao_abastecimento: string | null;
  endereco_imovel: string | null;
  endereco_correspondencia: string | null;
  titular: string | null;
  numero_hidrometro: string | null;
  data_ativacao: string | null;
};

export type UserMediaItem = {
  id: string;
  type: 'image' | 'video' | 'document' | 'audio' | 'other';
  label: string;
  created_at: string;
  content: string;
  url?: string;
};

export type MessageLog = {
  id: string;
  phone: string;
  direction: 'in' | 'out';
  content: string;
  created_at: string;
};

function logDbError(scope: string, error: unknown): void {
  try {
    if (!error) return;
    console.error(`[humanTickets:${scope}]`, error);
  } catch {
    // noop
  }
}

function phoneVariants(value: string): string[] {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return [];
  const out = new Set<string>();
  out.add(digits);
  if (digits.startsWith('55') && digits.length > 2) out.add(digits.slice(2));
  if (!digits.startsWith('55')) out.add(`55${digits}`);
  return Array.from(out);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractNameFromGreetingText(text: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const starred = raw.match(/ol[áa]\s*,?\s*\*+\s*([^*\n!,.]{2,80})\s*\*+/i);
  if (starred && starred[1]) {
    const n = normalizeName(starred[1]);
    if (n) return n;
  }
  const plain = raw.match(/ol[áa]\s*,?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,80})[!,.]/i);
  if (plain && plain[1]) {
    const n = normalizeName(plain[1]);
    if (n) return n;
  }
  return null;
}

function extractNameFromContent(content: string): string | null {
  const raw = (content ?? '').trim();
  if (!raw) return null;
  const direct = extractNameFromGreetingText(raw);
  if (direct) return direct;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidates = [parsed.message, parsed.text, parsed.caption, parsed.title];
      for (const c of candidates) {
        if (typeof c !== 'string') continue;
        const name = extractNameFromGreetingText(c);
        if (name) return name;
      }
    } catch {
      // noop
    }
  }
  return null;
}

function guessCustomerNameFromMessages(
  msgs: Array<{ direction: 'in' | 'out'; content: string }>
): string | null {
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (!m || typeof m.content !== 'string') continue;
    if (m.direction !== 'out') continue;
    const name = extractNameFromContent(m.content);
    if (name) return name;
  }
  return null;
}

function buildMessagePreview(content: string): string {
  const raw = (content ?? '').trim();
  if (!raw) return '';
  if (!raw.startsWith('{') && !raw.startsWith('[')) return truncate(raw);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const type = String(parsed.type ?? '');
    if (type === 'audio') return '[Audio]';
    if (type === 'video') return '[Video]';
    if (type === 'document') return '[Documento]';
    if (type === 'location') return '[Localizacao]';
    const textCandidates = [parsed.message, parsed.text, parsed.caption, parsed.title];
    for (const c of textCandidates) {
      if (typeof c === 'string' && c.trim()) return truncate(c);
    }
  } catch {
    // noop
  }
  return truncate(raw);
}

function truncate(value: string, max = 72): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max - 1)}...`;
}

function mediaFromContent(content: string): { type: UserMediaItem['type']; label: string; url?: string } | null {
  const raw = (content ?? '').trim();
  if (!raw) return null;
  if (raw === '[Imagem recebida]') return { type: 'image', label: 'Imagem recebida' };
  if (raw === '[Video recebido]') return { type: 'video', label: 'Video recebido' };
  if (raw === '[Documento recebido]') return { type: 'document', label: 'Documento recebido' };
  if (raw === '[Audio recebido]') return { type: 'audio', label: 'Audio recebido' };
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const t = String(parsed.type || '').toLowerCase();
      if (!t) return null;
      const urlCandidate = [parsed.url, parsed.linkUrl, parsed.document, parsed.video, parsed.image]
        .find((v) => typeof v === 'string' && /^https?:\/\//i.test(v as string)) as string | undefined;
      if (t === 'image') return { type: 'image', label: 'Imagem', url: urlCandidate };
      if (t === 'video') return { type: 'video', label: 'Video', url: urlCandidate };
      if (t === 'document') return { type: 'document', label: 'Documento', url: urlCandidate };
      if (t === 'audio') return { type: 'audio', label: 'Audio', url: urlCandidate };
      return { type: 'other', label: 'Midia', url: urlCandidate };
    } catch {
      return null;
    }
  }
  return null;
}

export async function listHumanTickets(
  config: AppConfig,
  params?: { status?: HumanTicketStatus | 'abertos' }
): Promise<HumanTicketListItem[]> {
  try {
    const pool = getDb(config);

    let tickets: HumanTicket[];
    if (params?.status === 'abertos') {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM human_tickets WHERE status IN ('pendente', 'em_atendimento') ORDER BY created_at DESC`
      );
      tickets = rows as unknown as HumanTicket[];
    } else if (params?.status) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM human_tickets WHERE status = ? ORDER BY created_at DESC',
        [params.status]
      );
      tickets = rows as unknown as HumanTicket[];
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM human_tickets ORDER BY created_at DESC'
      );
      tickets = rows as unknown as HumanTicket[];
    }

    if (tickets.length === 0) return [];

    const phones = [...new Set(tickets.map((t) => t.phone).filter(Boolean))];
    const phoneCandidates = new Set<string>();
    for (const p of phones) {
      for (const v of phoneVariants(p)) phoneCandidates.add(v);
    }
    const phoneList = Array.from(phoneCandidates);

    const minTicketStart = tickets
      .map((t) => new Date(t.created_at).getTime())
      .filter((ts) => !Number.isNaN(ts))
      .reduce((min, ts) => Math.min(min, ts), Number.POSITIVE_INFINITY);
    const sinceIso = Number.isFinite(minTicketStart)
      ? new Date(minTicketStart - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : undefined;

    const phPlaceholders = phoneList.map(() => '?').join(', ');

    const [customersRows] = await pool.query<RowDataPacket[]>(
      `SELECT name, whatsapp_phone FROM customers WHERE whatsapp_phone IN (${phPlaceholders})`,
      phoneList
    );

    let messagesRows: RowDataPacket[];
    if (sinceIso) {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT phone, direction, content, created_at FROM messages WHERE phone IN (${phPlaceholders}) AND created_at >= ? ORDER BY created_at ASC`,
        [...phoneList, sinceIso]
      );
      messagesRows = r as RowDataPacket[];
    } else {
      const [r] = await pool.query<RowDataPacket[]>(
        `SELECT phone, direction, content, created_at FROM messages WHERE phone IN (${phPlaceholders}) ORDER BY created_at ASC`,
        phoneList
      );
      messagesRows = r as RowDataPacket[];
    }

    const customerNameByPhone = new Map<string, string>();
    for (const c of customersRows as RowDataPacket[]) {
      if (typeof c.whatsapp_phone === 'string' && typeof c.name === 'string' && c.name.trim()) {
        for (const v of phoneVariants(c.whatsapp_phone)) {
          customerNameByPhone.set(v, c.name.trim());
        }
      }
    }

    type Msg = { phone: string; direction: 'in' | 'out'; content: string; created_at: string };
    const messagesByPhone = new Map<string, Msg[]>();
    for (const m of messagesRows as unknown as Msg[]) {
      const list = messagesByPhone.get(m.phone);
      if (list) list.push(m);
      else messagesByPhone.set(m.phone, [m]);
    }

    return tickets.map((t) => {
      const msgs =
        messagesByPhone.get(t.phone) ??
        phoneVariants(t.phone).map((v) => messagesByPhone.get(v) ?? []).find((arr) => arr.length > 0) ??
        [];
      const ticketStart = new Date(t.created_at).getTime();

      let lastMessageAt: string | null = null;
      let lastMessagePreview: string | null = null;
      let lastAgentOutAt = 0;
      let unreadCount = 0;

      for (const m of msgs) {
        const msgTime = new Date(m.created_at).getTime();
        if (Number.isNaN(msgTime)) continue;
        lastMessageAt = m.created_at;
        lastMessagePreview = buildMessagePreview(m.content);
        if (msgTime < ticketStart) continue;
        if (m.direction === 'out' && msgTime > lastAgentOutAt) {
          lastAgentOutAt = msgTime;
        }
      }

      for (const m of msgs) {
        const msgTime = new Date(m.created_at).getTime();
        if (Number.isNaN(msgTime) || msgTime < ticketStart) continue;
        if (m.direction !== 'in') continue;
        if (msgTime > lastAgentOutAt) unreadCount += 1;
      }

      const guessedName = guessCustomerNameFromMessages(msgs);

      return {
        ...t,
        customer_name:
          customerNameByPhone.get(t.phone) ??
          phoneVariants(t.phone).map((v) => customerNameByPhone.get(v)).find((n) => typeof n === 'string' && n.trim().length > 0) ??
          guessedName ??
          null,
        last_message_preview: lastMessagePreview,
        last_message_at: lastMessageAt ?? t.created_at,
        unread_count: unreadCount
      };
    });
  } catch (err) {
    logDbError('listHumanTickets', err);
    return [];
  }
}

export async function getHumanTicketById(
  config: AppConfig,
  id: string
): Promise<HumanTicket | null> {
  try {
    const pool = getDb(config);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM human_tickets WHERE id = ? LIMIT 1', [id]);
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    return list[0] as unknown as HumanTicket;
  } catch (err) {
    logDbError('getHumanTicketById', err);
    return null;
  }
}

export async function updateHumanTicketAssignee(
  config: AppConfig,
  id: string,
  assignedAttendant: string | null
): Promise<HumanTicket | null> {
  try {
    const pool = getDb(config);
    await pool.query('UPDATE human_tickets SET assigned_attendant = ? WHERE id = ?', [assignedAttendant, id]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM human_tickets WHERE id = ? LIMIT 1', [id]);
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    return list[0] as unknown as HumanTicket;
  } catch (err) {
    logDbError('updateHumanTicketAssignee', err);
    return null;
  }
}

export async function getMessagesByPhone(
  config: AppConfig,
  phone: string,
  options?: { limit?: number }
): Promise<MessageLog[]> {
  try {
    const pool = getDb(config);
    const normalized = (phone || '').replace(/\D/g, '');
    const phoneCandidates = new Set<string>();
    if (phone) phoneCandidates.add(phone);
    if (normalized) {
      phoneCandidates.add(normalized);
      if (normalized.startsWith('55') && normalized.length > 2) {
        phoneCandidates.add(normalized.slice(2));
      } else {
        phoneCandidates.add(`55${normalized}`);
      }
    }
    const candidateList = Array.from(phoneCandidates).filter(Boolean);
    const limit = Math.max(50, Math.min(options?.limit ?? 300, 1000));
    const placeholders = candidateList.map(() => '?').join(', ');

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM messages WHERE phone IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
      [...candidateList, limit]
    );

    return [...(rows as unknown as MessageLog[])].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta - tb;
    });
  } catch (err) {
    logDbError('getMessagesByPhone', err);
    return [];
  }
}

export async function updateHumanTicketStatus(
  config: AppConfig,
  id: string,
  status: HumanTicketStatus
): Promise<HumanTicket | null> {
  try {
    const pool = getDb(config);
    await pool.query('UPDATE human_tickets SET status = ? WHERE id = ?', [status, id]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM human_tickets WHERE id = ? LIMIT 1', [id]);
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    return list[0] as unknown as HumanTicket;
  } catch (err) {
    logDbError('updateHumanTicketStatus', err);
    return null;
  }
}

export async function ensureOpenHumanTicket(
  config: AppConfig,
  phone: string
): Promise<HumanTicket | null> {
  try {
    const pool = getDb(config);
    const [existingRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM human_tickets WHERE phone = ? AND status IN ('pendente', 'em_atendimento') ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    const existing = existingRows as RowDataPacket[];
    if (existing.length > 0) return existing[0] as unknown as HumanTicket;

    const newId = randomUUID();
    await pool.query('INSERT INTO human_tickets (id, phone, status) VALUES (?, ?, ?)', [newId, phone, 'pendente']);
    const [insertedRows] = await pool.query<RowDataPacket[]>('SELECT * FROM human_tickets WHERE id = ? LIMIT 1', [newId]);
    const inserted = insertedRows as RowDataPacket[];
    if (inserted.length === 0) return null;
    return inserted[0] as unknown as HumanTicket;
  } catch (err) {
    logDbError('ensureOpenHumanTicket', err);
    return null;
  }
}

export async function listHumanTicketNotes(
  config: AppConfig,
  ticketId: string
): Promise<HumanTicketNote[]> {
  try {
    const pool = getDb(config);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM human_ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticketId]
    );
    return rows as unknown as HumanTicketNote[];
  } catch (err) {
    logDbError('listHumanTicketNotes', err);
    return [];
  }
}

export async function addHumanTicketNote(
  config: AppConfig,
  params: { ticketId: string; author: string; note: string }
): Promise<HumanTicketNote | null> {
  try {
    const pool = getDb(config);
    const newId = randomUUID();
    await pool.query(
      'INSERT INTO human_ticket_notes (id, ticket_id, author, note) VALUES (?, ?, ?, ?)',
      [newId, params.ticketId, params.author, params.note]
    );
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM human_ticket_notes WHERE id = ? LIMIT 1', [newId]);
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    return list[0] as unknown as HumanTicketNote;
  } catch (err) {
    logDbError('addHumanTicketNote', err);
    return null;
  }
}

export async function getCustomerByPhone(
  config: AppConfig,
  phone: string
): Promise<CustomerProfile | null> {
  try {
    const pool = getDb(config);
    const candidates = phoneVariants(phone);
    if (!candidates.length) return null;
    const placeholders = candidates.map(() => '?').join(', ');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, cpf, email, name, whatsapp_phone FROM customers WHERE whatsapp_phone IN (${placeholders}) LIMIT 1`,
      candidates
    );
    const list = rows as RowDataPacket[];
    if (list.length === 0) return null;
    return list[0] as unknown as CustomerProfile;
  } catch (err) {
    logDbError('getCustomerByPhone', err);
    return null;
  }
}

export async function listLigacoesByCustomerId(
  config: AppConfig,
  customerId: string
): Promise<LigacaoProfile[]> {
  try {
    const pool = getDb(config);
    if (!customerId) return [];
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, numero_ligacao, categoria, servicos, situacao_abastecimento,
              endereco_imovel, endereco_correspondencia, titular, numero_hidrometro, data_ativacao
       FROM ligacoes WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
      [customerId]
    );
    return rows as unknown as LigacaoProfile[];
  } catch (err) {
    logDbError('listLigacoesByCustomerId', err);
    return [];
  }
}

export async function listUserMediaByPhone(
  config: AppConfig,
  phone: string,
  limit = 120
): Promise<UserMediaItem[]> {
  try {
    const pool = getDb(config);
    const candidates = phoneVariants(phone);
    if (!candidates.length) return [];
    const safeLimit = Math.max(20, Math.min(limit, 300));
    const placeholders = candidates.map(() => '?').join(', ');

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, content, created_at, direction FROM messages WHERE phone IN (${placeholders}) AND direction = 'in' ORDER BY created_at DESC LIMIT ?`,
      [...candidates, safeLimit]
    );

    const items: UserMediaItem[] = [];
    for (const row of rows as unknown as Array<{ id: string; content: string; created_at: string; direction: string }>) {
      const media = mediaFromContent(row.content);
      if (!media) continue;
      items.push({ id: row.id, type: media.type, label: media.label, created_at: row.created_at, content: row.content, url: media.url });
    }
    return items;
  } catch (err) {
    logDbError('listUserMediaByPhone', err);
    return [];
  }
}
