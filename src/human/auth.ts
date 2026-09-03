import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h de sessão

/** Hash de senha com scrypt (nativo do Node, sem dependência externa). Formato: salt:hash, ambos em hex. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computed, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type AttendantTokenPayload = {
  sub: string; // attendant id
  nome: string;
  email: string;
  exp: number; // epoch seconds
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Token assinado (HMAC-SHA256), formato <payload_base64url>.<assinatura_base64url>.
 * Não é JWT padrão, mas segue o mesmo princípio — payload legível + assinatura verificável,
 * sem precisar da dependência jsonwebtoken só pra isso.
 */
export function signAttendantToken(payload: Omit<AttendantTokenPayload, 'exp'>, secret: string): string {
  const full: AttendantTokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const payloadPart = base64url(JSON.stringify(full));
  const signature = crypto.createHmac('sha256', secret).update(payloadPart).digest('base64url');
  return `${payloadPart}.${signature}`;
}

export function verifyAttendantToken(token: string, secret: string): AttendantTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) return null;

  const expected = crypto.createHmac('sha256', secret).update(payloadPart).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as AttendantTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Exige um token de atendente válido nas rotas do painel listadas em pathPrefixes
 * (exceto /api/auth/login, que é o próprio ponto de entrada). Fail-open se
 * ATTENDANT_AUTH_SECRET/API_SECRET não estiver configurado — mesmo padrão de
 * rollout gradual usado em src/security/apiAuth.ts, pra não quebrar instâncias
 * que ainda não migraram pro login de atendente.
 */
export function createAttendantAuthHook(config: AppConfig, pathPrefixes: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.url.startsWith('/api/auth/login')) return;
    if (!pathPrefixes.some(p => request.url.startsWith(p))) return;

    const secret = config.attendantAuthSecret;
    if (!secret) return;

    // Header próprio (não "Authorization", que já é usado pela chave API_SECRET) —
    // evita colisão entre os dois mecanismos de auth, que hoje coexistem.
    const header = request.headers['x-attendant-token'];
    const headerToken = typeof header === 'string' ? header.trim() : '';
    const queryToken = typeof (request.query as any)?.token === 'string' ? (request.query as any).token : '';
    const payload = verifyAttendantToken(headerToken || queryToken, secret);
    if (!payload) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    (request as any).attendant = payload;
  };
}
