import type { Session, SessionStore } from './session.js';

/**
 * SessionStore em memória - usado quando Supabase não está disponível
 */
export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();

  async getByPhone(phone: string): Promise<Session | null> {
    return this.sessions.get(phone) || null;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.phone, {
      ...session,
      updatedAt: session.updatedAt || new Date().toISOString()
    });
  }

  async delete(phone: string): Promise<void> {
    this.sessions.delete(phone);
  }

  async deleteAll(): Promise<void> {
    this.sessions.clear();
  }
}
