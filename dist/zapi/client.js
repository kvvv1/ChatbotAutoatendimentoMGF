import { fetch } from 'undici';
export class ZapiClient {
    baseUrl;
    instanceId;
    token;
    clientToken;
    constructor(config) {
        this.baseUrl = config.zapiBaseUrl.replace(/\/+$/, '');
        this.instanceId = config.zapiInstanceId;
        this.token = config.zapiToken;
        this.clientToken = process.env.ZAPI_CLIENT_TOKEN;
    }
    authHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.clientToken)
            headers['Client-Token'] = this.clientToken;
        return headers;
    }
    async sendText(payload) {
        // Segue o padrão informado:
        // https://api.z-api.io/instances/{instanceId}/token/{token}/send-text
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-text`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: payload.phone,
                message: payload.message,
                delayTyping: payload.delayTypingSeconds ?? 2
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar mensagem: ${res.status} ${text}`);
        }
    }
    async sendButtons(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-buttons`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                message: params.text,
                buttons: params.buttons.map(b => ({ id: b.id, text: b.text })),
                footer: params.footer,
                delayTyping: params.delayTypingSeconds ?? 2
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar botões: ${res.status} ${text}`);
        }
    }
    async sendList(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-list`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                message: params.text,
                buttonText: params.buttonText ?? 'Selecionar',
                sections: params.sections,
                delayTyping: params.delayTypingSeconds ?? 2
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar lista: ${res.status} ${text}`);
        }
    }
    async sendLink(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-link`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                message: params.message,
                image: params.image,
                linkUrl: params.linkUrl,
                title: params.title,
                linkDescription: params.linkDescription
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar link: ${res.status} ${text}`);
        }
    }
    async sendVideo(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-video`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                video: params.video,
                caption: params.caption,
                viewOnce: params.viewOnce ?? false
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar vídeo: ${res.status} ${text}`);
        }
    }
    async sendButtonList(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-button-list`;
        const body = {
            phone: params.phone,
            message: params.message,
            buttonList: {
                buttons: params.buttons.map(b => ({ id: b.id, label: b.label }))
            }
        };
        if (params.image)
            body.buttonList.image = params.image;
        if (params.video)
            body.buttonList.video = params.video;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar button-list: ${res.status} ${text}`);
        }
    }
    async sendOptionList(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-option-list`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                message: params.message,
                optionList: params.optionList
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar option-list: ${res.status} ${text}`);
        }
    }
    async sendButtonActions(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-button-actions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: params.phone,
                message: params.message,
                buttonActions: params.buttonActions,
                title: params.title,
                footer: params.footer
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar button-actions: ${res.status} ${text}`);
        }
    }
}
