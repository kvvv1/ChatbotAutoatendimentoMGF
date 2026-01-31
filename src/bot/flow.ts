import type { AppConfig } from '../config.js';
import type { SessionStore, Session } from '../state/session.js';
import { messages, mainMenu } from './menus.js';
import { createAndSendOtp, verifyOtp } from '../otp/service.js';

function onlyDigits(value: string): string {
  try {
    if (typeof value !== 'string') return '';
    return value.replace(/\D/g, '');
  } catch {
    return '';
  }
}

function isValidCpf(cpf: string): boolean {
  try {
    if (!cpf || typeof cpf !== 'string') return false;
    const v = onlyDigits(cpf);
    return v.length === 11;
  } catch {
    return false;
  }
}

function isValidEmail(email: string): boolean {
  try {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  } catch {
    return false;
  }
}

export type BotReply =
  | string
  | { type: 'buttons'; text: string; buttons: { id: string; text: string }[]; footer?: string }
  | { type: 'list'; text: string; buttonText?: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] };

function minutesDiff(a: Date, b: Date): number {
  try {
    if (!(a instanceof Date) || !(b instanceof Date)) return 0;
    return Math.abs((a.getTime() - b.getTime()) / 60000);
  } catch {
    return 0;
  }
}
function hoursDiff(a: Date, b: Date): number {
  try {
    if (!(a instanceof Date) || !(b instanceof Date)) return 0;
    return Math.abs((a.getTime() - b.getTime()) / 3600000);
  } catch {
    return 0;
  }
}
function isAuthenticated(state: Session['state']): boolean {
  try {
    if (!state || typeof state !== 'object') return false;
    return state.name === 'main_menu' && typeof (state as any).cpf === 'string' && (state as any).cpf.length === 11;
  } catch {
    return false;
  }
}

const MENU_PROMPT = 'Toque na opção desejada ou digite o número correspondente:';
const MENU_ITEMS: { id: string; title: string; description?: string }[] = [
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

function menuSections(): { title: string; rows: { id: string; title: string; description?: string }[] }[] {
  return [
    { title: 'Autoatendimento', rows: MENU_ITEMS.slice(0, 7) },
    { title: 'Outros serviços', rows: MENU_ITEMS.slice(7) }
  ];
}

function menuInteractive(prefix?: string): BotReply {
  return {
    type: 'list',
    text: prefix ? `${prefix}\n\n${MENU_PROMPT}` : MENU_PROMPT,
    buttonText: 'Abrir menu',
    sections: menuSections()
  };
}

function menuFallbackText(prefix?: string): string {
  return prefix ? `${prefix}\n\n${mainMenu()}` : mainMenu();
}

export async function processMessage(
  config: AppConfig,
  phone: string,
  text: string,
  sessionStore: SessionStore
): Promise<BotReply[]> {
  const replies: BotReply[] = [];
  
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
    
    const now = new Date().toISOString();
    let session;
    try {
      session = await sessionStore.getByPhone(phone);
    } catch (err) {
      // Se falhar ao buscar sessão, cria nova
      session = null;
    }
    
    if (!session || !session.state) {
      session = {
        phone,
        state: { name: 'idle' as const },
        updatedAt: now
      };
    }
    
    const state = session.state || { name: 'idle' as const };
    
    // Comandos globais (processados antes da verificação de estado)
    if (text === '0') {
      try {
        replies.push(messages.humanContact);
        await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
      } catch (err) {
        // Mesmo se falhar ao salvar, retorna a resposta
      }
      return replies;
    }
    
    if (/^\s*menu\s*$/i.test(text)) {
      try {
        const authed = isAuthenticated(state);
        if (!authed) {
          replies.push(messages.askCpf);
          await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
        } else {
          replies.push(menuInteractive());
          replies.push(menuFallbackText());
          await sessionStore.save({ 
            phone, 
            state: { 
              name: 'main_menu', 
              cpf: (state as any)?.cpf || '', 
              email: (state as any)?.email, 
              ligacaoId: (state as any)?.ligacaoId 
            }, 
            updatedAt: now 
          });
        }
      } catch (err) {
        // Fallback em caso de erro
        replies.push(messages.askCpf);
      }
      return replies;
    }

    // Se está no estado inicial (idle), qualquer mensagem dispara saudação
    if (state.name === 'idle') {
      try {
        replies.push(messages.welcome);
        replies.push(messages.askCpf);
        await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
      } catch (err) {
        // Mesmo se falhar ao salvar, retorna a resposta
      }
      return replies;
    }

    // Enforce login obrigatório e expiração por inatividade
    try {
      const last = session.updatedAt ? new Date(session.updatedAt) : new Date();
      const nowD = new Date();
      const inactiveMinutes = minutesDiff(nowD, last);
      const ageHours = hoursDiff(nowD, last);
      const authed = isAuthenticated(state);
      const maxInactivity = config?.sessionMaxInactivityMinutes || 30;
      const maxAge = config?.sessionMaxAgeHours || 24;

      // Verifica se sessão expirou por inatividade ou idade
      const expiredByInactivity = inactiveMinutes > maxInactivity;
      const expiredByAge = ageHours > maxAge;
      const isExpired = expiredByInactivity || expiredByAge;

      if (isExpired) {
        try {
          replies.push(messages.sessionExpired);
          await sessionStore.save({ phone, state: { name: 'idle' }, updatedAt: now });
        } catch (err) {
          // Mesmo se falhar ao salvar, retorna a resposta
        }
        return replies;
      }

      if (!authed && !isExpired) {
        // Se não está autenticado e não expirou, requisita CPF (exceto se já está em fluxo de login)
        const loginStates = ['awaiting_login_cpf', 'awaiting_login_email', 'awaiting_login_otp', 'awaiting_confirm_cpf', 'awaiting_confirm_email'];
        if (state.name && !loginStates.includes(state.name)) {
          try {
            replies.push(messages.askCpf);
            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
          } catch (err) {
            // Mesmo se falhar ao salvar, retorna a resposta
          }
          return replies;
        }
      }
    } catch (err) {
      // Se falhar na verificação de expiração, continua o fluxo normalmente
    }

    const stateName = state?.name || 'idle';

    switch (stateName) {
      case 'main_menu': {
        try {
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
              try {
                if (!config?.videoTutorialUrl) {
                  replies.push(messages.videoUnavailable);
                } else {
                  const intro = config.videoTutorialIntro?.trim() || messages.videoIntro;
                  replies.push(intro);
                  const caption = config.videoTutorialCaption?.trim();
                  if (caption) {
                    replies.push(caption);
                  }
                  replies.push(`Acesse o vídeo: ${config.videoTutorialUrl}`);
                }
              } catch (err) {
                replies.push(messages.videoUnavailable);
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
        } catch (err) {
          // Fallback em caso de erro
          replies.push(menuInteractive());
          replies.push(menuFallbackText());
        }
        break;
      }
      case 'awaiting_login_cpf': {
        try {
          if (!isValidCpf(text)) {
            replies.push(messages.invalidCpf);
            replies.push(messages.askCpf);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            } catch (err) {
              // Mesmo se falhar ao salvar, retorna a resposta
            }
            break;
          }
          
          const cpfDigits = onlyDigits(text);
          if (!cpfDigits || cpfDigits.length !== 11) {
            replies.push(messages.invalidCpf);
            replies.push(messages.askCpf);
            break;
          }
          
          // Formata CPF para exibição: XXX.XXX.XXX-XX
          let cpfFormatted = '';
          try {
            cpfFormatted = cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
          } catch (err) {
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
          } catch (err) {
            // Mesmo se falhar ao salvar, retorna a resposta
          }
        } catch (err) {
          replies.push('Erro ao processar CPF. Por favor, tente novamente.');
          replies.push(messages.askCpf);
        }
        break;
      }
      case 'awaiting_confirm_cpf': {
        try {
          const cpf = (state as any)?.cpf;
          const normalizedText = typeof text === 'string' ? text.toLowerCase().trim() : '';
          
          // Verifica confirmação positiva
          if (text === 'confirm_cpf_yes' || normalizedText === 'sim' || normalizedText === 's' || normalizedText === '1') {
            if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
              replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
              replies.push(messages.askCpf);
              try {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
              } catch (err) {
                // Mesmo se falhar ao salvar, retorna a resposta
              }
            } else {
              replies.push(messages.askEmail);
              try {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
              } catch (err) {
                // Mesmo se falhar ao salvar, retorna a resposta
              }
            }
          } 
          // Verifica confirmação negativa
          else if (text === 'confirm_cpf_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'n' || normalizedText === '2') {
            replies.push(messages.askCpf);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            } catch (err) {
              // Mesmo se falhar ao salvar, retorna a resposta
            }
          } 
          // Resposta não reconhecida - reenvia os botões com instrução clara
          else {
            let cpfFormatted = '';
            if (cpf && typeof cpf === 'string' && cpf.length === 11) {
              try {
                cpfFormatted = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
              } catch (err) {
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
        } catch (err) {
          replies.push('Erro ao processar confirmação. Por favor, informe seu CPF novamente.');
          replies.push(messages.askCpf);
          try {
            await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
          } catch {
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
          
          const cpf = (state as any)?.cpf;
          if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
            replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
            replies.push(messages.askCpf);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            } catch (err) {
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
          } catch (err) {
            // Mesmo se falhar ao salvar, retorna a resposta
          }
        } catch (err) {
          replies.push('Erro ao processar e-mail. Por favor, tente novamente.');
          replies.push(messages.askEmail);
        }
        break;
      }
      case 'awaiting_confirm_email': {
        try {
          const normalizedText = typeof text === 'string' ? text.toLowerCase().trim() : '';
          const cpf = (state as any)?.cpf;
          const email = (state as any)?.email;
          
          if (text === 'confirm_email_yes' || normalizedText === 'sim' || normalizedText === 's' || normalizedText === '1') {
            // Valida dados antes de enviar OTP
            if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
              replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
              replies.push(messages.askCpf);
              try {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
              } catch (err) {
                // Mesmo se falhar ao salvar, retorna a resposta
              }
              break;
            }
            
            if (!email || typeof email !== 'string' || !isValidEmail(email)) {
              replies.push('Erro: E-mail inválido. Por favor, informe seu e-mail novamente.');
              replies.push(messages.askEmail);
              try {
                await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
              } catch (err) {
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
              } catch (err) {
                // Mesmo se falhar ao salvar, retorna a resposta
              }
            } catch (err) {
              replies.push('Erro ao enviar código de verificação. Por favor, tente novamente.');
              replies.push(messages.askEmail);
            }
          } else if (text === 'confirm_email_no' || normalizedText === 'não' || normalizedText === 'nao' || normalizedText === 'n' || normalizedText === '2') {
            replies.push(messages.askEmail);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
            } catch (err) {
              // Mesmo se falhar ao salvar, retorna a resposta
            }
          } else {
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
        } catch (err) {
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
          
          const cpf = (state as any)?.cpf;
          const email = (state as any)?.email;
          
          if (!cpf || typeof cpf !== 'string' || cpf.length !== 11) {
            replies.push('Erro: CPF não encontrado. Por favor, informe seu CPF novamente.');
            replies.push(messages.askCpf);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            } catch (err) {
              // Mesmo se falhar ao salvar, retorna a resposta
            }
            break;
          }
          
          if (!email || typeof email !== 'string' || !isValidEmail(email)) {
            replies.push('Erro: E-mail não encontrado. Por favor, informe seu e-mail novamente.');
            replies.push(messages.askEmail);
            try {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_email', cpf }, updatedAt: now });
            } catch (err) {
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
            
            replies.push(menuInteractive(messages.otpAccepted));
            replies.push(menuFallbackText(messages.otpAccepted));
            try {
              await sessionStore.save({
                phone,
                state: { name: 'main_menu', cpf, email },
                updatedAt: now
              });
            } catch (err) {
              // Mesmo se falhar ao salvar, retorna a resposta
            }
          } catch (err) {
            replies.push('Erro ao verificar código. Por favor, tente novamente ou digite "menu" para recomeçar.');
          }
        } catch (err) {
          replies.push('Erro ao processar código de verificação. Por favor, tente novamente.');
        }
        break;
      }
      case 'select_ligacao': {
        try {
          replies.push('Seleção de ligação ainda não está disponível. Em breve.');
          replies.push(menuInteractive());
          replies.push(menuFallbackText());
          const cpf = (state as any)?.cpf;
          try {
            await sessionStore.save({
              phone,
              state: { name: 'main_menu', cpf: cpf || '' },
              updatedAt: now
            });
          } catch (err) {
            // Mesmo se falhar ao salvar, retorna a resposta
          }
        } catch (err) {
          replies.push(menuInteractive());
          replies.push(menuFallbackText());
        }
        break;
      }
      default: {
        try {
          replies.push(menuInteractive());
          replies.push(menuFallbackText());
          // Atualiza estado apenas se já houver CPF; caso contrário, retorna ao fluxo de login
          const cpf = (state as any)?.cpf;
          const email = (state as any)?.email;
          const hasCpf = typeof cpf === 'string' && cpf.length === 11;
          
          try {
            if (hasCpf) {
              await sessionStore.save({ 
                phone, 
                state: { name: 'main_menu', cpf, email }, 
                updatedAt: now 
              });
            } else {
              await sessionStore.save({ phone, state: { name: 'awaiting_login_cpf' }, updatedAt: now });
            }
          } catch (err) {
            // Mesmo se falhar ao salvar, retorna a resposta
          }
        } catch (err) {
          // Fallback absoluto - sempre retorna uma resposta
          replies.push(messages.welcome);
          replies.push(messages.askCpf);
        }
      }
    }
  } catch (err) {
    // Tratamento de erro global - sempre retorna uma resposta
    replies.push('Desculpe, ocorreu um erro. Por favor, tente novamente.');
    replies.push(messages.askCpf);
  }

  // Garante que sempre retorna pelo menos uma resposta
  if (replies.length === 0) {
    replies.push('Por favor, informe seu CPF para continuar.');
    replies.push(messages.askCpf);
  }

  return replies;
}


