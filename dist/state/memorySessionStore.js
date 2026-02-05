/**
 * SessionStore em memória - usado quando Supabase não está disponível
 */
export class MemorySessionStore {
    sessions = new Map();
    async getByPhone(phone) {
        return this.sessions.get(phone) || null;
    }
    async save(session) {
        this.sessions.set(session.phone, {
            ...session,
            updatedAt: session.updatedAt || new Date().toISOString()
        });
    }
    async delete(phone) {
        this.sessions.delete(phone);
    }
    async deleteAll() {
        this.sessions.clear();
    }
}
