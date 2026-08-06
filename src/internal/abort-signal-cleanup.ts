/**
 * Keeps a caller's `AbortSignal` forwarder attached until a fetch `Response`
 * body is finished, then removes it.
 *
 * `fetch()` resolves as soon as headers arrive, so removing the listener there
 * breaks mid-stream aborts, while never removing it keeps `AbortSignal.timeout()`
 * listeners alive and can hold a Deno process open until the timeout fires
 * (#1811).
 *
 * Cleanup is therefore driven by body lifetime and is deliberately state-aware:
 * it runs when a body reaches a terminal state (fully read, cancelled, errored)
 * or when the request's own controller aborts — never on a rejected method call
 * that leaves the body readable and still abortable.
 *
 * This lives outside the generated client so the SDK's exported surface does
 * not grow; `parse.ts` reaches the hook through `releaseAbortCleanup`.
 */

import { makeReadableStream } from './shims';

const ABORT_FORWARDER_CLEANUP = Symbol.for('openai.abortForwarderCleanup');

/**
 * Statuses that must not carry a body: `new Response(body, { status })` throws
 * for these, which would turn an HTTP response into a fetch error (and a retry).
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Cleanup hooks for Responses that cannot hold the symbol (sealed/frozen). */
const weakHooks = new WeakMap<object, () => void>();

function storeHook(target: object, hook: () => void): void {
  try {
    (target as any)[ABORT_FORWARDER_CLEANUP] = hook;
    return;
  } catch {
    // Response may be sealed / non-extensible (custom fetch wrappers).
  }
  weakHooks.set(target, hook);
}

function clearHook(target: object): void {
  try {
    delete (target as any)[ABORT_FORWARDER_CLEANUP];
  } catch {
    // ignore
  }
  weakHooks.delete(target);
}

/**
 * Run the stored cleanup hook, if any. Safe to call repeatedly and on responses
 * that were never hooked.
 */
export function releaseAbortCleanup(target: object | null | undefined): void {
  if (target == null) return;
  let hook: unknown;
  try {
    hook = (target as any)[ABORT_FORWARDER_CLEANUP];
  } catch {
    // ignore exotic proxies
  }
  if (typeof hook !== 'function') hook = weakHooks.get(target);
  if (typeof hook !== 'function') return;
  try {
    (hook as () => void)();
  } catch {
    // cleanup must never mask the caller's result
  }
}

/** Best-effort: some runtimes expose `ReadableStream.state` as closed/errored. */
function isStreamTerminal(body: unknown): boolean {
  const state = (body as { state?: string } | null | undefined)?.state;
  return state === 'closed' || state === 'errored';
}

type IteratorCleanupOptions = {
  /** Detach when the consumer exits early via `return()` (e.g. `break`). */
  onEarlyReturn?: boolean;
  /** Detach when iteration rejects. Off when a hooked reader already tracks it. */
  onError?: boolean;
};

function wrapAsyncIterator<T>(
  iterator: AsyncIterator<T>,
  done: () => void,
  { onEarlyReturn = true, onError = true }: IteratorCleanupOptions = {},
): AsyncIterableIterator<T> {
  return {
    async next(...args: [] | [any]) {
      try {
        const result = await (iterator.next as any)(...args);
        if (result.done) done();
        return result;
      } catch (err) {
        if (onError) done();
        throw err;
      }
    },
    async return(value?: any) {
      try {
        if (iterator.return) return await iterator.return(value);
        return { done: true as const, value: undefined };
      } finally {
        if (onEarlyReturn) done();
      }
    },
    async throw(err?: any) {
      try {
        if (iterator.throw) return await iterator.throw(err);
        throw err;
      } finally {
        done();
      }
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * Tear down a node-fetch style async-iterable body, including when the retry
 * path cancels before anything was pulled (iterator still undefined).
 */
async function tearDownAsyncIterable(
  body: any,
  iterator: AsyncIterator<unknown> | undefined,
  reason: unknown,
): Promise<void> {
  try {
    if (iterator?.return) {
      await iterator.return(reason);
      return;
    }
    if (typeof body.cancel === 'function') {
      await body.cancel(reason);
      return;
    }
    if (typeof body.destroy === 'function') {
      body.destroy(reason instanceof Error ? reason : undefined);
      return;
    }
    // Never pulled: open an iterator solely to close the upstream socket.
    if (typeof body[Symbol.asyncIterator] === 'function') {
      const it = body[Symbol.asyncIterator]() as AsyncIterator<unknown>;
      if (it.return) await it.return(reason);
    }
  } catch {
    // Best-effort: retries must proceed even if the upstream close throws.
  }
}

/**
 * Attach `signal`'s forwarder lifetime to `response`'s body.
 *
 * Returns the original `Response` whenever possible so `url`, `redirected`, and
 * byte-stream (BYOB) reads stay intact; only runtimes that freeze stream methods
 * fall back to a mirrored response.
 */
export function attachAbortCleanup(
  response: Response,
  signal: AbortSignal | null | undefined,
  abort: () => void,
  controller?: AbortController,
): Response {
  if (!signal) return response;

  let signalRef: AbortSignal | null = signal;
  let abortRef: (() => void) | null = abort;
  let controllerSignal: AbortSignal | null = controller?.signal ?? null;
  let onControllerAbort: (() => void) | null = null;
  let hooked: object[] = [];

  const finish = () => {
    if (!signalRef) return;
    signalRef.removeEventListener('abort', abortRef!);
    if (controllerSignal && onControllerAbort) {
      controllerSignal.removeEventListener('abort', onControllerAbort);
    }
    // Drop every captured reference: this closure stays reachable from the
    // Response (and its patched methods) for as long as a caller keeps them,
    // and a signal can transitively retain unrelated application listeners.
    signalRef = null;
    abortRef = null;
    controllerSignal = null;
    onControllerAbort = null;
    for (const target of hooked) clearHook(target);
    hooked = [];
  };

  // `clone()` and `tee()` split the payload; forwarding has to survive until
  // every branch is terminal, so each one gets its own single-shot completion.
  let openBranches = 0;
  const openBranch = (): (() => void) => {
    openBranches++;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (--openBranches === 0) finish();
    };
  };

  if (signal.aborted) {
    finish();
    return response;
  }

  const contentLength = response.headers.get('content-length');
  // Nothing for the consumer (or `defaultParseResponse`) to read.
  if (response.body == null || NULL_BODY_STATUSES.has(response.status) || contentLength === '0') {
    finish();
    return response;
  }

  // A caller can stop a raw streaming result with `stream.controller.abort()`,
  // which kills the fetch body without touching any body hook below.
  if (controller) {
    if (controller.signal.aborted) {
      finish();
      return response;
    }
    onControllerAbort = () => finish();
    try {
      controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    } catch {
      onControllerAbort = null;
    }
  }

  const hookReader = (reader: any, done: () => void) => {
    let released = false;
    const originalReleaseLock = reader.releaseLock?.bind(reader);
    if (typeof originalReleaseLock === 'function') {
      reader.releaseLock = () => {
        released = true;
        return originalReleaseLock();
      };
    }

    // A `read()` rejection is not necessarily terminal — a BYOB reader rejects a
    // zero-length or detached view and stays usable — so stream completion is
    // observed through `closed` instead of this call's outcome.
    const originalRead = reader.read.bind(reader);
    reader.read = async (...args: any[]) => {
      const result = await originalRead(...args);
      if (result.done) done();
      return result;
    };

    const originalCancel = reader.cancel.bind(reader);
    reader.cancel = async (reason?: any) => {
      const result = await originalCancel(reason);
      done();
      return result;
    };

    // `closed` fulfils as soon as the stream closes, which can happen while the
    // final chunk is delivered as `{ done: false }` — a caller that stops at the
    // advertised byte count never performs the extra `read()`. It rejects both
    // when the stream errors (terminal) and on `releaseLock()` (not terminal).
    if (reader.closed && typeof reader.closed.then === 'function') {
      const observeClosed = async () => {
        try {
          await reader.closed;
        } catch {
          if (released) return;
        }
        done();
      };
      void observeClosed();
    }

    return reader;
  };

  const hookStream = (body: any, done: () => void) => {
    const originalGetReader = body.getReader.bind(body);
    Object.defineProperty(body, 'getReader', {
      configurable: true,
      value: (...args: any[]) => hookReader(originalGetReader(...args), done),
    });

    const originalCancel = body.cancel.bind(body);
    Object.defineProperty(body, 'cancel', {
      configurable: true,
      value: async (reason?: any) => {
        try {
          const result = await originalCancel(reason);
          done();
          return result;
        } catch (err) {
          // `cancel()` rejects while a reader holds the lock; that reader keeps
          // receiving the live body, so forwarding must stay.
          if (isStreamTerminal(body)) done();
          throw err;
        }
      },
    });

    const originalPipeTo = body.pipeTo?.bind(body);
    if (typeof originalPipeTo === 'function') {
      Object.defineProperty(body, 'pipeTo', {
        configurable: true,
        value: async (...args: any[]) => {
          const preventCancel = args[1]?.preventCancel === true;
          try {
            const result = await originalPipeTo(...args);
            done();
            return result;
          } catch (err) {
            // With `preventCancel` the source deliberately stays readable after a
            // destination failure, so a later abort must still reach it.
            if (!preventCancel || isStreamTerminal(body)) done();
            throw err;
          }
        },
      });
    }

    // `pipeThrough()` drains through stream internals rather than the methods
    // patched here. Per spec it is `pipeTo(writable)` with the promise handled,
    // so route it through the hooked `pipeTo` above.
    if (typeof body.pipeThrough === 'function' && typeof originalPipeTo === 'function') {
      Object.defineProperty(body, 'pipeThrough', {
        configurable: true,
        value: (transform: any, options?: any) => {
          const { readable, writable } = transform ?? {};
          if (readable == null || writable == null) {
            throw new TypeError('pipeThrough requires a { readable, writable } pair');
          }
          if (body.locked || writable.locked) {
            throw new TypeError('Cannot pipe a locked stream');
          }
          body.pipeTo(writable, options).catch(() => {
            // errors surface on `transform.readable`, as the spec requires
          });
          return readable;
        },
      });
    }

    // `tee()` hands the payload to two unpatched branches.
    const originalTee = body.tee?.bind(body);
    if (typeof originalTee === 'function') {
      Object.defineProperty(body, 'tee', {
        configurable: true,
        value: () => {
          const branches = originalTee() as any[];
          const branchDones = branches.map(() => openBranch());
          done();
          branches.forEach((branch, index) => {
            const branchDone = branchDones[index]!;
            try {
              hookStream(branch, branchDone);
            } catch {
              branchDone();
            }
          });
          return branches;
        },
      });
    }

    const originalValues = body.values?.bind(body);
    if (typeof originalValues === 'function') {
      Object.defineProperty(body, 'values', {
        configurable: true,
        value: (...args: any[]) =>
          wrapAsyncIterator(originalValues(...args), done, {
            // `preventCancel` leaves the body open after an early `break`.
            onEarlyReturn: args[0]?.preventCancel !== true,
          }),
      });
    }

    // Prefer a reader-backed iterator so native `for await` (Node/Deno) also
    // detaches when the stream ends or the loop exits early.
    Object.defineProperty(body, Symbol.asyncIterator, {
      configurable: true,
      value: () => {
        const reader = body.getReader();
        return wrapAsyncIterator(
          {
            next: () => reader.read(),
            async return() {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              try {
                reader.releaseLock();
              } catch {
                // ignore
              }
              return { done: true as const, value: undefined };
            },
          },
          done,
          // The hooked reader already reports terminal state via `closed`.
          { onError: false },
        );
      },
    });
  };

  const hookBodyHelpers = (res: Response, done: () => void) => {
    // Deno/Bun/undici drain these through stream internals, so wrap the public
    // helpers as well. Never use an unconditional `finally`: calling a helper on
    // an already-locked body rejects without consuming anything.
    for (const method of ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const) {
      try {
        const original = (res as any)[method]?.bind(res);
        if (typeof original !== 'function') continue;
        Object.defineProperty(res, method, {
          configurable: true,
          value: async (...args: any[]) => {
            try {
              const result = await original(...args);
              done();
              return result;
            } catch (err) {
              if (res.body == null || isStreamTerminal(res.body)) done();
              throw err;
            }
          },
        });
      } catch {
        // ignore frozen Response prototypes
      }
    }
  };

  const hookResponse = (res: Response, done: () => void): Response => {
    storeHook(res, done);
    hooked.push(res);
    hookBodyHelpers(res, done);

    const body: any = res.body;
    if (body == null) {
      done();
      return res;
    }

    // node-fetch / custom fetch: body may be async-iterable without getReader.
    if (typeof body.getReader !== 'function') {
      return wrapAsyncIterableBody(res, done);
    }

    try {
      hookStream(body, done);
    } catch {
      // Runtimes that freeze stream methods still need cleanup.
      return wrapStreamBody(res, done);
    }

    hookClone(res, done);
    return res;
  };

  /**
   * `clone()` tees the payload: `res.body` becomes a fresh branch that the hooks
   * installed above no longer cover, and the clone starts out unhooked. Track
   * both so forwarding survives until whichever branch is read last.
   */
  function hookClone(res: Response, done: () => void) {
    const originalClone = (res as any).clone?.bind(res);
    if (typeof originalClone !== 'function') return;
    try {
      Object.defineProperty(res, 'clone', {
        configurable: true,
        value: () => {
          const cloned = originalClone();
          const originalDone = openBranch();
          const clonedDone = openBranch();
          done();
          // A branch we cannot hook in place (frozen streams) is closed right
          // away rather than left pinning the listener forever.
          if (hookResponse(res, originalDone) !== res) originalDone();
          if (hookResponse(cloned, clonedDone) !== cloned) clonedDone();
          return cloned;
        },
      });
    } catch {
      // ignore frozen Response prototypes
    }
  }

  /**
   * Fallback for async-iterable bodies without `getReader` (classic node-fetch).
   * Bridged through `pull()` so upstream reads follow downstream demand instead
   * of buffering the whole payload.
   */
  function wrapAsyncIterableBody(res: Response, done: () => void): Response {
    const body: any = res.body;
    if (body == null || typeof body[Symbol.asyncIterator] !== 'function') {
      // Nothing observable — detach rather than pin the runtime open.
      done();
      return res;
    }

    let iterator: AsyncIterator<unknown> | undefined;
    const stream = makeReadableStream(
      {
        async pull(controller: any) {
          try {
            iterator ??= body[Symbol.asyncIterator]() as AsyncIterator<unknown>;
            // One chunk per pull; the runtime re-invokes while desiredSize > 0.
            const { done: iterDone, value } = await iterator.next();
            if (iterDone) {
              done();
              controller.close();
              return;
            }
            controller.enqueue(
              value instanceof Uint8Array
                ? value
                : typeof value === 'string'
                  ? new TextEncoder().encode(value)
                  : new Uint8Array(value as ArrayBufferLike),
            );
          } catch (err) {
            done();
            controller.error(err);
          }
        },
        cancel(reason: any) {
          done();
          return tearDownAsyncIterable(body, iterator, reason);
        },
      },
      // Do not prefetch: pull only when a consumer reads.
      { highWaterMark: 0 },
    );

    return mirrorResponse(res, stream, done);
  }

  /** Fallback when the body's stream methods cannot be patched. */
  function wrapStreamBody(res: Response, done: () => void): Response {
    const body: any = res.body;
    if (body == null) {
      done();
      return res;
    }

    let reader: any;
    const stream = makeReadableStream({
      async pull(controller: any) {
        reader ??= body.getReader();
        try {
          const { done: readDone, value } = await reader.read();
          if (readDone) {
            done();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (err) {
          done();
          controller.error(err);
        }
      },
      async cancel(reason: any) {
        done();
        await (reader ? reader.cancel(reason) : body.cancel(reason));
      },
    });

    return mirrorResponse(res, stream, done);
  }

  /** Re-wrap a body while keeping `status`, `url`, and `redirected` intact. */
  function mirrorResponse(res: Response, stream: unknown, done: () => void): Response {
    // A synthetic body is impossible for null-body statuses (the constructor
    // throws), and unnecessary — those responses have nothing to read.
    if (NULL_BODY_STATUSES.has(res.status)) {
      done();
      return res;
    }

    const wrapped = new Response(stream as any, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });

    try {
      Object.defineProperty(wrapped, 'url', { value: res.url, enumerable: true });
      Object.defineProperty(wrapped, 'redirected', { value: res.redirected, enumerable: true });
      Object.defineProperty(wrapped, 'type', { value: res.type, enumerable: true });
    } catch {
      // Ignore if the host Response forbids redefining identity fields.
    }

    storeHook(wrapped, done);
    hooked.push(wrapped);
    return wrapped;
  }

  return hookResponse(response, openBranch());
}
