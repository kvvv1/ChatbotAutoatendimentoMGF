import type { AppConfig } from '../config.js';
import { isSeteLagoas } from '../config.js';

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

/** Data atual em Brasília no formato AAAA-MM-DD */
function todayInBrasilia(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function isClosedDay(config: AppConfig, date: Date): boolean {
  if (!config.businessClosedFrom) return false;
  const today = todayInBrasilia(date);
  return today >= config.businessClosedFrom && today <= (config.businessClosedUntil ?? config.businessClosedFrom);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isWithinBusinessHours(config: AppConfig, date: Date = new Date()): boolean {
  if (isClosedDay(config, date)) return false;
  const { isoWeekday, minutesSinceMidnight } = nowInBrasilia(date);

  if (isSeteLagoas(config)) {
    if (isoWeekday === 7) return false;
    if (isoWeekday === 6) {
      if (!config.businessSaturdayEnabled || !config.businessSaturdayStart || !config.businessSaturdayEnd) return false;
      return minutesSinceMidnight >= timeToMinutes(config.businessSaturdayStart)
        && minutesSinceMidnight < timeToMinutes(config.businessSaturdayEnd);
    }
  }

  if (isoWeekday < config.businessDayStart || isoWeekday > config.businessDayEnd) return false;

  const start = timeToMinutes(config.businessHoursStart);
  const end = timeToMinutes(config.businessHoursEnd);
  return minutesSinceMidnight >= start && minutesSinceMidnight < end;
}

function activeNotice(config: AppConfig, date: Date): string | undefined {
  if (!config.businessHoursNotice) return undefined;
  if (config.businessHoursNoticeUntil && todayInBrasilia(date) > config.businessHoursNoticeUntil) return undefined;
  return config.businessHoursNotice;
}

export function businessHoursMessage(config: AppConfig, date: Date = new Date()): string {
  const message = config.businessHoursMessage ?? defaultBusinessHoursMessage(config);
  const notice = activeNotice(config, date);
  return notice ? `${message}\n\n${notice}` : message;
}

/** Texto exibido na saudação — só para quem configurou BUSINESS_HOURS_MESSAGE ou tem aviso ativo */
export function greetingHoursMessage(config: AppConfig, date: Date = new Date()): string | undefined {
  const notice = activeNotice(config, date);
  if (!config.businessHoursMessage && !notice) return undefined;
  if (!isWithinBusinessHours(config, date)) return businessHoursMessage(config, date);
  return notice;
}

function defaultBusinessHoursMessage(config: AppConfig): string {
  const dayRange = config.businessDayStart === config.businessDayEnd
    ? WEEKDAY_NAMES[config.businessDayStart]
    : `${WEEKDAY_NAMES[config.businessDayStart]} a ${WEEKDAY_NAMES[config.businessDayEnd]}`;

  if (isSeteLagoas(config)) {
    const weekdays = config.businessDayStart === 1 && config.businessDayEnd === 5 ? 'segunda a sexta-feira' : dayRange;
    const saturday = config.businessSaturdayEnabled && config.businessSaturdayStart && config.businessSaturdayEnd
      ? `, e aos *sábados*, das *${config.businessSaturdayStart}* às *${config.businessSaturdayEnd}*` : '';
    return `⏰ Nosso atendimento humano funciona de *${weekdays}*, das *${config.businessHoursStart}* às *${config.businessHoursEnd}*${saturday}.\n\nFora desse horário não conseguimos te transferir para um atendente agora, mas você pode continuar usando as outras opções do menu normalmente.`;
  }

  return `⏰ Nosso atendimento humano funciona de *${dayRange}*, das *${config.businessHoursStart}* às *${config.businessHoursEnd}*.\n\nFora desse horário não conseguimos te transferir para um atendente agora, mas você pode continuar usando as outras opções do menu normalmente.`;
}
