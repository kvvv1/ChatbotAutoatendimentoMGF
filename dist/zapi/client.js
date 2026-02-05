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
    async sendTextWithCode(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-text`;
        const body = {
            phone: String(params.phone).replace(/\D/g, ''),
            message: String(params.message).trim(),
            code: String(params.code),
            delayTyping: params.delayTypingSeconds ?? 2
        };
        if (params.image)
            body.image = params.image;
        if (params.buttonText)
            body.buttonText = String(params.buttonText).trim();
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar mensagem com código: ${res.status} ${text}`);
        }
    }
    async sendButtons(params) {
        // Validações
        if (!params.buttons || params.buttons.length === 0) {
            throw new Error('É necessário pelo menos um botão');
        }
        if (params.buttons.length > 3) {
            throw new Error('WhatsApp permite no máximo 3 botões');
        }
        // Valida formato dos botões
        for (const btn of params.buttons) {
            if (!btn.id || !btn.text) {
                throw new Error('Cada botão deve ter id e text');
            }
            if (btn.text.length > 20) {
                throw new Error(`Texto do botão muito longo (max 20): ${btn.text}`);
            }
            if (btn.id.length > 256) {
                throw new Error(`ID do botão muito longo (max 256): ${btn.id}`);
            }
        }
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-buttons`;
        // Formata os botões conforme esperado pela Z-API
        const buttonsFormatted = params.buttons.map(b => ({
            id: String(b.id).trim(),
            text: String(b.text).trim()
        }));
        const payload = {
            phone: String(params.phone).replace(/\D/g, ''), // Remove caracteres não numéricos
            message: String(params.text).trim(),
            buttons: buttonsFormatted,
            ...(params.footer ? { footer: String(params.footer).trim() } : {}),
            delayTyping: params.delayTypingSeconds ?? 2
        };
        // Log para debug (remover em produção se necessário)
        console.log('Enviando botões - Payload:', JSON.stringify(payload, null, 2));
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(payload)
        });
        const responseText = await res.text().catch(() => '');
        if (!res.ok) {
            let errorMsg = `Falha ao enviar botões: ${res.status} ${responseText}`;
            try {
                const json = JSON.parse(responseText);
                if (json.message)
                    errorMsg += ` - ${json.message}`;
                if (json.error)
                    errorMsg += ` - ${json.error}`;
                console.error('Erro da API ao enviar botões:', json);
            }
            catch {
                console.error('Erro ao enviar botões - Resposta:', responseText);
            }
            throw new Error(errorMsg);
        }
        // Verifica se a resposta tem dados
        try {
            const responseData = responseText ? JSON.parse(responseText) : {};
            if (responseData && responseData.error) {
                console.error('Erro na resposta da API:', responseData);
                throw new Error(`Erro da API: ${responseData.error}`);
            }
            if (responseData && responseData.message) {
                console.log('Resposta da API:', responseData.message);
            }
        }
        catch (e) {
            // Se não conseguir ler JSON, assume que está OK se status foi 200-299
            if (e instanceof Error && e.message.includes('Erro da API')) {
                throw e;
            }
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
    async sendAudio(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-audio`;
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                phone: String(params.phone).replace(/\D/g, ''),
                audio: params.audio,
                viewOnce: params.viewOnce ?? false,
                waveform: params.waveform ?? true,
                delayTyping: params.delayTypingSeconds ?? 2
            })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Falha ao enviar áudio: ${res.status} ${text}`);
        }
    }
    async sendButtonList(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-button-list`;
        const body = {
            phone: String(params.phone).replace(/\D/g, ''),
            message: String(params.message).trim(),
            buttonList: {
                buttons: params.buttons.map(b => ({ id: b.id, label: b.label }))
            }
        };
        if (params.image)
            body.buttonList.image = params.image;
        if (params.video)
            body.buttonList.video = params.video;
        // Log para debug do payload
        console.log('Enviando button-list - Payload:', JSON.stringify(body, null, 2));
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body)
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) {
            throw new Error(`Falha ao enviar button-list: ${res.status} ${text}`);
        }
        if (text) {
            try {
                const json = JSON.parse(text);
                if (json.error) {
                    console.error('Erro da API ao enviar button-list:', json);
                    throw new Error(`Erro da API (button-list): ${json.error}`);
                }
            }
            catch {
                // se não for JSON, apenas segue em frente
            }
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
    /**
     * Envia um documento (PDF, DOC, etc) via Z-API
     * Formato: POST /send-document/{extension}
     * @param params.document - URL do documento ou base64 (com prefixo data:application/pdf;base64,...)
     * @param params.extension - Extensão do arquivo (pdf, doc, xlsx, etc). Default: pdf
     */
    async sendDocument(params) {
        const extension = params.extension || 'pdf';
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-document/${extension}`;
        const body = {
            phone: String(params.phone).replace(/\D/g, ''),
            document: params.document
        };
        if (params.fileName)
            body.fileName = params.fileName;
        if (params.caption)
            body.caption = params.caption;
        console.log('[ZapiClient] Enviando documento para', params.phone, 'extension:', extension, 'fileName:', params.fileName);
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body)
        });
        const responseText = await res.text().catch(() => '');
        if (!res.ok) {
            console.error('[ZapiClient] Erro ao enviar documento:', res.status, responseText);
            throw new Error(`Falha ao enviar documento: ${res.status} ${responseText}`);
        }
        console.log('[ZapiClient] Documento enviado com sucesso:', responseText);
    }
    /**
     * Envia uma localização via Z-API
     * POST /send-location
     */
    async sendLocation(params) {
        const url = `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}/send-location`;
        const body = {
            phone: String(params.phone).replace(/\D/g, ''),
            title: params.title,
            address: params.address,
            latitude: params.latitude,
            longitude: params.longitude
        };
        console.log('[ZapiClient] Enviando localização para', params.phone, 'title:', params.title);
        const res = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body)
        });
        const responseText = await res.text().catch(() => '');
        if (!res.ok) {
            console.error('[ZapiClient] Erro ao enviar localização:', res.status, responseText);
            throw new Error(`Falha ao enviar localização: ${res.status} ${responseText}`);
        }
        console.log('[ZapiClient] Localização enviada com sucesso:', responseText);
    }
}
