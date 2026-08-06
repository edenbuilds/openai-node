import { getEventListeners } from 'node:events';
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
  return add.mock.calls.find((call: any[]) => call[0] === 'abort')?.[1];
}

function wasRemoved(remove: ReturnType<typeof vi.spyOn>, listener: unknown) {
  return remove.mock.calls.some((call: any[]) => call[0] === 'abort' && call[1] === listener);
}

/** Same key the internal cleanup module stores its hook under. */
const CLEANUP_HOOK = Symbol.for('openai.abortForwarderCleanup');

describe('AbortSignal forwarder cleanup', () => {
  test('leaves no listener on an AbortSignal.timeout() signal after a request (#1811)', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const signal = AbortSignal.timeout(30_000);
    await client.get('/foo', { signal });

    // A lingering listener is what keeps Deno alive until the timeout fires.
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
  });

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
          blob: async () => new Blob([]),
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

  test('locked-body helper reject does not detach abort forwarder', async () => {
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
    // Lock the body; text() should reject without consuming.
    const reader = response.body!.getReader();
    await expect(response.text()).rejects.toThrow();
    expect(wasRemoved(remove, listener)).toBe(false);

    // Forwarder still live — mid-stream abort reaches the fetch controller.
    external.abort();
    expect(internal.signal.aborted).toBe(true);

    await reader.cancel().catch(() => {});
    add.mockRestore();
    remove.mockRestore();
  });

  test('releaseLock rejection of reader.closed does not detach abort forwarder', async () => {
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
    const reader = response.body!.getReader();
    reader.releaseLock();
    // Allow reader.closed rejection microtask to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(wasRemoved(remove, listener)).toBe(false);
    external.abort();
    expect(internal.signal.aborted).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('response.bytes() detaches abort forwarder when available', async () => {
    if (typeof (Response.prototype as { bytes?: unknown }).bytes !== 'function') {
      return; // runtime without bytes()
    }

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
    await (response as Response & { bytes(): Promise<Uint8Array> }).bytes();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('cancelling an unread async-iterable bridge tears down upstream', async () => {
    let returned = false;
    const iterableBody = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false as const, value: new TextEncoder().encode('x') };
          },
          async return() {
            returned = true;
            return { done: true as const, value: undefined };
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
          blob: async () => new Blob([]),
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

    // Simulate retry CancelReadableStream before any pull.
    await response.body!.cancel('retry');
    expect(returned).toBe(true);
  });

  test('detaches when SDK-owned parsing rejects on malformed JSON', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      maxRetries: 0,
      fetch: async () =>
        new Response('{"ok": tru', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);

    await expect(client.get('/foo', { signal: external.signal })).rejects.toThrow();

    const listener = abortListener(add);
    expect(listener).toBeDefined();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('rejected body.cancel() on a locked stream keeps the abort forwarder', async () => {
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
    const reader = response.body!.getReader();
    await expect(response.body!.cancel('nope')).rejects.toThrow();
    expect(wasRemoved(remove, listener)).toBe(false);

    // The reader still owns a live body, so a later abort must reach the fetch.
    external.abort();
    expect(internal.signal.aborted).toBe(true);

    await reader.cancel().catch(() => {});
    add.mockRestore();
    remove.mockRestore();
  });

  test('non-terminal reader.read() rejection keeps the abort forwarder', async () => {
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
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = abortListener(add);
    const reader = response.body!.getReader({ mode: 'byob' });
    // A zero-length view rejects the read but leaves the stream readable.
    await expect(reader.read(new Uint8Array(0))).rejects.toThrow();
    expect(wasRemoved(remove, listener)).toBe(false);

    const { value } = await reader.read(new Uint8Array(payload.byteLength));
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');

    add.mockRestore();
    remove.mockRestore();
  });

  test('detaches when the request controller is aborted directly', async () => {
    // Never-ending body: only the controller abort can end this request.
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });

    const external = new AbortController();
    const { add, remove } = spyAbortSignal(external.signal);
    const internal = new AbortController();

    await client.fetchWithTimeout('http://localhost:5000/foo', { signal: external.signal }, 30_000, internal);

    const listener = abortListener(add);
    expect(wasRemoved(remove, listener)).toBe(false);

    // Documented escape hatch for raw streams: `stream.controller.abort()`.
    internal.abort();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('clears the stored cleanup hook once the body is done', async () => {
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
    const internal = new AbortController();
    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    expect(typeof (response as any)[CLEANUP_HOOK]).toBe('function');
    await response.json();
    // The hook captured the caller's signal — it must not outlive the body.
    expect((response as any)[CLEANUP_HOOK]).toBeUndefined();
  });

  test('keeps forwarding until both clone() branches are consumed', async () => {
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
    const cloned = response.clone();

    await response.json();
    expect(wasRemoved(remove, listener)).toBe(false);

    await cloned.json();
    expect(wasRemoved(remove, listener)).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });

  test('does not build a synthetic body for null-body statuses', async () => {
    const iterableBody = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: true as const, value: undefined };
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
          ok: false,
          status: 304,
          statusText: 'Not Modified',
          headers: new Headers(),
          body: iterableBody,
          url: 'http://localhost:5000/foo',
          redirected: false,
          type: 'basic',
        }) as unknown as Response,
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

    // `new Response(body, { status: 304 })` would throw, so the original stands.
    expect(response.status).toBe(304);
    expect(response.body).toBe(iterableBody);
    expect(wasRemoved(remove, abortListener(add))).toBe(true);

    add.mockRestore();
    remove.mockRestore();
  });
});
