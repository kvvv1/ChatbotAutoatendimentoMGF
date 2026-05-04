#!/usr/bin/env node

import { loadConfig } from '../config.js';
import { getDb } from '../supabase/client.js';
import type { RowDataPacket } from 'mysql2/promise';
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

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, phone, direction, content, created_at FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
      [phone]
    );
    const list = rows as RowDataPacket[];

    if (list.length === 0) {
      console.log('Nenhuma mensagem encontrada para este telefone.');
      await pool.end();
      return;
    }

    const data = list[0] as { id: string; phone: string; direction: string; content: string; created_at: string };

    if (data.direction !== 'in') {
      console.log('A ultima mensagem ja e de saida (do bot). Nada para reprocessar.');
      await pool.end();
      return;
    }

    const text = (data as any).content ?? '';
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
        try { await logMessage(config, { phone, direction: 'out', content: out }); } catch {}
      } else if ((out as any).type === 'buttons') {
        const buttonsOut = out as any;
        try {
          await zapi.sendButtonList({
            phone,
            message: buttonsOut.text,
            buttons: (buttonsOut.buttons || []).map((b: any) => ({ id: b.id, label: b.text }))
          });
          try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
        } catch (err: any) {
          console.error('❌ Erro ao enviar button-list, tentando fallback em texto numerado:', err?.message || err);
          const buttonsText = (buttonsOut.buttons || [])
            .map((b: any, idx: number) => `${idx + 1} - ${b.text}`)
            .join('\n');
          await zapi.sendText({
            phone,
            message: `${buttonsOut.text}\n\n${buttonsText}\n\nDigite o número correspondente ou use os botões acima.`
          });
        }
      } else if ((out as any).type === 'list') {
        const listOut = out as any;
        const options = ([] as Array<{ id?: string; title: string; description?: string }>)
          .concat(...(listOut.sections || []).map((s: any) => s.rows || []))
          .map((r: any) => ({ id: r.id, title: r.title, description: r.description }));
        await zapi.sendOptionList({
          phone,
          message: listOut.text,
          optionList: {
            title: (listOut.sections && listOut.sections[0]?.title) || 'Opções disponíveis',
            buttonLabel: listOut.buttonText || 'Abrir lista',
            options
          }
        });
        try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
      } else if ((out as any).type === 'link') {
        const linkOut = out as any;
        await zapi.sendLink({
          phone,
          message: linkOut.message,
          image: linkOut.image,
          linkUrl: linkOut.linkUrl,
          title: linkOut.title,
          linkDescription: linkOut.linkDescription
        });
        try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
      } else if ((out as any).type === 'video') {
        const videoOut = out as any;
        await zapi.sendVideo({
          phone,
          video: videoOut.video,
          caption: videoOut.caption,
          viewOnce: videoOut.viewOnce
        });
        try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
      } else if ((out as any).type === 'audio') {
        const audioOut = out as any;
        if (!audioOut.audioUrl) continue;
        await zapi.sendAudio({
          phone,
          audio: audioOut.audioUrl,
          viewOnce: audioOut.viewOnce,
          waveform: audioOut.waveform,
          delayTypingSeconds: audioOut.delayTypingSeconds
        });
        try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
      } else if ((out as any).type === 'buttonActions') {
        const actionsOut = out as any;
        await zapi.sendButtonActions({
          phone,
          message: actionsOut.message,
          buttonActions: actionsOut.buttonActions
        });
        try { await logMessage(config, { phone, direction: 'out', content: JSON.stringify(out) }); } catch {}
      }
    }

    console.log('Reprocessamento concluido com sucesso.');
    await pool.end();
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('Erro ao reprocessar ultima mensagem:', e?.message || err);
    process.exit(1);
  }
}

replayLastMessage();
