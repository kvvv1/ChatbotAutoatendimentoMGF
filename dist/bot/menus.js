export function mainMenu() {
    const lines = [];
    lines.push('Toque na opção desejada ou digite o número correspondente:');
    lines.push('1 - Minhas ligações');
    lines.push('2 - Débitos e 2ª via');
    lines.push('3 - Enviar fatura');
    lines.push('4 - Solicitar serviços (ex. religação)');
    lines.push('5 - Acompanhar solicitações');
    lines.push('6 - Histórico de consumo e leituras');
    lines.push('7 - Dados cadastrais da ligação');
    lines.push('8 - Localização para atendimento presencial');
    lines.push('9 - Vídeo orientativo');
    lines.push('10 - Ajuda (IA)');
    lines.push('0 - Falar com atendente');
    return lines.join('\n');
}
export const messages = {
    welcome: 'Olá! 👋 Sou o chatbot de autoatendimento da Gestcom Informática. Para iniciar seu atendimento, vamos validar suas informações.',
    askCpf: 'Informe seu CPF (apenas números).',
    invalidCpf: 'CPF inválido. Tente novamente (somente números, 11 dígitos).',
    askEmail: 'Informe seu e-mail cadastrado.',
    invalidEmail: 'E-mail inválido. Tente novamente.',
    otpSent: 'Um código de verificação foi enviado ao seu e-mail. Digite o código (6 dígitos).',
    otpAccepted: 'Verificação concluída com sucesso ✅',
    requireLogin: 'Você precisa estar logado para acessar esta opção.',
    requireLigacao: 'Selecione uma ligação primeiro.',
    videoIntro: 'Preparamos um vídeo orientativo para apresentar os principais recursos do autoatendimento.',
    videoUnavailable: 'O vídeo orientativo está indisponível no momento. Tente novamente mais tarde.',
    humanContact: 'Encaminhando para atendimento humano. Em breve um atendente entrará em contato.',
    sessionExpired: '⏱️ Sua sessão foi finalizada por inatividade. Para continuar, envie uma nova mensagem.'
};
