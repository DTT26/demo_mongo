'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { getAiConfig } = require('../src/config/ai.config');
const { createAiController } = require('../src/controllers/ai.controller');
const { createAiRouter } = require('../src/routes/ai.routes');
const { createAiObservabilityService } = require('../src/services/ai/ai-observability.service');
const { createAiOrchestrator } = require('../src/services/ai/ai-orchestrator.service');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');
const {
  AiProviderError,
  createAiProviderManager,
  createOpenAiProvider,
} = require('../src/services/ai/ai-provider.service');

const createConfig = (overrides = {}) => ({
  enabled: true,
  provider: 'openai',
  fallbackProvider: 'groq',
  providerFallbackEnabled: true,
  apiKey: 'openai-key',
  model: 'gpt-test',
  timeoutMs: 100,
  groqApiKey: 'groq-key',
  groqModel: 'openai/gpt-oss-120b',
  groqBaseUrl: 'https://api.groq.com/openai/v1',
  groqTimeoutMs: 100,
  maxInputChars: 2000,
  maxHistoryMessages: 8,
  maxOutputTokens: 100,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 10,
  dailyBudgetEstimate: 0,
  monthlyBudgetEstimate: 0,
  publicToolsEnabled: true,
  customerDynamicToolsEnabled: true,
  availabilityToolEnabled: true,
  voucherToolEnabled: true,
  bookingPreviewToolEnabled: true,
  bookingConfirmEnabled: true,
  knowledgeSearchEnabled: true,
  ownerToolsEnabled: true,
  adminToolsEnabled: true,
  pendingActionTtlMinutes: 10,
  maxToolRounds: 3,
  maxToolCalls: 5,
  toolTimeoutMs: 100,
  ...overrides,
});

const collectEvents = async (stream) => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createTextProvider = (providerName, text = providerName) => ({
  async *streamText() {
    yield { type: 'delta', text };
    yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
  },
});

const createFailingProvider = (error) => ({
  async *streamText() {
    throw error;
  },
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

const startServer = async ({
  controller,
  configProvider,
  observability,
} = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createAiRouter(controller, { configProvider, observability }));
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

const postStream = (url, body) => fetch(`${url}/chat/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('OpenAI configured uses OpenAI without Groq fallback', async () => {
  let groqCalled = false;
  const provider = createAiProviderManager({
    providers: {
      openai: createTextProvider('openai', 'openai-ok'),
      groq: {
        async *streamText() {
          groqCalled = true;
          yield { type: 'delta', text: 'groq-should-not-run' };
        },
      },
    },
  });

  const events = await collectEvents(provider.streamText({
    config: createConfig(),
    instructions: 'test',
    input: [{ role: 'user', content: 'hello' }],
    signal: new AbortController().signal,
  }));

  assert.equal(events.find((event) => event.type === 'delta').text, 'openai-ok');
  assert.equal(events.at(-1).providerUsed, 'openai');
  assert.equal(events.at(-1).fallbackUsed, false);
  assert.equal(groqCalled, false);
});

test('OpenAI missing key falls back to Groq before provider content', async () => {
  let openaiClientCreated = false;
  const provider = createAiProviderManager({
    providers: {
      openai: createOpenAiProvider({
        clientFactory: () => {
          openaiClientCreated = true;
          throw new Error('client should not be created without key');
        },
      }),
      groq: createTextProvider('groq', 'groq-ok'),
    },
  });

  const events = await collectEvents(provider.streamText({
    config: createConfig({ apiKey: '' }),
    instructions: 'test',
    input: [{ role: 'user', content: 'hello' }],
    signal: new AbortController().signal,
  }));

  assert.equal(openaiClientCreated, false);
  assert.equal(events.find((event) => event.type === 'delta').text, 'groq-ok');
  assert.equal(events.find((event) => event.fallbackUsed === true).providerUsed, 'groq');
  assert.equal(events.find((event) => event.fallbackUsed === true).fallbackReason, 'AI_AUTH_ERROR');
});

test('OpenAI rate limit and timeout before content fall back to Groq', async () => {
  for (const error of [
    Object.assign(new Error('quota exhausted'), { status: 429, code: 'insufficient_quota' }),
    new AiProviderError('AI_TIMEOUT'),
  ]) {
    const provider = createAiProviderManager({
      providers: {
        openai: createFailingProvider(error),
        groq: createTextProvider('groq', 'groq-fallback'),
      },
    });

    const events = await collectEvents(provider.streamText({
      config: createConfig(),
      instructions: 'test',
      input: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
    }));

    assert.equal(events.find((event) => event.type === 'delta').text, 'groq-fallback');
    assert.equal(events.find((event) => event.fallbackUsed === true).providerUsed, 'groq');
  }
});

test('provider manager does not switch provider after primary content has started', async () => {
  let groqCalled = false;
  const provider = createAiProviderManager({
    providers: {
      openai: {
        async *streamText() {
          yield { type: 'delta', text: 'partial' };
          throw new AiProviderError('AI_RATE_LIMITED');
        },
      },
      groq: {
        async *streamText() {
          groqCalled = true;
          yield { type: 'delta', text: 'late fallback' };
        },
      },
    },
  });

  await assert.rejects(
    collectEvents(provider.streamText({
      config: createConfig(),
      instructions: 'test',
      input: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
    })),
    (error) => error.code === 'AI_RATE_LIMITED',
  );
  assert.equal(groqCalled, false);
});

test('OpenAI fail and Groq fail returns safe AI_UNAVAILABLE stream error', async () => {
  const config = createConfig();
  const configProvider = () => config;
  const provider = createAiProviderManager({
    providers: {
      openai: createFailingProvider(new AiProviderError('AI_RATE_LIMITED')),
      groq: createFailingProvider(new AiProviderError('AI_UNAVAILABLE', {
        cause: new Error('private groq stack'),
      })),
    },
  });
  const orchestrator = createAiOrchestrator({ provider, configProvider });
  const controller = createAiController({ orchestrator, configProvider });
  const server = await startServer({ controller, configProvider });

  try {
    const response = await postStream(server.url, { message: 'Hello' });
    const text = await response.text();
    const events = parseSse(text);

    assert.deepEqual(events.map((event) => event.event), ['start', 'error', 'done']);
    assert.equal(events[1].data.code, 'AI_UNAVAILABLE');
    assert.equal(text.includes('private groq stack'), false);
  } finally {
    await server.close();
  }
});

test('fallback metrics record providerUsed groq and safe fallback reason', async () => {
  const observability = createAiObservabilityService();
  const config = createConfig({ apiKey: '' });
  const configProvider = () => config;
  const provider = createAiProviderManager({
    providers: {
      openai: createOpenAiProvider({ clientFactory: () => { throw new Error('should not run'); } }),
      groq: createTextProvider('groq', 'groq-ok'),
    },
  });
  const orchestrator = createAiOrchestrator({ provider, configProvider });
  const controller = createAiController({ orchestrator, configProvider, observability });
  const server = await startServer({ controller, configProvider, observability });

  try {
    const response = await postStream(server.url, { message: 'Hello' });
    const events = parseSse(await response.text());
    const snapshot = observability.getSnapshot();

    assert.equal(response.status, 200);
    assert.equal(events.find((event) => event.event === 'delta').data.text, 'groq-ok');
    assert.equal(snapshot.providers.byProvider.groq, 1);
    assert.equal(snapshot.fallbackCount, 1);
    assert.equal(snapshot.providers.fallbackByReason.AI_AUTH_ERROR, 1);
    assert.equal(snapshot.tokenUsage.byProvider.groq.inputTokens, 1);
    assert.equal(JSON.stringify(snapshot).includes('groq-key'), false);
  } finally {
    await server.close();
  }
});

test('health exposes fallback provider status without secrets', async () => {
  const configProvider = () => getAiConfig({
    AI_ENABLED: 'true',
    AI_PROVIDER: 'openai',
    AI_FALLBACK_PROVIDER: 'groq',
    AI_PROVIDER_FALLBACK_ENABLED: 'true',
    OPENAI_API_KEY: 'openai-secret',
    OPENAI_MODEL: 'gpt-test',
    GROQ_API_KEY: 'groq-secret',
    GROQ_MODEL: 'openai/gpt-oss-120b',
    GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
  });
  const controller = createAiController({ configProvider });
  const server = await startServer({ controller, configProvider });

  try {
    const response = await fetch(`${server.url}/health`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(body.data.primaryProvider, 'openai');
    assert.equal(body.data.fallbackProvider, 'groq');
    assert.equal(body.data.fallbackEnabled, true);
    assert.equal(body.data.openaiConfigured, true);
    assert.equal(body.data.groqConfigured, true);
    assert.equal(serialized.includes('openai-secret'), false);
    assert.equal(serialized.includes('groq-secret'), false);
  } finally {
    await server.close();
  }
});

test('tool calling still goes through permission guard and does not use fallback for forbidden tool result', async () => {
  let openaiCalls = 0;
  let groqCalled = false;
  const provider = createAiProviderManager({
    providers: {
      openai: {
        async *streamText() {
          openaiCalls += 1;
          if (openaiCalls === 1) {
            yield {
              type: 'function_call',
              call: {
                callId: 'call-voucher',
                name: 'validate_voucher',
                arguments: JSON.stringify({
                  code: 'SAVE10',
                  restaurantId: null,
                  orderAmountEstimate: 500000,
                }),
              },
            };
          }
          yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
        },
      },
      groq: {
        async *streamText() {
          groqCalled = true;
          yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
        },
      },
    },
  });
  const registry = createAiToolRegistry();
  const toolRunner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
  });
  const orchestrator = createAiOrchestrator({ provider, registry, toolRunner });
  const events = await collectEvents(orchestrator.streamChat({
    message: 'Check voucher SAVE10',
    history: [],
    requestId: 'req-permission',
    user: null,
    signal: new AbortController().signal,
    config: createConfig(),
  }));

  const completed = events.find((event) => event.type === 'tool_completed');
  assert.equal(completed.status, 'forbidden');
  assert.equal(completed.errorCode, 'AUTH_REQUIRED');
  assert.equal(groqCalled, false);
});

