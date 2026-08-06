import { vi } from 'vitest';

import OpenAI from 'openai';
import { releaseAbortCleanup } from 'openai/internal/abort-signal-cleanup';

/**
 * Handwritten regressions for AbortSignal forwarder cleanup (#1811 / PR #2086).
 * Kept out of the Stainless-generated `tests/index.test.ts` projection.
 */

function spyAbortSignal(signal: AbortSignal) {
  return {
    add: vi.spyOn(signal, 'addEventListener'),
    remove: vi.spyOn(signal, 'removeEventListener'),
  };
}

function abortListener(add: ReturnType<typeof vi.spyOn>) {
  return add.mock.calls.find((call) => call[0] === 'abort')?.[1];
}

function wasRemoved(
  remove: ReturnType<typeof vi.spyOn>,
  listener: EventListenerOrEventListenerObject | undefined,
) {
  return remove.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener);
}

describe('AbortSignal forwarder cleanup', () => {
  test('removes abort signal listener after the response body is fully read', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    expect(listener).toBeDefined();
    expect(wasRemoved(remove, listener)).toBe(false);

    await response.json();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('detaches after response.json() when getReader body hooks are bypassed', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () => {
        const response = new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
        Object.defineProperty(response, 'json', {
          configurable: true,
          value: async function (this: Response) {
            const buf = await Response.prototype.arrayBuffer.call(this);
            return JSON.parse(new TextDecoder().decode(buf));
          },
        });
        return response;
      },
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    await response.json();
    releaseAbortCleanup(response);

    expect(listener).toBeDefined();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('detaches after native for-await consumption', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    expect(wasRemoved(remove, listener)).toBe(false);

    for await (const _chunk of response.body as AsyncIterable<Uint8Array>) {
      // drain
    }

    expect(wasRemoved(remove, listener)).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });

  test('detaches immediately for Content-Length: 0 JSON bodies', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response('', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '0',
          },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    expect(listener).toBeDefined();
    expect(wasRemoved(remove, listener)).toBe(true);
    expect(response.headers.get('content-length')).toBe('0');

    add.mockRestore();
    remove.mockRestore();
  });

  test('preserves response identity and supports BYOB readers when a signal is used', async () => {
    const payload = new TextEncoder().encode('{"ok":true}');
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    expect(response.status).toBe(200);
    const buf = new Uint8Array(payload.byteLength);
    const reader = response.body!.getReader({ mode: 'byob' });
    const { done, value } = await reader.read(buf);
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');
    expect((await reader.read(new Uint8Array(1))).done).toBe(true);
  });

  test('caller abort still aborts after headers while the body is streaming', async () => {
    let resolveBody!: (chunk: Uint8Array) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        resolveBody = (chunk) => {
          controller.enqueue(chunk);
          controller.close();
        };
      },
    });

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    external.abort();
    expect(internal.signal.aborted).toBe(true);
    resolveBody(new TextEncoder().encode('{"ok":true}'));
    await response.text().catch(() => {});
  });

  test('pipeTo with preventCancel keeps abort forwarder when destination rejects', async () => {
    const payload = new TextEncoder().encode('chunk-one');
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    const failingDest = new WritableStream({
      write() {
        throw new Error('dest failed');
      },
    });

    await expect(response.body!.pipeTo(failingDest, { preventCancel: true })).rejects.toThrow('dest failed');
    // Source left open — forwarder must remain so a later abort still works.
    expect(wasRemoved(remove, listener)).toBe(false);
    expect(internal.signal.aborted).toBe(false);

    external.abort();
    expect(internal.signal.aborted).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('async-iterable custom fetch bodies are bridged with pull backpressure', async () => {
    let nextCalls = 0;
    const chunks = [new TextEncoder().encode('a'), new TextEncoder().encode('b')];
    const iterableBody = {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            nextCalls += 1;
            if (i >= chunks.length) return { done: true as const, value: undefined };
            return { done: false as const, value: chunks[i++] };
          },
        };
      },
    };

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
          body: iterableBody,
          url: 'http://localhost:5000/foo',
          redirected: false,
          type: 'basic',
          clone() {
            return this;
          },
          arrayBuffer: async () => new ArrayBuffer(0),
          blob: async () => new Blob(),
          formData: async () => new FormData(),
          json: async () => ({}),
          text: async () => '',
          bytes: async () => new Uint8Array(),
        }) as unknown as Response,
    });

    const external = new AbortController();
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    // Obtaining the response must not drain the iterable (no start()-time for-await).
    expect(nextCalls).toBe(0);

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(nextCalls).toBe(1);

    const second = await reader.read();
    expect(second.done).toBe(false);
    expect(nextCalls).toBe(2);

    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(nextCalls).toBe(3);
  });
});
