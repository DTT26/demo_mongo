'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adminToolMetadata,
  createAiToolRegistry,
} = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');
const { ADMIN_SYSTEM_INSTRUCTIONS, buildPrompt } = require('../src/services/ai/ai-prompt-builder');
const { createAdminTools } = require('../src/services/ai/tools/admin.tools');
const { createAdminAiQueryService } = require('../src/services/ai/admin-ai-query.service');

const adminId = '507f1f77bcf86cd7994390aa';
const customerId = '507f1f77bcf86cd7994390bb';
const ownerId = '507f1f77bcf86cd7994390cc';
const paymentId = '507f1f77bcf86cd7994390dd';
const refundId = '507f1f77bcf86cd7994390ee';
const restaurantId = '507f1f77bcf86cd7994390ff';

const createAdminOnlyRegistry = (handlers) => createAiToolRegistry({
  handlers,
  metadata: adminToolMetadata,
  flags: { adminToolsEnabled: true },
});

test('admin metadata is read-only, admin-scoped, and exposed with strict schemas', () => {
  const registry = createAdminOnlyRegistry(createAdminTools({
    adminQuery: {
      getPendingRestaurants: async () => ({}),
      getTransactions: async () => ({}),
      getRefunds: async () => ({}),
      getRevenueSummary: async () => ({}),
      detectAbnormalActivity: async () => ({}),
      draftComplaintReply: async () => ({}),
    },
  }));

  assert.deepEqual(registry.getToolNames().sort(), [
    'admin_detect_abnormal_activity',
    'admin_draft_complaint_reply',
    'admin_get_pending_restaurants',
    'admin_get_refunds',
    'admin_get_revenue_summary',
    'admin_get_transactions',
  ]);
  for (const tool of registry.listTools()) {
    assert.equal(tool.access, 'admin');
    assert.equal(tool.effect, 'read');
    assert.deepEqual(tool.allowedRoles, ['admin']);
    assert.equal(tool.schema.additionalProperties, false);
  }
  assert.equal(registry.getToolDefinitions().length, 6);
});

test('admin can call every Phase 9 admin tool successfully through the runner', async () => {
  const audits = [];
  const handlers = createAdminTools({
    adminQuery: {
      getPendingRestaurants: async () => ({
        type: 'admin_pending_restaurants',
        version: 1,
        payload: { total: 0, restaurants: [], sourceLabel: 'BookEat admin restaurants' },
      }),
      getTransactions: async () => ({
        type: 'admin_transaction_summary',
        version: 1,
        payload: {
          dateFrom: '2026-06-18',
          dateTo: '2026-06-18',
          totalTransactions: 0,
          totalAmount: 0,
          byStatus: {},
          currency: 'VND',
          sourceLabel: 'BookEat admin transactions',
        },
      }),
      getRefunds: async () => ({
        type: 'admin_refund_summary',
        version: 1,
        payload: {
          dateFrom: '2026-06-18',
          dateTo: '2026-06-18',
          totalRefunds: 0,
          totalAmount: 0,
          byStatus: {},
          items: [],
          currency: 'VND',
          sourceLabel: 'BookEat admin refunds',
        },
      }),
      getRevenueSummary: async () => ({
        type: 'admin_revenue_summary',
        version: 1,
        payload: {
          dateFrom: '2026-06-18',
          dateTo: '2026-06-18',
          grossRevenue: 0,
          platformFee: 0,
          restaurantPayout: 0,
          currency: 'VND',
          sourceLabel: 'BookEat admin revenue',
        },
      }),
      detectAbnormalActivity: async () => ({
        type: 'admin_abnormal_activity',
        version: 1,
        payload: {
          dateFrom: '2026-06-18',
          dateTo: '2026-06-18',
          signals: [],
          sourceLabel: 'BookEat admin anomaly scan',
        },
      }),
      draftComplaintReply: async () => ({
        type: 'admin_draft_reply',
        version: 1,
        payload: {
          subjectType: 'complaint',
          tone: 'supportive_professional',
          draftReply: 'Draft only.',
          disclaimer: 'Day chi la ban nhap, chua duoc gui.',
          sourceLabel: 'BookEat admin draft reply',
        },
      }),
    },
  });
  const runner = createAiToolRunner({
    registry: createAdminOnlyRegistry(handlers),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });
  const calls = [
    ['admin_get_pending_restaurants', { query: null, limit: null }, 'admin_pending_restaurants'],
    ['admin_get_transactions', { dateFrom: null, dateTo: null, status: null, query: null }, 'admin_transaction_summary'],
    ['admin_get_refunds', { dateFrom: null, dateTo: null, status: null, query: null, limit: null }, 'admin_refund_summary'],
    ['admin_get_revenue_summary', { dateFrom: null, dateTo: null }, 'admin_revenue_summary'],
    ['admin_detect_abnormal_activity', { dateFrom: null, dateTo: null }, 'admin_abnormal_activity'],
    ['admin_draft_complaint_reply', { complaintText: 'Need reply', tone: null, subjectType: null }, 'admin_draft_reply'],
  ];

  for (const [toolName, rawArguments, expectedType] of calls) {
    const result = await runner.runToolCall({
      toolName,
      rawArguments,
      requestId: `req-${toolName}`,
      user: { _id: adminId, role: 'admin' },
      adminContext: { mode: 'admin_assistant' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.type, expectedType);
  }
  assert.deepEqual(audits.map((item) => item.status), calls.map(() => 'success'));
});

test('admin tool runner passes JWT admin actor and never trusts admin identity from args', async () => {
  const audits = [];
  let captured;
  const handlers = createAdminTools({
    adminQuery: {
      async getTransactions(params) {
        captured = params;
        return {
          type: 'admin_transaction_summary',
          version: 1,
          payload: {
            dateFrom: '2026-06-01',
            dateTo: '2026-06-18',
            totalTransactions: 0,
            totalAmount: 0,
            byStatus: {},
            currency: 'VND',
            sourceLabel: 'BookEat admin transactions',
          },
        };
      },
    },
  });
  const runner = createAiToolRunner({
    registry: createAdminOnlyRegistry(handlers),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'admin_get_transactions',
    rawArguments: { dateFrom: null, dateTo: null, status: null, query: null },
    requestId: 'req-admin-ok',
    user: { _id: adminId, role: 'admin' },
    adminContext: { mode: 'admin_assistant' },
  });

  assert.equal(result.ok, true);
  assert.equal(captured.adminId, adminId);
  assert.equal(captured.role, 'admin');
  assert.equal(Object.hasOwn(captured, 'ownerId'), false);
  assert.equal(Object.hasOwn(captured, 'restaurantId'), false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'success');
  assert.equal(audits[0].role, 'admin');
});

test('guest, customer, and owner cannot call admin tools', async () => {
  const audits = [];
  let handlerCalled = false;
  const runner = createAiToolRunner({
    registry: createAdminOnlyRegistry({
      admin_get_transactions: async () => {
        handlerCalled = true;
        return {};
      },
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });
  const rawArguments = { dateFrom: null, dateTo: null, status: null, query: null };

  const guest = await runner.runToolCall({
    toolName: 'admin_get_transactions',
    rawArguments,
    requestId: 'req-admin-guest',
    user: null,
    adminContext: { mode: 'admin_assistant' },
  });
  const customer = await runner.runToolCall({
    toolName: 'admin_get_transactions',
    rawArguments,
    requestId: 'req-admin-customer',
    user: { _id: customerId, role: 'customer' },
    adminContext: { mode: 'admin_assistant' },
  });
  const owner = await runner.runToolCall({
    toolName: 'admin_get_transactions',
    rawArguments,
    requestId: 'req-admin-owner',
    user: { _id: ownerId, role: 'restaurant_owner' },
    adminContext: { mode: 'admin_assistant' },
  });

  assert.equal(guest.ok, false);
  assert.equal(guest.errorCode, 'AUTH_REQUIRED');
  assert.equal(customer.ok, false);
  assert.equal(customer.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(owner.ok, false);
  assert.equal(owner.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(handlerCalled, false);
  assert.deepEqual(audits.map((item) => item.status), ['forbidden', 'forbidden', 'forbidden']);
});

test('prompt injection mutation fields are rejected before admin handler runs', async () => {
  const audits = [];
  let handlerCalled = false;
  const runner = createAiToolRunner({
    registry: createAdminOnlyRegistry({
      admin_get_transactions: async () => {
        handlerCalled = true;
        return {};
      },
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'admin_get_transactions',
    rawArguments: {
      dateFrom: null,
      dateTo: null,
      status: null,
      query: null,
      approveRestaurant: true,
      paymentId,
      orderCode: 'ORDER-SECRET',
    },
    requestId: 'req-admin-injection',
    user: { _id: adminId, role: 'admin' },
    adminContext: { mode: 'admin_assistant' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_INVALID_ARGUMENT');
  assert.equal(handlerCalled, false);
  assert.equal(audits[0].status, 'failed');
  assert.equal(audits[0].argsRedacted.paymentId, '[redacted]');
  assert.equal(audits[0].argsRedacted.orderCode, '[redacted]');
});

test('admin service returns projection-safe pending restaurants, transactions, and refunds', async () => {
  const service = createAdminAiQueryService({
    nowProvider: () => new Date('2026-06-18T04:00:00.000Z'),
    restaurantModel: {
      find: async () => [{
        _id: restaurantId,
        name: 'Pending Bistro',
        approvalStatus: 'pending',
        ownerId,
        phone: '0901234567',
        email: 'owner@example.com',
        businessLicense: 'license-secret',
        taxCode: 'tax-secret',
        bankInfo: { accountNumber: '123456789' },
        createdAt: new Date('2026-06-17T10:00:00.000Z'),
      }],
    },
    paymentModel: {
      find: async () => [{
        _id: paymentId,
        amount: 250000,
        currency: 'VND',
        status: 'paid',
        orderCode: 'ORDER-SECRET',
        paymentLinkId: 'plink-secret',
        checkoutUrl: 'https://pay.example/secret',
        qrCode: 'qr-secret',
        metadata: { card: '4111111111111111' },
        gatewayTransactionId: 'gateway-secret',
        createdAt: new Date('2026-06-18T01:00:00.000Z'),
      }],
    },
    refundModel: {
      find: async () => [{
        _id: refundId,
        paymentId,
        userId: customerId,
        amount: 50000,
        status: 'requested',
        reason: 'Call 0901234567, email customer@example.com, bank account issue',
        bankInfo: { accountNumber: '123456789' },
        gatewayRefundId: 'gateway-refund-secret',
        adminNote: 'private admin note',
        createdAt: new Date('2026-06-18T02:00:00.000Z'),
      }],
    },
  });

  const pending = await service.getPendingRestaurants({ adminId, role: 'admin', query: null, limit: 10 });
  const transactions = await service.getTransactions({
    adminId,
    role: 'admin',
    dateFrom: '2026-06-18',
    dateTo: '2026-06-18',
    status: null,
    query: null,
  });
  const refunds = await service.getRefunds({
    adminId,
    role: 'admin',
    dateFrom: '2026-06-18',
    dateTo: '2026-06-18',
    status: null,
    query: null,
    limit: 10,
  });
  const serialized = JSON.stringify({ pending, transactions, refunds });

  assert.equal(pending.type, 'admin_pending_restaurants');
  assert.equal(pending.payload.restaurants[0].ownerLabel, `Owner #${ownerId.slice(-4)}`);
  assert.equal(transactions.type, 'admin_transaction_summary');
  assert.equal(transactions.payload.totalTransactions, 1);
  assert.equal(transactions.payload.totalAmount, 250000);
  assert.equal(refunds.type, 'admin_refund_summary');
  assert.match(refunds.payload.items[0].reason, /\[redacted-phone\]/);
  assert.match(refunds.payload.items[0].reason, /\[redacted-email\]/);
  assert.match(refunds.payload.items[0].reason, /\[redacted-private\]/);

  assert.doesNotMatch(serialized, /0901234567/);
  assert.doesNotMatch(serialized, /owner@example\.com|customer@example\.com/);
  assert.doesNotMatch(serialized, /license-secret|tax-secret|123456789/);
  assert.doesNotMatch(serialized, /ORDER-SECRET|plink-secret|checkoutUrl|qr-secret|gateway-secret/);
  assert.doesNotMatch(serialized, /private admin note|gateway-refund-secret/);
  assert.doesNotMatch(serialized, new RegExp(paymentId));
});

test('admin revenue and abnormal activity return aggregate-only data', async () => {
  const service = createAdminAiQueryService({
    nowProvider: () => new Date('2026-06-18T04:00:00.000Z'),
    paymentModel: {
      find: async () => [
        { _id: paymentId, amount: 100000, currency: 'VND', status: 'paid', createdAt: new Date('2026-06-18T01:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390d1', amount: 200000, currency: 'VND', status: 'failed', createdAt: new Date('2026-06-18T02:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390d2', amount: 100000, currency: 'VND', status: 'failed', createdAt: new Date('2026-06-18T03:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390d3', amount: 100000, currency: 'VND', status: 'failed', createdAt: new Date('2026-06-18T04:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390d4', amount: 100000, currency: 'VND', status: 'cancelled', createdAt: new Date('2026-06-18T05:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390d5', amount: 100000, currency: 'VND', status: 'expired', createdAt: new Date('2026-06-18T06:00:00.000Z') },
      ],
    },
    refundModel: {
      find: async () => [
        { _id: refundId, amount: 10000, status: 'requested', createdAt: new Date('2026-06-18T02:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390e1', amount: 10000, status: 'requested', createdAt: new Date('2026-06-18T02:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390e2', amount: 10000, status: 'requested', createdAt: new Date('2026-06-18T02:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390e3', amount: 10000, status: 'requested', createdAt: new Date('2026-06-18T02:00:00.000Z') },
        { _id: '507f1f77bcf86cd7994390e4', amount: 10000, status: 'requested', createdAt: new Date('2026-06-18T02:00:00.000Z') },
      ],
    },
    restaurantModel: {
      countDocuments: async () => 12,
    },
  });

  const revenue = await service.getRevenueSummary({
    adminId,
    role: 'admin',
    dateFrom: '2026-06-18',
    dateTo: '2026-06-18',
  });
  const abnormal = await service.detectAbnormalActivity({
    adminId,
    role: 'admin',
    dateFrom: '2026-06-18',
    dateTo: '2026-06-18',
  });
  const serialized = JSON.stringify({ revenue, abnormal });

  assert.equal(revenue.type, 'admin_revenue_summary');
  assert.equal(revenue.payload.grossRevenue, 700000);
  assert.equal(revenue.payload.platformFee, 70000);
  assert.equal(abnormal.type, 'admin_abnormal_activity');
  assert.ok(abnormal.payload.signals.some((signal) => signal.code === 'high_refund_rate'));
  assert.ok(abnormal.payload.signals.some((signal) => signal.code === 'payment_failures'));
  assert.ok(abnormal.payload.signals.some((signal) => signal.code === 'pending_restaurant_backlog'));
  assert.doesNotMatch(serialized, new RegExp(paymentId));
  assert.doesNotMatch(serialized, new RegExp(refundId));
});

test('admin complaint reply is draft-only and redacts complaint PII/payment hints', async () => {
  const audits = [];
  const runner = createAiToolRunner({
    registry: createAdminOnlyRegistry(createAdminTools({
      adminQuery: createAdminAiQueryService(),
    })),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });
  const result = await runner.runToolCall({
    toolName: 'admin_draft_complaint_reply',
    rawArguments: {
      complaintText: 'Khach 0901234567 email customer@example.com noi order ORD-123 va bank account bi loi',
      tone: 'apologetic',
      subjectType: 'refund',
    },
    requestId: 'req-admin-draft',
    user: { _id: adminId, role: 'admin' },
    adminContext: { mode: 'admin_assistant' },
  });
  const serialized = JSON.stringify(result.result);

  assert.equal(result.ok, true);
  assert.equal(result.result.type, 'admin_draft_reply');
  assert.match(result.result.payload.disclaimer, /chua duoc gui/i);
  assert.doesNotMatch(result.result.payload.draftReply, /da gui|da luu|approved|refunded/i);
  assert.doesNotMatch(serialized, /0901234567|customer@example\.com|ORD-123/);
  assert.match(serialized, /\[redacted-phone\]/);
  assert.match(serialized, /\[redacted-email\]/);
  assert.match(serialized, /\[redacted-private\]/);
  assert.equal(audits[0].argsRedacted.complaintText, '[redacted]');
});

test('admin prompt forbids dynamic RAG and mutation requests', () => {
  const prompt = buildPrompt({
    message: 'Duyet nha hang va refund thanh cong cho toi',
    history: [],
    pageContext: null,
    ownerContext: null,
    adminContext: { mode: 'admin_assistant' },
  });

  assert.equal(prompt.instructions, ADMIN_SYSTEM_INSTRUCTIONS);
  assert.match(prompt.instructions, /Khong dung search_knowledge\/RAG cho du lieu admin dong/);
  assert.match(prompt.instructions, /Khong approve\/reject nha hang/);
  assert.match(prompt.instructions, /khong refund/);
  assert.match(prompt.instructions, /khong mutate bat ky record nao/);
  assert.match(prompt.input[0].content, /BookEat admin context/);
});
