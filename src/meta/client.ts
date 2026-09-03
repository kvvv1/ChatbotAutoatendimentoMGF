import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
import type { AppConfig } from '../config.js';

type Button = { id: string; text: string };
type ListRow = { id: string; title: string; description?: string };
type ListSection = { title: string; rows: ListRow[] };
type MediaRef = { link?: string; id?: string };

function onlyDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Cliente para a WhatsApp Cloud API oficial da Meta (Graph API).
 * Espelha a interface pública do ZapiClient (src/zapi/client.ts) para que o
 * webhook consiga mapear as respostas do bot pros dois provedores da mesma forma.
 *
 * Diferenças importantes em relação ao Z-API:
 *  - Autenticação por Bearer token (system user), não instanceId/token na URL.
 *  - Mídia não aceita base64 inline: precisa ser uma URL pública (link) ou ser
 *    enviada antes pro endpoint /media, recebendo um media_id pra referenciar.
 *  - Botões de "ligar"/"abrir link" (buttonActions) e "copiar código" (copyCode)
 *    não têm equivalente em mensagens livres — só existem em Templates aprovados
 *    pela Meta. Aqui caem em fallback de texto simples.
 */
export class MetaClient {
  private readonly baseUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(config: AppConfig) {
    const version = config.metaApiVersion || 'v21.0';
    this.baseUrl = `https://graph.facebook.com/${version}`;
    this.phoneNumberId = config.metaPhoneNumberId || '';
    this.accessToken = config.metaAccessToken || '';
  }

  private messagesUrl(): string {
    return `${this.baseUrl}/${this.phoneNumberId}/messages`;
  }

  private guessMimeType(filePath: string, kind: 'audio' | 'video' | 'document' | 'image'): string {
    const ext = path.extname(filePath).toLowerCase();
    if (kind === 'audio') {
      if (ext === '.mp3') return 'audio/mpeg';
      if (ext === '.wav') return 'audio/wav';
      if (ext === '.ogg') return 'audio/ogg';
      if (ext === '.m4a') return 'audio/mp4';
      return 'audio/mpeg';
    }
    if (kind === 'video') {
      if (ext === '.mov') return 'video/quicktime';
      if (ext === '.webm') return 'video/webm';
      return 'video/mp4';
    }
    if (kind === 'document') {
      if (ext === '.doc') return 'application/msword';
      if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      return 'application/pdf';
    }
    if (ext === '.png') return 'image/png';
    return 'image/jpeg';
  }

  /**
   * Resolve uma referência de mídia (URL pública, caminho local ou data URI) pro
   * formato que a Cloud API aceita: link direto, ou upload prévio + media_id.
   */
  private async resolveMedia(input: string, kind: 'audio' | 'video' | 'document' | 'image'): Promise<MediaRef> {
    const value = String(input || '').trim();
    if (!value) return {};

    if (/^https?:\/\//i.test(value)) {
      return { link: value };
    }

    let buffer: Buffer;
    let mimeType: string;
    let fileName: string;

    if (value.startsWith('data:')) {
      const match = value.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('data URI de mídia inválida');
      mimeType = match[1];
      buffer = Buffer.from(match[2], 'base64');
      fileName = `arquivo.${mimeType.split('/')[1] || 'bin'}`;
    } else {
      let filePath = value;
      if (value.startsWith('file://')) filePath = decodeURIComponent(value.slice('file://'.length));
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      buffer = await readFile(resolvedPath);
      mimeType = this.guessMimeType(resolvedPath, kind);
      fileName = path.basename(resolvedPath);
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);

    const res = await fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form as any
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.id) {
      throw new Error(`Falha ao subir mídia pra Cloud API: ${res.status} ${JSON.stringify(json)}`);
    }
    return { id: json.id };
  }

  private async post(body: unknown): Promise<any> {
    const res = await fetch(this.messagesUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('[MetaClient] Erro na Cloud API:', res.status, text);
      throw new Error(`Falha na Cloud API: ${res.status} ${text}`);
    }
    try { return JSON.parse(text); } catch { return {}; }
  }

  async sendText(params: { phone: string; message: string }): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'text',
      text: { body: params.message, preview_url: false }
    });
  }

  /** Sem "copy code" nativo fora de Template — manda o código como texto simples. */
  async sendTextWithCode(params: { phone: string; message: string; code: string }): Promise<void> {
    await this.sendText({ phone: params.phone, message: `${params.message}\n\n*${params.code}*` });
  }

  async sendButtons(params: { phone: string; text: string; buttons: Button[]; footer?: string }): Promise<void> {
    if (!params.buttons?.length) throw new Error('É necessário pelo menos um botão');
    if (params.buttons.length > 3) throw new Error('WhatsApp permite no máximo 3 reply buttons');
    for (const btn of params.buttons) {
      if (btn.text.length > 20) throw new Error(`Texto do botão muito longo (max 20): ${btn.text}`);
    }
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: params.text },
        ...(params.footer ? { footer: { text: params.footer } } : {}),
        action: { buttons: params.buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.text } })) }
      }
    });
  }

  /** Compatível com a assinatura de sendButtonList do ZapiClient (id/label). */
  async sendButtonList(params: { phone: string; message: string; buttons: { id?: string; label: string }[] }): Promise<void> {
    await this.sendButtons({
      phone: params.phone,
      text: params.message,
      buttons: params.buttons.map((b, i) => ({ id: b.id || String(i), text: b.label }))
    });
  }

  async sendList(params: { phone: string; text: string; buttonText?: string; sections: ListSection[] }): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: params.text },
        action: {
          button: params.buttonText || 'Selecionar',
          sections: params.sections.map(s => ({
            title: s.title,
            rows: s.rows.map(r => ({ id: r.id, title: r.title, description: r.description }))
          }))
        }
      }
    });
  }

  /** Compatível com a assinatura de sendOptionList do ZapiClient. */
  async sendOptionList(params: {
    phone: string;
    message: string;
    optionList: { title: string; buttonLabel: string; options: { id?: string; title: string; description?: string }[] };
  }): Promise<void> {
    await this.sendList({
      phone: params.phone,
      text: params.message,
      buttonText: params.optionList.buttonLabel,
      sections: [{
        title: params.optionList.title,
        rows: params.optionList.options.map((o, i) => ({ id: o.id || String(i), title: o.title, description: o.description }))
      }]
    });
  }

  async sendAudio(params: { phone: string; audio: string }): Promise<void> {
    const media = await this.resolveMedia(params.audio, 'audio');
    await this.post({ messaging_product: 'whatsapp', to: onlyDigits(params.phone), type: 'audio', audio: media });
  }

  async sendVideo(params: { phone: string; video: string; caption?: string }): Promise<void> {
    const media = await this.resolveMedia(params.video, 'video');
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'video',
      video: { ...media, caption: params.caption }
    });
  }

  async sendDocument(params: { phone: string; document: string; fileName?: string; caption?: string }): Promise<void> {
    const media = await this.resolveMedia(params.document, 'document');
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'document',
      document: { ...media, filename: params.fileName, caption: params.caption }
    });
  }

  async sendLocation(params: { phone: string; title: string; address: string; latitude: string; longitude: string }): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'location',
      location: {
        latitude: Number(params.latitude),
        longitude: Number(params.longitude),
        name: params.title,
        address: params.address
      }
    });
  }

  /** Cloud API não tem "link card" nativo — manda texto com preview_url ligado. */
  async sendLink(params: { phone: string; message: string; linkUrl: string }): Promise<void> {
    await this.sendText({ phone: params.phone, message: `${params.message}\n${params.linkUrl}` });
  }

  /**
   * Sem suporte a botões de CALL/URL/REPLY mistos em mensagem livre (só em Template).
   * Fallback: lista as ações como texto numerado.
   */
  async sendButtonActions(params: {
    phone: string;
    message: string;
    buttonActions: Array<{ id?: string; type: 'CALL' | 'URL' | 'REPLY'; label: string; phone?: string; url?: string }>;
  }): Promise<void> {
    const lines = params.buttonActions.map((a, i) => {
      if (a.type === 'CALL') return `${i + 1}. ${a.label}: ${a.phone}`;
      if (a.type === 'URL') return `${i + 1}. ${a.label}: ${a.url}`;
      return `${i + 1}. ${a.label}`;
    });
    await this.sendText({ phone: params.phone, message: `${params.message}\n\n${lines.join('\n')}` });
  }

  /** Envio de Template Message (categoria Utility/Marketing/Authentication) já homologado na Meta. */
  async sendTemplate(params: { phone: string; templateName: string; languageCode?: string; components?: unknown[] }): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to: onlyDigits(params.phone),
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode || 'pt_BR' },
        components: params.components || []
      }
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
  }
}
