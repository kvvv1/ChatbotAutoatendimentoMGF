import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
export class EvolutionClient {
    baseUrl;
    instance;
    apiKey;
    constructor(config) {
        this.baseUrl = (config.evolutionBaseUrl ?? '').replace(/\/+$/, '');
        this.instance = config.evolutionInstance ?? '';
        this.apiKey = config.evolutionApiKey ?? '';
    }
    headers() {
        return { 'Content-Type': 'application/json', apikey: this.apiKey };
    }
    url(endpoint) {
        return `${this.baseUrl}/${endpoint}/${this.instance}`;
    }
    guessMimeType(filePath, kind) {
        const ext = path.extname(filePath).toLowerCase();
        if (kind === 'audio') {
            if (ext === '.mp3')
                return 'audio/mpeg';
            if (ext === '.wav')
                return 'audio/wav';
            if (ext === '.ogg')
                return 'audio/ogg';
            if (ext === '.m4a')
                return 'audio/mp4';
            return 'audio/mpeg';
        }
        if (ext === '.mp4')
            return 'video/mp4';
        if (ext === '.mov')
            return 'video/quicktime';
        if (ext === '.webm')
            return 'video/webm';
        if (ext === '.avi')
            return 'video/x-msvideo';
        return 'video/mp4';
    }
    async resolveMediaInput(input, kind) {
        const value = String(input || '').trim();
        if (!value)
            return value;
        if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:'))
            return value;
        let filePath = value;
        if (value.startsWith('file://'))
            filePath = decodeURIComponent(value.slice('file://'.length));
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        const buffer = await readFile(resolvedPath);
        const mimeType = this.guessMimeType(resolvedPath, kind);
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    async post(endpoint, body) {
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
    async sendText(payload) {
        await this.post('message/sendText', {
            number: String(payload.phone).replace(/\D/g, ''),
            text: payload.message
        });
    }
    async sendTextWithCode(params) {
        // Evolution API não tem endpoint nativo de "copy code"; envia como texto simples
        const text = `${params.message}\n\n*${params.code}*`;
        await this.post('message/sendText', {
            number: String(params.phone).replace(/\D/g, ''),
            text
        });
    }
    async sendButtons(params) {
        await this.post('message/sendButtons', {
            number: String(params.phone).replace(/\D/g, ''),
            title: params.text,
            footer: params.footer ?? '',
            buttons: params.buttons.map(b => ({ type: 'reply', displayText: b.text, id: b.id }))
        });
    }
    async sendList(params) {
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
    async sendLink(params) {
        // Evolution API gera preview de link automaticamente ao enviar URL no texto
        const parts = [params.message, params.linkUrl].filter(Boolean);
        await this.post('message/sendText', {
            number: String(params.phone).replace(/\D/g, ''),
            text: parts.join('\n')
        });
    }
    async sendVideo(params) {
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
    async sendAudio(params) {
        const audio = await this.resolveMediaInput(params.audio, 'audio');
        await this.post('message/sendWhatsAppAudio', {
            number: String(params.phone).replace(/\D/g, ''),
            audio,
            encoding: true
        });
    }
    async sendButtonList(params) {
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
    async sendOptionList(params) {
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
    async sendButtonActions(params) {
        const buttons = params.buttonActions.map((b, i) => {
            if (b.type === 'CALL')
                return { type: 'call', displayText: b.label, phoneNumber: b.phone };
            if (b.type === 'URL')
                return { type: 'url', displayText: b.label, url: b.url };
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
    async sendDocument(params) {
        const ext = params.extension ?? 'pdf';
        const mimeTypes = {
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
    async sendLocation(params) {
        await this.post('message/sendLocation', {
            number: String(params.phone).replace(/\D/g, ''),
            name: params.title,
            address: params.address,
            latitude: parseFloat(params.latitude),
            longitude: parseFloat(params.longitude)
        });
    }
}
