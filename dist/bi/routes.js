import { getDb } from '../supabase/client.js';
export async function registerBiRoutes(app, config) {
    const db = getDb(config);
    async function q(sql, params = []) {
        const [rows] = await db.execute(sql, params);
        return rows;
    }
    // Parse from/to strings, fall back to `days` offset from today
    function parsePeriod(qs) {
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (qs.from && qs.to) {
            return [qs.from, qs.to];
        }
        const days = Math.min(365, Math.max(1, parseInt(qs.days ?? '30', 10)));
        const from = new Date(today);
        from.setDate(from.getDate() - days + 1);
        return [fmt(from), fmt(today)];
    }
    function prevPeriod(from, to) {
        const ms = (s) => new Date(s + 'T00:00:00').getTime();
        const diff = ms(to) - ms(from);
        const prevTo = new Date(ms(from) - 24 * 60 * 60 * 1000);
        const prevFrom = new Date(prevTo.getTime() - diff);
        const fmt = (d) => d.toISOString().slice(0, 10);
        return [fmt(prevFrom), fmt(prevTo)];
    }
    function delta(curr, prev) {
        if (prev === 0)
            return null;
        return Math.round(((curr - prev) / prev) * 100);
    }
    app.get('/api/bi/info', async () => ({
        entidade: config.entidadeNome,
        entidadeCompleto: config.entidadeNomeCompleto,
    }));
    app.get('/api/bi/metrics', async (req, reply) => {
        const qs = req.query;
        const [from, to] = parsePeriod(qs);
        const [pFrom, pTo] = prevPeriod(from, to);
        try {
            const [
            // ── Sessões ──────────────────────────────────────────────────────────
            uniqueUsers, uniqueUsersPrev, authenticatedUsers, authenticatedUsersPrev, newUsers, // first message in period
            returningUsers, // had messages before period
            avgMsgsPerSession, 
            // ── Funil ─────────────────────────────────────────────────────────────
            funnelOtpAttempts, funnelOtpVerified, challengeStarted, 
            // ── Menu clicks ───────────────────────────────────────────────────────
            clickVideo, clickConsumo, clickSegundaVia, clickLocalizacao, clickAtendente, clickVideoPrev, clickConsumoPrev, clickSegundaViaPrev, clickLocalizacaoPrev, clickAtendentePrev, 
            // ── Tickets ───────────────────────────────────────────────────────────
            ticketsByStatus, ticketsTotal, ticketsTotalPrev, avgTicketTime, avgTicketTimePrev, ticketsPerDay, ticketsPendingSemAtendente, topAttendants, 
            // ── OTP ───────────────────────────────────────────────────────────────
            otpTotal, otpTotalPrev, otpSuccess, otpSuccessPrev, otpExpired, otpWithErrors, 
            // ── Volume ────────────────────────────────────────────────────────────
            byHour, byDow, messagesPerDay, 
            // ── Financeiro ────────────────────────────────────────────────────────
            faturasByStatus, faturasValorTotal, faturasCount, faturasCountPrev,] = await Promise.all([
                // ── Sessões ──────────────────────────────────────────────────────────
                q(`SELECT COUNT(DISTINCT phone) AS total FROM messages
           WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(DISTINCT phone) AS total FROM messages
           WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(DISTINCT phone) AS total FROM messages
           WHERE direction = 'out'
             AND content LIKE 'Olá, *%*! 👋'
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(DISTINCT phone) AS total FROM messages
           WHERE direction = 'out'
             AND content LIKE 'Olá, *%*! 👋'
             AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                // Novos usuários: primeiro contato DENTRO do período
                q(`SELECT COUNT(*) AS total FROM (
             SELECT phone, MIN(DATE(created_at)) AS first_date
             FROM messages WHERE direction = 'in'
             GROUP BY phone
             HAVING first_date BETWEEN ? AND ?
           ) t`, [from, to]),
                // Recorrentes: voltou em mais de 1 dia distinto no período OU tinha mensagem antes
                q(`SELECT COUNT(DISTINCT phone) AS total FROM (
             SELECT phone FROM messages
             WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY phone
             HAVING COUNT(DISTINCT DATE(created_at)) > 1
                 OR MIN(DATE(created_at)) < ?
           ) t`, [from, to, from]),
                // Média de mensagens por sessão (phone+dia)
                q(`SELECT ROUND(AVG(cnt)) AS avg_msgs FROM (
             SELECT phone, DATE(created_at) AS day, COUNT(*) AS cnt
             FROM messages
             WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY phone, day
           ) t`, [from, to]),
                // ── Funil ─────────────────────────────────────────────────────────────
                q(`SELECT COUNT(DISTINCT phone) AS total FROM otp_codes
           WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(DISTINCT phone) AS total FROM otp_codes
           WHERE used_at IS NOT NULL AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                // Verificação por perguntas (usuários sem e-mail — 2 questões de identidade)
                q(`SELECT COUNT(DISTINCT phone) AS total FROM messages
           WHERE direction = 'out'
             AND content LIKE '%Para confirmar sua identidade, precisamos de algumas informações%'
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                // ── Menu clicks ───────────────────────────────────────────────────────
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%"type":"video"%'
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%Histórico recente de consumo%'
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND (content LIKE '%2ª via%' OR content LIKE '%linha digit%')
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%maps.google%'
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM human_tickets
           WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                // Menu prev period
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%"type":"video"%'
             AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%Histórico recente de consumo%'
             AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND (content LIKE '%2ª via%' OR content LIKE '%linha digit%')
             AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM messages
           WHERE direction = 'out' AND content LIKE '%maps.google%'
             AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM human_tickets
           WHERE DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                // ── Tickets ───────────────────────────────────────────────────────────
                q(`SELECT status, COUNT(*) AS count FROM human_tickets GROUP BY status`),
                q(`SELECT COUNT(*) AS total FROM human_tickets
           WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM human_tickets
           WHERE DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at))) AS avg_min
           FROM human_tickets
           WHERE status = 'finalizado' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at))) AS avg_min
           FROM human_tickets
           WHERE status = 'finalizado' AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
           FROM human_tickets
           WHERE DATE(created_at) BETWEEN ? AND ?
           GROUP BY day ORDER BY day`, [from, to]),
                q(`SELECT id, phone,
             COALESCE(NULLIF(assigned_attendant, ''), NULL) AS assigned_attendant,
             created_at,
             TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS minutos_aguardando
           FROM human_tickets
           WHERE status = 'pendente'
             AND (assigned_attendant IS NULL OR assigned_attendant = '')
           ORDER BY created_at ASC
           LIMIT 5`),
                q(`SELECT assigned_attendant, COUNT(*) AS total,
             SUM(CASE WHEN status='finalizado' THEN 1 ELSE 0 END) AS finalizados,
             ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at))) AS avg_min
           FROM human_tickets
           WHERE assigned_attendant IS NOT NULL AND assigned_attendant != ''
             AND DATE(created_at) BETWEEN ? AND ?
           GROUP BY assigned_attendant
           ORDER BY total DESC
           LIMIT 8`, [from, to]),
                // ── OTP ───────────────────────────────────────────────────────────────
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE used_at IS NOT NULL AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE used_at IS NOT NULL AND DATE(created_at) BETWEEN ? AND ?`, [pFrom, pTo]),
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE used_at IS NULL AND expires_at < NOW()
             AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                q(`SELECT COUNT(*) AS total FROM otp_codes
           WHERE attempts > 0 AND DATE(created_at) BETWEEN ? AND ?`, [from, to]),
                // ── Volume ────────────────────────────────────────────────────────────
                q(`SELECT HOUR(created_at) AS hour, COUNT(*) AS count
           FROM messages
           WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?
           GROUP BY hour ORDER BY hour`, [from, to]),
                q(`SELECT DAYOFWEEK(created_at) AS dow, COUNT(*) AS count
           FROM messages
           WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?
           GROUP BY dow ORDER BY dow`, [from, to]),
                q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
           FROM messages
           WHERE direction = 'in' AND DATE(created_at) BETWEEN ? AND ?
           GROUP BY day ORDER BY day`, [from, to]),
                // ── Financeiro ────────────────────────────────────────────────────────
                // Filtra por vencimento (data da fatura), não por created_at (data de importação)
                q(`SELECT status, COUNT(*) AS count, ROUND(SUM(valor), 2) AS valor
           FROM faturas
           WHERE DATE(vencimento) BETWEEN ? AND ?
           GROUP BY status`, [from, to]).catch(() => []),
                q(`SELECT ROUND(SUM(valor), 2) AS total, COUNT(*) AS count
           FROM faturas
           WHERE DATE(vencimento) BETWEEN ? AND ?`, [from, to]).catch(() => []),
                q(`SELECT COUNT(*) AS total FROM faturas
           WHERE DATE(vencimento) BETWEEN ? AND ?`, [from, to]).catch(() => []),
                q(`SELECT COUNT(*) AS total FROM faturas
           WHERE DATE(vencimento) BETWEEN ? AND ?`, [pFrom, pTo]).catch(() => []),
            ]);
            const totalUsers = Number(uniqueUsers[0]?.total ?? 0);
            const totalUsersPrev = Number(uniqueUsersPrev[0]?.total ?? 0);
            const authUsers = Number(authenticatedUsers[0]?.total ?? 0);
            const authUsersPrev = Number(authenticatedUsersPrev[0]?.total ?? 0);
            const tickets = Number(ticketsTotal[0]?.total ?? 0);
            const ticketsPrev = Number(ticketsTotalPrev[0]?.total ?? 0);
            const otpTot = Number(otpTotal[0]?.total ?? 0);
            const otpTotPrev = Number(otpTotalPrev[0]?.total ?? 0);
            const otpSuc = Number(otpSuccess[0]?.total ?? 0);
            const otpSucPrev = Number(otpSuccessPrev[0]?.total ?? 0);
            // Usa null apenas quando a query não retornou resultado — 0 minutos é valor válido
            const avgMin = avgTicketTime[0]?.avg_min != null ? Number(avgTicketTime[0].avg_min) : null;
            const avgMinPrev = avgTicketTimePrev[0]?.avg_min != null ? Number(avgTicketTimePrev[0].avg_min) : null;
            const faturasTotal = Number(faturasCount[0]?.total ?? 0);
            const faturasTotalPrev = Number(faturasCountPrev[0]?.total ?? 0);
            return {
                period: { from, to },
                prevPeriod: { from: pFrom, to: pTo },
                overview: {
                    uniqueUsers: totalUsers,
                    uniqueUsersDelta: delta(totalUsers, totalUsersPrev),
                    authenticatedUsers: authUsers,
                    authenticatedUsersDelta: delta(authUsers, authUsersPrev),
                    tickets,
                    ticketsDelta: delta(tickets, ticketsPrev),
                    otpTotal: otpTot,
                    otpTotalDelta: delta(otpTot, otpTotPrev),
                    otpSuccessRate: otpTot > 0 ? Math.round((otpSuc / otpTot) * 100) : 0,
                    otpSuccessRateDelta: delta(otpTot > 0 ? Math.round((otpSuc / otpTot) * 100) : 0, otpTotPrev > 0 ? Math.round((otpSucPrev / otpTotPrev) * 100) : 0),
                    avgTicketMinutes: avgMin,
                    avgTicketMinutesDelta: avgMin && avgMinPrev ? delta(avgMin, avgMinPrev) : null,
                },
                // Funil: usuários únicos > reconhecidos > verificação por perguntas > OTP > verificado
                funnel: [
                    { label: 'Usuários únicos', value: totalUsers },
                    { label: 'Reconhecidos / Auth', value: authUsers },
                    { label: 'Verificação por perguntas', value: Number(challengeStarted[0]?.total ?? 0) },
                    { label: 'Solicitaram OTP', value: Number(funnelOtpAttempts[0]?.total ?? 0) },
                    { label: 'OTP verificado', value: Number(funnelOtpVerified[0]?.total ?? 0) },
                ],
                sessions: {
                    uniqueUsers: totalUsers,
                    uniqueUsersDelta: delta(totalUsers, totalUsersPrev),
                    authenticatedUsers: authUsers,
                    authenticatedUsersDelta: delta(authUsers, authUsersPrev),
                    authRate: totalUsers > 0 ? Math.round((authUsers / totalUsers) * 100) : 0,
                    newUsers: Number(newUsers[0]?.total ?? 0),
                    returningUsers: Number(returningUsers[0]?.total ?? 0),
                    avgMsgsPerSession: avgMsgsPerSession[0]?.avg_msgs != null ? Number(avgMsgsPerSession[0].avg_msgs) : null,
                    challengeUsers: Number(challengeStarted[0]?.total ?? 0),
                },
                menuClicks: {
                    video: Number(clickVideo[0]?.total ?? 0),
                    videoDelta: delta(Number(clickVideo[0]?.total ?? 0), Number(clickVideoPrev[0]?.total ?? 0)),
                    consumo: Number(clickConsumo[0]?.total ?? 0),
                    consumoDelta: delta(Number(clickConsumo[0]?.total ?? 0), Number(clickConsumoPrev[0]?.total ?? 0)),
                    segundaVia: Number(clickSegundaVia[0]?.total ?? 0),
                    segundaViaDelta: delta(Number(clickSegundaVia[0]?.total ?? 0), Number(clickSegundaViaPrev[0]?.total ?? 0)),
                    localizacao: Number(clickLocalizacao[0]?.total ?? 0),
                    localizacaoDelta: delta(Number(clickLocalizacao[0]?.total ?? 0), Number(clickLocalizacaoPrev[0]?.total ?? 0)),
                    atendente: Number(clickAtendente[0]?.total ?? 0),
                    atendenteDelta: delta(Number(clickAtendente[0]?.total ?? 0), Number(clickAtendentePrev[0]?.total ?? 0)),
                },
                tickets: {
                    byStatus: ticketsByStatus,
                    total: tickets,
                    totalDelta: delta(tickets, ticketsPrev),
                    avgTimeMinutes: avgMin,
                    avgTimeDelta: avgMin && avgMinPrev ? delta(avgMin, avgMinPrev) : null,
                    perDay: ticketsPerDay,
                    pendingSemAtendente: ticketsPendingSemAtendente,
                    topAttendants,
                },
                otp: {
                    total: otpTot,
                    totalDelta: delta(otpTot, otpTotPrev),
                    success: otpSuc,
                    successDelta: delta(otpSuc, otpSucPrev),
                    expired: Number(otpExpired[0]?.total ?? 0),
                    withErrors: Number(otpWithErrors[0]?.total ?? 0),
                    successRate: otpTot > 0 ? Math.round((otpSuc / otpTot) * 100) : 0,
                    successRateDelta: delta(otpTot > 0 ? Math.round((otpSuc / otpTot) * 100) : 0, otpTotPrev > 0 ? Math.round((otpSucPrev / otpTotPrev) * 100) : 0),
                },
                volume: {
                    byHour,
                    byDow,
                    perDay: messagesPerDay,
                },
                financeiro: {
                    total: faturasTotal,
                    totalDelta: delta(faturasTotal, faturasTotalPrev),
                    valorTotal: Number(faturasValorTotal[0]?.total ?? 0),
                    byStatus: faturasByStatus,
                },
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.code(500).send({ error: message });
        }
    });
    // ── Diagnostic ────────────────────────────────────────────────────────────
    // GET /api/bi/debug — lista tabelas e colunas disponíveis no banco
    app.get('/api/bi/debug', async (_, reply) => {
        try {
            const tables = await q(`SHOW TABLES`);
            const key = Object.keys(tables[0] ?? {})[0];
            const names = tables.map(r => String(r[key]));
            const cols = {};
            for (const t of names) {
                const c = await q(`SHOW COLUMNS FROM \`${t}\``);
                cols[t] = c.map(r => String(r.Field));
            }
            return { tables: names, columns: cols };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/debug/audit — mostra actions disponíveis no audit_logs
    app.get('/api/bi/debug/audit', async (_, reply) => {
        try {
            const actions = await q(`SELECT action, COUNT(*) AS total FROM audit_logs GROUP BY action ORDER BY total DESC`);
            const sample = await q(`SELECT action, whatsapp_phone, cpf, payload, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10`);
            return { actions, sample };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/debug/faturas — diagnóstico específico da tabela faturas
    app.get('/api/bi/debug/faturas', async (_, reply) => {
        try {
            const [count] = await q(`SELECT COUNT(*) AS total FROM faturas`);
            const [ranges] = await q(`
        SELECT
          COUNT(*) AS total,
          MIN(vencimento) AS min_vencimento,
          MAX(vencimento) AS max_vencimento,
          MIN(created_at) AS min_created,
          MAX(created_at) AS max_created,
          ROUND(SUM(valor), 2) AS valor_total,
          ROUND(AVG(valor), 2) AS valor_medio
        FROM faturas
      `);
            const byStatus = await q(`SELECT status, COUNT(*) AS cnt FROM faturas GROUP BY status`);
            const sample = await q(`SELECT id, identificador, referencia, status, valor, vencimento, created_at FROM faturas ORDER BY vencimento DESC LIMIT 5`);
            return { count: count?.total, ranges, byStatus, sample };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // ── Detail / drill-down endpoints ─────────────────────────────────────────
    // GET /api/bi/detail/sessions — list of phones with activity summary
    app.get('/api/bi/detail/sessions', async (req, reply) => {
        const qs = req.query;
        const [from, to] = parsePeriod(qs);
        const limit = Math.min(200, Math.max(1, parseInt(qs.limit ?? '50', 10)));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10));
        const filter = qs.filter ?? 'all'; // all | authenticated | new | returning
        try {
            let baseWhere = `WHERE m.direction = 'in' AND DATE(m.created_at) BETWEEN ? AND ?`;
            const params = [from, to];
            if (filter === 'authenticated') {
                baseWhere += ` AND EXISTS (
          SELECT 1 FROM messages ma
          WHERE ma.phone = m.phone AND ma.direction = 'out'
            AND ma.content LIKE 'Olá, *%*! 👋'
            AND DATE(ma.created_at) BETWEEN ? AND ?
        )`;
                params.push(from, to);
            }
            else if (filter === 'new') {
                baseWhere += ` AND NOT EXISTS (
          SELECT 1 FROM messages mb WHERE mb.phone = m.phone
            AND mb.direction = 'in' AND DATE(mb.created_at) < ?
        )`;
                params.push(from);
            }
            else if (filter === 'returning') {
                baseWhere += ` AND EXISTS (
          SELECT 1 FROM messages mb WHERE mb.phone = m.phone
            AND mb.direction = 'in' AND DATE(mb.created_at) < ?
        )`;
                params.push(from);
            }
            const [countRow] = await q(`SELECT COUNT(DISTINCT m.phone) AS total FROM messages m ${baseWhere}`, params);
            const rows = await q(`SELECT
           m.phone,
           COUNT(*) AS msg_count,
           MIN(DATE_FORMAT(m.created_at,'%Y-%m-%d %H:%i')) AS primeiro_contato,
           MAX(DATE_FORMAT(m.created_at,'%Y-%m-%d %H:%i')) AS ultimo_contato,
           EXISTS (
             SELECT 1 FROM messages ma
             WHERE ma.phone = m.phone AND ma.direction = 'out'
               AND ma.content LIKE 'Olá, *%*! 👋'
               AND DATE(ma.created_at) BETWEEN ? AND ?
           ) AS autenticado
         FROM messages m
         ${baseWhere}
         GROUP BY m.phone
         ORDER BY ultimo_contato DESC
         LIMIT ? OFFSET ?`, [from, to, ...params, limit, offset]);
            return { total: Number(countRow?.total ?? 0), from, to, rows };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/detail/tickets — paginated ticket list
    app.get('/api/bi/detail/tickets', async (req, reply) => {
        const qs = req.query;
        const [from, to] = parsePeriod(qs);
        const limit = Math.min(200, Math.max(1, parseInt(qs.limit ?? '50', 10)));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10));
        const status = qs.status ?? '';
        const attendant = qs.attendant ?? '';
        try {
            const params = [from, to];
            let extra = '';
            if (status) {
                extra += ` AND status = ?`;
                params.push(status);
            }
            if (attendant) {
                extra += ` AND assigned_attendant = ?`;
                params.push(attendant);
            }
            const [countRow] = await q(`SELECT COUNT(*) AS total FROM human_tickets
         WHERE DATE(created_at) BETWEEN ? AND ? ${extra}`, params);
            const rows = await q(`SELECT
           id,
           phone,
           status,
           COALESCE(NULLIF(assigned_attendant,''), '—') AS assigned_attendant,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS criado_em,
           DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i') AS atualizado_em,
           TIMESTAMPDIFF(MINUTE, created_at, COALESCE(
             CASE WHEN status='finalizado' THEN updated_at ELSE NULL END,
             NOW()
           )) AS duracao_min
         FROM human_tickets
         WHERE DATE(created_at) BETWEEN ? AND ? ${extra}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`, [...params, limit, offset]);
            return { total: Number(countRow?.total ?? 0), from, to, rows };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/detail/otp — paginated OTP list
    app.get('/api/bi/detail/otp', async (req, reply) => {
        const qs = req.query;
        const [from, to] = parsePeriod(qs);
        const limit = Math.min(200, Math.max(1, parseInt(qs.limit ?? '50', 10)));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10));
        const filter = qs.filter ?? 'all'; // all | used | expired | errors
        try {
            let extra = '';
            const params = [from, to];
            if (filter === 'used')
                extra = ` AND used_at IS NOT NULL`;
            if (filter === 'expired')
                extra = ` AND used_at IS NULL AND expires_at < NOW()`;
            if (filter === 'errors')
                extra = ` AND attempts > 0`;
            const [countRow] = await q(`SELECT COUNT(*) AS total FROM otp_codes
         WHERE DATE(created_at) BETWEEN ? AND ? ${extra}`, params);
            const rows = await q(`SELECT
           id,
           phone,
           attempts,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS criado_em,
           DATE_FORMAT(expires_at,  '%Y-%m-%d %H:%i') AS expira_em,
           DATE_FORMAT(used_at,     '%Y-%m-%d %H:%i') AS usado_em,
           CASE
             WHEN used_at IS NOT NULL             THEN 'verificado'
             WHEN expires_at < NOW()              THEN 'expirado'
             WHEN attempts > 0                    THEN 'com_tentativas'
             ELSE 'pendente'
           END AS status_otp
         FROM otp_codes
         WHERE DATE(created_at) BETWEEN ? AND ? ${extra}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`, [...params, limit, offset]);
            return { total: Number(countRow?.total ?? 0), from, to, rows };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/detail/messages — conversation history for a phone
    app.get('/api/bi/detail/messages', async (req, reply) => {
        const qs = req.query;
        const phone = qs.phone ?? '';
        const [from, to] = parsePeriod(qs);
        const limit = Math.min(200, Math.max(1, parseInt(qs.limit ?? '100', 10)));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10));
        if (!phone)
            return reply.code(400).send({ error: 'phone required' });
        try {
            const [countRow] = await q(`SELECT COUNT(*) AS total FROM messages
         WHERE phone = ? AND DATE(created_at) BETWEEN ? AND ?`, [phone, from, to]);
            const rows = await q(`SELECT
           id,
           direction,
           SUBSTRING(content, 1, 400) AS content,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS criado_em
         FROM messages
         WHERE phone = ? AND DATE(created_at) BETWEEN ? AND ?
         ORDER BY created_at ASC
         LIMIT ? OFFSET ?`, [phone, from, to, limit, offset]);
            return { total: Number(countRow?.total ?? 0), phone, from, to, rows };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // GET /api/bi/detail/financeiro — paginated fatura list
    app.get('/api/bi/detail/financeiro', async (req, reply) => {
        const qs = req.query;
        const [from, to] = parsePeriod(qs);
        const limit = Math.min(200, Math.max(1, parseInt(qs.limit ?? '50', 10)));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10));
        const status = qs.status ?? '';
        try {
            const params = [from, to];
            const extra = status ? ` AND status = ?` : '';
            if (status)
                params.push(status);
            const [countRow] = await q(`SELECT COUNT(*) AS total FROM faturas
         WHERE DATE(vencimento) BETWEEN ? AND ? ${extra}`, params).catch(() => [{ total: 0 }]);
            const rows = await q(`SELECT
           f.id,
           f.identificador,
           f.referencia,
           COALESCE(c.whatsapp_phone, c.cpf, l.numero_ligacao, '—') AS cliente,
           COALESCE(l.titular, '—') AS titular,
           f.status,
           ROUND(f.valor, 2) AS valor,
           DATE_FORMAT(f.vencimento, '%Y-%m-%d') AS vencimento,
           DATE_FORMAT(f.created_at, '%Y-%m-%d %H:%i') AS importado_em
         FROM faturas f
         LEFT JOIN ligacoes l ON l.id = f.ligacao_id
         LEFT JOIN customers c ON c.id = l.customer_id
         WHERE DATE(f.vencimento) BETWEEN ? AND ? ${extra}
         ORDER BY f.vencimento DESC
         LIMIT ? OFFSET ?`, [...params, limit, offset]).catch(() => []);
            return { total: Number(countRow[0]?.total ?? 0), from, to, rows };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
}
