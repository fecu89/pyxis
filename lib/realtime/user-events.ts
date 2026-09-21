import { EventEmitter } from "node:events";

export type UserEvent = {
  type: "notification.created";
  notificationId: string;
  emittedAt?: string;
};

const globalForEvents = globalThis as unknown as { pyxCourseUserEventBus?: EventEmitter };

function getEventBus() {
  if (!globalForEvents.pyxCourseUserEventBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    globalForEvents.pyxCourseUserEventBus = bus;
  }
  return globalForEvents.pyxCourseUserEventBus;
}

const channel = (userId: string) => `user:${userId}`;

export function publishUserEvent(userId: string, event: UserEvent) {
  getEventBus().emit(channel(userId), { ...event, emittedAt: new Date().toISOString() } satisfies UserEvent);
}

export function subscribeUserEvent(userId: string, listener: (event: UserEvent) => void) {
  const bus = getEventBus();
  const name = channel(userId);
  bus.on(name, listener);
  return () => bus.off(name, listener);
}
