import { EventEmitter } from "node:events";

/** Per-user realtime event bus feeding the SSE stream. */
export type AmuseEvent =
  | { type: "status"; status: string }
  | { type: "message"; chatId: number; message: unknown }
  | { type: "delta"; chatId: number; runId: number; messageId: number; text: string }
  | { type: "message_done"; chatId: number; messageId: number }
  | { type: "run"; run: unknown }
  | { type: "approval"; approval: unknown }
  | { type: "activity"; activity: unknown }
  | { type: "browser"; session: unknown }
  | { type: "notification"; notification: unknown }
  | { type: "refresh"; what: string };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(userId: string, event: AmuseEvent) {
  emitter.emit(userId, event);
}

export function subscribe(userId: string, fn: (e: AmuseEvent) => void) {
  emitter.on(userId, fn);
  return () => emitter.off(userId, fn);
}
