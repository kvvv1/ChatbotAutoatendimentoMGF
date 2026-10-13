import { reopenFinalizedHumanTicket } from '../supabase/humanTickets.js';
import { hasActiveHumanTicket } from '../supabase/messages.js';
import { logAudit } from '../supabase/audit.js';
import { publishHumanEvent } from './events.js';
/** Decide se a mensagem deve permanecer no atendimento humano, antes de acionar o bot. */
export async function routeIncomingHumanMessage(config, phone) {
    const reopened = await reopenFinalizedHumanTicket(config, phone);
    if (reopened) {
        publishHumanEvent({ type: 'ticket_update', phone, at: new Date().toISOString() });
        await logAudit(config, {
            whatsappPhone: phone,
            action: 'human_ticket_reopened',
            payload: { ticketId: reopened.id, previousStatus: 'finalizado', status: 'pendente' }
        });
        return true;
    }
    return hasActiveHumanTicket(config, phone);
}
