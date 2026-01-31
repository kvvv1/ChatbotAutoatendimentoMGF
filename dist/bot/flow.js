import { messages, mainMenu } from './menus.js';
import { createAndSendOtp, verifyOtp } from '../otp/service.js';
function onlyDigits(value) {
    return value.replace(/\D/g, '');
}
function isValidCpf(cpf) {
    const v = onlyDigits(cpf);
    return v.length === 11;
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function minutesDiff(a, b) {
    return Math.abs((a.getTime() - b.getTime()) / 60000);
}
function hoursDiff(a, b) {
    return Math.abs((a.getTime() - b.getTime()) / 3600000);
}
function isAuthenticated(state) {
    return state.name === 'main_menu' && typeof state.cpf === 'string' && state.cpf.length === 11;
}
const MENU_PROMPT = 'Toque na opção desejada ou digite o número correspondente:';
const MENU_ITEMS = [
    { id: '1', title: 'Minhas ligações' },
    { id: '2', title: 'Débitos e 2ª via' },
    { id: '3', title: 'Enviar fatura' },
    { id: '4', title: 'Solicitar serviços (ex.: religação)' },
    { id: '5', title: 'Acompanhar solicitações' },
    { id: '6', title: 'Histórico de consumo e leituras' },
    { id: '7', title: 'Dados cadastrais da ligação' },
    { id: '8', title: 'Localização para atendimento presencial' },
    { id: '9', title: 'Vídeo orientativo' },
    { id: '10', title: 'Ajuda (IA)' },
    { id: '0', title: 'Falar com atendente' }
];
function menuSections() {
    return [
        { title: 'Autoatendimento', rows: MENU_ITEMS.slice(0, 7) },
        { title: 'Outros serviços', rows: MENU_ITEMS.slice(7) }
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
    const now = new Date().toISOString();
    const session = (await sessionStore.getByPhone(phone)) ?? {
        phone,
        state: { name: 'idle' },
        updatedAt: now
    };
    const state = session.state;
    const replies = [];
    // Comandos globais (processados antes da verificação de estado)
    if (text === '0') {
        // falar com humano
        replies.push(messages.humanContact);
        // TODO: abrir ticket humano no Supabase e silenciar
        await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
        return replies;
    }
    if (/^\s*menu\s*$/i.test(text)) {
        const authed = isAuthenticated(state);
        if (!authed) {
            replies.push(messages.askCpf);
            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            return replies;
        }
        else {
            replies.push(menuInteractive());
            replies.push(menuFallbackText());
            await sessionStore.save({ phone, state: { name: 'main_menu', cpf: state?.cpf, email: state?.email, ligacaoId: state?.ligacaoId }, updatedAt: now });
            return replies;
        }
    }
    // Se está no estado inicial (idle), qualquer mensagem dispara saudação
    if (state.name === 'idle') {
        replies.push(messages.welcome);
        replies.push(messages.askCpf);
        await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
        return replies;
    }
    // Enforce login obrigatório e expiração por inatividade
    try {
        const last = new Date(session.updatedAt);
        const nowD = new Date();
        const inactiveMinutes = minutesDiff(nowD, last);
        const ageHours = hoursDiff(nowD, last);
        const authed = isAuthenticated(state);
        // Verifica se sessão expirou por inatividade ou idade
        const expiredByInactivity = inactiveMinutes > config.sessionMaxInactivityMinutes;
        const expiredByAge = ageHours > config.sessionMaxAgeHours;
        const isExpired = expiredByInactivity || expiredByAge;
        if (isExpired) {
            // Sessão expirada: avisa usuário e reseta para idle
            replies.push(messages.sessionExpired);
            await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
            return replies;
        }
        if (!authed && !isExpired) {
            // Se não está autenticado e não expirou, requisita CPF (exceto se já está em fluxo de login)
            if (state.name !== 'awaiting_login_cpf' && state.name !== 'awaiting_login_email' && state.name !== 'awaiting_login_otp' && state.name !== 'awaiting_confirm_cpf' && state.name !== 'awaiting_confirm_email') {
                replies.push(messages.askCpf);
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                return replies;
            }
        }
    }
    catch { }
    switch (state.name) {
        case 'main_menu': {
            let showMenuAfter = false;
            switch (text) {
                case '1':
                    replies.push('Minhas ligações: em breve.');
                    showMenuAfter = true;
                    break;
                case '2':
                    replies.push('Débitos e 2ª via: em breve.');
                    showMenuAfter = true;
                    break;
                case '3':
                    replies.push('Envio de fatura: em breve.');
                    showMenuAfter = true;
                    break;
                case '4':
                    replies.push('Solicitar serviços (ex.: religação): em breve.');
                    showMenuAfter = true;
                    break;
                case '5':
                    replies.push('Acompanhar solicitações: em breve.');
                    showMenuAfter = true;
                    break;
                case '6':
                    replies.push('Histórico de consumo e leituras: em breve.');
                    showMenuAfter = true;
                    break;
                case '7':
                    replies.push('Dados cadastrais: em breve.');
                    showMenuAfter = true;
                    break;
                case '8':
                    replies.push('Localização para atendimento presencial: em breve.');
                    showMenuAfter = true;
                    break;
                case '9':
                    if (!config.videoTutorialUrl) {
                        replies.push(messages.videoUnavailable);
                    }
                    else {
                        const intro = config.videoTutorialIntro?.trim() || messages.videoIntro;
                        replies.push(intro);
                        const caption = config.videoTutorialCaption?.trim();
                        if (caption) {
                            replies.push(caption);
                        }
                        replies.push(`Acesse o vídeo: ${config.videoTutorialUrl}`);
                    }
                    showMenuAfter = true;
                    break;
                case '10':
                    replies.push('Ajuda com IA: em breve.');
                    showMenuAfter = true;
                    break;
                default:
                    replies.push(menuInteractive());
                    replies.push(menuFallbackText());
            }
            if (showMenuAfter) {
                replies.push(menuInteractive());
                replies.push(menuFallbackText());
            }
            break;
        }
        case 'awaiting_login_cpf': {
            if (!isValidCpf(text)) {
                replies.push(messages.invalidCpf);
                replies.push(messages.askCpf);
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                break;
            }
            const cpfDigits = onlyDigits(text);
            // Formata CPF para exibição: XXX.XXX.XXX-XX
            const cpfFormatted = cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            replies.push({
                type: 'buttons',
                text: `Confirme se o CPF está correto:\n\n${cpfFormatted}`,
                buttons: [
                    { id: 'confirm_cpf_yes', text: '✅ Sim, está correto' },
                    { id: 'confirm_cpf_no', text: '❌ Não, quero corrigir' }
                ],
                footer: 'Toque no botão para confirmar'
            });
            await sessionStore.save({ phone, state: { name: 'awaiting_confirm_cpf', cpf: cpfDigits }, updatedAt: now });
            break;
        }
        case 'awaiting_confirm_cpf': {
            const cpf = state.cpf;
            const normalizedText = typeof text === 'string' ? text.toLowerCase().trim() : '';
            // Verifica confirmação positiva
            if (text === 'confirm_cpf_yes' || normalizedText === 'sim' || normalizedText === 's' || normalizedText === '1') {
                if (!cpf || cpf.length !== 11) {
                    replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
                    replies.push(messages.askCpf);
                    await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
                }
                else {
                    replies.push(messages.askEmail);
                    await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
                }
            }
            // Verifica confirmação negativa
            else if (text === 'confirm_cpf_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'n' || normalizedText === '2') {
                replies.push(messages.askCpf);
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            }
            // Resposta não reconhecida - reenvia os botões
            else {
                const cpfFormatted = cpf && cpf.length === 11 ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '';
                replies.push({
                    type: 'buttons',
                    text: cpfFormatted ? `Confirme se o CPF está correto:\n\n${cpfFormatted}\n\nPor favor, toque em um dos botões abaixo:` : 'Por favor, toque em um dos botões para confirmar:',
                    buttons: [
                        { id: 'confirm_cpf_yes', text: '✅ Sim, está correto' },
                        { id: 'confirm_cpf_no', text: '❌ Não, quero corrigir' }
                    ],
                    footer: 'Toque no botão para confirmar'
                });
            }
            break;
        }
        case 'awaiting_login_email': {
            if (!isValidEmail(text)) {
                replies.push(messages.invalidEmail);
                break;
            }
            // Mostra confirmação com botões antes de enviar OTP
            replies.push({
                type: 'buttons',
                text: `Confirme se o e-mail está correto:\n\n${text}`,
                buttons: [
                    { id: 'confirm_email_yes', text: '✅ Sim, está correto' },
                    { id: 'confirm_email_no', text: '❌ Não, quero corrigir' }
                ],
                footer: 'Toque no botão para confirmar'
            });
            await sessionStore.save({ phone, state: { name: 'awaiting_confirm_email', cpf: state.cpf, email: text }, updatedAt: now });
            break;
        }
        case 'awaiting_confirm_email': {
            if (text === 'confirm_email_yes' || text === 'sim' || text === 's' || text === '1') {
                // Envia OTP real por e-mail e persiste no Supabase
                const cpf = state.cpf;
                const email = state.email;
                await createAndSendOtp(config, { phone, cpf, email });
                replies.push(messages.otpSent);
                await sessionStore.save({
                    phone,
                    state: { name: 'awaiting_login_otp', cpf, email },
                    updatedAt: now
                });
            }
            else if (text === 'confirm_email_no' || text === 'não' || text === 'nao' || text === 'n' || text === '2') {
                replies.push(messages.askEmail);
                await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf: state.cpf }, updatedAt: now });
            }
            else {
                replies.push({
                    type: 'buttons',
                    text: 'Por favor, toque em um dos botões para confirmar:',
                    buttons: [
                        { id: 'confirm_email_yes', text: '✅ Sim, está correto' },
                        { id: 'confirm_email_no', text: '❌ Não, quero corrigir' }
                    ]
                });
            }
            break;
        }
        case 'awaiting_login_otp': {
            // Validar OTP via Supabase
            if (!/^\d{4,8}$/.test(text)) {
                replies.push('Código inválido. Digite o código de verificação recebido por e-mail.');
                break;
            }
            {
                const cpf = state.cpf;
                const email = state.email;
                const ok = await verifyOtp(config, { cpf, email, code: text });
                if (!ok) {
                    replies.push('Código incorreto ou expirado. Tente novamente ou digite "menu" para recomeçar.');
                    break;
                }
                replies.push(menuInteractive(messages.otpAccepted));
                replies.push(menuFallbackText(messages.otpAccepted));
                await sessionStore.save({
                    phone,
                    state: { name: 'main_menu', cpf, email },
                    updatedAt: now
                });
            }
            break;
        }
        case 'select_ligacao': {
            replies.push('Seleção de ligação ainda não está disponível. Em breve.');
            replies.push(menuInteractive());
            replies.push(menuFallbackText());
            await sessionStore.save({
                phone,
                state: { name: 'main_menu', cpf: state.cpf },
                updatedAt: now
            });
            break;
        }
        default: {
            replies.push(menuInteractive());
            replies.push(menuFallbackText());
            // Atualiza estado apenas se já houver CPF; caso contrário, retorna ao fluxo de login
            const hasCpf = typeof state?.cpf === 'string' && state.cpf.length === 11;
            if (hasCpf) {
                await sessionStore.save({ phone, state: { name: 'main_menu', cpf: state.cpf, email: state.email }, updatedAt: now });
            }
            else {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            }
        }
    }
    return replies;
}
