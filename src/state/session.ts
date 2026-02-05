export type ConversationState =
  | { name: 'idle' }
  | { name: 'awaiting_login_id' }
  | { name: 'awaiting_confirm_id'; idEletronico: string }
  | { name: 'awaiting_login_cpf' }
  | { name: 'awaiting_confirm_cpf' ; cpf: string }
  | { name: 'awaiting_login_email' ; cpf?: string; idEletronico?: string }
  | { name: 'awaiting_confirm_email' ; cpf?: string; idEletronico?: string; email: string }
  | { name: 'awaiting_login_otp' ; cpf?: string; idEletronico?: string; email: string }
  | { name: 'main_menu' ; cpf?: string; idEletronico?: string; nomeCliente?: string; email?: string ; imovelId?: number; ligacaoId?: string ; menuAudioPlayed?: boolean }
  | { name: 'select_ligacao' ; cpf?: string; idEletronico?: string; nomeCliente?: string; email?: string ; menuAudioPlayed?: boolean }
  | { name: 'view_debitos' ; cpf?: string; idEletronico?: string; imovelId?: number; ligacaoId?: string ; menuAudioPlayed?: boolean }
  | { name: 'send_fatura' ; cpf?: string; idEletronico?: string; imovelId?: number; ligacaoId?: string ; menuAudioPlayed?: boolean }
  | { name: 'request_servico' ; cpf?: string; idEletronico?: string; imovelId?: number; ligacaoId?: string ; servico: string ; menuAudioPlayed?: boolean }
  | {
      name: 'acompanhar_servico';
      cpf?: string;
      idEletronico?: string;
      protocolo: string;
      imovelId?: number;
      ligacaoId?: string;
      email?: string;
      step?: 'waiting_protocolo' | 'after_status';
      menuAudioPlayed?: boolean;
    };

export type Session = {
  phone: string;
  state: ConversationState;
  updatedAt: string;
};

export interface SessionStore {
  getByPhone(phone: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete?(phone: string): Promise<void>;
  deleteAll?(): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  async getByPhone(phone: string): Promise<Session | null> {
    return this.sessions.get(phone) ?? null;
  }
  async save(session: Session): Promise<void> {
    this.sessions.set(session.phone, { ...session, updatedAt: new Date().toISOString() });
  }
}


