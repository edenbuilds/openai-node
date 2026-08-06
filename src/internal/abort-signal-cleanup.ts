/**
 * Coordinates AbortSignal listener cleanup for fetch responses.
 *
 * Lives in an internal module (not on the public OpenAI class) so declaration
 * emit does not grow the consumer API. Uses Symbol.for for normal Responses
 * and a WeakMap fallback when the Response is non-extensible.
 */

export const ABORT_FORWARDER_CLEANUP = Symbol.for('openai.abortForwarderCleanup');

const weakCleanups = new WeakMap<object, () => void>();

export function storeAbortCleanup(target: object, cleanup: () => void): void {
  try {
    (target as any)[ABORT_FORWARDER_CLEANUP] = cleanup;
    return;
  } catch {
    // Response may be sealed / non-extensible (custom fetch wrappers).
  }
  weakCleanups.set(target, cleanup);
}

/** Safe to call multiple times; used after parse and after body hooks finish. */
export function releaseAbortCleanup(target: object | null | undefined): void {
  if (target == null) return;
  try {
    const fromSymbol = (target as any)[ABORT_FORWARDER_CLEANUP];
    if (typeof fromSymbol === 'function') fromSymbol();
  } catch {
    // ignore
  }
  const fromWeak = weakCleanups.get(target);
  if (fromWeak) {
    try {
      fromWeak();
    } catch {
      // ignore
    }
    weakCleanups.delete(target);
  }
}
