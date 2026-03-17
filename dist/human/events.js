import { EventEmitter } from 'node:events';
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
export function publishHumanEvent(event) {
    emitter.emit('event', event);
}
export function subscribeHumanEvents(listener) {
    emitter.on('event', listener);
    return () => {
        emitter.off('event', listener);
    };
}
