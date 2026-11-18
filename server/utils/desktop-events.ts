import { EventEmitter } from 'node:events'

export const desktopEvents = new EventEmitter()
export function notifyDesktop(type: string, payload: unknown = {}) {
  desktopEvents.emit('change', { type, payload })
}
