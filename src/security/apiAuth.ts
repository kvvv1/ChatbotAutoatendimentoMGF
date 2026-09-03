import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Exige a chave em API_SECRET nas rotas /api/*, via header Authorization: Bearer <chave>
 * ou querystring ?key=<chave> (necessário para o EventSource do SSE, que não permite headers customizados).
 *
 * Fail-open se API_SECRET não estiver configurado — evita quebrar instâncias existentes
 * que ainda não adicionaram a variável ao .env. Configure API_SECRET para fechar o acesso.
 */
export function createApiAuthHook(secret: string | undefined, pathPrefixes: string | string[]) {
  const prefixes = Array.isArray(pathPrefixes) ? pathPrefixes : [pathPrefixes];
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!secret) return;
    if (!prefixes.some(p => request.url.startsWith(p))) return;

    const header = request.headers['authorization'];
    const headerToken = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
    const queryToken = typeof (request.query as any)?.key === 'string' ? (request.query as any).key : '';

    if (headerToken !== secret && queryToken !== secret) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
