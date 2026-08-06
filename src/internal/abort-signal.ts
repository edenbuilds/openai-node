/**
 * Combine a request's own `AbortController` with an optional caller signal.
 *
 * `AbortSignal.any` is preferred over forwarding aborts with a listener. A
 * listener has to outlive the request (`fetch` resolves when headers arrive, so
 * removing it there would break mid-stream aborts), and in Deno an
 * `AbortSignal.timeout()` signal keeps its timer referenced for as long as it has
 * listeners — which holds the process open until the timeout fires, long after
 * the request finished (#1811). A composed signal also lets both signals be
 * collected with the request, so reusing one long-lived signal across many
 * requests no longer accumulates listeners.
 *
 * Returns `controllerSignal` unchanged when there is nothing to combine, or when
 * the runtime predates `AbortSignal.any` (Node < 18.17, Safari < 17.4); callers
 * then fall back to attaching a listener.
 */
export function combineAbortSignals(
  controllerSignal: AbortSignal,
  signal: AbortSignal | null | undefined,
): AbortSignal {
  if (!signal) return controllerSignal;
  const any = (globalThis as any).AbortSignal?.any;
  if (typeof any !== 'function') return controllerSignal;
  try {
    return any.call((globalThis as any).AbortSignal, [controllerSignal, signal]) as AbortSignal;
  } catch {
    // Exotic signal implementations (custom fetch shims) may not be composable.
    return controllerSignal;
  }
}
