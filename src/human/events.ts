import { EventEmitter } from 'node:events';

export type HumanRealtimeEvent =
  | { type: 'message'; phone: string; at: string }
  | { type: 'ticket_update'; phone: string; at: string };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishHumanEvent(event: HumanRealtimeEvent): void {
  emitter.emit('event', event);
}

export function subscribeHumanEvents(
  listener: (event: HumanRealtimeEvent) => void
): () => void {
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
  };
}

