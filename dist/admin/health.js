import net from 'node:net';
import { fetch, Agent } from 'undici';
// Agente que ignora erros de certificado SSL — usado apenas nos health checks internos
const tlsAgent = new Agent({ connect: { rejectUnauthorized: false } });
async function checkZapi(instance) {
    if (!instance.zapiInstanceId || !instance.zapiToken) {
        return { ok: false, detail: 'ZAPI_INSTANCE_ID ou ZAPI_TOKEN não configurado' };
    }
    const url = `${instance.zapiBaseUrl}/instances/${instance.zapiInstanceId}/token/${instance.zapiToken}/status`;
    const start = Date.now();
    try {
        const res = await fetch(url, {
            headers: { 'Client-Token': instance.zapiClientToken },
            signal: AbortSignal.timeout(8000),
            // @ts-ignore
            dispatcher: tlsAgent,
        });
        const latencyMs = Date.now() - start;
        const text = await res.text();
        if (!res.ok) {
            return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
        }
        const data = JSON.parse(text);
        const connected = !!data.connected;
        const smartphoneConnected = !!data.smartphoneConnected;
        return {
            ok: connected,
            connected,
            smartphoneConnected,
            latencyMs,
            // sempre nosso label, nunca a mensagem bruta da Z-API
            detail: connected ? 'Conectado' : 'Desconectado',
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, detail: msg.includes('timeout') ? 'Timeout (8s)' : 'Sem resposta da Z-API' };
    }
}
async function checkGestcom(instance) {
    // Prefere URL externa se disponível; senão usa a base
    const url = instance.linkApiExternalUrl || instance.linkApiBaseUrl;
    const token = instance.linkApiExternalUrl ? instance.linkApiExternalToken : instance.linkApiToken;
    if (!url)
        return { ok: false, detail: 'Não configurado' };
    // Detecta hostname Docker interno (sem ponto = nome de serviço interno)
    try {
        const hostname = new URL(url).hostname;
        const isDockerInternal = !hostname.includes('.') || hostname === 'localhost';
        if (isDockerInternal) {
            return { ok: false, detail: `Host interno Docker (${hostname})` };
        }
    }
    catch {
        return { ok: false, detail: 'URL inválida' };
    }
    const start = Date.now();
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
            // @ts-ignore — dispatcher é aceito pelo undici mas não está no tipo global fetch
            dispatcher: tlsAgent,
        });
        const latencyMs = Date.now() - start;
        // Qualquer resposta HTTP significa que o servidor está no ar (mesmo 4xx/5xx)
        return { ok: true, latencyMs, detail: `HTTP ${res.status} (${latencyMs}ms)` };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, detail: msg.includes('timeout') ? 'Timeout (8s)' : 'Sem resposta' };
    }
}
function checkSmtp(host, port) {
    if (!host)
        return Promise.resolve({ ok: false, detail: 'Não configurado' });
    return new Promise(resolve => {
        const start = Date.now();
        const socket = net.createConnection({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            resolve({ ok: false, detail: 'Timeout (5s)' });
        }, 5000);
        socket.on('connect', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve({ ok: true, latencyMs: Date.now() - start, detail: `Porta ${port} acessível` });
        });
        socket.on('error', err => {
            clearTimeout(timer);
            resolve({ ok: false, detail: err.message });
        });
    });
}
export async function checkInstance(instance) {
    const [whatsapp, gestcom, smtp] = await Promise.all([
        checkZapi(instance),
        checkGestcom(instance),
        checkSmtp(instance.smtpHost, instance.smtpPort),
    ]);
    return {
        slug: instance.slug,
        nomeAbreviado: instance.nomeAbreviado,
        nomeCompleto: instance.nomeCompleto,
        port: instance.port,
        phoneNumber: instance.phoneNumber,
        envFile: instance.envFile,
        checks: { whatsapp, gestcom, smtp },
    };
}
