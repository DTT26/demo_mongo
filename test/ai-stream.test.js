'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { getAiConfig, AiConfigError } = require('../src/config/ai.config');
const { createAiController } = require('../src/controllers/ai.controller');
const { createAiRouter, createOptionalAiUserMiddleware } = require('../src/routes/ai.routes');
const { createAiOrchestrator } = require('../src/services/ai/ai-orchestrator.service');
const { AiProviderError, createOpenAiProvider } = require('../src/services/ai/ai-provider.service');

const createConfig = (overrides = {}) => ({
  enabled: true,
  apiKey: 'test-key-not-real',
  model: 'gpt-test',
  timeoutMs: 100,
  maxInputChars: 2000,
  maxHistoryMessages: 8,
  maxOutputTokens: 100,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 10,
  publicToolsEnabled: true,
  availabilityToolEnabled: true,
  voucherToolEnabled: true,
  bookingPreviewToolEnabled: true,
  pendingActionTtlMinutes: 10,
  maxToolRounds: 3,
  maxToolCalls: 5,
  ...overrides,
});

const parseSse = (text) => text
  .split(/\r?\n\r?\n/)
  .filter(Boolean)
  .map((block) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
    return { event, data: JSON.parse(data) };
  });

const startTestServer = async ({
  controller,
  configProvider,
  rateLimiter,
  optionalUser,
} = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createAiRouter(controller, { configProvider, rateLimiter, optionalUser }));

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/api/v1/ai`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const withServer = async (options, callback) => {
  const server = await startTestServer(options);
  try {
    await callback(server.url);
  } finally {
    await server.close();
  }
};

const postStream = (url, body, options = {}) => fetch(`${url}/chat/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  ...options,
});

test('AI config validates model and numeric limits without exposing the key', () => {
  const config = getAiConfig({
    AI_ENABLED: 'true',
    OPENAI_API_KEY: 'super-secret-key',
    OPENAI_MODEL: 'gpt-test',
    OPENAI_TIMEOUT_MS: '5000',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.timeoutMs, 5000);
  assert.equal(JSON.stringify({ ...config, apiKey: '[redacted]' }).includes('super-secret-key'), false);
  assert.throws(
    () => getAiConfig({ OPENAI_MODEL: 'not a valid model', OPENAI_TIMEOUT_MS: '5000' }),
    AiConfigError,
  );
  assert.throws(
    () => getAiConfig({ OPENAI_MODEL: 'gpt-test', OPENAI_TIMEOUT_MS: 'fast' }),
    AiConfigError,
  );
});

test('OpenAI provider converts official Responses API events to text events', async () => {
  let requestBody;
  let requestOptions;
  const provider = createOpenAiProvider({
    clientFactory: () => ({
      responses: {
        async create(body, options) {
          requestBody = body;
          requestOptions = options;
          return (async function* fakeOpenAiStream() {
            yield { type: 'response.output_text.delta', delta: 'Xin' };
            yield { type: 'response.output_text.delta', delta: ' chào' };
            yield {
              type: 'response.completed',
              response: { usage: { input_tokens: 5, output_tokens: 2 } },
            };
          }());
        },
      },
    }),
  });

  const events = [];
  for await (const event of provider.streamText({
    instructions: 'Text only',
    input: [{ role: 'user', content: 'Hello' }],
    config: createConfig(),
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, [
    { type: 'delta', text: 'Xin' },
    { type: 'delta', text: ' chào' },
    { type: 'completed', usage: { inputTokens: 5, outputTokens: 2 } },
  ]);
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.store, false);
  assert.equal(Object.hasOwn(requestBody, 'tools'), false);
  assert.ok(requestOptions.signal);
});

test('text-only fake provider is serialized to ordered SSE events and trims history', async () => {
  let providerRequest;
  const provider = {
    async *streamText(request) {
      providerRequest = request;
      yield { type: 'delta', text: 'Xin' };
      yield { type: 'delta', text: ' chào' };
      yield { type: 'completed', usage: { inputTokens: 10, outputTokens: 2 } };
    },
  };
  const config = createConfig({ maxHistoryMessages: 2 });
  const configProvider = () => config;
  const orchestrator = createAiOrchestrator({ provider, configProvider });
  const controller = createAiController({ orchestrator, configProvider });

  await withServer({ controller, configProvider }, async (url) => {
    const response = await postStream(url, {
      message: 'Bạn giúp gì được?',
      history: [
        { role: 'user', content: 'Bỏ qua' },
        { role: 'assistant', content: 'Tin gần' },
        { role: 'user', content: 'Tin mới' },
      ],
    });
    const events = parseSse(await response.text());

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    assert.deepEqual(events.map((event) => event.event), [
      'start', 'delta', 'delta', 'completed', 'done',
    ]);
    assert.deepEqual(events.map((event) => event.data.sequence), [0, 1, 2, 3, 4]);
    assert.equal(events[1].data.text + events[2].data.text, 'Xin chào');
    assert.deepEqual(providerRequest.input.slice(0, 2), [
      { role: 'assistant', content: 'Tin gần' },
      { role: 'user', content: 'Tin mới' },
    ]);
    assert.match(providerRequest.instructions, /public tools/i);
    assert.match(providerRequest.instructions, /Khong tao booking/i);
  });
});

test('invalid message and history return a safe 400 JSON envelope', async () => {
  const config = createConfig();
  const configProvider = () => config;
  const controller = createAiController({ configProvider });

  await withServer({ controller, configProvider }, async (url) => {
    const cases = [
      { message: '' },
      { message: 'Hello', history: 'invalid' },
      { message: 'Hello', history: [{ role: 'system', content: 'No' }] },
      { message: 'Hello', history: [{ role: 'user', content: '' }] },
    ];

    for (const body of cases) {
      const response = await postStream(url, body);
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.equal(payload.code, 'INVALID_REQUEST');
      assert.ok(payload.requestId);
    }
  });
});

test('disabled AI and missing key return safe 503 errors without opening SSE', async () => {
  for (const config of [
    createConfig({ enabled: false }),
    createConfig({ apiKey: '' }),
  ]) {
    const configProvider = () => config;
    const controller = createAiController({ configProvider });
    await withServer({ controller, configProvider }, async (url) => {
      const response = await postStream(url, { message: 'Hello' });
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.code, 'AI_DISABLED');
      assert.equal(JSON.stringify(body).includes('apiKey'), false);
    });
  }
});

test('invalid bearer token returns 401 before opening an AI stream', async () => {
  const config = createConfig();
  const configProvider = () => config;
  const orchestrator = {
    async *streamChat() {
      throw new Error('stream should not start');
    },
  };
  const controller = createAiController({ orchestrator, configProvider });
  const optionalUser = createOptionalAiUserMiddleware({
    tokenVerifier() {
      const error = new Error('bad token');
      error.name = 'JsonWebTokenError';
      throw error;
    },
    userModel: {
      findById() {
        throw new Error('user lookup should not run');
      },
    },
  });

  await withServer({ controller, configProvider, optionalUser }, async (url) => {
    const response = await postStream(url, { message: 'Hello' }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token',
      },
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(response.headers.get('content-type').includes('application/json'), true);
  });
});

test('provider timeout is emitted as a safe SSE error followed by done', async () => {
  const config = createConfig({ timeoutMs: 25 });
  const provider = {
    async *streamText({ signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('private timeout detail')), { once: true });
      });
      yield { type: 'delta', text: 'never' };
    },
  };
  const configProvider = () => config;
  const orchestrator = createAiOrchestrator({ provider, configProvider });
  const controller = createAiController({ orchestrator, configProvider });

  await withServer({ controller, configProvider }, async (url) => {
    const response = await postStream(url, { message: 'Hello' });
    const text = await response.text();
    const events = parseSse(text);

    assert.deepEqual(events.map((event) => event.event), ['start', 'error', 'done']);
    assert.equal(events[1].data.code, 'AI_TIMEOUT');
    assert.equal(events[1].data.retryable, true);
    assert.equal(text.includes('private timeout detail'), false);
  });
});

test('provider unavailable before output can fall back to explicit mock public stream', async (t) => {
  const previousMockEnabled = process.env.AI_MOCK_ENABLED;
  process.env.AI_MOCK_ENABLED = 'true';
  t.after(() => {
    if (previousMockEnabled === undefined) delete process.env.AI_MOCK_ENABLED;
    else process.env.AI_MOCK_ENABLED = previousMockEnabled;
  });

  const config = createConfig();
  const configProvider = () => config;
  const orchestrator = {
    async *streamChat() {
      throw new AiProviderError('AI_UNAVAILABLE', {
        cause: { code: 'insufficient_quota', type: 'insufficient_quota' },
      });
    },
  };
  const mockService = {
    async *streamMockChat() {
      yield { type: 'delta', text: 'fallback public data' };
      yield { type: 'completed', usage: { fallback: 'mock-public-tools' } };
    },
  };
  const controller = createAiController({
    orchestrator,
    configProvider,
    mockService,
  });

  await withServer({ controller, configProvider }, async (url) => {
    const response = await postStream(url, { message: 'Tim nha hang pho' });
    const events = parseSse(await response.text());

    assert.deepEqual(events.map((event) => event.event), ['start', 'delta', 'completed', 'done']);
    assert.equal(events[1].data.text, 'fallback public data');
    assert.equal(events.some((event) => event.event === 'error'), false);
  });
});

test('AI stream route applies its own rate limit', async () => {
  const config = createConfig({ rateLimitMaxRequests: 1 });
  const configProvider = () => config;
  const orchestrator = {
    async *streamChat() {
      yield { type: 'completed', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  const controller = createAiController({ orchestrator, configProvider });

  await withServer({ controller, configProvider }, async (url) => {
    const first = await postStream(url, { message: 'First' });
    assert.equal(first.status, 200);
    await first.text();

    const second = await postStream(url, { message: 'Second' });
    const body = await second.json();
    assert.equal(second.status, 429);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.ok(Number(second.headers.get('retry-after')) >= 1);
  });
});

test('client disconnect aborts provider work', async () => {
  let providerAborted = false;
  let resolveAbort;
  const aborted = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  const config = createConfig({ timeoutMs: 2000 });
  const provider = {
    async *streamText({ signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          providerAborted = true;
          resolveAbort();
          reject(new Error('client disconnected'));
        }, { once: true });
      });
      yield { type: 'delta', text: 'never' };
    },
  };
  const configProvider = () => config;
  const orchestrator = createAiOrchestrator({ provider, configProvider });
  const controller = createAiController({ orchestrator, configProvider });

  await withServer({ controller, configProvider }, async (url) => {
    const abortController = new AbortController();
    const response = await postStream(url, { message: 'Hello' }, { signal: abortController.signal });
    const reader = response.body.getReader();
    await reader.read();
    abortController.abort();
    await Promise.race([
      aborted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('abort cleanup timed out')), 1000)),
    ]);
    assert.equal(providerAborted, true);
  });
});

test('real OpenAI smoke test is opt-in', {
  skip: process.env.RUN_OPENAI_SMOKE !== 'true' || !process.env.OPENAI_API_KEY,
}, async () => {
  const config = getAiConfig({
    ...process.env,
    AI_ENABLED: 'true',
  });
  const orchestrator = createAiOrchestrator({ configProvider: () => config });
  let text = '';
  for await (const event of orchestrator.streamChat({
    message: 'Trả lời đúng một từ: chào',
    history: [],
    signal: new AbortController().signal,
    config,
  })) {
    if (event.type === 'delta') text += event.text;
  }
  assert.ok(text.trim());
});
