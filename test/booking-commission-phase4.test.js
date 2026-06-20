const test = require('node:test');
const assert = require('node:assert/strict');

const BookingCommissionLedger = require('../src/models/BookingCommissionLedger');
const Subscription = require('../src/models/Subscription');
const Payment = require('../src/models/Payment');
const notificationService = require('../src/services/notification.service');
const emailService = require('../src/services/email.service');
const planGatingService = require('../src/services/plan-gating.service');
const bookingCommissionService = require('../src/services/booking-commission.service');
const bookingCommissionRules = require('../src/services/booking-commission-rules.service');
const ownerBookingController = require('../src/controllers/owner.booking.controller');
const adminPaymentController = require('../src/controllers/admin.payment.controller');

const OWNER_ID = '507f1f77bcf86cd799439011';
const RESTAURANT_ID = '507f1f77bcf86cd799439012';
const BOOKING_ID = '507f1f77bcf86cd799439013';

const restore = (target, original) => {
  Object.entries(original).forEach(([key, value]) => {
    target[key] = value;
  });
};

const createLedgerHarness = (planCode = 'free') => {
  const records = [];
  const ledgerModel = {
    async findOne(query) {
      return records.find((item) => String(item.bookingId) === String(query.bookingId)) || null;
    },
    async create(payload) {
      const ledger = { _id: `ledger-${records.length + 1}`, ...payload };
      records.push(ledger);
      return ledger;
    },
  };
  const restaurantModel = {
    findById() {
      return { select: async () => ({ _id: RESTAURANT_ID, ownerId: OWNER_ID, name: 'Phase 4 Bistro' }) };
    },
  };
  const service = bookingCommissionService.createBookingCommissionService({
    ledgerModel,
    restaurantModel,
    getEffectivePlan: async () => ({ planCode }),
    now: () => new Date('2026-06-20T12:00:00.000Z'),
  });
  const booking = {
    _id: BOOKING_ID,
    restaurantId: RESTAURANT_ID,
    status: 'completed',
    completedAt: new Date('2026-06-20T11:55:00.000Z'),
  };
  return { records, service, booking };
};

test('commission rules are backend-owned for Free, Plus and Pro', () => {
  assert.deepEqual(bookingCommissionRules.getBookingCommissionRule('free'), {
    planCode: 'free', type: 'fixed', amount: 5000, currency: 'VND',
  });
  assert.equal(bookingCommissionRules.getBookingCommissionRule('plus').amount, 2000);
  assert.equal(bookingCommissionRules.getBookingCommissionRule('pro').type, 'waived');
  assert.equal(bookingCommissionRules.getBookingCommissionRule('pro').amount, 0);
});

for (const [planCode, amount, status] of [
  ['free', 5000, 'billable'],
  ['plus', 2000, 'billable'],
  ['pro', 0, 'waived'],
]) {
  test(`${planCode} completed booking snapshots plan and creates ${amount} VND ledger`, async () => {
    const { records, service, booking } = createLedgerHarness(planCode);
    const result = await service.createLedgerForBooking(BOOKING_ID, { booking });

    assert.equal(result.created, true);
    assert.equal(records.length, 1);
    assert.equal(result.ledger.planCodeAtBooking, planCode);
    assert.equal(result.ledger.commissionAmount, amount);
    assert.equal(result.ledger.status, status);
    assert.equal(result.ledger.triggerStatus, 'completed');
  });
}

test('unknown or missing effective plan safely falls back to Free', async () => {
  const { service, booking } = createLedgerHarness('legacy-plan');
  const result = await service.createLedgerForBooking(BOOKING_ID, { booking });
  assert.equal(result.ledger.planCodeAtBooking, 'free');
  assert.equal(result.ledger.commissionAmount, 5000);
});

test('same booking is idempotent and returns the existing ledger', async () => {
  const { records, service, booking } = createLedgerHarness('plus');
  const first = await service.createLedgerForBooking(BOOKING_ID, { booking });
  const second = await service.createLedgerForBooking(BOOKING_ID, { booking });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.ledger._id, first.ledger._id);
  assert.equal(records.length, 1);
});

test('booking that is not completed does not create a ledger', async () => {
  const { records, service, booking } = createLedgerHarness('free');
  booking.status = 'confirmed';
  const result = await service.createLedgerForBooking(BOOKING_ID, { booking });
  assert.equal(result.skipped, 'BOOKING_NOT_COMPLETED');
  assert.equal(records.length, 0);
});

test('unique bookingId index is present at the database schema layer', () => {
  const indexes = BookingCommissionLedger.schema.indexes();
  const bookingIndex = indexes.find(([fields]) => fields.bookingId === 1);
  assert.ok(bookingIndex);
  assert.equal(bookingIndex[1].unique, true);
});

test('expired active subscription is expired and effective plan falls back to Free', async () => {
  const original = { findOne: Subscription.findOne };
  let saved = false;
  try {
    Subscription.findOne = () => ({
      sort: async () => ({
        status: 'active',
        planCode: 'pro',
        currentPeriodEnd: new Date('2025-01-01T00:00:00.000Z'),
        async save() { saved = true; },
      }),
    });
    const result = await planGatingService.getEffectivePlanForRestaurant(RESTAURANT_ID);
    assert.equal(result.planCode, 'free');
    assert.equal(saved, true);
  } finally {
    restore(Subscription, original);
  }
});

test('owner commission query is scoped by owner and rejects a foreign restaurant', async () => {
  let ledgerQueried = false;
  const ledgerModel = {
    aggregate: async () => { ledgerQueried = true; return []; },
    countDocuments: async () => 0,
    find: () => { ledgerQueried = true; throw new Error('Ledger must not be queried'); },
  };
  const restaurantModel = {
    findOne() {
      return { select: async () => null };
    },
  };
  const service = bookingCommissionService.createBookingCommissionService({ ledgerModel, restaurantModel });

  await assert.rejects(
    () => service.getOwnerCommissions(OWNER_ID, { restaurantId: RESTAURANT_ID }),
    (error) => error.code === 'OWNER_RESTAURANT_FORBIDDEN' && error.statusCode === 403
  );
  assert.equal(ledgerQueried, false);
});

test('admin commission summary separates projected, billable and paid amounts', async () => {
  const item = {
    _id: 'ledger-admin',
    bookingId: { _id: BOOKING_ID, bookingDate: new Date('2026-06-20T00:00:00.000Z'), bookingTime: '18:30' },
    restaurantId: { _id: RESTAURANT_ID, name: 'Phase 4 Bistro' },
    ownerId: { _id: OWNER_ID, fullName: 'Owner Phase 4' },
    planCodeAtBooking: 'free',
    commissionType: 'fixed',
    commissionAmount: 5000,
    currency: 'VND',
    status: 'billable',
    triggerStatus: 'completed',
    reason: 'Phase 4 test',
    createdAt: new Date('2026-06-20T12:00:00.000Z'),
  };
  const query = {
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    populate() { return this; },
    async lean() { return [item]; },
  };
  const ledgerModel = {
    aggregate: async () => [
      { _id: 'pending', total: 2000, count: 1 },
      { _id: 'billable', total: 5000, count: 1 },
      { _id: 'paid', total: 3000, count: 1 },
    ],
    countDocuments: async () => 3,
    find: () => query,
  };
  const service = bookingCommissionService.createBookingCommissionService({ ledgerModel });
  const result = await service.getAdminCommissionSummary({ page: 1, limit: 20 });

  assert.equal(result.summary.projectedCommission, 7000);
  assert.equal(result.summary.billableCommission, 5000);
  assert.equal(result.summary.paidCommission, 3000);
  assert.equal(result.summary.count, 3);
  assert.equal(result.items[0].ownerName, 'Owner Phase 4');
  assert.equal(result.items[0].restaurantName, 'Phase 4 Bistro');
});

test('owner completion creates ledger for regular and AI-origin bookings through the shared completion flow', async () => {
  const originalCommission = { createLedgerForBooking: bookingCommissionService.createLedgerForBooking };
  const originalNotification = { notifyBookingStatusChanged: notificationService.notifyBookingStatusChanged };
  const originalEmail = { sendBookingCompletedEmail: emailService.sendBookingCompletedEmail };
  const sources = [];

  try {
    bookingCommissionService.createLedgerForBooking = async (bookingId, options) => {
      sources.push({ bookingId, source: options.source });
      return { created: true };
    };
    notificationService.notifyBookingStatusChanged = async () => {};
    emailService.sendBookingCompletedEmail = async () => {};

    for (const sourceAiPendingActionId of [null, 'ai-action-1']) {
      const booking = {
        _id: sourceAiPendingActionId ? 'booking-ai' : 'booking-regular',
        customerId: OWNER_ID,
        restaurantId: RESTAURANT_ID,
        sourceAiPendingActionId,
        status: 'confirmed',
        statusHistory: [],
        async save() { return this; },
        toAdminJSON() { return { id: this._id, status: this.status }; },
      };
      const restaurant = {
        ownerId: OWNER_ID,
        stats: { completedBookings: 0 },
        async save() { return this; },
      };
      const req = {
        booking,
        restaurant,
        user: { _id: OWNER_ID },
        body: {},
        app: { get: () => null },
      };
      const res = {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
      };
      await ownerBookingController.completeBooking(req, res);
      assert.equal(res.payload.success, true);
    }

    assert.deepEqual(sources.map((item) => item.source), [
      'owner_booking_completed',
      'ai_booking_completed',
    ]);
  } finally {
    restore(bookingCommissionService, originalCommission);
    restore(notificationService, originalNotification);
    restore(emailService, originalEmail);
  }
});

test('admin paid revenue stays isolated from projected and billable booking commission', async () => {
  const originalPayment = { aggregate: Payment.aggregate };
  const originalSubscription = { countDocuments: Subscription.countDocuments };
  const originalLedger = { aggregate: BookingCommissionLedger.aggregate };
  const originalLedgerReadyState = BookingCommissionLedger.db.readyState;
  let paymentAggregateCall = 0;

  try {
    Payment.aggregate = async () => {
      paymentAggregateCall += 1;
      if (paymentAggregateCall === 1) return [{ _id: 'subscription', total: 100000, count: 1 }];
      if (paymentAggregateCall === 2) return [];
      return [];
    };
    Subscription.countDocuments = async () => 1;
    BookingCommissionLedger.db.readyState = 1;
    BookingCommissionLedger.aggregate = async () => [
      { _id: 'billable', total: 5000, count: 1 },
      { _id: 'waived', total: 0, count: 1 },
    ];

    const req = { query: {} };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await adminPaymentController.getRevenue(req, res);

    assert.equal(res.payload.data.paidRevenue, 100000);
    assert.equal(res.payload.data.totalRevenue, 100000);
    assert.equal(res.payload.data.projectedBookingCommission, 5000);
    assert.equal(res.payload.data.billableBookingCommission, 5000);
  } finally {
    restore(Payment, originalPayment);
    restore(Subscription, originalSubscription);
    restore(BookingCommissionLedger, originalLedger);
    BookingCommissionLedger.db.readyState = originalLedgerReadyState;
  }
});
