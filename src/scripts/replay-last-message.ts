#!/usr/bin/env node

import { loadConfig } from '../config.js';
import { getSupabaseAdmin } from '../supabase/client.js';
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
      console.error('Telefone inválido. Informe apenas números ou um número WhatsApp completo.');
      process.exit(1);
    }

    console.log(`🔎 Buscando última mensagem de entrada para o telefone ${phone}...`);

    const config = loadConfig();
    const supabase = getSupabaseAdmin(config);

    const { data, error } = await supabase
      .from('messages')
      .select('id, phone, direction, content, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Erro ao buscar mensagens:', error.message);
      process.exit(1);
    }

    if (!data) {
      console.log('ℹ️ Nenhuma mensagem encontrada para este telefone.');
      return;
    }

    if (data.direction !== 'in') {
      console.log('ℹ️ A última mensagem já é de saída (do bot). Nada para reprocessar.');
      return;
    }

    const text = (data as any).content ?? '';
    console.log(`📨 Reprocessando última mensagem de entrada: "${text}" (em ${data.created_at})`);

    const sessionStore = new SupabaseSessionStore(config);
    const zapi = new ZapiClient(config);

    const replies = await processMessage(config, phone, text, sessionStore);

    if (!replies || replies.length === 0) {
      console.log('ℹ️ Nenhuma resposta gerada pelo fluxo para esta mensagem.');
      return;
    }

    console.log(`💬 Enviando ${replies.length} resposta(s) para o usuário...`);

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

    console.log('✅ Reprocessamento concluído com sucesso.');
  } catch (err: any) {
    console.error('❌ Erro ao reprocessar última mensagem:', err?.message || err);
    process.exit(1);
  }
}

replayLastMessage();
