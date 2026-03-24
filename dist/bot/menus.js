export function mainMenu() {
    const lines = [];
    lines.push('Toque na opção desejada:');
    lines.push('1️⃣ Vídeo orientativo');
    lines.push('2️⃣ Minhas ligações');
    lines.push('3️⃣ Histórico de consumo e leituras');
    lines.push('4️⃣ Emissão de 2ª via');
    lines.push('5️⃣ Localização para atendimento presencial');
    lines.push('0️⃣ Falar com atendente');
    return lines.join('\n');
}
export const messages = {
    welcome: 'Olá!  Sou o autoatendimento da Cosama. Para iniciar seu atendimento, vamos validar suas informações.',
    askIdEletronico: 'Informe seu *ID Eletrônico* (encontrado na sua conta de água).',
    // askCpf: 'Informe seu CPF (apenas números).', // COMENTADO: Não é mais usado, login é por ID Eletrônico
    invalidIdEletronico: 'ID Eletrônico inválido ou não encontrado. Verifique e tente novamente.',
    // invalidCpf: 'CPF inválido. Tente novamente (somente números, 11 dígitos).', // COMENTADO
    askEmail: 'Informe seu e-mail cadastrado.',
    invalidEmail: 'E-mail inválido. Tente novamente.',
    otpSent: 'Um código de verificação foi enviado ao seu e-mail. Digite o código (6 dígitos).',
    otpAccepted: 'Verificação concluída com sucesso ✅',
    requireLogin: 'Você precisa estar logado para acessar esta opção.',
    requireLigacao: 'Selecione uma ligação primeiro.',
    videoIntro: '🎬 *Vídeo de teste*\n\nO vídeo orientativo oficial está em produção. Enquanto isso, segue um vídeo demonstrativo:',
    videoUnavailable: 'O vídeo orientativo está indisponível no momento. Tente novamente mais tarde.',
    humanContact: 'Encaminhando para atendimento humano. Em breve um atendente entrará em contato.',
    sessionExpired: '⏱️ Sua sessão foi finalizada por inatividade. Para continuar, envie uma nova mensagem.',
    clienteEncontrado: (nome) => `Olá, *${nome}*! 👋`,
    selecioneImovel: 'Selecione o imóvel desejado:',
    idEletronicoInserido: (id) => `ID Eletrônico inserido: *${id}*`
};
