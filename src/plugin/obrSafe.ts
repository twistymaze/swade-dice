/**
 * Catch and log a rejected OBR promise (D-02). An OBR call can reject (not ready, rate limit,
 * timeout, room closed); a call that nobody awaits must not become an unhandled rejection.
 * Resolves to undefined after a failure.
 */
export function obrSafe<T>(promise: Promise<T>, what: string): Promise<T | undefined> {
  return promise.catch((e: unknown) => {
    console.error(`[savage-worlds-dice] ${what} failed`, e);
    return undefined;
  });
}
