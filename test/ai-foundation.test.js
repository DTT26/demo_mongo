'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAiController } = require('../src/controllers/ai.controller');
const { createAiRouter } = require('../src/routes/ai.routes');

const startTestServer = async (controller) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createAiRouter(controller));

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/api/v1/ai`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const withServer = async (callback, controller) => {
  const server = await startTestServer(controller);
  try {
    await callback(server.url);
  } finally {
    await server.close();
  }
};

test.beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.AI_MOCK_ENABLED = 'true';
});

test.after(() => {
  delete process.env.AI_MOCK_ENABLED;
});

test('GET /health returns the phase 10 provider status and tool availability', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.provider, 'openai');
    assert.equal(body.data.phase, 10);
    assert.equal(body.data.mockEnabled, true);
    assert.equal(body.data.publicToolsEnabled, true);
    assert.equal(body.data.customerDynamicToolsEnabled, true);
    assert.equal(body.data.availabilityToolEnabled, true);
    assert.equal(body.data.voucherToolEnabled, true);
    assert.equal(body.data.bookingPreviewToolEnabled, true);
    assert.equal(body.data.bookingConfirmEnabled, true);
    assert.equal(body.data.knowledgeSearchEnabled, true);
    assert.equal(body.data.ownerToolsEnabled, true);
    assert.equal(body.data.adminToolsEnabled, true);
    assert.equal(body.data.toolTimeoutMs, 10000);
    assert.equal(body.data.maxToolRounds, 3);
    assert.equal(body.data.maxToolCalls, 5);
    assert.deepEqual(body.data.budgets, { dailyEnabled: false, monthlyEnabled: false });
    assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
  });
});

test('POST /mock-chat trims the message and returns a mock response', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/mock-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '  Xin chào BookEat  ' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      message: 'BookEat đã nhận: Xin chào BookEat',
      provider: 'mock',
    });
    assert.ok(body.requestId);
  });
});

test('POST /mock-chat rejects missing, empty, non-string, long, and binary messages', async (t) => {
  const cases = [
    { name: 'missing', body: {} },
    { name: 'empty', body: { message: '   ' } },
    { name: 'non-string', body: { message: 42 } },
    { name: 'too long', body: { message: 'a'.repeat(2001) } },
  ];

  await withServer(async (url) => {
    for (const item of cases) {
      await t.test(item.name, async () => {
        const response = await fetch(`${url}/mock-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body),
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.equal(body.code, 'INVALID_REQUEST');
        assert.ok(body.requestId);
      });
    }

    await t.test('binary payload', async () => {
      const response = await fetch(`${url}/mock-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from([0, 1, 2, 3]),
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.code, 'INVALID_REQUEST');
    });
  });
});

test('POST /mock-chat returns a safe 500 envelope when the service throws', async () => {
  const controller = createAiController({
    mockService: {
      createMockReply() {
        throw new Error('secret stack detail');
      },
    },
  });

  await withServer(async (url) => {
    const response = await fetch(`${url}/mock-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Xin chào' }),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.code, 'AI_INTERNAL_ERROR');
    assert.equal(JSON.stringify(body).includes('secret stack detail'), false);
    assert.equal(Object.hasOwn(body, 'stack'), false);
  }, controller);
});

test('mock endpoint can be disabled by environment configuration', async () => {
  process.env.AI_MOCK_ENABLED = 'false';

  await withServer(async (url) => {
    const healthResponse = await fetch(`${url}/health`);
    const healthBody = await healthResponse.json();
    assert.equal(healthBody.data.enabled, false);

    const response = await fetch(`${url}/mock-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Xin chào' }),
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, 'AI_MOCK_DISABLED');
  });
});
