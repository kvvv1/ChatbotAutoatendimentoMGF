import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
function onlyDigits(value) {
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
    baseUrl;
    phoneNumberId;
    accessToken;
    constructor(config) {
        const version = config.metaApiVersion || 'v21.0';
        this.baseUrl = `https://graph.facebook.com/${version}`;
        this.phoneNumberId = config.metaPhoneNumberId || '';
        this.accessToken = config.metaAccessToken || '';
    }
    messagesUrl() {
        return `${this.baseUrl}/${this.phoneNumberId}/messages`;
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
        if (kind === 'video') {
            if (ext === '.mov')
                return 'video/quicktime';
            if (ext === '.webm')
                return 'video/webm';
            return 'video/mp4';
        }
        if (kind === 'document') {
            if (ext === '.doc')
                return 'application/msword';
            if (ext === '.xlsx')
                return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            return 'application/pdf';
        }
        if (ext === '.png')
            return 'image/png';
        return 'image/jpeg';
    }
    /**
     * Resolve uma referência de mídia (URL pública, caminho local ou data URI) pro
     * formato que a Cloud API aceita: link direto, ou upload prévio + media_id.
     */
    async resolveMedia(input, kind) {
        const value = String(input || '').trim();
        if (!value)
            return {};
        if (/^https?:\/\//i.test(value)) {
            return { link: value };
        }
        let buffer;
        let mimeType;
        let fileName;
        if (value.startsWith('data:')) {
            const match = value.match(/^data:([^;]+);base64,(.+)$/);
            if (!match)
                throw new Error('data URI de mídia inválida');
            mimeType = match[1];
            buffer = Buffer.from(match[2], 'base64');
            fileName = `arquivo.${mimeType.split('/')[1] || 'bin'}`;
        }
        else {
            let filePath = value;
            if (value.startsWith('file://'))
                filePath = decodeURIComponent(value.slice('file://'.length));
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
            body: form
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.id) {
            throw new Error(`Falha ao subir mídia pra Cloud API: ${res.status} ${JSON.stringify(json)}`);
        }
        return { id: json.id };
    }
    async post(body) {
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
        try {
            return JSON.parse(text);
        }
        catch {
            return {};
        }
    }
    async sendText(params) {
        await this.post({
            messaging_product: 'whatsapp',
            to: onlyDigits(params.phone),
            type: 'text',
            text: { body: params.message, preview_url: false }
        });
    }
    /** Sem "copy code" nativo fora de Template — manda o código como texto simples. */
    async sendTextWithCode(params) {
        await this.sendText({ phone: params.phone, message: `${params.message}\n\n*${params.code}*` });
    }
    async sendButtons(params) {
        if (!params.buttons?.length)
            throw new Error('É necessário pelo menos um botão');
        if (params.buttons.length > 3)
            throw new Error('WhatsApp permite no máximo 3 reply buttons');
        for (const btn of params.buttons) {
            if (btn.text.length > 20)
                throw new Error(`Texto do botão muito longo (max 20): ${btn.text}`);
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
    async sendButtonList(params) {
        await this.sendButtons({
            phone: params.phone,
            text: params.message,
            buttons: params.buttons.map((b, i) => ({ id: b.id || String(i), text: b.label }))
        });
    }
    async sendList(params) {
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
    async sendOptionList(params) {
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
    async sendAudio(params) {
        const media = await this.resolveMedia(params.audio, 'audio');
        await this.post({ messaging_product: 'whatsapp', to: onlyDigits(params.phone), type: 'audio', audio: media });
    }
    async sendVideo(params) {
        const media = await this.resolveMedia(params.video, 'video');
        await this.post({
            messaging_product: 'whatsapp',
            to: onlyDigits(params.phone),
            type: 'video',
            video: { ...media, caption: params.caption }
        });
    }
    async sendDocument(params) {
        const media = await this.resolveMedia(params.document, 'document');
        await this.post({
            messaging_product: 'whatsapp',
            to: onlyDigits(params.phone),
            type: 'document',
            document: { ...media, filename: params.fileName, caption: params.caption }
        });
    }
    async sendLocation(params) {
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
    async sendLink(params) {
        await this.sendText({ phone: params.phone, message: `${params.message}\n${params.linkUrl}` });
    }
    /**
     * Sem suporte a botões de CALL/URL/REPLY mistos em mensagem livre (só em Template).
     * Fallback: lista as ações como texto numerado.
     */
    async sendButtonActions(params) {
        const lines = params.buttonActions.map((a, i) => {
            if (a.type === 'CALL')
                return `${i + 1}. ${a.label}: ${a.phone}`;
            if (a.type === 'URL')
                return `${i + 1}. ${a.label}: ${a.url}`;
            return `${i + 1}. ${a.label}`;
        });
        await this.sendText({ phone: params.phone, message: `${params.message}\n\n${lines.join('\n')}` });
    }
    /** Envio de Template Message (categoria Utility/Marketing/Authentication) já homologado na Meta. */
    async sendTemplate(params) {
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
    async markAsRead(messageId) {
        await this.post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    }
}
