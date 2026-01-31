export class InMemorySessionStore {
    sessions = new Map();
    async getByPhone(phone) {
        return this.sessions.get(phone) ?? null;
    }
    async save(session) {
        this.sessions.set(session.phone, { ...session, updatedAt: new Date().toISOString() });
    }
}
