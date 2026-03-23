import { messages, mainMenu } from './menus.js';
import { createAndSendOtp, verifyOtp } from '../otp/service.js';
import { fetchLigacoesByCpf, imoveisToLigacoes } from '../company/ligacoes.js';
import { fetchDebitosByLigacao } from '../company/debitos.js';
// Serviços: API a ser implementada em breve
import { fetchConsumoByLigacao } from '../company/consumo.js';
import { fetchDadosCadastraisByLigacao } from '../company/cadastro.js';
import { fetchClienteByCpf, loginByIdEletronico } from '../company/cliente.js';
import { isLinkApiConfigured, linkImpressaoConta } from '../company/linkApi.js';
import { fetchDadosAutarquia, formatarTelefone } from '../company/autarquia.js';
import { ensureOpenHumanTicket } from '../supabase/humanTickets.js';
function onlyDigits(value) {
    try {
        if (typeof value !== 'string')
            return '';
        return value.replace(/\D/g, '');
    }
    catch {
        return '';
    }
}
function isValidCpf(cpf) {
    try {
        if (!cpf || typeof cpf !== 'string')
            return false;
        const v = onlyDigits(cpf);
        return v.length === 11;
    }
    catch {
        return false;
    }
}
function buildDadosCadastraisMessage(lig, dados) {
    const linhas = [];
    if (lig) {
        const detalhes = lig.description ? `\n${lig.description}` : '';
        linhas.push(`Ligação selecionada:`);
        linhas.push('');
        linhas.push(`${lig.label}${detalhes}`);
        linhas.push('');
    }
    if (!dados) {
        linhas.push('Não encontramos dados cadastrais para esta ligação.');
        return linhas.join('\n');
    }
    linhas.push('*Dados cadastrais da ligação:*');
    linhas.push('');
    if (dados.numeroLigacao)
        linhas.push(`• Número da ligação: ${dados.numeroLigacao}`);
    if (dados.nomeTitular)
        linhas.push(`• Titular: ${dados.nomeTitular}`);
    if (dados.numeroHidrometro)
        linhas.push(`• Número do hidrômetro: ${dados.numeroHidrometro}`);
    if (dados.situacaoAbastecimento)
        linhas.push(`• Situação do abastecimento: ${dados.situacaoAbastecimento}`);
    if (dados.servicosContratados && dados.servicosContratados.length > 0) {
        linhas.push(`• Serviços contratados: ${dados.servicosContratados.join(', ')}`);
    }
    if (dados.enderecoImovel) {
        linhas.push('• Endereço do imóvel:');
        linhas.push(`  ${dados.enderecoImovel}`);
    }
    if (dados.enderecoCorrespondencia) {
        linhas.push('• Endereço de correspondência:');
        linhas.push(`  ${dados.enderecoCorrespondencia}`);
    }
    if (dados.categoria)
        linhas.push(`• Categoria da ligação: ${dados.categoria}`);
    if (dados.dataAtivacao)
        linhas.push(`• Data de ativação: ${dados.dataAtivacao}`);
    return linhas.join('\n');
}
function isValidEmail(email) {
    try {
        if (!email || typeof email !== 'string')
            return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    }
    catch {
        return false;
    }
}
function normalizeUserText(value) {
    try {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }
    catch {
        return (value || '').toLowerCase().trim();
    }
}
function isHumanAttendantRequest(value) {
    const normalized = normalizeUserText(value || '');
    if (!normalized)
        return false;
    if (normalized === '0')
        return true;
    if (normalized.includes('falar com atendente'))
        return true;
    if (normalized.includes('com atendente'))
        return true;
    if (normalized.includes('atendimento humano'))
        return true;
    if (normalized === 'atendente' || normalized.includes('atendente'))
        return true;
    return false;
}
async function sendLigacoesSelection(config, sessionStore, phone, replies, now, cpf, state, prefixMessage) {
    try {
        if (prefixMessage) {
            replies.push(prefixMessage);
        }
        let ligacoes = [];
        try {
            ligacoes = await fetchLigacoesByCpf(config, cpf);
        }
        catch {
            replies.push('Não foi possível consultar suas ligações no momento. Tente novamente mais tarde.');
            try {
                await sessionStore.save({
                    phone,
                    state: { name: 'main_menu', cpf, email: state?.email },
                    updatedAt: now
                });
            }
            catch {
            }
            return 'error';
        }
        if (!ligacoes || ligacoes.length === 0) {
            replies.push('Não encontramos nenhuma ligação vinculada a este CPF.');
            try {
                await sessionStore.save({
                    phone,
                    state: { name: 'main_menu', cpf, email: state?.email },
                    updatedAt: now
                });
            }
            catch {
            }
            return 'none';
        }
        if (ligacoes.length === 1) {
            const lig = ligacoes[0];
            let dados = null;
            try {
                dados = await fetchDadosCadastraisByLigacao(config, { cpf, ligacaoId: lig.id });
            }
            catch {
            }
            replies.push(buildDadosCadastraisMessage(lig, dados));
            try {
                await sessionStore.save({
                    phone,
                    state: {
                        name: 'main_menu',
                        cpf,
                        email: state?.email,
                        ligacaoId: lig.id
                    },
                    updatedAt: now
                });
            }
            catch {
            }
            return 'single';
        }
        replies.push({
            type: 'list',
            text: 'Selecione a ligação desejada:',
            buttonText: 'Minhas ligações',
            sections: [
                {
                    title: 'Ligações vinculadas ao CPF',
                    rows: ligacoes.map(l => ({ id: l.id, title: l.label, description: l.description }))
                }
            ]
        });
        try {
            await sessionStore.save({
                phone,
                state: { name: 'select_ligacao', cpf, email: state?.email },
                updatedAt: now
            });
        }
        catch {
        }
        return 'list';
    }
    catch {
        replies.push('Não foi possível consultar suas ligações no momento.');
        try {
            await sessionStore.save({
                phone,
                state: { name: 'main_menu', cpf, email: state?.email },
                updatedAt: now
            });
        }
        catch {
        }
        return 'error';
    }
}
function minutesDiff(a, b) {
    try {
        if (!(a instanceof Date) || !(b instanceof Date))
            return 0;
        return Math.abs((a.getTime() - b.getTime()) / 60000);
    }
    catch {
        return 0;
    }
}
function hoursDiff(a, b) {
    try {
        if (!(a instanceof Date) || !(b instanceof Date))
            return 0;
        return Math.abs((a.getTime() - b.getTime()) / 3600000);
    }
    catch {
        return 0;
    }
}
/**
 * Verifica se o ID Eletrônico tem formato válido
 * Formato esperado: números seguidos de @ e letra (ex: 70111@A)
 */
function isValidIdEletronico(id) {
    if (!id || typeof id !== 'string')
        return false;
    // Aceita formatos como "70111@A", "8991@X", etc.
    return /^\d+@[A-Za-z]\s*$/.test(id.trim()) || /^\d+@[A-Za-z]$/.test(id.trim());
}
function isAuthenticated(state) {
    try {
        if (!state || typeof state !== 'object')
            return false;
        const authedStates = [
            'main_menu',
            'select_ligacao',
            'send_fatura',
            'request_servico',
            'acompanhar_servico'
        ];
        // Aceita autenticação por CPF (legado) OU por ID Eletrônico (novo)
        const hasCpf = typeof state.cpf === 'string' && state.cpf.length === 11;
        const hasIdEletronico = typeof state.idEletronico === 'string' && state.idEletronico.length > 0;
        return authedStates.includes(state.name) && (hasCpf || hasIdEletronico);
    }
    catch {
        return false;
    }
}
const MENU_PROMPT = 'Toque na opção desejada:';
const MENU_ITEMS = [
    { id: '1', title: '1️⃣ Vídeo orientativo' },
    { id: '2', title: '2️⃣ Minhas ligações' },
    { id: '3', title: '3️⃣ Histórico de consumo e leituras' },
    { id: '4', title: '4️⃣ Emissão de 2ª via' },
    { id: '5', title: '5️⃣ Localização para atendimento presencial' },
    { id: '0', title: '0️⃣ Falar com atendente' }
];
function menuSections() {
    return [
        { title: 'Autoatendimento', rows: MENU_ITEMS.slice(0, 5) },
        { title: 'Outros serviços', rows: MENU_ITEMS.slice(5) }
    ];
}
function menuInteractive(prefix) {
    return {
        type: 'list',
        text: prefix ? `${prefix}\n\n${MENU_PROMPT}` : MENU_PROMPT,
        buttonText: 'Abrir menu',
        sections: menuSections()
    };
}
function menuFallbackText(prefix) {
    return prefix ? `${prefix}\n\n${mainMenu()}` : mainMenu();
}
export async function processMessage(config, phone, text, sessionStore) {
    const replies = [];
    try {
        // Validações básicas de entrada
        if (!phone || typeof phone !== 'string') {
            replies.push('Erro: Telefone inválido.');
            return replies;
        }
        if (!text || typeof text !== 'string') {
            text = '';
        }
        text = text.trim();
        const normalizedText = text.toLowerCase();
        const now = new Date().toISOString();
        let session;
        try {
            session = await sessionStore.getByPhone(phone);
        }
        catch (err) {
            // Se falhar ao buscar sessão, cria nova
            session = null;
        }
        if (!session || !session.state) {
            session = {
                phone,
                state: { name: 'idle' },
                updatedAt: now
            };
        }
        const state = session.state || { name: 'idle' };
        // Comandos globais (processados antes da verificação de estado)
        // 0 - falar com atendente (cria/garante ticket humano no Supabase)
        if (isHumanAttendantRequest(text)) {
            try {
                let protocoloMsg = '';
                try {
                    const ticket = await ensureOpenHumanTicket(config, phone);
                    if (ticket) {
                        const shortId = ticket.id.slice(0, 8);
                        protocoloMsg = `\n\n🔢 Protocolo do atendimento humano: *${shortId}*`;
                    }
                }
                catch {
                    // Falha ao registrar ticket não impede a mensagem ao usuário
                }
                // Tenta buscar telefone da autarquia para contato alternativo
                let telefoneMsg = '';
                try {
                    const autarquia = await fetchDadosAutarquia(config);
                    if (autarquia.telefone) {
                        const telFormatado = formatarTelefone(autarquia.telefone);
                        telefoneMsg = `\n\n📞 Você também pode ligar para: *${telFormatado}*`;
                    }
                }
                catch {
                    // Ignora erro - usa apenas a mensagem padrão
                }
                replies.push(messages.humanContact + protocoloMsg + telefoneMsg);
                await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
            }
            catch {
                // Mesmo se falhar ao salvar sessão, retorna a resposta já montada
            }
            return replies;
        }
        // ENCERRAR ATENDIMENTO - reseta completamente a sessão e volta ao início
        if (normalizedText === 'encerrar atendimento') {
            try {
                // Se o SessionStore suportar delete, limpa a sessão persistida
                if (typeof sessionStore.delete === 'function') {
                    await sessionStore.delete(phone);
                }
            }
            catch {
                // Ignora erro ao tentar limpar sessão; segue com reset lógico
            }
            replies.push('✅ Atendimento encerrado. Vamos começar novamente.');
            replies.push(messages.welcome);
            if (config.welcomeAudioUrl) {
                replies.push({
                    type: 'audio',
                    audioUrl: config.welcomeAudioUrl,
                    waveform: true
                });
            }
            // Modo demonstração: usa ID do environment se configurado
            const demoId = config.demoIdEletronico;
            if (demoId) {
                replies.push(messages.idEletronicoInserido(demoId));
                replies.push({
                    type: 'buttons',
                    text: 'Confirma que este é seu ID Eletrônico?',
                    buttons: [
                        { id: 'confirm_id_yes', text: '✅ Sim, confirmo' },
                        { id: 'confirm_id_no', text: '❌ Não, corrigir' }
                    ],
                    footer: 'Toque no botão'
                });
                try {
                    await sessionStore.save({ phone, state: { name: 'awaiting_confirm_id', idEletronico: demoId }, updatedAt: now });
                }
                catch {
                    // Erro silencioso
                }
            }
            else {
                replies.push(messages.askIdEletronico);
                try {
                    await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                }
                catch {
                    // Erro silencioso
                }
            }
            return replies;
        }
        // Verificar expiração de sessão ANTES de processar comandos como "menu"
        const last = session.updatedAt ? new Date(session.updatedAt) : new Date();
        const nowD = new Date();
        const inactiveMinutes = minutesDiff(nowD, last);
        const ageHours = hoursDiff(nowD, last);
        const maxInactivity = config?.sessionMaxInactivityMinutes || 30;
        const maxAge = config?.sessionMaxAgeHours || 24;
        const expiredByInactivity = inactiveMinutes > maxInactivity;
        const expiredByAge = ageHours > maxAge;
        const sessionExpired = expiredByInactivity || expiredByAge;
        if (sessionExpired) {
            try {
                replies.push(messages.sessionExpired);
                await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
            }
            catch (err) {
                // Mesmo se falhar ao salvar, retorna a resposta
            }
            return replies;
        }
        if (/^\s*menu\s*$/i.test(text)) {
            try {
                const authed = isAuthenticated(state);
                if (!authed) {
                    // Login é sempre por ID Eletrônico
                    replies.push(messages.askIdEletronico);
                    await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                }
                else {
                    const menuAudioAlreadyPlayed = state?.menuAudioPlayed === true;
                    if (config.menuAudioUrl && !menuAudioAlreadyPlayed) {
                        replies.push({
                            type: 'audio',
                            audioUrl: config.menuAudioUrl,
                            waveform: true
                        });
                    }
                    replies.push(menuInteractive());
                    // menuFallbackText removido - só menu interativo
                    await sessionStore.save({
                        phone,
                        state: {
                            name: 'main_menu',
                            cpf: state?.cpf,
                            idEletronico: state?.idEletronico,
                            nomeCliente: state?.nomeCliente,
                            email: state?.email,
                            imovelId: state?.imovelId,
                            ligacaoId: state?.ligacaoId,
                            menuAudioPlayed: true
                        },
                        updatedAt: now
                    });
                }
            }
            catch (err) {
                // Fallback em caso de erro
                replies.push(messages.askIdEletronico);
            }
            return replies;
        }
        // Se está no estado inicial (idle)
        if (state.name === 'idle') {
            // Modo demonstração: usa ID do environment se configurado
            const demoId = config.demoIdEletronico;
            const trimmedText = text.trim();
            const idToUse = demoId || (isValidIdEletronico(trimmedText) ? trimmedText : null);
            if (idToUse) {
                replies.push(messages.welcome);
                if (config.welcomeAudioUrl) {
                    replies.push({
                        type: 'audio',
                        audioUrl: config.welcomeAudioUrl,
                        waveform: true
                    });
                }
                replies.push(messages.idEletronicoInserido(idToUse));
                replies.push({
                    type: 'buttons',
                    text: 'Confirma que este é seu ID Eletrônico?',
                    buttons: [
                        { id: 'confirm_id_yes', text: '✅ Sim, confirmo' },
                        { id: 'confirm_id_no', text: '❌ Não, corrigir' }
                    ],
                    footer: 'Toque no botão'
                });
                try {
                    await sessionStore.save({
                        phone,
                        state: { name: 'awaiting_confirm_id', idEletronico: idToUse },
                        updatedAt: now
                    });
                }
                catch {
                    // Erro silencioso - sessão em memória não deve falhar
                }
                return replies;
            }
            // Se não tem demo ID e não é ID válido, pede ID Eletrônico
            replies.push(messages.welcome);
            if (config.welcomeAudioUrl) {
                replies.push({
                    type: 'audio',
                    audioUrl: config.welcomeAudioUrl,
                    waveform: true
                });
            }
            replies.push(messages.askIdEletronico);
            try {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
            }
            catch {
                // Erro silencioso
            }
            return replies;
            /* COMENTADO: Fluxo legado por CPF - não é mais usado
            const cpfDigitsFromFirstMessage = onlyDigits(text);
            if (cpfDigitsFromFirstMessage && cpfDigitsFromFirstMessage.length === 11) {
              // ... código CPF omitido ...
            }
            FIM DO COMENTÁRIO */
        }
        // Enforce login obrigatório (expiração já foi verificada acima)
        try {
            const authed = isAuthenticated(state);
            if (!authed) {
                // Se não está autenticado, requisita login (exceto se já está em fluxo de login)
                const loginStates = [
                    // 'awaiting_login_cpf', // COMENTADO: Não é mais usado
                    'awaiting_login_id',
                    'awaiting_login_email',
                    'awaiting_login_otp',
                    // 'awaiting_confirm_cpf', // COMENTADO: Não é mais usado
                    'awaiting_confirm_id',
                    'awaiting_confirm_email'
                ];
                if (state.name && !loginStates.includes(state.name)) {
                    try {
                        // Login é sempre por ID Eletrônico
                        replies.push(messages.askIdEletronico);
                        await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                    }
                    catch (err) {
                        // Mesmo se falhar ao salvar, retorna a resposta
                    }
                    return replies;
                }
            }
        }
        catch (err) {
            // Se falhar na verificação de expiração, continua o fluxo normalmente
        }
        const stateName = state?.name || 'idle';
        switch (stateName) {
            // ========== NOVO FLUXO: LOGIN POR ID ELETRÔNICO ==========
            case 'awaiting_login_id': {
                try {
                    const trimmedText = text.trim();
                    if (!isValidIdEletronico(trimmedText)) {
                        replies.push(messages.invalidIdEletronico);
                        replies.push(messages.askIdEletronico);
                        return replies;
                    }
                    // Mostra o ID inserido e pede confirmação
                    replies.push(messages.idEletronicoInserido(trimmedText));
                    replies.push({
                        type: 'buttons',
                        text: 'Confirma que este é seu ID Eletrônico?',
                        buttons: [
                            { id: 'confirm_id_yes', text: '✅ Sim, confirmo' },
                            { id: 'confirm_id_no', text: '❌ Não, corrigir' }
                        ],
                        footer: 'Toque no botão'
                    });
                    await sessionStore.save({
                        phone,
                        state: { name: 'awaiting_confirm_id', idEletronico: trimmedText },
                        updatedAt: now
                    });
                }
                catch (err) {
                    replies.push('Erro ao processar ID. Tente novamente.');
                    replies.push(messages.askIdEletronico);
                }
                return replies;
            }
            case 'awaiting_confirm_id': {
                try {
                    const idEletronico = state?.idEletronico;
                    const confirmed = text === 'confirm_id_yes' || normalizedText === 'sim' || normalizedText === 'sim, correto';
                    const denied = text === 'confirm_id_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'não, corrigir' || normalizedText === 'nao, corrigir';
                    if (denied) {
                        replies.push(messages.askIdEletronico);
                        await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                        return replies;
                    }
                    if (!confirmed) {
                        replies.push(messages.idEletronicoInserido(idEletronico));
                        replies.push({
                            type: 'buttons',
                            text: 'Confirma que este é seu ID Eletrônico?',
                            buttons: [
                                { id: 'confirm_id_yes', text: '✅ Sim, confirmo' },
                                { id: 'confirm_id_no', text: '❌ Não, corrigir' }
                            ],
                            footer: 'Toque no botão'
                        });
                        return replies;
                    }
                    // Faz login via API
                    try {
                        const loginResult = await loginByIdEletronico(config, idEletronico);
                        const ligacoes = imoveisToLigacoes(loginResult.imoveis);
                        // Saudação com nome do cliente
                        replies.push(messages.clienteEncontrado(loginResult.nomeCliente));
                        if (ligacoes.length === 0) {
                            replies.push('Não encontramos imóveis vinculados a este ID Eletrônico.');
                            replies.push(messages.askIdEletronico);
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                            return replies;
                        }
                        if (ligacoes.length === 1) {
                            // Único imóvel - vai direto pro menu
                            const lig = ligacoes[0];
                            // Busca dados cadastrais
                            let dados = null;
                            try {
                                dados = await fetchDadosCadastraisByLigacao(config, {
                                    ligacaoId: lig.id,
                                    imovelId: lig.imovelId
                                });
                            }
                            catch {
                                // Erro silencioso
                            }
                            replies.push(buildDadosCadastraisMessage(lig, dados));
                            // Toca áudio do menu se configurado
                            if (config.menuAudioUrl) {
                                replies.push({
                                    type: 'audio',
                                    audioUrl: config.menuAudioUrl,
                                    waveform: true
                                });
                            }
                            replies.push(menuInteractive());
                            // menuFallbackText removido - só menu interativo
                            await sessionStore.save({
                                phone,
                                state: {
                                    name: 'main_menu',
                                    idEletronico,
                                    nomeCliente: loginResult.nomeCliente,
                                    imovelId: lig.imovelId,
                                    ligacaoId: lig.id,
                                    menuAudioPlayed: true
                                },
                                updatedAt: now
                            });
                        }
                        else {
                            // Múltiplos imóveis - mostra lista para seleção
                            replies.push({
                                type: 'list',
                                text: messages.selecioneImovel,
                                buttonText: 'Meus imóveis',
                                sections: [
                                    {
                                        title: 'Imóveis vinculados',
                                        rows: ligacoes.map(l => ({
                                            id: l.id,
                                            title: l.label,
                                            description: l.description
                                        }))
                                    }
                                ]
                            });
                            await sessionStore.save({
                                phone,
                                state: {
                                    name: 'select_ligacao',
                                    idEletronico,
                                    nomeCliente: loginResult.nomeCliente
                                },
                                updatedAt: now
                            });
                        }
                    }
                    catch (err) {
                        // Log do erro para debug
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        console.error('[flow] Erro ao fazer login:', errorMessage);
                        if (errorMessage.includes('404') || errorMessage.toLowerCase().includes('user not found')) {
                            replies.push(messages.invalidIdEletronico);
                        }
                        else {
                            replies.push(`Erro ao validar ID Eletrônico: ${errorMessage}`);
                        }
                        replies.push(messages.askIdEletronico);
                        await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar. Tente novamente.');
                    replies.push(messages.askIdEletronico);
                    await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                }
                return replies;
            }
            case 'main_menu': {
                try {
                    let showMenuAfter = false;
                    switch (text) {
                        case '1':
                            // 1️⃣ Vídeo orientativo
                            try {
                                if (!config?.videoTutorialUrl) {
                                    replies.push(messages.videoUnavailable);
                                }
                                else {
                                    const intro = config.videoTutorialIntro?.trim() || messages.videoIntro;
                                    replies.push(intro);
                                    // Envia o vídeo diretamente via Z-API
                                    replies.push({
                                        type: 'video',
                                        video: config.videoTutorialUrl,
                                        caption: config.videoTutorialCaption?.trim() || undefined
                                    });
                                }
                            }
                            catch (err) {
                                replies.push(messages.videoUnavailable);
                            }
                            showMenuAfter = true;
                            break;
                        case '2':
                            // 2️⃣ Minhas ligações
                            try {
                                const cpf = state?.cpf;
                                const idEletronico = state?.idEletronico;
                                if (!cpf && !idEletronico) {
                                    replies.push(messages.requireLogin);
                                    showMenuAfter = true;
                                    break;
                                }
                                // Se temos idEletronico, refaz o login para pegar imóveis atualizados
                                if (idEletronico) {
                                    try {
                                        const loginResult = await loginByIdEletronico(config, idEletronico);
                                        const ligacoes = imoveisToLigacoes(loginResult.imoveis);
                                        if (ligacoes.length === 0) {
                                            replies.push('Não encontramos imóveis vinculados.');
                                            showMenuAfter = true;
                                            break;
                                        }
                                        if (ligacoes.length === 1) {
                                            const lig = ligacoes[0];
                                            let dados = null;
                                            try {
                                                dados = await fetchDadosCadastraisByLigacao(config, {
                                                    ligacaoId: lig.id,
                                                    imovelId: lig.imovelId
                                                });
                                            }
                                            catch {
                                                // Erro silencioso
                                            }
                                            replies.push(buildDadosCadastraisMessage(lig, dados));
                                            showMenuAfter = true;
                                        }
                                        else {
                                            replies.push({
                                                type: 'list',
                                                text: messages.selecioneImovel,
                                                buttonText: 'Meus imóveis',
                                                sections: [
                                                    {
                                                        title: 'Imóveis vinculados',
                                                        rows: ligacoes.map(l => ({
                                                            id: l.id,
                                                            title: l.label,
                                                            description: l.description
                                                        }))
                                                    }
                                                ]
                                            });
                                            await sessionStore.save({
                                                phone,
                                                state: {
                                                    name: 'select_ligacao',
                                                    idEletronico,
                                                    nomeCliente: state?.nomeCliente
                                                },
                                                updatedAt: now
                                            });
                                            return replies;
                                        }
                                    }
                                    catch {
                                        replies.push('Não foi possível consultar seus imóveis. Tente novamente mais tarde.');
                                        showMenuAfter = true;
                                    }
                                    break;
                                }
                                // Fluxo legado por CPF - mas se tem idEletronico, já passou acima
                                const isLoggedIn1 = (cpf && cpf.length === 11) || (idEletronico && idEletronico.length > 0);
                                if (!isLoggedIn1) {
                                    replies.push(messages.requireLogin);
                                    showMenuAfter = true;
                                    break;
                                }
                                const result = await sendLigacoesSelection(config, sessionStore, phone, replies, now, cpf, state);
                                if (result === 'none' || result === 'single' || result === 'error') {
                                    showMenuAfter = true;
                                }
                            }
                            catch {
                                replies.push('Não foi possível consultar suas ligações no momento.');
                                showMenuAfter = true;
                            }
                            break;
                        case '3':
                            // 3️⃣ Histórico de consumo e leituras
                            try {
                                const cpf = state?.cpf;
                                const idEletronico = state?.idEletronico;
                                const ligacaoId = state?.ligacaoId;
                                const imovelId = state?.imovelId;
                                const isLoggedIn3 = (cpf && cpf.length === 11) || (idEletronico && idEletronico.length > 0);
                                if (!isLoggedIn3) {
                                    replies.push(messages.requireLogin);
                                    showMenuAfter = true;
                                    break;
                                }
                                if (!ligacaoId || typeof ligacaoId !== 'string') {
                                    const result = await sendLigacoesSelection(config, sessionStore, phone, replies, now, cpf, state, 'Primeiro selecione a ligação que você deseja utilizar.');
                                    if (result === 'none' || result === 'single' || result === 'error') {
                                        showMenuAfter = true;
                                    }
                                    break;
                                }
                                let itensConsumo = [];
                                try {
                                    itensConsumo = await fetchConsumoByLigacao(config, { cpf, ligacaoId, imovelId });
                                }
                                catch (err) {
                                    console.error('[consumo] Erro ao buscar histórico:', err);
                                    replies.push('Não foi possível consultar o histórico de consumo desta ligação no momento. Tente novamente mais tarde.');
                                    showMenuAfter = true;
                                    break;
                                }
                                if (!itensConsumo || itensConsumo.length === 0) {
                                    replies.push('Não encontramos registros recentes de consumo para esta ligação.');
                                    showMenuAfter = true;
                                    break;
                                }
                                const maxItens = 6;
                                const selecionados = itensConsumo.slice(0, maxItens);
                                const linesConsumo = [];
                                linesConsumo.push('*Histórico recente de consumo e leituras:*');
                                linesConsumo.push('');
                                for (const item of selecionados) {
                                    linesConsumo.push(`📅 *Referência: ${item.referencia}*`);
                                    if (item.dataLeitura)
                                        linesConsumo.push(`• Data da leitura: ${item.dataLeitura}`);
                                    if (item.hidrometro)
                                        linesConsumo.push(`• Hidrômetro: ${item.hidrometro}`);
                                    if (item.leitura !== undefined)
                                        linesConsumo.push(`• Leitura: ${item.leitura}`);
                                    if (item.consumoReal !== undefined) {
                                        linesConsumo.push(`• Consumo real: ${item.consumoReal} m³`);
                                    }
                                    if (item.consumoFaturado !== undefined) {
                                        linesConsumo.push(`• Consumo faturado: ${item.consumoFaturado} m³`);
                                    }
                                    if (item.consumoMedio !== undefined) {
                                        linesConsumo.push(`• Média de consumo: ${item.consumoMedio} m³`);
                                    }
                                    if (item.ocorrencia)
                                        linesConsumo.push(`• Ocorrência: ${item.ocorrencia}`);
                                    linesConsumo.push('');
                                }
                                replies.push(linesConsumo.join('\n'));
                                showMenuAfter = true;
                            }
                            catch {
                                replies.push('Não foi possível consultar o histórico de consumo desta ligação no momento.');
                                showMenuAfter = true;
                            }
                            break;
                        case '4':
                            // 4️⃣ Emissão de 2ª via
                            try {
                                const cpf = state?.cpf;
                                const idEletronico = state?.idEletronico;
                                const ligacaoId = state?.ligacaoId;
                                const imovelId = state?.imovelId;
                                // Aceita login por CPF (legado) ou ID Eletrônico (novo)
                                const isLoggedIn = (cpf && cpf.length === 11) || (idEletronico && idEletronico.length > 0);
                                if (!isLoggedIn) {
                                    replies.push(messages.requireLogin);
                                    showMenuAfter = true;
                                    break;
                                }
                                if (!ligacaoId || typeof ligacaoId !== 'string') {
                                    const result = await sendLigacoesSelection(config, sessionStore, phone, replies, now, cpf, state, 'Primeiro selecione a ligação que você deseja utilizar.');
                                    if (result === 'none' || result === 'single' || result === 'error') {
                                        showMenuAfter = true;
                                    }
                                    break;
                                }
                                let debitos = [];
                                try {
                                    debitos = await fetchDebitosByLigacao(config, { cpf, ligacaoId, imovelId });
                                }
                                catch (err) {
                                    replies.push('Não foi possível consultar as faturas desta ligação no momento. Tente novamente mais tarde.');
                                    showMenuAfter = true;
                                    break;
                                }
                                if (!debitos || debitos.length === 0) {
                                    replies.push('Não há faturas pendentes em aberto para esta ligação.');
                                    showMenuAfter = true;
                                    break;
                                }
                                const lines = [];
                                lines.push('Faturas pendentes desta ligação:');
                                lines.push('');
                                let index = 1;
                                for (const debito of debitos) {
                                    const valorFormatado = `R$ ${debito.valor.toFixed(2).replace('.', ',')}`;
                                    const auto = debito.emDebitoAutomatico ? 'Sim' : 'Não';
                                    lines.push(`Fatura ${index}:`);
                                    lines.push(`• Nº da fatura: ${debito.idFatura}`);
                                    if (debito.mesAnoReferencia)
                                        lines.push(`• Mês/ano: ${debito.mesAnoReferencia}`);
                                    if (debito.dataVencimento)
                                        lines.push(`• Vencimento: ${debito.dataVencimento}`);
                                    lines.push(`• Valor: ${valorFormatado}`);
                                    lines.push(`• Débito automático: ${auto}`);
                                    if (debito.status)
                                        lines.push(`• Status: ${debito.status}`);
                                    lines.push('');
                                    index++;
                                }
                                replies.push(lines.join('\n'));
                                // Em seguida, o usuário escolhe qual fatura deseja receber em PDF
                                replies.push({
                                    type: 'list',
                                    text: 'Selecione a fatura que deseja receber no formato PDF:',
                                    buttonText: 'Escolher fatura',
                                    sections: [
                                        {
                                            title: 'Faturas disponíveis',
                                            rows: debitos.map(d => {
                                                const valorFormatado = `R$ ${d.valor.toFixed(2).replace('.', ',')}`;
                                                const title = `Ref. ${d.mesAnoReferencia} - ${valorFormatado}`;
                                                const description = d.dataVencimento
                                                    ? `Vencimento: ${d.dataVencimento}`
                                                    : undefined;
                                                return { id: d.idFatura, title, description };
                                            })
                                        }
                                    ]
                                });
                                try {
                                    await sessionStore.save({
                                        phone,
                                        state: { name: 'send_fatura', cpf, idEletronico, ligacaoId, imovelId },
                                        updatedAt: now
                                    });
                                }
                                catch {
                                }
                            }
                            catch {
                                replies.push('Não foi possível consultar as faturas desta ligação no momento.');
                                showMenuAfter = true;
                            }
                            break;
                        case '5':
                            // 5️⃣ Localização para atendimento presencial
                            try {
                                const hasLocation = config?.atendimentoMapsLatitude && config?.atendimentoMapsLongitude;
                                if (!hasLocation) {
                                    replies.push('No momento, não há um endereço de atendimento presencial configurado. Por favor, entre em contato com o atendimento humano para mais informações.');
                                    showMenuAfter = true;
                                    break;
                                }
                                // Busca endereço da autarquia para usar no pin
                                let enderecoAutarquia = '';
                                try {
                                    const autarquia = await fetchDadosAutarquia(config);
                                    if (autarquia.endereco) {
                                        enderecoAutarquia = autarquia.endereco;
                                    }
                                }
                                catch {
                                    // Ignora erro - usa dados do .env
                                }
                                const title = config.atendimentoMapsTitle?.trim() || 'Atendimento presencial';
                                const address = enderecoAutarquia || config.atendimentoMapsAddress?.trim() || 'Endereço de atendimento';
                                replies.push({
                                    type: 'location',
                                    title,
                                    address,
                                    latitude: config.atendimentoMapsLatitude,
                                    longitude: config.atendimentoMapsLongitude
                                });
                                showMenuAfter = true;
                            }
                            catch {
                                replies.push('Não foi possível carregar a localização de atendimento presencial no momento.');
                                showMenuAfter = true;
                            }
                            break;
                        default:
                            replies.push(menuInteractive());
                    }
                    if (showMenuAfter) {
                        replies.push(menuInteractive());
                    }
                }
                catch (err) {
                    // Fallback em caso de erro: só menu em texto
                    replies.push(menuFallbackText());
                }
                break;
            }
            case 'awaiting_login_cpf': {
                try {
                    if (!isValidCpf(text)) {
                        replies.push(messages.invalidIdEletronico);
                        replies.push(messages.askIdEletronico);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                        break;
                    }
                    const cpfDigits = onlyDigits(text);
                    if (!cpfDigits || cpfDigits.length !== 11) {
                        replies.push(messages.invalidIdEletronico);
                        replies.push(messages.askIdEletronico);
                        break;
                    }
                    // Formata CPF para exibição: XXX.XXX.XXX-XX
                    let cpfFormatted = '';
                    try {
                        cpfFormatted = cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                    }
                    catch (err) {
                        cpfFormatted = cpfDigits;
                    }
                    replies.push({
                        type: 'buttons',
                        text: `Confirme se o CPF está correto:\n\n${cpfFormatted}`,
                        buttons: [
                            { id: 'confirm_cpf_yes', text: '✅ Sim, correto' },
                            { id: 'confirm_cpf_no', text: '❌ Não, corrigir' }
                        ],
                        footer: 'Toque no botão'
                    });
                    try {
                        await sessionStore.save({ phone, state: { name: 'awaiting_confirm_cpf', cpf: cpfDigits }, updatedAt: now });
                    }
                    catch (err) {
                        // Mesmo se falhar ao salvar, retorna a resposta
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar CPF. Por favor, tente novamente.');
                    replies.push(messages.askIdEletronico);
                }
                break;
            }
            case 'awaiting_confirm_cpf': {
                try {
                    const cpf = state?.cpf;
                    const normalizedText = typeof text === 'string' ? text.toLowerCase().trim() : '';
                    // Verifica confirmação positiva (botões, texto "sim" ou número 1)
                    if (text === 'confirm_cpf_yes' || normalizedText === 'sim' || normalizedText === 's' || normalizedText === '1') {
                        if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
                            replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
                            replies.push(messages.askIdEletronico);
                            try {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                            }
                            catch (err) {
                            }
                        }
                        else {
                            // Em modo mock de OTP, pula totalmente fluxo de e-mail/OTP e já autentica o usuário
                            if (config.otpMock) {
                                replies.push('Enviamos um código de verificação para o seu e-mail cadastrado (modo teste).');
                                replies.push(messages.otpAccepted);
                                try {
                                    const ligacoes = await fetchLigacoesByCpf(config, cpf);
                                    if (ligacoes && ligacoes.length > 0) {
                                        if (ligacoes.length === 1) {
                                            const lig = ligacoes[0];
                                            const detalhes = lig.description ? `\n${lig.description}` : '';
                                            replies.push(`Ligação encontrada:\n\n${lig.label}${detalhes}`);
                                            if (config.menuAudioUrl) {
                                                replies.push({
                                                    type: 'audio',
                                                    audioUrl: config.menuAudioUrl,
                                                    waveform: true
                                                });
                                            }
                                            replies.push(menuInteractive('Agora escolha uma opção do menu para essa ligação.'));
                                            await sessionStore.save({
                                                phone,
                                                state: { name: 'main_menu', cpf, ligacaoId: lig.id, menuAudioPlayed: true },
                                                updatedAt: now
                                            });
                                        }
                                        else {
                                            replies.push({
                                                type: 'list',
                                                text: 'Selecione a ligação desejada:',
                                                buttonText: 'Minhas ligações',
                                                sections: [
                                                    {
                                                        title: 'Ligações vinculadas ao CPF',
                                                        rows: ligacoes.map(l => ({ id: l.id, title: l.label, description: l.description }))
                                                    }
                                                ]
                                            });
                                            await sessionStore.save({
                                                phone,
                                                state: { name: 'select_ligacao', cpf },
                                                updatedAt: now
                                            });
                                        }
                                    }
                                    else {
                                        replies.push('Não encontramos nenhuma ligação vinculada a este CPF.');
                                        await sessionStore.save({
                                            phone,
                                            state: { name: 'main_menu', cpf },
                                            updatedAt: now
                                        });
                                    }
                                }
                                catch (err) {
                                    // Se der erro ao buscar ligações, cai para o menu padrão
                                    replies.push(menuInteractive(messages.otpAccepted));
                                    try {
                                        await sessionStore.save({
                                            phone,
                                            state: { name: 'main_menu', cpf },
                                            updatedAt: now
                                        });
                                    }
                                    catch { }
                                }
                            }
                            else {
                                try {
                                    const cliente = await fetchClienteByCpf(config, cpf);
                                    if (!cliente) {
                                        replies.push('Não localizamos um cadastro ativo para este CPF. Por favor, entre em contato com a entidade para cadastrar sua ligação. Este atendimento será encerrado por aqui. Muito obrigado pelo contato!');
                                        // Se houver telefone da entidade configurado, envia botão de ligação (CALL)
                                        if (config.entidadePhoneNumber) {
                                            const tel = config.entidadePhoneNumber.trim();
                                            if (tel) {
                                                replies.push({
                                                    type: 'buttonActions',
                                                    message: 'Toque no botão abaixo para ligar diretamente para a entidade.',
                                                    title: 'Ligar para a entidade',
                                                    footer: 'Atendimento telefônico',
                                                    buttonActions: [
                                                        {
                                                            id: 'call_entidade',
                                                            type: 'CALL',
                                                            phone: tel,
                                                            label: 'Fale conosco'
                                                        }
                                                    ]
                                                });
                                            }
                                        }
                                        try {
                                            if (typeof sessionStore.delete === 'function') {
                                                await sessionStore.delete(phone);
                                            }
                                            else {
                                                await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
                                            }
                                        }
                                        catch {
                                        }
                                    }
                                    else if (cliente.email && isValidEmail(cliente.email)) {
                                        try {
                                            await createAndSendOtp(config, { phone, cpf, email: cliente.email });
                                            replies.push('Enviamos um código de verificação para o seu e-mail cadastrado.');
                                            replies.push(messages.otpSent);
                                            try {
                                                await sessionStore.save({
                                                    phone,
                                                    state: { name: 'awaiting_login_otp', cpf, email: cliente.email },
                                                    updatedAt: now
                                                });
                                            }
                                            catch {
                                            }
                                        }
                                        catch {
                                            replies.push('Erro ao enviar código de verificação para o seu e-mail cadastrado. Por favor, tente novamente mais tarde ou entre em contato com a entidade para atendimento. Este atendimento será encerrado por aqui. Muito obrigado pelo contato!');
                                            if (config.entidadePhoneNumber) {
                                                const tel = config.entidadePhoneNumber.trim();
                                                if (tel) {
                                                    replies.push({
                                                        type: 'buttonActions',
                                                        message: 'Toque no botão abaixo para ligar diretamente para a entidade.',
                                                        title: 'Ligar para a entidade',
                                                        footer: 'Atendimento telefônico',
                                                        buttonActions: [
                                                            {
                                                                id: 'call_entidade',
                                                                type: 'CALL',
                                                                phone: tel,
                                                                label: 'Fale conosco'
                                                            }
                                                        ]
                                                    });
                                                }
                                            }
                                            try {
                                                if (typeof sessionStore.delete === 'function') {
                                                    await sessionStore.delete(phone);
                                                }
                                                else {
                                                    await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
                                                }
                                            }
                                            catch {
                                            }
                                        }
                                    }
                                    else {
                                        replies.push('Seu cadastro não possui e-mail. Por favor, entre em contato com a entidade para atualizar seus dados cadastrais. Este atendimento será encerrado por aqui. Muito obrigado pelo contato!');
                                        if (config.entidadePhoneNumber) {
                                            const tel = config.entidadePhoneNumber.trim();
                                            if (tel) {
                                                replies.push({
                                                    type: 'buttonActions',
                                                    message: 'Toque no botão abaixo para ligar diretamente para a entidade.',
                                                    title: 'Ligar para a entidade',
                                                    footer: 'Atendimento telefônico',
                                                    buttonActions: [
                                                        {
                                                            id: 'call_entidade',
                                                            type: 'CALL',
                                                            phone: tel,
                                                            label: 'Fale conosco'
                                                        }
                                                    ]
                                                });
                                            }
                                        }
                                        try {
                                            if (typeof sessionStore.delete === 'function') {
                                                await sessionStore.delete(phone);
                                            }
                                            else {
                                                await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
                                            }
                                        }
                                        catch {
                                        }
                                    }
                                }
                                catch {
                                    replies.push('Não foi possível consultar seus dados cadastrais no momento. Por favor, entre em contato com a entidade para atualizar ou conferir seus dados. Este atendimento será encerrado por aqui. Muito obrigado pelo contato!');
                                    if (config.entidadePhoneNumber) {
                                        const tel = config.entidadePhoneNumber.trim();
                                        if (tel) {
                                            replies.push({
                                                type: 'buttonActions',
                                                message: 'Toque no botão abaixo para ligar diretamente para a entidade.',
                                                title: 'Ligar para a entidade',
                                                footer: 'Atendimento telefônico',
                                                buttonActions: [
                                                    {
                                                        id: 'call_entidade',
                                                        type: 'CALL',
                                                        phone: tel,
                                                        label: 'Fale conosco'
                                                    }
                                                ]
                                            });
                                        }
                                    }
                                    try {
                                        if (typeof sessionStore.delete === 'function') {
                                            await sessionStore.delete(phone);
                                        }
                                        else {
                                            await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
                                        }
                                    }
                                    catch {
                                    }
                                }
                            }
                        }
                    }
                    // Verifica confirmação negativa (botões, texto "não" ou número 2)
                    else if (text === 'confirm_cpf_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'n' || normalizedText === '2') {
                        replies.push(messages.askIdEletronico);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                    }
                    // Resposta não reconhecida - reenvia os botões com instrução clara
                    else {
                        let cpfFormatted = '';
                        if (cpf && typeof cpf === 'string' && cpf.length === 11) {
                            try {
                                cpfFormatted = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                            }
                            catch (err) {
                                cpfFormatted = cpf;
                            }
                        }
                        replies.push({
                            type: 'buttons',
                            text: cpfFormatted ? `Confirme se o CPF está correto:\n\n${cpfFormatted}\n\nPor favor, toque em um dos botões abaixo:` : 'Confirme o CPF:\n\nPor favor, toque em um dos botões abaixo:',
                            buttons: [
                                { id: 'confirm_cpf_yes', text: '✅ Sim, correto' },
                                { id: 'confirm_cpf_no', text: '❌ Não, corrigir' }
                            ],
                            footer: 'Toque no botão'
                        });
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar confirmação. Por favor, informe seu CPF novamente.');
                    replies.push(messages.askIdEletronico);
                    try {
                        await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                    }
                    catch {
                        // Ignora erro ao salvar
                    }
                }
                break;
            }
            case 'awaiting_login_email': {
                try {
                    if (!isValidEmail(text)) {
                        replies.push(messages.invalidEmail);
                        replies.push(messages.askEmail);
                        break;
                    }
                    const cpf = state?.cpf;
                    if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
                        replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
                        replies.push(messages.askIdEletronico);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                        break;
                    }
                    // Mostra confirmação com botões antes de enviar OTP
                    replies.push({
                        type: 'buttons',
                        text: `Confirme se o e-mail está correto:\n\n${text.trim()}`,
                        buttons: [
                            { id: 'confirm_email_yes', text: '✅ Sim, correto' },
                            { id: 'confirm_email_no', text: '❌ Não, corrigir' }
                        ],
                        footer: 'Toque no botão'
                    });
                    try {
                        await sessionStore.save({ phone, state: { name: 'awaiting_confirm_email', cpf, email: text.trim() }, updatedAt: now });
                    }
                    catch (err) {
                        // Mesmo se falhar ao salvar, retorna a resposta
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar e-mail. Por favor, tente novamente.');
                    replies.push(messages.askEmail);
                }
                break;
            }
            case 'awaiting_confirm_email': {
                try {
                    const normalizedText = typeof text === 'string' ? text.toLowerCase().trim() : '';
                    const cpf = state?.cpf;
                    const email = state?.email;
                    if (text === 'confirm_email_yes' || normalizedText === 'sim' || normalizedText === 's' || normalizedText === '1') {
                        // Valida dados antes de enviar OTP
                        if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
                            replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
                            replies.push(messages.askIdEletronico);
                            try {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                            }
                            catch (err) {
                                // Mesmo se falhar ao salvar, retorna a resposta
                            }
                            break;
                        }
                        if (!email || typeof email !== 'string' || !isValidEmail(email)) {
                            replies.push('Erro: E-mail inválido. Por favor, informe seu e-mail novamente.');
                            replies.push(messages.askEmail);
                            try {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
                            }
                            catch (err) {
                                // Mesmo se falhar ao salvar, retorna a resposta
                            }
                            break;
                        }
                        // Envia OTP real por e-mail e persiste no Supabase
                        try {
                            await createAndSendOtp(config, { phone, cpf, email });
                            replies.push(messages.otpSent);
                            try {
                                await sessionStore.save({
                                    phone,
                                    state: { name: 'awaiting_login_otp', cpf, email },
                                    updatedAt: now
                                });
                            }
                            catch (err) {
                                // Mesmo se falhar ao salvar, retorna a resposta
                            }
                        }
                        catch (err) {
                            replies.push('Erro ao enviar código de verificação. Por favor, tente novamente.');
                            replies.push(messages.askEmail);
                        }
                    }
                    else if (text === 'confirm_email_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'n' || normalizedText === '2') {
                        replies.push(messages.askEmail);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                    }
                    else {
                        const emailToShow = email || '';
                        replies.push({
                            type: 'buttons',
                            text: emailToShow ? `Confirme se o e-mail está correto:\n\n${emailToShow}\n\nPor favor, toque em um dos botões abaixo:` : 'Por favor, toque em um dos botões para confirmar:',
                            buttons: [
                                { id: 'confirm_email_yes', text: '✅ Sim, correto' },
                                { id: 'confirm_email_no', text: '❌ Não, corrigir' }
                            ],
                            footer: 'Toque no botão'
                        });
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar confirmação de e-mail. Por favor, informe seu e-mail novamente.');
                    replies.push(messages.askEmail);
                }
                break;
            }
            case 'awaiting_login_otp': {
                try {
                    // Validar OTP via Supabase
                    if (!text || typeof text !== 'string' || !/^\d{4,8}$/.test(text.trim())) {
                        replies.push('Código inválido. Digite o código de verificação recebido por e-mail (4 a 8 dígitos).');
                        break;
                    }
                    const cpf = state?.cpf;
                    const email = state?.email;
                    if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
                        replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
                        replies.push(messages.askIdEletronico);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                        break;
                    }
                    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
                        replies.push('Erro: E-mail não encontrado. Por favor, informe seu e-mail novamente.');
                        replies.push(messages.askEmail);
                        try {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
                        }
                        catch (err) {
                            // Mesmo se falhar ao salvar, retorna a resposta
                        }
                        break;
                    }
                    try {
                        const ok = await verifyOtp(config, { cpf, email, code: text.trim() });
                        if (!ok) {
                            replies.push('Código incorreto ou expirado. Tente novamente ou digite "menu" para recomeçar.');
                            break;
                        }
                        // Login OK: em vez de ir direto para o menu, já direciona para seleção de ligação
                        replies.push(messages.otpAccepted);
                        try {
                            const ligacoes = await fetchLigacoesByCpf(config, cpf);
                            if (ligacoes && ligacoes.length > 0) {
                                if (ligacoes.length === 1) {
                                    const lig = ligacoes[0];
                                    const detalhes = lig.description ? `\n${lig.description}` : '';
                                    replies.push(`Ligação encontrada:\n\n${lig.label}${detalhes}`);
                                    if (config.menuAudioUrl) {
                                        replies.push({
                                            type: 'audio',
                                            audioUrl: config.menuAudioUrl,
                                            waveform: true
                                        });
                                    }
                                    replies.push(menuInteractive('Agora escolha uma opção do menu para essa ligação.'));
                                    await sessionStore.save({
                                        phone,
                                        state: { name: 'main_menu', cpf, email, ligacaoId: lig.id, menuAudioPlayed: true },
                                        updatedAt: now
                                    });
                                }
                                else {
                                    replies.push({
                                        type: 'list',
                                        text: 'Selecione a ligação desejada:',
                                        buttonText: 'Minhas ligações',
                                        sections: [
                                            {
                                                title: 'Ligações vinculadas ao CPF',
                                                rows: ligacoes.map(l => ({ id: l.id, title: l.label, description: l.description }))
                                            }
                                        ]
                                    });
                                    await sessionStore.save({
                                        phone,
                                        state: { name: 'select_ligacao', cpf, email },
                                        updatedAt: now
                                    });
                                }
                            }
                            else {
                                replies.push('Não encontramos nenhuma ligação vinculada a este CPF.');
                                await sessionStore.save({
                                    phone,
                                    state: { name: 'main_menu', cpf, email },
                                    updatedAt: now
                                });
                            }
                        }
                        catch (err) {
                            // Se der erro ao buscar ligações, cai para o menu padrão
                            replies.push(menuInteractive(messages.otpAccepted));
                            try {
                                await sessionStore.save({
                                    phone,
                                    state: { name: 'main_menu', cpf, email },
                                    updatedAt: now
                                });
                            }
                            catch { }
                        }
                    }
                    catch (err) {
                        replies.push('Erro ao verificar código. Por favor, tente novamente ou digite "menu" para recomeçar.');
                    }
                }
                catch (err) {
                    replies.push('Erro ao processar código de verificação. Por favor, tente novamente.');
                }
                break;
            }
            case 'select_ligacao': {
                try {
                    const cpf = state?.cpf;
                    const idEletronico = state?.idEletronico;
                    if (!cpf && !idEletronico) {
                        replies.push(messages.requireLogin);
                        try {
                            if (isLinkApiConfigured(config)) {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                            }
                            else {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                            }
                        }
                        catch {
                        }
                        break;
                    }
                    const selectedId = typeof text === 'string' ? text.trim() : '';
                    if (!selectedId) {
                        replies.push('Não entendi qual imóvel você selecionou. Por favor, escolha uma opção da lista novamente.');
                        // Refaz a listagem
                        try {
                            let ligacoes = [];
                            if (idEletronico) {
                                const loginResult = await loginByIdEletronico(config, idEletronico);
                                ligacoes = imoveisToLigacoes(loginResult.imoveis);
                            }
                            else if (cpf) {
                                ligacoes = await fetchLigacoesByCpf(config, cpf);
                            }
                            if (ligacoes && ligacoes.length > 0) {
                                replies.push({
                                    type: 'list',
                                    text: messages.selecioneImovel,
                                    buttonText: 'Meus imóveis',
                                    sections: [
                                        {
                                            title: 'Imóveis vinculados',
                                            rows: ligacoes.map(l => ({ id: l.id, title: l.label, description: l.description }))
                                        }
                                    ]
                                });
                            }
                        }
                        catch {
                        }
                        break;
                    }
                    let ligacoes = [];
                    try {
                        if (idEletronico) {
                            const loginResult = await loginByIdEletronico(config, idEletronico);
                            ligacoes = imoveisToLigacoes(loginResult.imoveis);
                        }
                        else if (cpf) {
                            ligacoes = await fetchLigacoesByCpf(config, cpf);
                        }
                    }
                    catch {
                    }
                    let lig = ligacoes.find(l => String(l.id) === selectedId) ?? ligacoes.find(l => String(l.id) === String(Number(selectedId)));
                    // Se não encontrou por id, interpreta selectedId como índice da lista retornado pela Z-API (selectedRowId)
                    if (!lig && ligacoes && ligacoes.length > 0) {
                        const idx = Number(selectedId);
                        if (Number.isInteger(idx)) {
                            // Tenta 1-based (1 = primeiro item)
                            if (!lig && idx >= 1 && idx <= ligacoes.length) {
                                lig = ligacoes[idx - 1];
                            }
                            // Tenta 0-based (0 = primeiro item), caso a API use esse padrão
                            if (!lig && idx >= 0 && idx < ligacoes.length) {
                                lig = ligacoes[idx];
                            }
                        }
                    }
                    if (!lig) {
                        replies.push('Imóvel não encontrado para a opção informada. Por favor, selecione novamente.');
                        if (ligacoes && ligacoes.length > 0) {
                            replies.push({
                                type: 'list',
                                text: messages.selecioneImovel,
                                buttonText: 'Meus imóveis',
                                sections: [
                                    {
                                        title: 'Imóveis vinculados',
                                        rows: ligacoes.map(l => ({ id: l.id, title: l.label, description: l.description }))
                                    }
                                ]
                            });
                        }
                        break;
                    }
                    let dados = null;
                    try {
                        dados = await fetchDadosCadastraisByLigacao(config, {
                            cpf,
                            ligacaoId: lig.id,
                            imovelId: lig.imovelId
                        });
                    }
                    catch {
                    }
                    replies.push(buildDadosCadastraisMessage(lig, dados));
                    if (config.menuAudioUrl) {
                        replies.push({
                            type: 'audio',
                            audioUrl: config.menuAudioUrl,
                            waveform: true
                        });
                    }
                    replies.push(menuInteractive('Agora escolha uma opção do menu para esse imóvel.'));
                    try {
                        await sessionStore.save({
                            phone,
                            state: {
                                name: 'main_menu',
                                cpf,
                                idEletronico,
                                nomeCliente: state?.nomeCliente,
                                email: state?.email,
                                imovelId: lig.imovelId,
                                ligacaoId: lig.id,
                                menuAudioPlayed: true
                            },
                            updatedAt: now
                        });
                    }
                    catch {
                    }
                }
                catch (err) {
                    replies.push(menuFallbackText());
                }
                break;
            }
            case 'send_fatura': {
                try {
                    const cpf = state?.cpf;
                    const idEletronico = state?.idEletronico;
                    const ligacaoId = state?.ligacaoId;
                    const imovelId = state?.imovelId;
                    if (!cpf && !idEletronico) {
                        replies.push(messages.requireLogin);
                        try {
                            if (isLinkApiConfigured(config)) {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_id' }, updatedAt: now });
                            }
                            else {
                                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                            }
                        }
                        catch {
                        }
                        break;
                    }
                    if (!ligacaoId || typeof ligacaoId !== 'string') {
                        await sendLigacoesSelection(config, sessionStore, phone, replies, now, cpf || '', state, 'Primeiro selecione a ligação que você deseja utilizar.');
                        break;
                    }
                    const selectedId = typeof text === 'string' ? text.trim() : '';
                    if (!selectedId) {
                        replies.push('Não entendi qual fatura você selecionou. Por favor, escolha uma opção da lista novamente.');
                        try {
                            const debitos = await fetchDebitosByLigacao(config, { cpf, ligacaoId, imovelId });
                            if (debitos && debitos.length > 0) {
                                replies.push({
                                    type: 'list',
                                    text: 'Selecione a fatura que deseja receber para pagamento:',
                                    buttonText: 'Escolher fatura',
                                    sections: [
                                        {
                                            title: 'Faturas disponíveis',
                                            rows: debitos.map(d => {
                                                const valorFormatado = `R$ ${d.valor.toFixed(2).replace('.', ',')}`;
                                                const title = `Ref. ${d.mesAnoReferencia} - ${valorFormatado}`;
                                                const description = d.dataVencimento
                                                    ? `Vencimento: ${d.dataVencimento}`
                                                    : undefined;
                                                return { id: d.idFatura, title, description };
                                            })
                                        }
                                    ]
                                });
                            }
                        }
                        catch {
                        }
                        break;
                    }
                    let debitos = [];
                    try {
                        debitos = await fetchDebitosByLigacao(config, { cpf, ligacaoId, imovelId });
                    }
                    catch {
                    }
                    const d = debitos.find(x => String(x.idFatura) === selectedId) ??
                        debitos.find(x => String(x.idFatura) === String(Number(selectedId)));
                    if (!d) {
                        replies.push('Fatura não encontrada para a opção informada. Por favor, selecione novamente.');
                        if (debitos && debitos.length > 0) {
                            replies.push({
                                type: 'list',
                                text: 'Selecione a fatura que deseja receber para pagamento:',
                                buttonText: 'Escolher fatura',
                                sections: [
                                    {
                                        title: 'Faturas disponíveis',
                                        rows: debitos.map(d2 => {
                                            const valorFormatado = `R$ ${d2.valor.toFixed(2).replace('.', ',')}`;
                                            const title = `Ref. ${d2.mesAnoReferencia} - ${valorFormatado}`;
                                            const description = d2.dataVencimento
                                                ? `Vencimento: ${d2.dataVencimento}`
                                                : undefined;
                                            return { id: d2.idFatura, title, description };
                                        })
                                    }
                                ]
                            });
                        }
                        break;
                    }
                    const valorFormatado = `R$ ${d.valor.toFixed(2).replace('.', ',')}`;
                    const resumo = `Fatura Ref. ${d.mesAnoReferencia} - Venc. ${d.dataVencimento} - ${valorFormatado}`;
                    // Tenta gerar o PDF via API Impressao-Conta se temos imovelId
                    let pdfBase64 = null;
                    if (imovelId && isLinkApiConfigured(config)) {
                        try {
                            console.log('[send_fatura] Gerando PDF via Impressao-Conta para ImovelID:', imovelId, 'BoletoID:', d.idFatura);
                            pdfBase64 = await linkImpressaoConta(config, Number(imovelId), [d.idFatura]);
                            console.log('[send_fatura] Resultado Impressao-Conta:', pdfBase64 ? `base64 com ${pdfBase64.length} chars` : 'null');
                        }
                        catch (err) {
                            console.error('[send_fatura] Erro ao gerar PDF:', err);
                        }
                    }
                    // Envia resumo da fatura
                    const linhas = [];
                    linhas.push('*Fatura selecionada para pagamento:*');
                    linhas.push('');
                    linhas.push(resumo);
                    replies.push(linhas.join('\n'));
                    // Envia o PDF se disponível
                    if (pdfBase64) {
                        // Envia como documento PDF
                        replies.push({
                            type: 'document',
                            document: pdfBase64.startsWith('data:') ? pdfBase64 : `data:application/pdf;base64,${pdfBase64}`,
                            fileName: `fatura_${d.mesAnoReferencia.replace('/', '_')}.pdf`
                        });
                    }
                    else if (d.urlFatura) {
                        // Fallback para URL se disponível
                        replies.push({
                            type: 'link',
                            message: 'Clique para baixar sua fatura em PDF:',
                            linkUrl: d.urlFatura,
                            title: 'Fatura PDF',
                            linkDescription: resumo
                        });
                    }
                    // SEMPRE envia linha digitável se disponível
                    if (d.linhaDigitavel) {
                        replies.push({
                            type: 'copyCode',
                            message: 'Linha digitável desta fatura:',
                            code: d.linhaDigitavel,
                            buttonText: 'Copiar linha digitável'
                        });
                    }
                    // SEMPRE envia código PIX se disponível
                    if (d.payloadPix) {
                        replies.push({
                            type: 'copyCode',
                            message: 'Código PIX para pagamento:',
                            code: d.payloadPix,
                            buttonText: 'Copiar código PIX'
                        });
                    }
                    replies.push(menuInteractive('Toque na opção desejada para voltar ao menu inicial.'));
                    try {
                        await sessionStore.save({
                            phone,
                            state: { name: 'main_menu', cpf, idEletronico, email: state?.email, ligacaoId, imovelId },
                            updatedAt: now
                        });
                    }
                    catch {
                    }
                }
                catch {
                    replies.push('Não foi possível processar a seleção da fatura.');
                    replies.push(menuInteractive());
                }
                break;
            }
            case 'request_servico': {
                // API de serviços ainda não implementada
                replies.push('�️ *Solicitar Serviços*\n\nEsta opção estará disponível em breve!');
                replies.push(menuInteractive('Posso ajudar em mais alguma coisa?'));
                try {
                    await sessionStore.save({
                        phone,
                        state: { name: 'main_menu', cpf: state?.cpf, email: state?.email, ligacaoId: state?.ligacaoId },
                        updatedAt: now
                    });
                }
                catch { }
                break;
            }
            case 'acompanhar_servico': {
                // API de serviços ainda não implementada
                replies.push('� *Acompanhar Solicitações*\n\nEsta opção estará disponível em breve!');
                replies.push(menuInteractive('Posso ajudar em mais alguma coisa?'));
                try {
                    await sessionStore.save({
                        phone,
                        state: { name: 'main_menu', cpf: state?.cpf, email: state?.email, ligacaoId: state?.ligacaoId },
                        updatedAt: now
                    });
                }
                catch { }
                break;
            }
            default: {
                try {
                    replies.push(menuInteractive());
                    // Atualiza estado apenas se já houver CPF; caso contrário, retorna ao fluxo de login
                    const cpf = state?.cpf;
                    const email = state?.email;
                    const hasCpf = typeof cpf === 'string' && cpf.length === 11;
                    try {
                        if (hasCpf) {
                            await sessionStore.save({
                                phone,
                                state: { name: 'main_menu', cpf, email, ligacaoId: state?.ligacaoId },
                                updatedAt: now
                            });
                        }
                        else {
                            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                        }
                    }
                    catch (err) {
                        // Mesmo se falhar ao salvar, retorna a resposta
                    }
                }
                catch (err) {
                    // Fallback absoluto - sempre retorna uma resposta
                    replies.push(messages.welcome);
                    replies.push(messages.askIdEletronico);
                }
            }
        }
    }
    catch (err) {
        // Tratamento de erro global - sempre retorna uma resposta
        replies.push('Desculpe, ocorreu um erro. Por favor, tente novamente.');
        replies.push(messages.askIdEletronico);
    }
    // Garante que sempre retorna pelo menos uma resposta
    if (replies.length === 0) {
        replies.push('Por favor, informe seu CPF para continuar.');
        replies.push(messages.askIdEletronico);
    }
    return replies;
}
