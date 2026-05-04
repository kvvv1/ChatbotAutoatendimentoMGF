/**
 * Geração adaptativa de desafios de verificação de identidade.
 *
 * O usuário SEMPRE seleciona uma opção via botão — nunca digita nada.
 *
 * Prioridade dos campos:
 *  1. CPF (4 últimos dígitos)       — todo brasileiro conhece seu CPF
 *  2. Celular / Telefone (4 últimos) — pessoa conhece seu número
 *  3. E-mail                         — exibido mascarado (abc***@gmail.com)
 *  4. Bairro do endereço             — pessoa sabe onde mora
 *  5. Nome do titular                — pessoa reconhece o próprio nome
 *  null → sem dados suficientes, pula verificação
 */

import type { LinkDadosCadastrais } from '../company/linkApi.js';
import type { IdentityChallengeState, ChallengeOption } from '../state/session.js';

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Embaralha aleatoriamente — ordem diferente a cada sessão */
function shuffle<T>(arr: T[]): T[] {
  const items = [...arr];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Trunca para o limite de 20 chars dos botões do WhatsApp */
function trunc(s: string, max = 20): string {
  return s.length <= max ? s : s.substring(0, max - 1) + '…';
}

function capitalize(s: string): string {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/** Gera 2 números de 4 dígitos aleatórios e diferentes do correto */
function digitDecoys(correct: string): [string, string] {
  const candidates: string[] = [];
  let attempts = 0;
  while (candidates.length < 2 && attempts < 100) {
    attempts++;
    const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (c !== correct && !candidates.includes(c)) candidates.push(c);
  }
  return [candidates[0] ?? '0000', candidates[1] ?? '1111'];
}

/** Extrai bairro de "LOGRADOURO, N - BAIRRO - CIDADE/UF" */
function extractBairro(endereco: string): string | null {
  const parts = endereco.split(' - ');
  if (parts.length >= 2) {
    const bairro = parts[parts.length - 2].trim();
    if (bairro && !bairro.includes('/') && bairro.length > 1) return bairro;
  }
  return null;
}

// Decoys de bairros para cidades de médio porte
const BAIRROS_DECOY = [
  'CENTRO', 'INDUSTRIAL', 'JARDIM ALVORADA', 'SAO LUIS', 'NOVA ESPERANCA',
  'BOA VISTA', 'SANTA RITA', 'VILA NOVA', 'PROGRESSO', 'SANTA HELENA',
  'ROSARIO', 'JARDIM BRASIL', 'VILA OPERARIA', 'SAO SEBASTIAO',
  'MONTE CASTELO', 'SAO JOSE', 'BELA VISTA', 'JARDIM DAS FLORES',
];

// Decoys de primeiro nome para o campo Nome
const NOMES_DECOY = [
  'Carlos', 'Maria', 'João', 'Ana', 'Pedro', 'Luciana', 'Roberto',
  'Fernanda', 'Marcos', 'Patrícia', 'Ricardo', 'Juliana', 'Felipe',
  'Camila', 'Bruno', 'Larissa', 'Eduardo', 'Aline', 'Thiago', 'Mariana',
];

// ─── Builders por campo ──────────────────────────────────────────────────────

function buildCpfChallenge(cpf: string): IdentityChallengeState {
  const last4 = cpf.replace(/\D/g, '').slice(-4);
  const [d1, d2] = digitDecoys(last4);
  const options = shuffle<ChallengeOption>([
    { id: 'ident_correct', text: last4 },
    { id: 'ident_wrong_1', text: d1 },
    { id: 'ident_wrong_2', text: d2 },
  ]);
  return {
    question: 'Selecione os 4 últimos dígitos do seu CPF:',
    options,
    correctId: 'ident_correct',
  };
}

function buildPhoneChallenge(phone: string): IdentityChallengeState {
  const last4 = phone.replace(/\D/g, '').slice(-4);
  const [d1, d2] = digitDecoys(last4);
  const options = shuffle<ChallengeOption>([
    { id: 'ident_correct', text: last4 },
    { id: 'ident_wrong_1', text: d1 },
    { id: 'ident_wrong_2', text: d2 },
  ]);
  return {
    question: 'Selecione os 4 últimos dígitos do seu telefone:',
    options,
    correctId: 'ident_correct',
  };
}

// Prefixos comuns de nomes brasileiros para decoys de e-mail realistas
const PREFIXOS_EMAIL = [
  'car', 'mar', 'ana', 'jua', 'pet', 'rod', 'luc', 'fer', 'fab', 'pat',
  'rob', 'ale', 'gui', 'bru', 'the', 'raf', 'fla', 'cri', 'dan', 'ren',
];

function buildEmailChallenge(email: string): IdentityChallengeState {
  const [local, domain] = email.toLowerCase().split('@');
  const correct = trunc(local.substring(0, 3) + '***@' + domain);

  // Decoys: prefixos de nomes comuns brasileiros, diferente do correto, mesmo domínio
  const decoyPrefixos = shuffle(
    PREFIXOS_EMAIL.filter(p => p !== local.substring(0, 3))
  );
  const d1 = trunc(decoyPrefixos[0] + '***@' + domain);
  const d2 = trunc(decoyPrefixos[1] + '***@' + domain);

  const options = shuffle<ChallengeOption>([
    { id: 'ident_correct', text: correct },
    { id: 'ident_wrong_1', text: d1 },
    { id: 'ident_wrong_2', text: d2 },
  ]);
  return {
    question: 'Selecione o seu e-mail cadastrado:',
    options,
    correctId: 'ident_correct',
  };
}

function buildBairroChallenge(bairro: string): IdentityChallengeState {
  const decoys = shuffle(
    BAIRROS_DECOY.filter(b => b.toUpperCase() !== bairro.toUpperCase())
  );
  const options = shuffle<ChallengeOption>([
    { id: 'ident_correct', text: trunc(capitalize(bairro)) },
    { id: 'ident_wrong_1', text: trunc(capitalize(decoys[0])) },
    { id: 'ident_wrong_2', text: trunc(capitalize(decoys[1])) },
  ]);
  return {
    question: 'Selecione o bairro do seu imóvel:',
    options,
    correctId: 'ident_correct',
  };
}

function buildNomeChallenge(nomeCompleto: string): IdentityChallengeState {
  // Usa apenas o primeiro nome para o botão (mais curto, mais legível)
  const primeiroNome = capitalize(nomeCompleto.trim().split(/\s+/)[0]);
  const decoys = shuffle(
    NOMES_DECOY.filter(n => n.toLowerCase() !== primeiroNome.toLowerCase())
  );
  const options = shuffle<ChallengeOption>([
    { id: 'ident_correct', text: trunc(primeiroNome) },
    { id: 'ident_wrong_1', text: trunc(decoys[0]) },
    { id: 'ident_wrong_2', text: trunc(decoys[1]) },
  ]);
  return {
    question: 'Selecione o primeiro nome do titular do cadastro:',
    options,
    correctId: 'ident_correct',
  };
}

// ─── Ponto de entrada ────────────────────────────────────────────────────────

export type ChallengeSet = {
  primary: IdentityChallengeState;
  secondary?: IdentityChallengeState; // existe quando CPF é o primário e há outro campo disponível
};

/**
 * Gera o melhor desafio primário disponível, sem CPF.
 * Usado como segunda etapa quando CPF já foi o primário.
 */
function buildSecondaryCandidates(dados: LinkDadosCadastrais): IdentityChallengeState | null {
  const tel = dados.Celular ?? dados.Telefone;
  if (tel) {
    const digits = String(tel).replace(/\D/g, '');
    if (digits.length >= 4) return buildPhoneChallenge(digits);
  }
  if (dados.Email && typeof dados.Email === 'string' && dados.Email.includes('@')) {
    const [local] = dados.Email.split('@');
    if (local.length >= 2) return buildEmailChallenge(dados.Email);
  }
  if (dados.Endereco) {
    const bairro = extractBairro(dados.Endereco);
    if (bairro) return buildBairroChallenge(bairro);
  }
  if (dados.Nome && dados.Nome.trim().length >= 2) {
    return buildNomeChallenge(dados.Nome);
  }
  return null;
}

/**
 * Analisa os dados cadastrais e gera o conjunto de desafios de identidade.
 * Retorna null se não houver dados suficientes — fluxo segue sem verificação.
 *
 * Quando CPF está disponível:
 *   - primary  = CPF (4 últimos dígitos)
 *   - secondary = melhor campo disponível (telefone → email → bairro → nome)
 *
 * Quando CPF não está disponível:
 *   - primary  = melhor campo disponível
 *   - secondary = undefined (etapa única)
 */
export function buildChallenges(dados: LinkDadosCadastrais): ChallengeSet | null {
  const hasCpf = dados.CPF && String(dados.CPF).replace(/\D/g, '').length >= 4;

  if (hasCpf) {
    const primary = buildCpfChallenge(String(dados.CPF!).replace(/\D/g, ''));
    const secondary = buildSecondaryCandidates(dados) ?? undefined;
    return { primary, secondary };
  }

  // Sem CPF — etapa única com o melhor campo disponível
  const tel = dados.Celular ?? dados.Telefone;
  if (tel) {
    const digits = String(tel).replace(/\D/g, '');
    if (digits.length >= 4) return { primary: buildPhoneChallenge(digits) };
  }
  if (dados.Email && typeof dados.Email === 'string' && dados.Email.includes('@')) {
    const [local] = dados.Email.split('@');
    if (local.length >= 2) return { primary: buildEmailChallenge(dados.Email) };
  }
  if (dados.Endereco) {
    const bairro = extractBairro(dados.Endereco);
    if (bairro) return { primary: buildBairroChallenge(bairro) };
  }
  if (dados.Nome && dados.Nome.trim().length >= 2) {
    return { primary: buildNomeChallenge(dados.Nome) };
  }
  return null;
}
