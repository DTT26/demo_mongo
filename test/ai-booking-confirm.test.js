'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  createAiPendingActionController,
} = require('../src/controllers/ai-pending-action.controller');
const { createAiRouter } = require('../src/routes/ai.routes');
const {
  BookingApplicationError,
  createBookingApplicationService,
} = require('../src/services/application/booking-application.service');
const {
  createAiBookingConfirmationService,
} = require('../src/services/ai/ai-booking-confirmation.service');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');

const ACTION_ID = '507f1f77bcf86cd799439012';
const USER_ID = '507f191e810c19729de860ea';
const OTHER_USER_ID = '507f191e810c19729de860eb';
const RESTAURANT_ID = '507f1f77bcf86cd799439011';
const BOOKING_ID = '507f1f77bcf86cd799439099';
const VOUCHER_ID = '507f1f77bcf86cd799439088';
const IDEMPOTENCY_KEY = 'confirm-key-12345678';

const canonicalPayload = {
  customerId: USER_ID,
  restaurantId: RESTAURANT_ID,
  bookingDate: '2026-06-25',
  bookingTime: '19:00',
  numberOfGuests: 4,
  customerName: 'Nguyễn Văn A',
  customerPhone: '0901234567',
  customerEmail: 'a@example.com',
  tableNumbers: ['A1'],
  voucherCode: 'BOOKEAT10',
  voucherId: VOUCHER_ID,
  specialRequests: 'Gần cửa sổ',
  occasion: 'birthday',
  depositAmount: 1,
  discountAmount: 1,
  amountDue: 0,
};

const createAction = (overrides = {}) => ({
  _id: ACTION_ID,
  userId: USER_ID,
  actionType: 'prepare_booking',
  schemaVersion: 'booking_preview@1',
  payload: { ...canonicalPayload },
  preview: { restaurant: { name: 'BookEat Bistro' } },
  status: 'pending',
  expiresAt: new Date('2026-06-18T11:00:00.000Z'),
  idempotencyKey: null,
  requestFingerprint: null,
  processingAt: null,
  confirmedAt: null,
  resultType: null,
  resultId: null,
  errorCode: null,
  ...overrides,
});

const sameId = (left, right) => String(left || '') === String(right || '');

const matchesQuery = (action, query) => {
  for (const [key, expected] of Object.entries(query || {})) {
    if (key === '$or') {
      if (!expected.some((item) => matchesQuery(action, item))) return false;
      continue;
    }
    const actual = action[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Object.hasOwn(expected, '$gt') && !(new Date(actual) > new Date(expected.$gt))) return false;
      if (Object.hasOwn(expected, '$exists')) {
        const exists = actual !== undefined;
        if (exists !== expected.$exists) return false;
      }
      continue;
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (!sameId(actual, expected)) return false;
  }
  return true;
};

const createPendingActionModel = (initialAction) => {
  const state = {
    action: initialAction,
    updates: [],
  };
  return {
    state,
    async findOne(query) {
      return state.action && matchesQuery(state.action, query) ? state.action : null;
    },
    async findOneAndUpdate(query, update) {
      if (!state.action || !matchesQuery(state.action, query)) return null;
      Object.assign(state.action, update.$set || {});
      state.updates.push({ query, update });
      return state.action;
    },
  };
};

const createBookingRecord = (overrides = {}) => ({
  _id: BOOKING_ID,
  status: 'pending',
  restaurantId: RESTAURANT_ID,
  bookingDate: new Date('2026-06-25T00:00:00.000Z'),
  bookingTime: '19:00',
  numberOfGuests: 4,
  tableNumbers: ['A1'],
  depositAmount: 250000,
  discountAmount: 25000,
  ...overrides,
});

const createConfirmationFixture = ({
  action = createAction(),
  createBooking,
  configProvider = () => ({ bookingConfirmEnabled: true }),
} = {}) => {
  const pendingActionModel = createPendingActionModel(action);
  const audits = [];
  const state = {
    booking: null,
    createCalls: 0,
  };
  const bookingApplication = {
    async createBooking(input) {
      state.createCalls += 1;
      if (createBooking) return createBooking(input, state);
      state.booking = createBookingRecord();
      return { booking: state.booking, created: true };
    },
  };
  const bookingModel = {
    async findById(id) {
      return state.booking && sameId(state.booking._id, id) ? state.booking : null;
    },
    async findOne(query) {
      return state.booking && sameId(query.sourceAiPendingActionId, ACTION_ID)
        ? state.booking
        : null;
    },
  };
  const service = createAiBookingConfirmationService({
    pendingActionModel,
    bookingModel,
    bookingApplication,
    auditLogger: { create: async (entry) => audits.push(entry) },
    configProvider,
    now: () => new Date('2026-06-18T10:00:00.000Z'),
    processingWaitMs: 1,
  });

  return {
    service,
    state,
    pendingActionModel,
    audits,
  };
};

const confirm = (service, overrides = {}) => service.confirmPendingBooking({
  pendingActionId: ACTION_ID,
  user: { _id: USER_ID, role: 'customer' },
  confirmation: true,
  idempotencyKey: IDEMPOTENCY_KEY,
  requestId: 'req-confirm',
  ...overrides,
});

test('confirm uses canonical pending payload, creates one booking, and stores the result', async () => {
  let capturedInput;
  const fixture = createConfirmationFixture({
    createBooking: async (input, state) => {
      capturedInput = input;
      state.booking = createBookingRecord();
      return { booking: state.booking, created: true };
    },
  });

  const result = await confirm(fixture.service);

  assert.equal(fixture.state.createCalls, 1);
  assert.equal(capturedInput.command.restaurantId, canonicalPayload.restaurantId);
  assert.deepEqual(capturedInput.command.tableNumbers, canonicalPayload.tableNumbers);
  assert.equal(Object.hasOwn(capturedInput.command, 'depositAmount'), false);
  assert.equal(Object.hasOwn(capturedInput.command, 'discountAmount'), false);
  assert.equal(Object.hasOwn(capturedInput.command, 'amountDue'), false);
  assert.equal(capturedInput.context.sourceAiPendingActionId, ACTION_ID);
  assert.equal(fixture.pendingActionModel.state.action.status, 'confirmed');
  assert.equal(fixture.pendingActionModel.state.action.resultType, 'booking');
  assert.equal(fixture.pendingActionModel.state.action.resultId, BOOKING_ID);
  assert.ok(fixture.pendingActionModel.state.action.confirmedAt);
  assert.equal(result.booking.id, BOOKING_ID);
  assert.equal(result.booking.amountDue, 225000);
  assert.equal(Object.hasOwn(result.booking, 'customerEmail'), false);
  assert.equal(fixture.audits.at(-1).status, 'success');
});

test('double confirm with the same key returns the old booking and never creates twice', async () => {
  const fixture = createConfirmationFixture();

  const first = await confirm(fixture.service);
  const second = await confirm(fixture.service);

  assert.equal(first.booking.id, BOOKING_ID);
  assert.equal(second.booking.id, BOOKING_ID);
  assert.equal(second.idempotent, true);
  assert.equal(fixture.state.createCalls, 1);
});

test('confirmed action returns the old booking for a retry with a different key', async () => {
  const fixture = createConfirmationFixture();

  const first = await confirm(fixture.service);
  const retry = await confirm(fixture.service, {
    idempotencyKey: 'different-retry-key-12345678',
  });

  assert.equal(first.booking.id, BOOKING_ID);
  assert.equal(retry.booking.id, BOOKING_ID);
  assert.equal(retry.idempotent, true);
  assert.equal(fixture.state.createCalls, 1);
});

test('confirm fails closed when feature configuration cannot be loaded', async () => {
  const fixture = createConfirmationFixture({
    configProvider: () => {
      throw new Error('invalid config');
    },
  });

  await assert.rejects(
    confirm(fixture.service),
    (error) => error.code === 'AI_BOOKING_CONFIRM_DISABLED' && error.statusCode === 503,
  );
  assert.equal(fixture.state.createCalls, 0);
  assert.equal(fixture.pendingActionModel.state.action.status, 'pending');
});

test('concurrent confirm with another key is rejected while the winner creates one booking', async () => {
  let releaseCreate;
  const fixture = createConfirmationFixture({
    createBooking: async (input, state) => new Promise((resolve) => {
      releaseCreate = () => {
        state.booking = createBookingRecord();
        resolve({ booking: state.booking, created: true });
      };
    }),
  });

  const winner = confirm(fixture.service);
  while (fixture.pendingActionModel.state.action.status !== 'processing') {
    await new Promise((resolve) => setImmediate(resolve));
  }

  await assert.rejects(
    confirm(fixture.service, { idempotencyKey: 'another-key-12345678' }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  releaseCreate();
  await winner;

  assert.equal(fixture.state.createCalls, 1);
  assert.equal(fixture.pendingActionModel.state.action.status, 'confirmed');
});

test('expired, cancelled, and foreign pending actions cannot create bookings', async (t) => {
  await t.test('expired', async () => {
    const fixture = createConfirmationFixture({
      action: createAction({ expiresAt: new Date('2026-06-18T09:00:00.000Z') }),
    });
    await assert.rejects(confirm(fixture.service), (error) => error.code === 'PENDING_ACTION_EXPIRED');
    assert.equal(fixture.state.createCalls, 0);
    assert.equal(fixture.pendingActionModel.state.action.status, 'expired');
  });

  await t.test('cancelled', async () => {
    const fixture = createConfirmationFixture({
      action: createAction({ status: 'cancelled' }),
    });
    await assert.rejects(confirm(fixture.service), (error) => error.code === 'PENDING_ACTION_CANCELLED');
    assert.equal(fixture.state.createCalls, 0);
  });

  await t.test('wrong user', async () => {
    const fixture = createConfirmationFixture();
    await assert.rejects(
      confirm(fixture.service, {
        user: { _id: OTHER_USER_ID, role: 'customer' },
      }),
      (error) => error.code === 'PERMISSION_DENIED' && error.statusCode === 403,
    );
    assert.equal(fixture.state.createCalls, 0);
  });
});

test('availability and voucher conflicts fail the action with a safe, actionable code', async (t) => {
  for (const item of [
    {
      name: 'availability conflict',
      code: 'TABLE_NO_LONGER_AVAILABLE',
      message: 'Bàn A1 vừa được đặt.',
    },
    {
      name: 'voucher invalid',
      code: 'VOUCHER_NO_LONGER_VALID',
      message: 'Voucher đã hết hạn.',
    },
  ]) {
    await t.test(item.name, async () => {
      const fixture = createConfirmationFixture({
        createBooking: async () => {
          throw new BookingApplicationError(item.code, item.message, { statusCode: 409 });
        },
      });
      await assert.rejects(confirm(fixture.service), (error) => error.code === item.code);
      assert.equal(fixture.pendingActionModel.state.action.status, 'failed');
      assert.equal(fixture.pendingActionModel.state.action.errorCode, item.code);
      assert.equal(fixture.state.createCalls, 1);
    });
  }
});

test('booking application service recalculates deposit and discount from current database state', async () => {
  const saved = [];
  class FakeBooking {
    constructor(document) {
      Object.assign(this, document);
      this._id = BOOKING_ID;
    }

    async save() {
      saved.push(this);
      return this;
    }

    static async findOne() {
      return null;
    }
  }

  const voucherCalls = [];
  const service = createBookingApplicationService({
    bookingModel: FakeBooking,
    restaurantModel: {
      async findById() {
        return {
          _id: RESTAURANT_ID,
          approvalStatus: 'approved',
          active: true,
          deletedAt: null,
          operatingHours: {},
        };
      },
    },
    tableModel: {
      async countDocuments() {
        return 1;
      },
      async find() {
        return [{ tableNumber: 'A1', capacity: 4, depositAmount: 300000 }];
      },
    },
    booking: {
      normalizeDate: (value) => new Date(`${value}T00:00:00.000Z`),
      async validateBookingTime() {
        return { valid: true, errors: [] };
      },
      async validateTableCapacity() {
        return { valid: true, errors: [], tables: [] };
      },
      async checkTimeConflict() {
        return { hasConflict: false, conflictingBookings: [] };
      },
      async checkAvailability() {
        throw new Error('not expected');
      },
    },
    voucher: {
      async validateVoucher(code, restaurantId, customerId, amount, options) {
        voucherCalls.push({ code, restaurantId, customerId: String(customerId), amount, options });
        return {
          valid: true,
          discountAmount: 45000,
          voucher: { _id: VOUCHER_ID },
        };
      },
    },
    notifications: {
      notifyBookingCreated: async () => {},
    },
    email: {
      sendBookingCreatedEmail: async () => {},
    },
  });

  const result = await service.createBooking({
    actor: { userId: USER_ID, user: { _id: USER_ID } },
    command: {
      ...canonicalPayload,
      depositAmount: 1,
      discountAmount: 1,
      amountDue: 0,
    },
    context: {
      sourceAiPendingActionId: ACTION_ID,
      customer: { _id: USER_ID },
    },
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].depositAmount, 300000);
  assert.equal(saved[0].discountAmount, 45000);
  assert.equal(result.amountDue, 255000);
  assert.deepEqual(voucherCalls[0], {
    code: 'BOOKEAT10',
    restaurantId: RESTAURANT_ID,
    customerId: USER_ID,
    amount: 300000,
    options: { readOnly: true },
  });
});

test('confirm endpoint accepts only pendingActionId, confirmation, and Idempotency-Key', async () => {
  const calls = [];
  const controller = createAiPendingActionController({
    confirmationService: {
      async confirmPendingBooking(input) {
        calls.push(input);
        return {
          pendingAction: { id: ACTION_ID, status: 'confirmed' },
          booking: createBookingRecord({ id: BOOKING_ID }),
          idempotent: false,
        };
      },
    },
    pendingActionService: {},
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createAiRouter({
    health: (req, res) => res.json({ success: true }),
    mockChat: (req, res) => res.json({ success: true }),
    streamChat: (req, res) => res.end(),
  }, {
    pendingController: controller,
    confirmProtect: (req, res, next) => {
      req.user = { _id: USER_ID, role: 'customer' };
      next();
    },
    confirmCustomer: (req, res, next) => next(),
    optionalUser: (req, res, next) => next(),
    rateLimiter: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/ai/pending-actions/${ACTION_ID}/confirm`;

  try {
    const successResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': IDEMPOTENCY_KEY,
      },
      body: JSON.stringify({ confirmation: true }),
    });
    assert.equal(successResponse.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pendingActionId, ACTION_ID);
    assert.equal(calls[0].idempotencyKey, IDEMPOTENCY_KEY);

    const rejectedResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'another-key-12345678',
      },
      body: JSON.stringify({
        confirmation: true,
        restaurantId: RESTAURANT_ID,
        amountDue: 1,
      }),
    });
    const rejectedBody = await rejectedResponse.json();
    assert.equal(rejectedResponse.status, 400);
    assert.equal(rejectedBody.code, 'INVALID_REQUEST');
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('the model-facing tool runner cannot execute confirm_booking', async () => {
  const registry = createAiToolRegistry({
    handlers: {
      confirm_booking: async () => {
        throw new Error('execute handler must not run');
      },
    },
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
  });

  const result = await runner.runToolCall({
    toolName: 'confirm_booking',
    rawArguments: JSON.stringify({
      pendingActionId: ACTION_ID,
      confirmation: true,
    }),
    requestId: 'req-model-confirm',
    user: { _id: USER_ID, role: 'customer' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(result.status, 'forbidden');
});
