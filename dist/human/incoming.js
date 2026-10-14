import { hasActiveHumanTicket } from '../supabase/messages.js';
/** Decide se a mensagem deve permanecer no atendimento humano, antes de acionar o bot. */
export async function routeIncomingHumanMessage(config, phone) {
    // Uma mensagem comum não solicita atendimento humano. Tickets finalizados
    // permanecem finalizados para que o cliente possa continuar no bot.
    return hasActiveHumanTicket(config, phone);
}
