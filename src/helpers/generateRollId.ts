/**
 * A unique id for one finished roll (the same for every revision of it). Sent as `rollId` and
 * stored in the player metadata history. Matches `[A-Za-z0-9_-]{1,64}`.
 */
export function generateRollId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
