export type ConversationState =
  | { name: 'idle' }
  | { name: 'awaiting_login_cpf' }
  | { name: 'awaiting_confirm_cpf' ; cpf: string }
  | { name: 'awaiting_login_email' ; cpf: string }
  | { name: 'awaiting_confirm_email' ; cpf: string ; email: string }
  | { name: 'awaiting_login_otp' ; cpf: string ; email: string }
  | { name: 'main_menu' ; cpf: string ; email?: string ; ligacaoId?: string }
  | { name: 'select_ligacao' ; cpf: string }
  | { name: 'view_debitos' ; cpf: string ; ligacaoId: string }
  | { name: 'request_servico' ; cpf: string ; ligacaoId: string ; servico: string }
  | { name: 'acompanhar_servico' ; cpf: string ; protocolo: string };

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


