const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../src/models/Payment');
const Restaurant = require('../src/models/Restaurant');
const Subscription = require('../src/models/Subscription');
const Transaction = require('../src/models/Transaction');
const WebhookLog = require('../src/models/WebhookLog');
const notificationService = require('../src/services/notification.service');
const payosService = require('../src/services/payos.service');
const { SUBSCRIPTION_PLANS } = require('../src/config/payos.config');
const { canUseFeature } = require('../src/services/plan-gating.service');
const { expireSubscriptionIfNeeded } = require('../src/services/plan-gating.service');
const paymentController = require('../src/controllers/payment.controller');
const webhookController = require('../src/controllers/webhook.controller');

const buildRes = () => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  return res;
};

const restore = (target, original) => {
  Object.entries(original).forEach(([key, value]) => {
    target[key] = value;
  });
};

test('plan gating supports Phase 1.5 feature aliases and numeric booking limits', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };

  try {
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });

    Subscription.findOne = () => ({
      sort: async () => ({
        _id: 'subscription-plus',
        status: 'active',
        planCode: 'plus',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: SUBSCRIPTION_PLANS.plus.benefits,
        save: async () => {},
      }),
    });

    assert.equal((await canUseFeature('owner-1', 'ai.owner.basic', 'restaurant-1')).allowed, true);
    assert.equal((await canUseFeature('owner-1', 'ai.owner.analytics', 'restaurant-1')).allowed, false);
    assert.equal((await canUseFeature('owner-1', 'voucher.basic', 'restaurant-1')).allowed, true);
    assert.equal((await canUseFeature('owner-1', 'voucher.advanced', 'restaurant-1')).allowed, true);
    assert.equal((await canUseFeature('owner-1', 'featured.purchase', 'restaurant-1')).allowed, true);

    const bookingLimit = await canUseFeature('owner-1', 'booking.monthly.limit', 'restaurant-1');
    assert.equal(bookingLimit.allowed, true);
    assert.equal(bookingLimit.limit, 500);

    Subscription.findOne = () => ({
      sort: async () => ({
        _id: 'subscription-pro',
        status: 'active',
        planCode: 'pro',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: SUBSCRIPTION_PLANS.pro.benefits,
        save: async () => {},
      }),
    });

    assert.equal((await canUseFeature('owner-1', 'analytics.advanced', 'restaurant-1')).allowed, true);
    assert.equal((await canUseFeature('owner-1', 'booking.monthly.limit', 'restaurant-1')).limit, -1);
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
  }
});

test('subscription activation is idempotent by paymentId and duplicate webhook cannot double-activate', async () => {
  const originalSubscription = {
    findOne: Subscription.findOne,
    updateMany: Subscription.updateMany,
    create: Subscription.create,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  let existingByPayment = null;
  const createdSubscriptions = [];

  try {
    Subscription.findOne = (query) => {
      if (query.paymentId) return Promise.resolve(existingByPayment);
      return { sort: async () => null };
    };
    Subscription.updateMany = async () => ({ modifiedCount: 0 });
    Subscription.create = async (doc) => {
      const subscription = { _id: `sub-${createdSubscriptions.length + 1}`, ...doc };
      createdSubscriptions.push(subscription);
      existingByPayment = subscription;
      return subscription;
    };
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });
    notificationService.notifyPaymentStatus = async () => {};

    const payment = {
      _id: 'payment-1',
      targetType: 'subscription',
      targetId: 'restaurant-1',
      userId: 'owner-1',
      metadata: { plan: 'plus', planCode: 'plus' },
    };

    await paymentController._processPaymentSuccess(payment);
    await paymentController._processPaymentSuccess(payment);

    assert.equal(createdSubscriptions.length, 1);
    assert.equal(createdSubscriptions[0].planCode, 'plus');
    assert.equal(createdSubscriptions[0].status, 'active');
  } finally {
    restore(Subscription, originalSubscription);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});

test('same-plan renewal extends from the old period end', async () => {
  const originalSubscription = {
    findOne: Subscription.findOne,
    updateMany: Subscription.updateMany,
    create: Subscription.create,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  const oldEnd = new Date('2026-07-19T12:00:00.000Z');
  const activeSubscription = {
    _id: 'subscription-old',
    status: 'active',
    planCode: 'plus',
    currentPeriodEnd: oldEnd,
    expiredAt: oldEnd,
    save: async function save() { return this; },
  };
  const createdSubscriptions = [];

  try {
    Subscription.findOne = (query) => {
      if (query.paymentId) return Promise.resolve(null);
      return { sort: async () => activeSubscription };
    };
    Subscription.updateMany = async () => ({ modifiedCount: 0 });
    Subscription.create = async (doc) => {
      createdSubscriptions.push(doc);
      return { _id: 'subscription-new', ...doc };
    };
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });
    notificationService.notifyPaymentStatus = async () => {};

    await paymentController._processPaymentSuccess({
      _id: 'payment-renew',
      targetType: 'subscription',
      targetId: 'restaurant-1',
      userId: 'owner-1',
      metadata: { plan: 'plus', planCode: 'plus', isRenewal: true },
    });

    assert.equal(createdSubscriptions.length, 1);
    assert.equal(createdSubscriptions[0].currentPeriodStart.toISOString(), oldEnd.toISOString());
    assert.equal(
      createdSubscriptions[0].currentPeriodEnd.toISOString(),
      new Date(oldEnd.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.equal(activeSubscription.status, 'expired');
  } finally {
    restore(Subscription, originalSubscription);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});

test('payment status polling activates subscription when gateway says PAID', async () => {
  const originalPayment = {
    find: Payment.find,
    findOne: Payment.findOne,
    findOneAndUpdate: Payment.findOneAndUpdate,
  };
  const originalPayos = { getPaymentInfo: payosService.getPaymentInfo };
  const originalSubscription = {
    findOne: Subscription.findOne,
    updateMany: Subscription.updateMany,
    create: Subscription.create,
  };
  const originalTransaction = { findOneAndUpdate: Transaction.findOneAndUpdate };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  let createdSubscription = null;
  let transactionCreated = false;

  try {
    const payment = {
      _id: 'payment-poll',
      orderCode: 178188000001,
      userId: 'owner-1',
      targetType: 'subscription',
      targetId: 'restaurant-1',
      amount: SUBSCRIPTION_PLANS.plus.price,
      status: 'pending',
      metadata: { plan: 'plus', planCode: 'plus' },
      toObject() {
        return {
          _id: this._id,
          orderCode: this.orderCode,
          userId: this.userId,
          targetType: this.targetType,
          status: this.status,
          amount: this.amount,
          metadata: this.metadata,
        };
      },
      save: async function save() { return this; },
    };

    Payment.find = () => ({
      select: () => ({ limit: () => ({ lean: async () => [] }) }),
    });
    Payment.findOne = async () => payment;
    Payment.findOneAndUpdate = async (query, update) => {
      payment.status = update.$set.status;
      payment.paidAt = update.$set.paidAt;
      return payment;
    };

    payosService.getPaymentInfo = async () => ({
      data: {
        status: 'PAID',
        reference: 'ref-poll-1',
        paymentLinkId: 'plink-poll-1',
      },
    });

    Subscription.findOne = (query) => {
      if (query.paymentId) return Promise.resolve(null);
      return { sort: async () => null };
    };
    Subscription.updateMany = async () => ({ modifiedCount: 0 });
    Subscription.create = async (doc) => {
      createdSubscription = doc;
      return { _id: 'subscription-poll-new', ...doc };
    };

    Transaction.findOneAndUpdate = async () => {
      transactionCreated = true;
      return {};
    };

    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });

    notificationService.notifyPaymentStatus = async () => {};

    const req = {
      params: { orderCode: String(payment.orderCode) },
      user: { _id: 'owner-1', role: 'restaurant_owner' },
      app: { get: () => null },
    };
    const res = buildRes();

    await paymentController.checkPaymentStatus(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data.status, 'paid');
    assert.equal(res.payload.data.gatewayStatus, 'PAID');
    assert.equal(payment.status, 'paid');
    assert.ok(createdSubscription);
    assert.equal(createdSubscription.planCode, 'plus');
    assert.ok(transactionCreated);
  } finally {
    restore(Payment, originalPayment);
    restore(payosService, originalPayos);
    restore(Subscription, originalSubscription);
    restore(Transaction, originalTransaction);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});

test('cancelling a pending subscription payment does not activate subscription', async () => {
  const originalPayment = { findById: Payment.findById };
  const originalPayos = { cancelPaymentLink: payosService.cancelPaymentLink };
  const originalSubscription = { create: Subscription.create };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  try {
    const payment = {
      _id: 'payment-cancel',
      orderCode: 178188000002,
      userId: 'owner-1',
      targetType: 'subscription',
      status: 'pending',
      save: async function save() { return this; },
    };

    Payment.findById = async () => payment;
    payosService.cancelPaymentLink = async () => ({ data: { status: 'CANCELLED' } });
    Subscription.create = async () => {
      throw new Error('cancel must not activate subscriptions');
    };
    notificationService.notifyPaymentStatus = async () => {};

    const req = {
      params: { id: 'payment-cancel' },
      user: { _id: 'owner-1', role: 'restaurant_owner' },
      app: { get: () => null },
    };
    const res = buildRes();

    await paymentController.cancelPayment(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(payment.status, 'cancelled');
    assert.ok(payment.cancelledAt instanceof Date);
  } finally {
    restore(Payment, originalPayment);
    restore(payosService, originalPayos);
    restore(Subscription, originalSubscription);
    restore(notificationService, originalNotification);
  }
});

test('expired active subscription is marked expired for lazy Free fallback', async () => {
  const subscription = {
    status: 'active',
    currentPeriodEnd: new Date(Date.now() - 60 * 1000),
    saveCalled: false,
    save: async function save() {
      this.saveCalled = true;
      return this;
    },
  };

  const result = await expireSubscriptionIfNeeded(subscription);

  assert.equal(result, null);
  assert.equal(subscription.status, 'expired');
  assert.equal(subscription.saveCalled, true);
});

test('subscription checkout calculates amount server-side and returns PayOS checkout data', async () => {
  const originalPayment = {
    findOne: Payment.findOne,
    find: Payment.find,
    create: Payment.create,
    updateMany: Payment.updateMany,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };
  const originalPayos = { createPaymentLink: payosService.createPaymentLink };

  let createdPayment = null;

  try {
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });
    Subscription.findOne = () => ({ sort: async () => null });
    Payment.findOne = async () => null;
    Payment.find = () => ({
      select: () => ({ limit: () => ({ lean: async () => [] }) }),
      sort: async () => [],
    });
    Payment.updateMany = async () => ({ modifiedCount: 0 });
    Payment.create = async (doc) => {
      createdPayment = {
        _id: 'payment-new',
        ...doc,
        save: async function save() { return this; },
      };
      return createdPayment;
    };
    payosService.createPaymentLink = async (orderCode, amount, description) => ({
      data: {
        checkoutUrl: `https://payos.test/checkout/${orderCode}`,
        paymentLinkId: `plink-${orderCode}`,
        qrCode: `qr:${description}:${amount}`,
      },
    });

    const req = {
      body: {
        targetType: 'subscription',
        targetId: 'restaurant-1',
        planCode: 'plus',
        amount: 1,
      },
      user: { _id: 'owner-1', role: 'restaurant_owner' },
    };
    const res = buildRes();

    await paymentController.createPayment(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(createdPayment.amount, SUBSCRIPTION_PLANS.plus.price);
    assert.equal(createdPayment.metadata.planCode, 'plus');
    assert.equal(res.payload.data.checkoutUrl.startsWith('https://payos.test/checkout/'), true);
    assert.equal(Boolean(res.payload.data.qrCode), true);
  } finally {
    restore(Payment, originalPayment);
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
    restore(payosService, originalPayos);
  }
});

test('owner cannot checkout subscription for a foreign restaurant', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalPayos = { createPaymentLink: payosService.createPaymentLink };

  try {
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'other-owner', name: 'Foreign Bistro' }),
    });
    payosService.createPaymentLink = async () => {
      throw new Error('PayOS must not be called for forbidden restaurants');
    };

    const req = {
      body: {
        targetType: 'subscription',
        targetId: 'restaurant-1',
        planCode: 'plus',
      },
      user: { _id: 'owner-1', role: 'restaurant_owner' },
    };
    const res = buildRes();

    await paymentController.createPayment(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'OWNER_RESTAURANT_FORBIDDEN');
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(payosService, originalPayos);
  }
});

test('PayOS webhook verifies, activates subscription once, and ignores duplicate processed orderCode', async () => {
  const originalPayment = { findOne: Payment.findOne, findOneAndUpdate: Payment.findOneAndUpdate };
  const originalWebhookLog = {
    create: WebhookLog.create,
    findOne: WebhookLog.findOne,
  };
  const originalTransaction = { findOneAndUpdate: Transaction.findOneAndUpdate };
  const originalPayos = { verifyWebhookSignature: payosService.verifyWebhookSignature };
  const originalSubscription = {
    findOne: Subscription.findOne,
    updateMany: Subscription.updateMany,
    create: Subscription.create,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  let processedOrderCode = null;
  let paymentFindCount = 0;
  let transactionCount = 0;
  let subscriptionCount = 0;
  let paymentClaimed = false;

  try {
    payosService.verifyWebhookSignature = () => true;
    WebhookLog.create = async (doc) => ({
      ...doc,
      save: async function save() {
        if (this.processed) processedOrderCode = this.orderCode;
        return this;
      },
    });
    WebhookLog.findOne = async (query) => (
      query.orderCode === processedOrderCode && query.processed
        ? { orderCode: processedOrderCode, processed: true }
        : null
    );

    Payment.findOne = async () => {
      paymentFindCount += 1;
      return {
        _id: 'payment-webhook',
        orderCode: 178188510001,
        userId: 'owner-1',
        targetType: 'subscription',
        targetId: 'restaurant-1',
        amount: SUBSCRIPTION_PLANS.plus.price,
        status: 'pending',
        metadata: { plan: 'plus', planCode: 'plus' },
        save: async function save() { return this; },
      };
    };
    Payment.findOneAndUpdate = async (query, update) => {
      if (paymentClaimed || !query.status.$in.includes('pending')) return null;
      paymentClaimed = true;
      return {
        _id: 'payment-webhook',
        orderCode: 178188510001,
        userId: 'owner-1',
        targetType: 'subscription',
        targetId: 'restaurant-1',
        amount: SUBSCRIPTION_PLANS.plus.price,
        status: update.$set.status,
        paidAt: update.$set.paidAt,
        metadata: { plan: 'plus', planCode: 'plus' },
      };
    };
    Transaction.findOneAndUpdate = async () => {
      transactionCount += 1;
      return {};
    };
    Subscription.findOne = (query) => {
      if (query.paymentId) return Promise.resolve(null);
      return { sort: async () => null };
    };
    Subscription.updateMany = async () => ({ modifiedCount: 0 });
    Subscription.create = async (doc) => {
      subscriptionCount += 1;
      return { _id: 'subscription-webhook', ...doc };
    };
    Restaurant.findById = () => ({
      select: async () => ({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Phase 1.5 Bistro' }),
    });
    notificationService.notifyPaymentStatus = async () => {};

    const req = {
      headers: { 'x-payos-signature': 'valid-signature' },
      body: {
        success: true,
        data: {
          code: '00',
          orderCode: 178188510001,
          reference: 'payos-ref-1',
        },
      },
      app: { get: () => null },
    };

    await webhookController.handlePayOSWebhook(req, buildRes());
    await webhookController.handlePayOSWebhook(req, buildRes());

    assert.equal(paymentFindCount, 1);
    assert.equal(subscriptionCount, 1);
    assert.equal(transactionCount, 1);
    assert.equal(processedOrderCode, 178188510001);
  } finally {
    restore(Payment, originalPayment);
    restore(WebhookLog, originalWebhookLog);
    restore(Transaction, originalTransaction);
    restore(payosService, originalPayos);
    restore(Subscription, originalSubscription);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});
