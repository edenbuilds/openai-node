import { getEventListeners } from 'node:events';

import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';

/**
 * Regressions for #1811: a request made with a caller signal must not leave that
 * signal holding a reference to the request. Kept out of the Stainless-generated
 * `tests/index.test.ts` projection.
 */

function makeClient(fetchImpl: typeof fetch | (() => Promise<Response>)) {
  return new OpenAI({
    baseURL: 'http://localhost:5000/',
    apiKey: 'My API Key',
    adminAPIKey: 'My Admin API Key',
    maxRetries: 0,
    fetch: fetchImpl as any,
  });
}

const jsonResponse = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

describe('caller AbortSignal handling', () => {
  test('leaves no listener on the caller signal after a request (#1811)', async () => {
    const client = makeClient(async () => jsonResponse());

    const signal = AbortSignal.timeout(30_000);
    await client.get('/foo', { signal });

    // A listener here keeps Deno's timeout timer referenced, so the process
    // cannot exit until the timeout fires.
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

  test('does not accumulate listeners when one signal is reused', async () => {
    const client = makeClient(async () => jsonResponse());

    const controller = new AbortController();
    for (let i = 0; i < 5; i++) {
      await client.get('/foo', { signal: controller.signal });
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('caller abort before the request rejects with APIUserAbortError', async () => {
    const client = makeClient(async () => jsonResponse());

    const controller = new AbortController();
    controller.abort();

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrow(OpenAI.APIUserAbortError);
  });

  test('caller abort reaches the fetch after headers arrive', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    });

    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });

    const controller = new AbortController();
    const response = await client.get('/foo', { signal: controller.signal }).asResponse();

    // Body still streaming: the request must remain abortable.
    expect(observed!.aborted).toBe(false);
    controller.abort();
    expect(observed!.aborted).toBe(true);

    bodyController.close();
    await response.text().catch(() => {});
  });

  test('the request signal records a caller abort', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const external = new AbortController();
    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    // `Stream` and the streaming helpers decide between cancellation and failure
    // by reading the request controller, so it has to see the caller's abort.
    expect(observed).toBe(internal.signal);
    external.abort();
    expect(internal.signal.aborted).toBe(true);
  });

  test('the request controller still aborts the fetch on its own', async () => {
    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const external = new AbortController();
    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    // `stream.controller.abort()` is the documented escape hatch for raw streams.
    internal.abort();
    expect(observed!.aborted).toBe(true);
    expect(external.signal.aborted).toBe(false);
  });

  test('an SSE stream ends cleanly when the caller aborts with a non-AbortError reason', async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const client = makeClient(async (_url: any, init: any) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
          // What fetch does: reads reject with whatever the signal aborted with.
          signal.addEventListener('abort', () => streamController.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });

    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const chunks: unknown[] = [];
    const stream = Stream.fromSSEResponse<{ n: number }>(response, internal);
    const iterating = (async () => {
      for await (const chunk of stream) chunks.push(chunk);
    })();

    bodyController.enqueue(new TextEncoder().encode('data: {"n":1}\n\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // `AbortSignal.timeout()` aborts with a TimeoutError, and a caller may abort
    // with any reason at all; neither is an AbortError.
    external.abort(new DOMException('The operation was timed out.', 'TimeoutError'));

    await expect(iterating).resolves.toBeUndefined();
    expect(chunks).toEqual([{ n: 1 }]);
    expect(internal.signal.aborted).toBe(true);
  });

  test('a caller abort mid-body is reported as an AbortError', async () => {
    const client = makeClient(async (_url: any, init: any) => {
      const signal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"ok"'));
          signal.addEventListener('abort', () => streamController.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });

    const caller = new AbortController();
    const request = client.get('/foo', { signal: caller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Callers classify cancellation by AbortError, so the reason the caller
    // aborted with must not reach them in its place.
    caller.abort(new DOMException('The operation was timed out.', 'TimeoutError'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('a body read that fails on its own keeps its error', async () => {
    const client = makeClient(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.error(new Error('connection reset'));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    });

    await expect(client.get('/foo', { signal: new AbortController().signal })).rejects.toThrow(
      'connection reset',
    );
  });

  test('leaves the response untouched', async () => {
    const client = makeClient(async () => jsonResponse());

    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    // Nothing about the body is wrapped or patched, so identity, byte-stream
    // reads, and own-property shape all stay exactly as the runtime produced them.
    expect(Object.keys(response)).toEqual([]);
    expect(Object.getOwnPropertyNames(response.body!)).toEqual([]);
    const reader = response.body!.getReader({ mode: 'byob' });
    const { value } = await reader.read(new Uint8Array(32));
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');
  });

  test('forwards aborts with a listener when AbortSignal.any is unavailable', async () => {
    const original = (AbortSignal as any).any;
    try {
      (AbortSignal as any).any = undefined;

      let observed: AbortSignal | undefined;
      const client = makeClient(async (_url: any, init: any) => {
        observed = init.signal;
        return jsonResponse();
      });

      const external = new AbortController();
      const internal = new AbortController();
      await client.fetchWithTimeout(
        'http://localhost:5000/foo',
        { signal: external.signal },
        30_000,
        internal,
      );

      expect(observed).toBe(internal.signal);
      external.abort();
      expect(internal.signal.aborted).toBe(true);
    } finally {
      (AbortSignal as any).any = original;
    }
  });

  test('forwards aborts with a listener when the caller signal is not composable', async () => {
    // Polyfilled signals (e.g. the `abort-controller` package) are rejected by
    // native AbortSignal.any.
    let forward: (() => void) | undefined;
    const polyfilled = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => {
        forward = listener;
      },
      removeEventListener: () => {
        forward = undefined;
      },
    } as unknown as AbortSignal;

    let observed: AbortSignal | undefined;
    const client = makeClient(async (_url: any, init: any) => {
      observed = init.signal;
      return jsonResponse();
    });

    const internal = new AbortController();
    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: polyfilled }, 30_000, internal);

    expect(observed).toBe(internal.signal);
    forward!();
    expect(internal.signal.aborted).toBe(true);
  });

  test('removes the fallback listener when the fetch itself fails', async () => {
    const original = (AbortSignal as any).any;
    try {
      (AbortSignal as any).any = undefined;

      const client = makeClient(async () => {
        throw new Error('connection failed');
      });

      const external = new AbortController();
      const internal = new AbortController();
      await expect(
        client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal),
      ).rejects.toThrow('connection failed');

      expect(getEventListeners(external.signal, 'abort')).toHaveLength(0);
    } finally {
      (AbortSignal as any).any = original;
    }
  });
});
