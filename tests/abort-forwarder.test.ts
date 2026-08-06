import { getEventListeners } from 'node:events';

import OpenAI from 'openai';
import { combineAbortSignals } from 'openai/internal/abort-signal';

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

  describe('combineAbortSignals', () => {
    test('aborts when either input aborts, without listening on them', () => {
      const controller = new AbortController();
      const caller = new AbortController();

      const combined = combineAbortSignals(controller.signal, caller.signal);
      expect(combined).not.toBe(controller.signal);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);

      caller.abort(new Error('caller went away'));
      expect(combined.aborted).toBe(true);
      expect((combined.reason as Error).message).toBe('caller went away');

      const other = combineAbortSignals(new AbortController().signal, controller.signal);
      controller.abort();
      expect(other.aborted).toBe(true);
    });

    test('passes the controller signal through when there is nothing to combine', () => {
      const controller = new AbortController();
      expect(combineAbortSignals(controller.signal, undefined)).toBe(controller.signal);
      expect(combineAbortSignals(controller.signal, null)).toBe(controller.signal);
    });

    test('falls back when the caller signal is not composable', () => {
      // Polyfilled signals (e.g. the `abort-controller` package) are rejected by
      // native AbortSignal.any.
      const polyfilled = {
        aborted: false,
        addEventListener() {},
        removeEventListener() {},
      } as unknown as AbortSignal;

      const controller = new AbortController();
      expect(combineAbortSignals(controller.signal, polyfilled)).toBe(controller.signal);
    });

    test('falls back to the controller signal without AbortSignal.any', () => {
      const original = (AbortSignal as any).any;
      try {
        (AbortSignal as any).any = undefined;
        const controller = new AbortController();
        const caller = new AbortController();
        expect(combineAbortSignals(controller.signal, caller.signal)).toBe(controller.signal);
      } finally {
        (AbortSignal as any).any = original;
      }
    });
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
