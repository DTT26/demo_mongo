const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiController } = require('../src/controllers/ai.controller');
const { AiProviderError } = require('../src/services/ai/ai-provider.service');

const createResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    once(event, listener) {
      return this;
    },
    removeListener(event, listener) {
      return this;
    },
  };
  return res;
};

const createRequest = ({ user, body = {}, query = {}, params = {}, aiRequestId = 'req-123' } = {}) => ({
  user,
  body,
  query,
  params,
  aiRequestId,
  aiTelemetry: {},
});

test('AI Field Polish (Tối ưu bằng AI) Backend Test Suite', async (t) => {
  // Mock dependencies
  const mockConfigProvider = (enabled = true) => () => ({
    enabled,
    apiKey: 'mock-openai-key',
    groqApiKey: 'mock-groq-key',
    rateLimitMaxRequests: 20,
    rateLimitWindowMs: 60000,
  });

  const mockObservability = (budgetExceeded = false) => ({
    isBudgetExceeded: () => ({ exceeded: budgetExceeded }),
    recordRequest: () => ({ inputTokens: 10, outputTokens: 5, estimatedCost: 0.001 }),
  });

  const mockProviderSuccess = {
    async *streamText({ instructions, input, config, signal }) {
      yield { type: 'provider_status', providerUsed: 'openai', fallbackUsed: false };
      yield { type: 'delta', text: 'Nhà hàng phở truyền thống gia truyền' };
      yield { type: 'completed', usage: { prompt_tokens: 12, completion_tokens: 6 } };
    }
  };

  const mockProviderWithFallback = {
    async *streamText({ instructions, input, config, signal }) {
      // Simulate openai failing and falling back to groq
      yield { type: 'provider_status', providerUsed: 'groq', fallbackUsed: true, fallbackReason: 'AI_RATE_LIMITED' };
      yield { type: 'delta', text: 'Nhà hàng phở từ Groq' };
      yield { type: 'completed', usage: { prompt_tokens: 15, completion_tokens: 8 } };
    }
  };

  const mockProviderFailAll = {
    async *streamText({ instructions, input, config, signal }) {
      throw new AiProviderError('AI_UNAVAILABLE');
    }
  };

  await t.test('1. Tối ưu thành công với input hợp lệ', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
        context: { restaurantName: 'Phở ngon' },
        maxLength: 2000,
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.fieldKey, 'description');
    assert.equal(res.body.data.originalText, 'nhà hàng phở ngon lắm');
    assert.equal(res.body.data.polishedText, 'Nhà hàng phở truyền thống gia truyền');
    assert.equal(res.body.data.providerUsed, 'openai');
    assert.equal(res.body.data.fallbackUsed, false);
  });

  await t.test('2. Thất bại khi text rỗng hoặc quá ngắn', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: '  ',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_REQUEST');
  });

  await t.test('3. Thất bại khi fieldKey không nằm trong allowlist', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'secretKeyNotExist',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_REQUEST');
  });

  await t.test('4. Thất bại khi mode không phải restaurant_form', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'chat_bot',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_REQUEST');
  });

  await t.test('5. Chặn nội dung chứa thẻ script/HTML (Sanitization)', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'Phở ngon <script>alert("hack")</script>',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'INVALID_REQUEST');
  });

  await t.test('6. Thất bại khi vượt quá hạn mức chi phí (Budget Exceeded)', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(true), // budget exceeded
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 429);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'BUDGET_LIMITED');
  });

  await t.test('7. Thất bại khi AI bị tắt (AI Disabled)', async () => {
    const controller = createAiController({
      provider: mockProviderSuccess,
      configProvider: mockConfigProvider(false), // disabled
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_DISABLED');
  });

  await t.test('8. Tự động chuyển vùng sang Provider dự phòng (Fallback Provider)', async () => {
    const controller = createAiController({
      provider: mockProviderWithFallback,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.polishedText, 'Nhà hàng phở từ Groq');
    assert.equal(res.body.data.providerUsed, 'groq');
    assert.equal(res.body.data.fallbackUsed, true);
  });

  await t.test('9. Thất bại toàn bộ khi cả 2 provider lỗi', async () => {
    const controller = createAiController({
      provider: mockProviderFailAll,
      configProvider: mockConfigProvider(true),
      observability: mockObservability(false),
    });

    const req = createRequest({
      user: { role: 'owner', id: 'owner-1' },
      body: {
        fieldKey: 'description',
        text: 'nhà hàng phở ngon lắm',
        mode: 'restaurant_form',
      },
    });

    const res = createResponse();
    await controller.polishText(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
  });
});
