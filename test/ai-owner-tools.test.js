'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiToolRegistry, ownerToolMetadata } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');
const { createOwnerTools } = require('../src/services/ai/tools/owner.tools');
const { createOwnerAiQueryService } = require('../src/services/ai/owner-ai-query.service');

const ownerId = '507f1f77bcf86cd799439010';
const selectedRestaurantId = '507f1f77bcf86cd799439011';
const secondRestaurantId = '507f1f77bcf86cd799439021';
const foreignRestaurantId = '507f1f77bcf86cd799439099';
const reviewId = '507f1f77bcf86cd799439088';
const ownedRestaurant = {
  _id: selectedRestaurantId,
  name: 'Owner Bistro',
  ownerId,
};

const createOwnerOnlyRegistry = (handlers) => createAiToolRegistry({
  handlers,
  metadata: ownerToolMetadata,
  flags: { ownerToolsEnabled: true },
});

test('owner tool runner passes backend ownerContext selectedRestaurantId to owner handler', async () => {
  const audits = [];
  let captured;
  const handlers = createOwnerTools({
    ownerQuery: {
      async getTodayBookings(params) {
        captured = params;
        return {
          type: 'owner_booking_summary',
          version: 1,
          payload: {
            restaurant: { id: selectedRestaurantId, name: 'Owner Bistro' },
            date: '2026-06-18',
            total: 0,
            byStatus: {},
            upcoming: [],
            sourceLabel: 'BookEat owner bookings',
          },
        };
      },
    },
  });
  const runner = createAiToolRunner({
    registry: createOwnerOnlyRegistry(handlers),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments: { date: null, limit: null },
    requestId: 'req-owner-ok',
    user: { _id: ownerId, role: 'restaurant_owner' },
    ownerContext: { selectedRestaurantId },
  });

  assert.equal(result.ok, true);
  assert.equal(captured.ownerId, ownerId);
  assert.equal(captured.selectedRestaurantId, selectedRestaurantId);
  assert.equal(Object.hasOwn(captured, 'restaurantId'), false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'success');
  assert.equal(audits[0].role, 'restaurant_owner');
});

test('owner query service requires selectedRestaurantId before ownership lookup', async () => {
  let guardCalled = false;
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => {
      guardCalled = true;
      return ownedRestaurant;
    },
  });

  await assert.rejects(
    () => service.getTodayBookings({ ownerId, selectedRestaurantId: null }),
    (error) => error.code === 'SELECTED_RESTAURANT_REQUIRED',
  );
  assert.equal(guardCalled, false);
});

test('owner query service scopes data by selectedRestaurantId for multi-restaurant owners', async () => {
  const guardCalls = [];
  const service = createOwnerAiQueryService({
    ownershipGuard: async (guardOwnerId, restaurantId) => {
      guardCalls.push({ guardOwnerId, restaurantId });
      return {
        _id: restaurantId,
        name: restaurantId === selectedRestaurantId ? 'Owner Bistro A' : 'Owner Bistro B',
        ownerId,
      };
    },
    bookingModel: {
      find: (filter) => {
        const isA = filter.restaurantId === selectedRestaurantId;
        return Promise.resolve([{
          _id: isA ? '507f1f77bcf86cd7994390a1' : '507f1f77bcf86cd7994390b1',
          bookingDate: new Date('2026-06-18T00:00:00.000Z'),
          bookingTime: isA ? '18:00' : '20:00',
          numberOfGuests: isA ? 2 : 6,
          status: 'confirmed',
          customerName: isA ? 'Alice Nguyen' : 'Bao Tran',
          tableNumbers: [isA ? 'A1' : 'B2'],
        }]);
      },
    },
  });

  const resultA = await service.getTodayBookings({
    ownerId,
    selectedRestaurantId,
    date: '2026-06-18',
    limit: 5,
  });
  const resultB = await service.getTodayBookings({
    ownerId,
    selectedRestaurantId: secondRestaurantId,
    date: '2026-06-18',
    limit: 5,
  });

  assert.equal(resultA.payload.restaurant.id, selectedRestaurantId);
  assert.equal(resultA.payload.restaurant.name, 'Owner Bistro A');
  assert.equal(resultA.payload.upcoming[0].time, '18:00');
  assert.deepEqual(resultA.payload.upcoming[0].tableNumbers, ['A1']);
  assert.equal(resultB.payload.restaurant.id, secondRestaurantId);
  assert.equal(resultB.payload.restaurant.name, 'Owner Bistro B');
  assert.equal(resultB.payload.upcoming[0].time, '20:00');
  assert.deepEqual(resultB.payload.upcoming[0].tableNumbers, ['B2']);
  assert.deepEqual(guardCalls, [
    { guardOwnerId: ownerId, restaurantId: selectedRestaurantId },
    { guardOwnerId: ownerId, restaurantId: secondRestaurantId },
  ]);
});

test('owner aggregate tools switch revenue, voucher, and review data by selectedRestaurantId', async () => {
  const filters = {
    booking: [],
    voucher: [],
    review: [],
  };
  const service = createOwnerAiQueryService({
    ownershipGuard: async (guardOwnerId, restaurantId) => ({
      _id: restaurantId,
      name: restaurantId === selectedRestaurantId ? 'Owner Bistro A' : 'Owner Bistro B',
      ownerId: guardOwnerId,
    }),
    nowProvider: () => new Date('2026-06-18T04:00:00.000Z'),
    bookingModel: {
      find: (filter) => {
        filters.booking.push(filter);
        const isA = filter.restaurantId === selectedRestaurantId;
        return Promise.resolve([{
          _id: isA ? '507f1f77bcf86cd7994390c1' : '507f1f77bcf86cd7994390d1',
          depositPaid: true,
          depositAmount: isA ? 100000 : 300000,
          discountAmount: 0,
          status: 'confirmed',
          bookingDate: new Date('2026-06-18T00:00:00.000Z'),
        }]);
      },
    },
    voucherModel: {
      find: (filter) => {
        filters.voucher.push(filter);
        const isA = filter.restaurantId === selectedRestaurantId;
        return Promise.resolve(isA
          ? [{ _id: '507f1f77bcf86cd7994390e1', status: 'active', endDate: new Date('2026-07-01T00:00:00.000Z') }]
          : [{ _id: '507f1f77bcf86cd7994390e2', status: 'expired', endDate: new Date('2026-06-01T00:00:00.000Z') }]);
      },
    },
    voucherRedemptionModel: {
      find: async () => [],
    },
    reviewModel: {
      find: (filter) => {
        filters.review.push(filter);
        const isA = filter.restaurantId === selectedRestaurantId;
        return Promise.resolve([{
          _id: isA ? '507f1f77bcf86cd7994390f1' : '507f1f77bcf86cd7994390f2',
          rating: isA ? 5 : 2,
          comment: isA ? 'A review' : 'B review',
          ownerReply: { comment: null },
          createdAt: new Date('2026-06-18T03:00:00.000Z'),
        }]);
      },
    },
  });

  const revenueA = await service.getRevenueSummary({ ownerId, selectedRestaurantId });
  const revenueB = await service.getRevenueSummary({ ownerId, selectedRestaurantId: secondRestaurantId });
  const voucherA = await service.getVoucherSummary({ ownerId, selectedRestaurantId });
  const voucherB = await service.getVoucherSummary({ ownerId, selectedRestaurantId: secondRestaurantId });
  const reviewA = await service.getReviewSummary({ ownerId, selectedRestaurantId });
  const reviewB = await service.getReviewSummary({ ownerId, selectedRestaurantId: secondRestaurantId });

  assert.equal(revenueA.payload.grossRevenue, 100000);
  assert.equal(revenueB.payload.grossRevenue, 300000);
  assert.equal(voucherA.payload.activeCount, 1);
  assert.equal(voucherB.payload.expiredCount, 1);
  assert.equal(reviewA.payload.averageRating, 5);
  assert.equal(reviewB.payload.averageRating, 2);
  assert.deepEqual(filters.booking.map((filter) => filter.restaurantId), [selectedRestaurantId, secondRestaurantId]);
  assert.deepEqual(filters.voucher.map((filter) => filter.restaurantId), [selectedRestaurantId, secondRestaurantId]);
  assert.deepEqual(filters.review.map((filter) => filter.restaurantId), [selectedRestaurantId, secondRestaurantId]);
});

test('owner query service maps foreign restaurant ownership to OWNER_RESTAURANT_FORBIDDEN', async () => {
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => {
      const error = new Error('forbidden');
      error.status = 403;
      throw error;
    },
  });

  await assert.rejects(
    () => service.getTodayBookings({ ownerId, selectedRestaurantId: foreignRestaurantId }),
    (error) => error.code === 'OWNER_RESTAURANT_FORBIDDEN' && error.status === 'forbidden',
  );
});

test('guest, customer, and admin cannot call owner tools', async () => {
  const audits = [];
  let handlerCalled = false;
  const runner = createAiToolRunner({
    registry: createOwnerOnlyRegistry({
      owner_get_today_bookings: async () => {
        handlerCalled = true;
        return {};
      },
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });
  const rawArguments = { date: null, limit: null };

  const guest = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments,
    requestId: 'req-owner-guest',
    user: null,
    ownerContext: { selectedRestaurantId },
  });
  const customer = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments,
    requestId: 'req-owner-customer',
    user: { _id: '507f1f77bcf86cd799439012', role: 'customer' },
    ownerContext: { selectedRestaurantId },
  });
  const admin = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments,
    requestId: 'req-owner-admin',
    user: { _id: '507f1f77bcf86cd799439013', role: 'admin' },
    ownerContext: { selectedRestaurantId },
  });

  assert.equal(guest.ok, false);
  assert.equal(guest.errorCode, 'AUTH_REQUIRED');
  assert.equal(customer.ok, false);
  assert.equal(customer.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(admin.ok, false);
  assert.equal(admin.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(handlerCalled, false);
  assert.deepEqual(audits.map((item) => item.status), ['forbidden', 'forbidden', 'forbidden']);
});

test('prompt injection restaurantId in owner tool args is rejected by strict schema', async () => {
  let handlerCalled = false;
  const audits = [];
  const runner = createAiToolRunner({
    registry: createOwnerOnlyRegistry({
      owner_get_today_bookings: async () => {
        handlerCalled = true;
        return {};
      },
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments: {
      date: null,
      limit: null,
      restaurantId: foreignRestaurantId,
    },
    requestId: 'req-owner-injection',
    user: { _id: ownerId, role: 'restaurant_owner' },
    ownerContext: { selectedRestaurantId },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_INVALID_ARGUMENT');
  assert.equal(handlerCalled, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'failed');
});

test('owner search booking audit redacts phone and email query', async () => {
  const audits = [];
  const runner = createAiToolRunner({
    registry: createOwnerOnlyRegistry({
      owner_search_booking: async () => ({
        type: 'owner_booking_search_result',
        version: 1,
        payload: {
          restaurant: { id: selectedRestaurantId, name: 'Owner Bistro' },
          query: '[redacted]',
          total: 0,
          bookings: [],
          sourceLabel: 'BookEat owner booking search',
        },
      }),
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'owner_search_booking',
    rawArguments: {
      query: '0901234567 customer@example.com',
      status: null,
      dateFrom: null,
      dateTo: null,
      limit: null,
    },
    requestId: 'req-owner-redact',
    user: { _id: ownerId, role: 'restaurant_owner' },
    ownerContext: { selectedRestaurantId },
  });

  assert.equal(result.ok, true);
  assert.equal(audits[0].argsRedacted.query, '[redacted]');
});

test('owner audit redacts private payment, bank, order, voucher, and note fields', async () => {
  const audits = [];
  const runner = createAiToolRunner({
    registry: createOwnerOnlyRegistry({
      owner_get_today_bookings: async () => ({}),
    }),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'owner_get_today_bookings',
    rawArguments: {
      date: null,
      limit: null,
      customerId: '507f1f77bcf86cd799439066',
      voucherId: '507f1f77bcf86cd799439077',
      redemptionId: 'redemption-secret',
      internalNotes: 'private staff note',
      paymentId: 'payment-secret',
      bankInfo: { accountNumber: '123456789', accountHolder: 'Nguyen Van A' },
      orderId: 'order-secret',
      withdrawalId: 'withdrawal-secret',
    },
    requestId: 'req-owner-private-redact',
    user: { _id: ownerId, role: 'restaurant_owner' },
    ownerContext: { selectedRestaurantId },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_INVALID_ARGUMENT');
  assert.equal(audits[0].argsRedacted.customerId, '[redacted]');
  assert.equal(audits[0].argsRedacted.voucherId, '[redacted]');
  assert.equal(audits[0].argsRedacted.redemptionId, '[redacted]');
  assert.equal(audits[0].argsRedacted.internalNotes, '[redacted]');
  assert.equal(audits[0].argsRedacted.paymentId, '[redacted]');
  assert.equal(audits[0].argsRedacted.bankInfo, '[redacted]');
  assert.equal(audits[0].argsRedacted.orderId, '[redacted]');
  assert.equal(audits[0].argsRedacted.withdrawalId, '[redacted]');
});

test('owner booking projection does not leak raw customer PII or payment fields', async () => {
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => ownedRestaurant,
    bookingModel: {
      find: async () => [{
        _id: '507f1f77bcf86cd799439022',
        bookingDate: new Date('2026-06-18T00:00:00.000Z'),
        bookingTime: '19:00',
        numberOfGuests: 4,
        status: 'confirmed',
        customerName: 'Nguyen Van A',
        customerPhone: '0901234567',
        customerEmail: 'customer@example.com',
        specialRequests: 'secret allergy note',
        internalNotes: 'private staff note',
        paymentId: 'pay-secret',
        voucherId: 'voucher-secret',
        tableNumbers: ['A1'],
      }],
    },
  });

  const result = await service.getTodayBookings({
    ownerId,
    selectedRestaurantId,
    date: '2026-06-18',
    limit: 5,
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.type, 'owner_booking_summary');
  assert.equal(result.payload.upcoming[0].customerLabel, 'Nguyen A.');
  assert.match(serialized, /bookingId/);
  assert.doesNotMatch(serialized, /0901234567/);
  assert.doesNotMatch(serialized, /customer@example\.com/);
  assert.doesNotMatch(serialized, /secret allergy note/);
  assert.doesNotMatch(serialized, /private staff note/);
  assert.doesNotMatch(serialized, /pay-secret/);
  assert.doesNotMatch(serialized, /voucher-secret/);
});

test('owner booking projection does not expose contact-shaped customer labels', async () => {
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => ownedRestaurant,
    bookingModel: {
      find: async () => [{
        _id: '507f1f77bcf86cd799439022',
        bookingDate: new Date('2026-06-18T00:00:00.000Z'),
        bookingTime: '19:00',
        numberOfGuests: 4,
        status: 'confirmed',
        customerName: '0901234567',
        tableNumbers: ['A1'],
      }],
    },
  });

  const result = await service.getTodayBookings({
    ownerId,
    selectedRestaurantId,
    date: '2026-06-18',
    limit: 5,
  });

  assert.equal(result.payload.upcoming[0].customerLabel, 'Khach #9022');
  assert.doesNotMatch(JSON.stringify(result), /0901234567/);
});

test('owner review reply suggestion is draft-only and does not save owner reply', async () => {
  let saveCalled = false;
  const review = {
    _id: reviewId,
    rating: 2,
    comment: 'Service was slow and staff missed my request.',
    ownerReply: { comment: null, repliedAt: null },
    save: async () => {
      saveCalled = true;
    },
  };
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => ownedRestaurant,
    reviewModel: {
      findOne: () => ({
        select() {
          return this;
        },
        lean: async () => review,
      }),
    },
  });

  const result = await service.suggestReviewReply({
    ownerId,
    selectedRestaurantId,
    reviewId,
    tone: 'apologetic',
  });

  assert.equal(result.type, 'owner_review_reply_suggestion');
  assert.match(result.payload.disclaimer, /chua duoc gui/i);
  assert.equal(result.payload.tone, 'apologetic');
  assert.equal(saveCalled, false);
  assert.equal(review.ownerReply.comment, null);
});

test('owner review summary and reply draft redact contact details from review text', async () => {
  const contactReview = {
    _id: reviewId,
    rating: 5,
    comment: 'Mon ngon, goi toi 0901234567 hoac email customer@example.com nhe.',
    ownerReply: { comment: null },
    createdAt: new Date('2026-06-18T03:00:00.000Z'),
  };
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => ownedRestaurant,
    nowProvider: () => new Date('2026-06-18T04:00:00.000Z'),
    reviewModel: {
      find: async () => [contactReview],
      findOne: () => ({
        select() {
          return this;
        },
        lean: async () => contactReview,
      }),
    },
  });

  const summary = await service.getReviewSummary({
    ownerId,
    selectedRestaurantId,
    dateFrom: '2026-06-18',
    dateTo: '2026-06-18',
    limit: 5,
  });
  const draft = await service.suggestReviewReply({
    ownerId,
    selectedRestaurantId,
    reviewId,
    tone: 'warm_professional',
  });
  const serialized = JSON.stringify({ summary, draft });

  assert.match(summary.payload.latestReviews[0].content, /\[redacted-phone\]/);
  assert.match(summary.payload.latestReviews[0].content, /\[redacted-email\]/);
  assert.match(draft.payload.draftReply, /\[redacted-phone\]/);
  assert.match(draft.payload.draftReply, /\[redacted-email\]/);
  assert.doesNotMatch(serialized, /0901234567/);
  assert.doesNotMatch(serialized, /customer@example\.com/);
});

test('owner revenue summary clamps oversized date range to 90 days', async () => {
  const service = createOwnerAiQueryService({
    ownershipGuard: async () => ownedRestaurant,
    nowProvider: () => new Date('2026-06-18T04:00:00.000Z'),
    bookingModel: {
      find: async () => [],
    },
  });

  const result = await service.getRevenueSummary({
    ownerId,
    selectedRestaurantId,
    dateFrom: '2026-01-01',
    dateTo: '2026-06-18',
  });
  const fromTime = new Date(`${result.payload.dateFrom}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${result.payload.dateTo}T00:00:00.000Z`).getTime();
  const inclusiveDays = Math.floor((toTime - fromTime) / (24 * 60 * 60 * 1000)) + 1;

  assert.equal(result.type, 'owner_revenue_summary');
  assert.equal(result.payload.dateTo, '2026-06-18');
  assert.ok(inclusiveDays <= 90);
});
