import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
import type { AppConfig } from '../config.js';

type SendTextPayload = {
  phone: string;
  message: string;
  delayTypingSeconds?: number;
};

type Button = { id: string; text: string };
type ListRow = { id: string; title: string; description?: string };
type ListSection = { title: string; rows: ListRow[] };

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly instance: string;
  private readonly apiKey: string;

  constructor(config: AppConfig) {
    this.baseUrl = (config.evolutionBaseUrl ?? '').replace(/\/+$/, '');
    this.instance = config.evolutionInstance ?? '';
    this.apiKey = config.evolutionApiKey ?? '';
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', apikey: this.apiKey };
  }

  private url(endpoint: string): string {
    return `${this.baseUrl}/${endpoint}/${this.instance}`;
  }

  private guessMimeType(filePath: string, kind: 'audio' | 'video'): string {
    const ext = path.extname(filePath).toLowerCase();
    if (kind === 'audio') {
      if (ext === '.mp3') return 'audio/mpeg';
      if (ext === '.wav') return 'audio/wav';
      if (ext === '.ogg') return 'audio/ogg';
      if (ext === '.m4a') return 'audio/mp4';
      return 'audio/mpeg';
    }
    if (ext === '.mp4') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.avi') return 'video/x-msvideo';
    return 'video/mp4';
  }

  private async resolveMediaInput(input: string, kind: 'audio' | 'video'): Promise<string> {
    const value = String(input || '').trim();
    if (!value) return value;
    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;

    let filePath = value;
    if (value.startsWith('file://')) filePath = decodeURIComponent(value.slice('file://'.length));

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const buffer = await readFile(resolvedPath);
    const mimeType = this.guessMimeType(resolvedPath, kind);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private async post(endpoint: string, body: unknown): Promise<void> {
    const res = await fetch(this.url(endpoint), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[Evolution] ${endpoint} falhou: ${res.status} ${text}`);
    }
  }

  async sendText(payload: SendTextPayload): Promise<void> {
    await this.post('message/sendText', {
      number: String(payload.phone).replace(/\D/g, ''),
      text: payload.message
    });
  }

  async sendTextWithCode(params: {
    phone: string;
    message: string;
    code: string;
    image?: string;
    buttonText?: string;
  }): Promise<void> {
    // Evolution API não tem endpoint nativo de "copy code"; envia como texto simples
    const text = `${params.message}\n\n*${params.code}*`;
    await this.post('message/sendText', {
      number: String(params.phone).replace(/\D/g, ''),
      text
    });
  }

  async sendButtons(params: {
    phone: string;
    text: string;
    buttons: Button[];
    footer?: string;
  }): Promise<void> {
    await this.post('message/sendButtons', {
      number: String(params.phone).replace(/\D/g, ''),
      title: params.text,
      footer: params.footer ?? '',
      buttons: params.buttons.map(b => ({ type: 'reply', displayText: b.text, id: b.id }))
    });
  }

  async sendList(params: {
    phone: string;
    text: string;
    buttonText?: string;
    sections: ListSection[];
  }): Promise<void> {
    await this.post('message/sendList', {
      number: String(params.phone).replace(/\D/g, ''),
      title: params.text,
      buttonText: params.buttonText ?? 'Selecionar',
      sections: params.sections.map(s => ({
        title: s.title,
        rows: s.rows.map(r => ({ title: r.title, description: r.description ?? '', rowId: r.id }))
      }))
    });
  }

  async sendLink(params: {
    phone: string;
    message: string;
    image?: string;
    linkUrl: string;
    title?: string;
    linkDescription?: string;
  }): Promise<void> {
    // Evolution API gera preview de link automaticamente ao enviar URL no texto
    const parts = [params.message, params.linkUrl].filter(Boolean);
    await this.post('message/sendText', {
      number: String(params.phone).replace(/\D/g, ''),
      text: parts.join('\n')
    });
  }

  async sendVideo(params: {
    phone: string;
    video: string;
    caption?: string;
    viewOnce?: boolean;
  }): Promise<void> {
    const media = await this.resolveMediaInput(params.video, 'video');
    await this.post('message/sendMedia', {
      number: String(params.phone).replace(/\D/g, ''),
      mediatype: 'video',
      mimetype: 'video/mp4',
      caption: params.caption ?? '',
      media,
      fileName: 'video.mp4'
    });
  }

  async sendAudio(params: {
    phone: string;
    audio: string;
    viewOnce?: boolean;
    waveform?: boolean;
    delayTypingSeconds?: number;
  }): Promise<void> {
    const audio = await this.resolveMediaInput(params.audio, 'audio');
    await this.post('message/sendWhatsAppAudio', {
      number: String(params.phone).replace(/\D/g, ''),
      audio,
      encoding: true
    });
  }

  async sendButtonList(params: {
    phone: string;
    message: string;
    buttons: { id?: string; label: string }[];
    image?: string;
    video?: string;
  }): Promise<void> {
    await this.post('message/sendButtons', {
      number: String(params.phone).replace(/\D/g, ''),
      title: params.message,
      footer: '',
      buttons: params.buttons.map((b, i) => ({
        type: 'reply',
        displayText: b.label,
        id: b.id ?? String(i + 1)
      }))
    });
  }

  async sendOptionList(params: {
    phone: string;
    message: string;
    optionList: {
      title: string;
      buttonLabel: string;
      options: { id?: string; title: string; description?: string }[];
    };
  }): Promise<void> {
    await this.post('message/sendList', {
      number: String(params.phone).replace(/\D/g, ''),
      title: params.optionList.title,
      description: params.message,
      buttonText: params.optionList.buttonLabel,
      sections: [
        {
          title: params.optionList.title,
          rows: params.optionList.options.map((o, i) => ({
            title: o.title,
            description: o.description ?? '',
            rowId: o.id ?? String(i + 1)
          }))
        }
      ]
    });
  }

  async sendButtonActions(params: {
    phone: string;
    message: string;
    buttonActions: Array<
      | { id?: string; type: 'CALL'; phone: string; label: string }
      | { id?: string; type: 'URL'; url: string; label: string }
      | { id?: string; type: 'REPLY'; label: string; idReply?: string }
    >;
    title?: string;
    footer?: string;
  }): Promise<void> {
    const buttons = params.buttonActions.map((b, i) => {
      if (b.type === 'CALL') return { type: 'call', displayText: b.label, phoneNumber: b.phone };
      if (b.type === 'URL') return { type: 'url', displayText: b.label, url: b.url };
      return { type: 'reply', displayText: b.label, id: b.id ?? String(i + 1) };
    });
    await this.post('message/sendButtons', {
      number: String(params.phone).replace(/\D/g, ''),
      title: params.title ?? params.message,
      description: params.title ? params.message : undefined,
      footer: params.footer ?? '',
      buttons
    });
  }

  async sendDocument(params: {
    phone: string;
    document: string;
    extension?: string;
    fileName?: string;
    caption?: string;
  }): Promise<void> {
    const ext = params.extension ?? 'pdf';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    await this.post('message/sendMedia', {
      number: String(params.phone).replace(/\D/g, ''),
      mediatype: 'document',
      mimetype: mimeTypes[ext] ?? 'application/octet-stream',
      caption: params.caption ?? '',
      media: params.document,
      fileName: params.fileName ?? `arquivo.${ext}`
    });
  }

  async sendLocation(params: {
    phone: string;
    title: string;
    address: string;
    latitude: string;
    longitude: string;
  }): Promise<void> {
    await this.post('message/sendLocation', {
      number: String(params.phone).replace(/\D/g, ''),
      name: params.title,
      address: params.address,
      latitude: parseFloat(params.latitude),
      longitude: parseFloat(params.longitude)
    });
  }
}
