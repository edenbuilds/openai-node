// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIPromise } from 'openai/core/api-promise';

import util from 'node:util';
import OpenAI from 'openai';
import { APIUserAbortError } from 'openai';
const defaultFetch = fetch;

describe('instantiate client', () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  describe('defaultHeaders', () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      defaultHeaders: { 'X-My-Default-Header': '2' },
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
    });

    test('they are used in the request', async () => {
      const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
      expect(req.headers.get('x-my-default-header')).toEqual('2');
    });

    test('can ignore `undefined` and leave the default', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': undefined },
      });
      expect(req.headers.get('x-my-default-header')).toEqual('2');
    });

    test('can be removed with `null`', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        headers: { 'X-My-Default-Header': null },
      });
      expect(req.headers.has('x-my-default-header')).toBe(false);
    });

    test('preserves Headers defaultHeaders when OPENAI_CUSTOM_HEADERS is set', async () => {
      process.env['OPENAI_CUSTOM_HEADERS'] = 'X-Env-Header: env\nX-My-Default-Header: env-default';

      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultHeaders: new Headers({ 'X-My-Default-Header': '2' }),
        apiKey: 'My API Key',
      });

      const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
      expect(req.headers.get('x-env-header')).toEqual('env');
      expect(req.headers.get('x-my-default-header')).toEqual('2');
    });

    test('preserves tuple defaultHeaders when OPENAI_CUSTOM_HEADERS is set', async () => {
      process.env['OPENAI_CUSTOM_HEADERS'] = 'X-Env-Header: env';

      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultHeaders: [['X-Tuple-Header', 'tuple']],
        apiKey: 'My API Key',
      });

      const { req } = await client.buildRequest({ path: '/foo', method: 'post' });
      expect(req.headers.get('x-env-header')).toEqual('env');
      expect(req.headers.get('x-tuple-header')).toEqual('tuple');
    });
  });
  describe('logging', () => {
    const env = process.env;

    beforeEach(() => {
      process.env = { ...env };
      process.env['OPENAI_LOG'] = undefined;
    });

    afterEach(() => {
      process.env = env;
    });

    const forceAPIResponseForClient = async (client: OpenAI) => {
      await new APIPromise(
        client,
        Promise.resolve({
          response: new Response(),
          controller: new AbortController(),
          requestLogID: 'log_000000',
          retryOfRequestLogID: undefined,
          startTime: Date.now(),
          options: {
            method: 'get',
            path: '/',
          },
        }),
      );
    };

    test('debug logs when log level is debug', async () => {
      const debugMock = jest.fn();
      const logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const client = new OpenAI({
        logger: logger,
        logLevel: 'debug',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      await forceAPIResponseForClient(client);
      expect(debugMock).toHaveBeenCalled();
    });

    test('default logLevel is warn', async () => {
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.logLevel).toBe('warn');
    });

    test('debug logs are skipped when log level is info', async () => {
      const debugMock = jest.fn();
      const logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const client = new OpenAI({
        logger: logger,
        logLevel: 'info',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      await forceAPIResponseForClient(client);
      expect(debugMock).not.toHaveBeenCalled();
    });

    test('debug logs happen with debug env var', async () => {
      const debugMock = jest.fn();
      const logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      process.env['OPENAI_LOG'] = 'debug';
      const client = new OpenAI({
        logger: logger,
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.logLevel).toBe('debug');

      await forceAPIResponseForClient(client);
      expect(debugMock).toHaveBeenCalled();
    });

    test('warn when env var level is invalid', async () => {
      const warnMock = jest.fn();
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: warnMock,
        error: jest.fn(),
      };

      process.env['OPENAI_LOG'] = 'not a log level';
      const client = new OpenAI({
        logger: logger,
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.logLevel).toBe('warn');
      expect(warnMock).toHaveBeenCalledWith(
        'process.env[\'OPENAI_LOG\'] was set to "not a log level", expected one of ["off","error","warn","info","debug"]',
      );
    });

    test('client log level overrides env var', async () => {
      const debugMock = jest.fn();
      const logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      process.env['OPENAI_LOG'] = 'debug';
      const client = new OpenAI({
        logger: logger,
        logLevel: 'off',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      await forceAPIResponseForClient(client);
      expect(debugMock).not.toHaveBeenCalled();
    });

    test('no warning logged for invalid env var level + valid client level', async () => {
      const warnMock = jest.fn();
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: warnMock,
        error: jest.fn(),
      };

      process.env['OPENAI_LOG'] = 'not a log level';
      const client = new OpenAI({
        logger: logger,
        logLevel: 'debug',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.logLevel).toBe('debug');
      expect(warnMock).not.toHaveBeenCalled();
    });
  });

  describe('defaultQuery', () => {
    test('with null query params given', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo' },
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/foo?apiVersion=foo');
    });

    test('multiple default query params', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { apiVersion: 'foo', hello: 'world' },
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/foo?apiVersion=foo&hello=world');
    });

    test('overriding with `undefined`', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultQuery: { hello: 'world' },
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.buildURL('/foo', { hello: undefined })).toEqual('http://localhost:5000/foo');
    });
  });

  test('custom fetch', async () => {
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: (url) => {
        return Promise.resolve(
          new Response(JSON.stringify({ url, custom: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    });

    const response = await client.get('/foo');
    expect(response).toEqual({ url: 'http://localhost:5000/foo', custom: true });
  });

  test('explicit global fetch', async () => {
    // make sure the global fetch type is assignable to our Fetch type
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: defaultFetch,
    });
  });

  test('custom signal', async () => {
    const client = new OpenAI({
      baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: (...args) => {
        return new Promise((resolve, reject) =>
          setTimeout(
            () =>
              defaultFetch(...args)
                .then(resolve)
                .catch(reject),
            300,
          ),
        );
      },
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const spy = jest.spyOn(client, 'request');

    await expect(client.get('/foo', { signal: controller.signal })).rejects.toThrowError(APIUserAbortError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('removes abort signal listener after the response body is fully read', async () => {
    // Regression for openai/openai-node#1811: leave the abort forwarder active
    // until the body ends (so streaming aborts still work), then detach so
    // AbortSignal.timeout() does not keep Deno alive for the full timeout.
    const testFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
    });

    const external = new AbortController();
    const addSpy = jest.spyOn(external.signal, 'addEventListener');
    const removeSpy = jest.spyOn(external.signal, 'removeEventListener');
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = addSpy.mock.calls.find((call) => call[0] === 'abort')?.[1];
    expect(listener).toBeDefined();
    // Still attached after headers (body not consumed yet)
    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(false);

    await response.json();

    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('detaches abort listener after response.json() when body hooks are bypassed', async () => {
    // Regression for Deno/Body: response.json() may drain via private readers and
    // never call the public body.getReader property. parse still detaches.
    const rawJson = Response.prototype.json;
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async () => {
        const response = new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
        // Simulate a runtime where Body.json does not go through getReader.
        Object.defineProperty(response, 'json', {
          configurable: true,
          value: async function (this: Response) {
            // Read without using our patched getReader path by restoring prototype
            // temporarily on a clone's internal… simplest: use arrayBuffer then parse.
            const buf = await Response.prototype.arrayBuffer.call(this);
            return JSON.parse(new TextDecoder().decode(buf));
          },
        });
        return response;
      },
    });

    const external = new AbortController();
    const addSpy = jest.spyOn(external.signal, 'addEventListener');
    const removeSpy = jest.spyOn(external.signal, 'removeEventListener');
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = addSpy.mock.calls.find((call) => call[0] === 'abort')?.[1];
    // After our wrapper json() which finally-cleans
    await response.json();
    // parse path would also call releaseAbortCleanup (Symbol/WeakMap internal)
    const { releaseAbortCleanup } = require('../src/internal/abort-signal-cleanup');
    releaseAbortCleanup(response);

    expect(listener).toBeDefined();
    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
    void rawJson;
  });

  test('detaches abort listener after native for-await consumption', async () => {
    // Regression: ReadableStreamToAsyncIterable prefers body[Symbol.asyncIterator]
    // and never calls getReader when present. Stream finish must still cleanup.
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
    const addSpy = jest.spyOn(external.signal, 'addEventListener');
    const removeSpy = jest.spyOn(external.signal, 'removeEventListener');
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = addSpy.mock.calls.find((call) => call[0] === 'abort')?.[1];
    expect(listener).toBeDefined();
    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(false);

    // Consume via native async iteration (same path as SSE streaming on Node).
    for await (const _chunk of response.body as AsyncIterable<Uint8Array>) {
      // drain
    }

    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('detaches abort listener immediately for Content-Length: 0 JSON bodies', async () => {
    // defaultParseResponse returns without reading the body when Content-Length is 0,
    // so we must detach even though response.body can be non-null.
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
    const addSpy = jest.spyOn(external.signal, 'addEventListener');
    const removeSpy = jest.spyOn(external.signal, 'removeEventListener');
    const internal = new AbortController();

    const response = await client.fetchWithTimeout(
      'http://localhost:5000/foo',
      { signal: external.signal },
      30_000,
      internal,
    );

    const listener = addSpy.mock.calls.find((call) => call[0] === 'abort')?.[1];
    expect(listener).toBeDefined();
    expect(
      removeSpy.mock.calls.some((call) => call[0] === 'abort' && call[1] === listener),
    ).toBe(true);
    // Original response identity preserved (no synthetic wrapper).
    expect(response.headers.get('content-length')).toBe('0');

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('preserves response identity and supports BYOB readers when a signal is used', async () => {
    const payload = new TextEncoder().encode('{"ok":true}');
    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: async (url) => {
        // Real fetch sets url; synthetic Response from `new Response` has empty url
        // and we must still return THAT object (not a wrapper), so .asResponse metadata
        // and getReader({ mode: 'byob' }) keep working.
        return new Response(payload, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
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
    expect(response.headers.get('content-type')).toContain('application/json');

    // Byte-stream/BYOB: native fetch bodies support this; wrapping in a default
    // ReadableStream would throw. Keep the original body so this works.
    const buf = new Uint8Array(payload.byteLength);
    const reader = response.body!.getReader({ mode: 'byob' });
    const { done, value } = await reader.read(buf);
    expect(done).toBe(false);
    expect(value).toBeDefined();
    expect(new TextDecoder().decode(value)).toBe('{"ok":true}');
    const rest = await reader.read(new Uint8Array(1));
    expect(rest.done).toBe(true);
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
    // Forwarder should still have aborted the internal controller for the body.
    expect(internal.signal.aborted).toBe(true);
    resolveBody(new TextEncoder().encode('{"ok":true}'));
    // Drain so the body cleanup path can run without hanging the test process.
    await response.text().catch(() => {});
  });

  test('normalized method', async () => {
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      capturedRequest = init;
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
    });

    await client.patch('/foo');
    expect(capturedRequest?.method).toEqual('PATCH');
  });

  test('explains undici dispatcher and fetch version mismatch', async () => {
    const undiciError = Object.assign(new Error('invalid onRequestStart method'), {
      name: 'InvalidArgumentError',
      code: 'UND_ERR_INVALID_ARG',
    });
    const fetchError = new TypeError('fetch failed');
    (fetchError as any).cause = undiciError;

    const client = new OpenAI({
      baseURL: 'http://localhost:5000/',
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      maxRetries: 0,
      fetch: async () => {
        throw fetchError;
      },
      fetchOptions: {
        dispatcher: { dispatch() {} },
      } as any,
    });

    await expect(client.get('/foo')).rejects.toThrow(
      "If you are using undici's ProxyAgent, pass the fetch implementation from the same undici package",
    );

    try {
      await client.get('/foo');
      throw new Error('expected request to fail');
    } catch (error) {
      expect((error as any).cause).toBe(fetchError);
    }
  });

  describe('baseUrl', () => {
    test('trailing slash', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/custom/path/',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    test('no trailing slash', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/custom/path',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.buildURL('/foo', null)).toEqual('http://localhost:5000/custom/path/foo');
    });

    afterEach(() => {
      process.env['OPENAI_BASE_URL'] = undefined;
    });

    test('explicit option', () => {
      const client = new OpenAI({
        baseURL: 'https://example.com',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });
      expect(client.baseURL).toEqual('https://example.com');
    });

    test('env variable', () => {
      process.env['OPENAI_BASE_URL'] = 'https://example.com/from_env';
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.baseURL).toEqual('https://example.com/from_env');
    });

    test('empty env variable', () => {
      process.env['OPENAI_BASE_URL'] = ''; // empty
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.baseURL).toEqual('https://api.openai.com/v1');
    });

    test('blank env variable', () => {
      process.env['OPENAI_BASE_URL'] = '  '; // blank
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.baseURL).toEqual('https://api.openai.com/v1');
    });

    test('in request options', () => {
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.buildURL('/foo', null, 'http://localhost:5000/option')).toEqual(
        'http://localhost:5000/option/foo',
      );
    });

    test('in request options overridden by client options', () => {
      const client = new OpenAI({
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
        baseURL: 'http://localhost:5000/client',
      });
      expect(client.buildURL('/foo', null, 'http://localhost:5000/option')).toEqual(
        'http://localhost:5000/client/foo',
      );
    });

    test('in request options overridden by env variable', () => {
      process.env['OPENAI_BASE_URL'] = 'http://localhost:5000/env';
      const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
      expect(client.buildURL('/foo', null, 'http://localhost:5000/option')).toEqual(
        'http://localhost:5000/env/foo',
      );
    });
  });

  test('maxRetries option is correctly set', () => {
    const client = new OpenAI({
      maxRetries: 4,
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
    });
    expect(client.maxRetries).toEqual(4);

    // default
    const client2 = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
    expect(client2.maxRetries).toEqual(2);
  });

  describe('withOptions', () => {
    test('creates a new client with overridden options', async () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        maxRetries: 3,
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      const newClient = client.withOptions({
        maxRetries: 5,
        baseURL: 'http://localhost:5001/',
      });

      // Verify the new client has updated options
      expect(newClient.maxRetries).toEqual(5);
      expect(newClient.baseURL).toEqual('http://localhost:5001/');

      // Verify the original client is unchanged
      expect(client.maxRetries).toEqual(3);
      expect(client.baseURL).toEqual('http://localhost:5000/');

      // Verify it's a different instance
      expect(newClient).not.toBe(client);
      expect(newClient.constructor).toBe(client.constructor);
    });

    test('inherits options from the parent client', async () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        defaultHeaders: { 'X-Test-Header': 'test-value' },
        defaultQuery: { 'test-param': 'test-value' },
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      const newClient = client.withOptions({
        baseURL: 'http://localhost:5001/',
      });

      // Test inherited options remain the same
      expect(newClient.buildURL('/foo', null)).toEqual('http://localhost:5001/foo?test-param=test-value');

      const { req } = await newClient.buildRequest({ path: '/foo', method: 'get' });
      expect(req.headers.get('x-test-header')).toEqual('test-value');
    });

    test('respects runtime property changes when creating new client', () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        timeout: 1000,
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      // Modify the client properties directly after creation
      client.baseURL = 'http://localhost:6000/';
      client.timeout = 2000;

      // Create a new client with withOptions
      const newClient = client.withOptions({
        maxRetries: 10,
      });

      // Verify the new client uses the updated properties, not the original ones
      expect(newClient.baseURL).toEqual('http://localhost:6000/');
      expect(newClient.timeout).toEqual(2000);
      expect(newClient.maxRetries).toEqual(10);

      // Original client should still have its modified properties
      expect(client.baseURL).toEqual('http://localhost:6000/');
      expect(client.timeout).toEqual(2000);
      expect(client.maxRetries).not.toEqual(10);

      // Verify URL building uses the updated baseURL
      expect(newClient.buildURL('/bar', null)).toEqual('http://localhost:6000/bar');
    });
  });

  test('with environment variable arguments', () => {
    // set options via env var
    process.env['OPENAI_API_KEY'] = 'My API Key';
    process.env['OPENAI_ADMIN_KEY'] = 'My Admin API Key';
    const client = new OpenAI();
    expect(client.apiKey).toBe('My API Key');
    expect(client.adminAPIKey).toBe('My Admin API Key');
  });

  test('with overridden environment variable arguments', () => {
    // set options via env var
    process.env['OPENAI_API_KEY'] = 'another My API Key';
    process.env['OPENAI_ADMIN_KEY'] = 'another My Admin API Key';
    const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });
    expect(client.apiKey).toBe('My API Key');
    expect(client.adminAPIKey).toBe('My Admin API Key');
  });
});

describe('request building', () => {
  const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });

  describe('custom headers', () => {
    test('handles undefined', async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        body: { value: 'hello' },
        headers: { 'X-Foo': 'baz', 'x-foo': 'bar', 'x-Foo': undefined, 'x-baz': 'bam', 'X-Baz': null },
      });
      expect(req.headers.get('x-foo')).toEqual('bar');
      expect(req.headers.get('x-Foo')).toEqual('bar');
      expect(req.headers.get('X-Foo')).toEqual('bar');
      expect(req.headers.get('x-baz')).toEqual(null);
    });
  });
});

describe('default encoder', () => {
  const client = new OpenAI({ apiKey: 'My API Key', adminAPIKey: 'My Admin API Key' });

  class Serializable {
    toJSON() {
      return { $type: 'Serializable' };
    }
  }
  class Collection<T> {
    #things: T[];
    constructor(things: T[]) {
      this.#things = Array.from(things);
    }
    toJSON() {
      return Array.from(this.#things);
    }
    [Symbol.iterator]() {
      return this.#things[Symbol.iterator];
    }
  }
  for (const jsonValue of [{}, [], { __proto__: null }, new Serializable(), new Collection(['item'])]) {
    test(`serializes ${util.inspect(jsonValue)} as json`, async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        body: jsonValue,
      });
      expect(req.headers).toBeInstanceOf(Headers);
      expect(req.headers.get('content-type')).toEqual('application/json');
      expect(req.body).toBe(JSON.stringify(jsonValue));
    });
  }

  test('keeps content-type for omitted optional request bodies', async () => {
    const { req } = await client.buildRequest({
      path: '/foo',
      method: 'post',
      body: undefined,
    });

    expect(req.headers).toBeInstanceOf(Headers);
    expect(req.headers.get('content-type')).toEqual('application/json');
    expect(req.body).toBe(undefined);
  });

  test('does not serialize null optional request bodies', async () => {
    const { req } = await client.buildRequest({
      path: '/foo',
      method: 'post',
      body: null,
    });

    expect(req.headers).toBeInstanceOf(Headers);
    expect(req.headers.get('content-type')).toEqual(null);
    expect(req.body).toBe(undefined);
  });

  const encoder = new TextEncoder();
  const asyncIterable = (async function* () {
    yield encoder.encode('a\n');
    yield encoder.encode('b\n');
    yield encoder.encode('c\n');
  })();
  for (const streamValue of [
    [encoder.encode('a\nb\nc\n')][Symbol.iterator](),
    new Response('a\nb\nc\n').body,
    asyncIterable,
  ]) {
    test(`converts ${util.inspect(streamValue)} to ReadableStream`, async () => {
      const { req } = await client.buildRequest({
        path: '/foo',
        method: 'post',
        body: streamValue,
      });
      expect(req.headers).toBeInstanceOf(Headers);
      expect(req.headers.get('content-type')).toEqual(null);
      expect(req.body).toBeInstanceOf(ReadableStream);
      expect(await new Response(req.body).text()).toBe('a\nb\nc\n');
    });
  }

  test(`can set content-type for ReadableStream`, async () => {
    const { req } = await client.buildRequest({
      path: '/foo',
      method: 'post',
      body: new Response('a\nb\nc\n').body,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(req.headers).toBeInstanceOf(Headers);
    expect(req.headers.get('content-type')).toEqual('text/plain');
    expect(req.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(req.body).text()).toBe('a\nb\nc\n');
  });
});

describe('retries', () => {
  test('retry on timeout', async () => {
    let count = 0;
    const testFetch = async (
      url: string | URL | Request,
      { signal }: RequestInit = {},
    ): Promise<Response> => {
      if (count++ === 0) {
        return new Promise((resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('timed out'))),
        );
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      timeout: 10,
      fetch: testFetch,
    });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });

  test('does not retry streaming request bodies', async () => {
    let count = 0;
    const testFetch = async (url: string | URL | Request, { body }: RequestInit = {}): Promise<Response> => {
      count++;
      expect(body).toBeInstanceOf(ReadableStream);
      await new Response(body).text();
      return new Response(undefined, { status: 429 });
    };

    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
      maxRetries: 2,
    });

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed-content'));
        controller.close();
      },
    });

    await expect(client.request({ path: '/foo', method: 'post', body })).rejects.toMatchObject({
      status: 429,
    });
    expect(count).toEqual(1);
  });

  test('retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
      maxRetries: 4,
    });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });

    expect((capturedRequest!.headers as Headers).get('x-stainless-retry-count')).toEqual('2');
    expect(count).toEqual(3);
  });

  test('omit retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
      maxRetries: 4,
    });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
        headers: { 'X-Stainless-Retry-Count': null },
      }),
    ).toEqual({ a: 1 });

    expect((capturedRequest!.headers as Headers).has('x-stainless-retry-count')).toBe(false);
  });

  test('omit retry count header by default', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
      maxRetries: 4,
      defaultHeaders: { 'X-Stainless-Retry-Count': null },
    });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
      }),
    ).toEqual({ a: 1 });

    expect(capturedRequest!.headers as Headers).not.toHaveProperty('x-stainless-retry-count');
  });

  test('overwrite retry count header', async () => {
    let count = 0;
    let capturedRequest: RequestInit | undefined;
    const testFetch = async (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      count++;
      if (count <= 2) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      capturedRequest = init;
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };
    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
      maxRetries: 4,
    });

    expect(
      await client.request({
        path: '/foo',
        method: 'get',
        headers: { 'X-Stainless-Retry-Count': '42' },
      }),
    ).toEqual({ a: 1 });

    expect((capturedRequest!.headers as Headers).get('x-stainless-retry-count')).toEqual('42');
  });

  test('retry on 429 with retry-after', async () => {
    let count = 0;
    const testFetch = async (
      url: string | URL | Request,
      { signal }: RequestInit = {},
    ): Promise<Response> => {
      if (count++ === 0) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After': '0.1',
          },
        });
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
    });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });

  test('retry on 429 with retry-after-ms', async () => {
    let count = 0;
    const testFetch = async (
      url: string | URL | Request,
      { signal }: RequestInit = {},
    ): Promise<Response> => {
      if (count++ === 0) {
        return new Response(undefined, {
          status: 429,
          headers: {
            'Retry-After-Ms': '10',
          },
        });
      }
      return new Response(JSON.stringify({ a: 1 }), { headers: { 'Content-Type': 'application/json' } });
    };

    const client = new OpenAI({
      apiKey: 'My API Key',
      adminAPIKey: 'My Admin API Key',
      fetch: testFetch,
    });

    expect(await client.request({ path: '/foo', method: 'get' })).toEqual({ a: 1 });
    expect(count).toEqual(2);
    expect(
      await client
        .request({ path: '/foo', method: 'get' })
        .asResponse()
        .then((r) => r.text()),
    ).toEqual(JSON.stringify({ a: 1 }));
    expect(count).toEqual(3);
  });

  describe('auth', () => {
    test('apiKey', async () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: 'My API Key',
      });
      const { req } = await client.buildRequest({ path: '/foo', method: 'get' });
      expect(req.headers.get('authorization')).toEqual('Bearer My API Key');
    });

    test('apiKey and adminAPIKey use route-specific auth', async () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      const bearer = await client.buildRequest({
        path: '/responses',
        method: 'post',
        __security: { bearerAuth: true },
      });
      expect(bearer.req.headers.get('authorization')).toEqual('Bearer My API Key');

      const admin = await client.buildRequest({
        path: '/organization/projects',
        method: 'get',
        __security: { adminAPIKeyAuth: true },
      });
      expect(admin.req.headers.get('authorization')).toEqual('Bearer My Admin API Key');
    });

    test('defaults to bearer auth when both apiKey and adminAPIKey are configured', async () => {
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: 'My API Key',
        adminAPIKey: 'My Admin API Key',
      });

      const { req } = await client.buildRequest({ path: '/foo', method: 'get' });
      expect(req.headers.get('authorization')).toEqual('Bearer My API Key');
    });

    test('does not resolve apiKey provider for admin-only requests', async () => {
      const testFetch = async (url: any, { headers }: RequestInit = {}): Promise<Response> => {
        return new Response(JSON.stringify({}), { headers: headers ?? [] });
      };
      const apiKey = jest.fn(async () => {
        throw new Error('should not be called');
      });
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey,
        adminAPIKey: 'My Admin API Key',
        fetch: testFetch,
      });

      const response = await client
        .request({
          path: '/organization/projects',
          method: 'get',
          __security: { adminAPIKeyAuth: true },
        })
        .asResponse();

      expect(apiKey).not.toHaveBeenCalled();
      expect(response.headers.get('authorization')).toEqual('Bearer My Admin API Key');
    });

    test('checkpoint permission routes use admin auth', async () => {
      const testFetch = async (url: any, { headers }: RequestInit = {}): Promise<Response> => {
        return new Response(JSON.stringify({}), { headers: headers ?? [] });
      };
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: null,
        adminAPIKey: 'My Admin API Key',
        fetch: testFetch,
      });

      const response = await client.fineTuning.checkpoints.permissions
        .retrieve('ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd')
        .asResponse();

      expect(response.headers.get('authorization')).toEqual('Bearer My Admin API Key');
    });

    test('adminAPIKey only', async () => {
      delete process.env['OPENAI_API_KEY'];

      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: null,
        adminAPIKey: 'My Admin API Key',
      });

      const admin = await client.buildRequest({
        path: '/organization/projects',
        method: 'get',
        __security: { adminAPIKeyAuth: true },
      });
      expect(admin.req.headers.get('authorization')).toEqual('Bearer My Admin API Key');

      await expect(
        client.buildRequest({
          path: '/responses',
          method: 'post',
          __security: { bearerAuth: true },
        }),
      ).rejects.toThrow(/Could not resolve authentication method/);
    });

    test('token', async () => {
      const testFetch = async (url: any, { headers }: RequestInit = {}): Promise<Response> => {
        return new Response(JSON.stringify({}), { headers: headers ?? [] });
      };
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey: async () => 'my token',
        fetch: testFetch,
      });
      expect(
        (await client.request({ method: 'post', path: 'https://example.com' }).asResponse()).headers.get(
          'authorization',
        ),
      ).toEqual('Bearer my token');
    });

    test('token is refreshed', async () => {
      let fail = true;
      const testFetch = async (url: any, { headers }: RequestInit = {}): Promise<Response> => {
        if (fail) {
          fail = false;
          return new Response(undefined, {
            status: 429,
            headers: {
              'Retry-After': '0.1',
            },
          });
        }
        return new Response(JSON.stringify({}), {
          headers: headers ?? [],
        });
      };
      let counter = 0;
      async function apiKey() {
        return `token-${counter++}`;
      }
      const client = new OpenAI({
        baseURL: 'http://localhost:5000/',
        apiKey,
        fetch: testFetch,
      });
      expect(
        (
          await client.chat.completions
            .create({
              model: '',
              messages: [{ role: 'system', content: 'Hello' }],
            })
            .asResponse()
        ).headers.get('authorization'),
      ).toEqual('Bearer token-1');
    });

    test('at least one', () => {
      delete process.env['OPENAI_API_KEY'];
      delete process.env['OPENAI_ADMIN_KEY'];

      expect(
        () =>
          new OpenAI({
            baseURL: 'http://localhost:5000/',
          }),
      ).toThrow(
        new Error(
          'Missing credentials. Please pass an `apiKey`, `workloadIdentity`, `adminAPIKey`, or set the `OPENAI_API_KEY` or `OPENAI_ADMIN_KEY` environment variable.',
        ),
      );
    });
  });
});
