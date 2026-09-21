export const PAD_TRASH_RETENTION_DAYS = 7;
export const PAD_TRASH_RETENTION_MS = PAD_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export function padTrashCutoff(now = new Date()) {
  return new Date(now.getTime() - PAD_TRASH_RETENTION_MS);
}

export function isPadTrashRestorable(deletedAt: Date, now = Date.now()) {
  return now - deletedAt.getTime() <= PAD_TRASH_RETENTION_MS;
}
