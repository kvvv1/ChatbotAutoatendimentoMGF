import type { AppConfig } from '../config.js';

const WEEKDAY_NAMES = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const ISO_WEEKDAY_BY_SHORT_NAME: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7
};

/** Retorna {isoWeekday (1=segunda..7=domingo), minutesSinceMidnight} no horário de Brasília, independente do fuso do servidor */
function nowInBrasilia(date: Date): { isoWeekday: number; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(date);

  const weekdayShort = parts.find(p => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');

  return {
    isoWeekday: ISO_WEEKDAY_BY_SHORT_NAME[weekdayShort] ?? 1,
    minutesSinceMidnight: hour * 60 + minute
  };
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isWithinBusinessHours(config: AppConfig, date: Date = new Date()): boolean {
  const { isoWeekday, minutesSinceMidnight } = nowInBrasilia(date);

  if (isoWeekday < config.businessDayStart || isoWeekday > config.businessDayEnd) return false;

  const start = timeToMinutes(config.businessHoursStart);
  const end = timeToMinutes(config.businessHoursEnd);
  return minutesSinceMidnight >= start && minutesSinceMidnight < end;
}

export function businessHoursMessage(config: AppConfig): string {
  const dayRange = config.businessDayStart === config.businessDayEnd
    ? WEEKDAY_NAMES[config.businessDayStart]
    : `${WEEKDAY_NAMES[config.businessDayStart]} a ${WEEKDAY_NAMES[config.businessDayEnd]}`;

  return `⏰ Nosso atendimento humano funciona de *${dayRange}*, das *${config.businessHoursStart}* às *${config.businessHoursEnd}*.\n\nFora desse horário não conseguimos te transferir para um atendente agora, mas você pode continuar usando as outras opções do menu normalmente.`;
}
