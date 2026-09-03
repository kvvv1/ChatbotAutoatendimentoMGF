#!/usr/bin/env node
import { loadConfig } from '../config.js';
import { getDb } from '../supabase/client.js';
import { ZapiClient } from '../zapi/client.js';
import { SupabaseSessionStore } from '../supabase/sessionStore.js';
import { processMessage } from '../bot/flow.js';
import { logMessage } from '../supabase/messages.js';
async function replayLastMessage() {
    try {
        const phoneArg = process.argv[2];
        if (!phoneArg) {
            console.error('Uso: npm run replay-last -- <telefone>');
            process.exit(1);
        }
        const phone = String(phoneArg).replace(/\D/g, '');
        if (!phone) {
            console.error('Telefone invalido.');
            process.exit(1);
        }
        console.log(`Buscando ultima mensagem de entrada para o telefone ${phone}...`);
        const config = loadConfig();
        const pool = getDb(config);
        const [rows] = await pool.query('SELECT id, phone, direction, content, created_at FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT 1', [phone]);
        const list = rows;
        if (list.length === 0) {
            console.log('Nenhuma mensagem encontrada para este telefone.');
            await pool.end();
            return;
        }
        const data = list[0];
        if (data.direction !== 'in') {
            console.log('A ultima mensagem ja e de saida (do bot). Nada para reprocessar.');
            await pool.end();
            return;
        }
        const text = data.content ?? '';
        console.log(`Reprocessando ultima mensagem de entrada: "${text}" (em ${data.created_at})`);
        const sessionStore = new SupabaseSessionStore(config);
        const zapi = new ZapiClient(config);
        const replies = await processMessage(config, phone, text, sessionStore);
        if (!replies || replies.length === 0) {
            console.log('Nenhuma resposta gerada pelo fluxo para esta mensagem.');
            await pool.end();
            return;
        }
        console.log(`Enviando ${replies.length} resposta(s) para o usuario...`);
        for (const out of replies) {
            if (typeof out === 'string') {
                await zapi.sendText({ phone, message: out });
                try {
                    await logMessage(config, { phone, direction: 'out', content: out });
                }
                catch { }
            }
            else if (out.type === 'buttons') {
                const buttonsOut = out;
                try {
                    await zapi.sendButtonList({
                        phone,
                        message: buttonsOut.text,
                        buttons: (buttonsOut.buttons || []).map((b) => ({ id: b.id, label: b.text }))
                    });
                    try {
                        await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                    }
                    catch { }
                }
                catch (err) {
                    console.error('❌ Erro ao enviar button-list, tentando fallback em texto numerado:', err?.message || err);
                    const buttonsText = (buttonsOut.buttons || [])
                        .map((b, idx) => `${idx + 1} - ${b.text}`)
                        .join('\n');
                    await zapi.sendText({
                        phone,
                        message: `${buttonsOut.text}\n\n${buttonsText}\n\nDigite o número correspondente ou use os botões acima.`
                    });
                }
            }
            else if (out.type === 'list') {
                const listOut = out;
                const options = []
                    .concat(...(listOut.sections || []).map((s) => s.rows || []))
                    .map((r) => ({ id: r.id, title: r.title, description: r.description }));
                await zapi.sendOptionList({
                    phone,
                    message: listOut.text,
                    optionList: {
                        title: (listOut.sections && listOut.sections[0]?.title) || 'Opções disponíveis',
                        buttonLabel: listOut.buttonText || 'Abrir lista',
                        options
                    }
                });
                try {
                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                }
                catch { }
            }
            else if (out.type === 'link') {
                const linkOut = out;
                await zapi.sendLink({
                    phone,
                    message: linkOut.message,
                    image: linkOut.image,
                    linkUrl: linkOut.linkUrl,
                    title: linkOut.title,
                    linkDescription: linkOut.linkDescription
                });
                try {
                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                }
                catch { }
            }
            else if (out.type === 'video') {
                const videoOut = out;
                await zapi.sendVideo({
                    phone,
                    video: videoOut.video,
                    caption: videoOut.caption,
                    viewOnce: videoOut.viewOnce
                });
                try {
                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                }
                catch { }
            }
            else if (out.type === 'audio') {
                const audioOut = out;
                if (!audioOut.audioUrl)
                    continue;
                await zapi.sendAudio({
                    phone,
                    audio: audioOut.audioUrl,
                    viewOnce: audioOut.viewOnce,
                    waveform: audioOut.waveform,
                    delayTypingSeconds: audioOut.delayTypingSeconds
                });
                try {
                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                }
                catch { }
            }
            else if (out.type === 'buttonActions') {
                const actionsOut = out;
                await zapi.sendButtonActions({
                    phone,
                    message: actionsOut.message,
                    buttonActions: actionsOut.buttonActions
                });
                try {
                    await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) });
                }
                catch { }
            }
        }
        console.log('Reprocessamento concluido com sucesso.');
        await pool.end();
    }
    catch (err) {
        const e = err;
        console.error('Erro ao reprocessar ultima mensagem:', e?.message || err);
        process.exit(1);
    }
}
replayLastMessage();
