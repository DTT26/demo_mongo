const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../src/models/Payment');
const Transaction = require('../src/models/Transaction');
const WebhookLog = require('../src/models/WebhookLog');
const Subscription = require('../src/models/Subscription');
const FeaturedPlacement = require('../src/models/FeaturedPlacement');
const VoucherCampaignPurchase = require('../src/models/VoucherCampaignPurchase');
const payosService = require('../src/services/payos.service');
const paymentController = require('../src/controllers/payment.controller');
const webhookController = require('../src/controllers/webhook.controller');
const adminPaymentController = require('../src/controllers/admin.payment.controller');
const { expirePendingPayments } = require('../src/services/payment-lifecycle.service');

const buildRes = () => ({
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
});

const restore = (target, original) => {
  Object.entries(original).forEach(([key, value]) => {
    target[key] = value;
  });
};

const buildWebhookRequest = (orderCode) => ({
  headers: { 'x-payos-signature': 'test-signature' },
  rawBody: Buffer.from(`order:${orderCode}`),
  body: {
    success: true,
    data: { code: '00', orderCode, reference: `ref-${orderCode}` },
  },
  app: { get: () => null },
});

test('invalid webhook signature never claims or activates a payment', async () => {
  const originalPayos = { verifyWebhookSignature: payosService.verifyWebhookSignature };
  const originalWebhookLog = { create: WebhookLog.create };
  const originalPayment = {
    findOne: Payment.findOne,
    findOneAndUpdate: Payment.findOneAndUpdate,
  };
  const originalProcessor = { _processPaymentSuccess: paymentController._processPaymentSuccess };
  let paymentReads = 0;
  let paymentClaims = 0;
  let activations = 0;

  try {
    payosService.verifyWebhookSignature = () => false;
    WebhookLog.create = async (doc) => ({
      ...doc,
      save: async function save() { return this; },
    });
    Payment.findOne = async () => { paymentReads += 1; return null; };
    Payment.findOneAndUpdate = async () => { paymentClaims += 1; return null; };
    paymentController._processPaymentSuccess = async () => { activations += 1; };

    const res = buildRes();
    await webhookController.handlePayOSWebhook(buildWebhookRequest(178188530001), res);

    assert.equal(res.statusCode, 200);
    assert.equal(paymentReads, 0);
    assert.equal(paymentClaims, 0);
    assert.equal(activations, 0);
  } finally {
    restore(payosService, originalPayos);
    restore(WebhookLog, originalWebhookLog);
    restore(Payment, originalPayment);
    restore(paymentController, originalProcessor);
  }
});

for (const [index, targetType] of ['subscription', 'featured_restaurant', 'voucher_campaign'].entries()) {
  test(`duplicate ${targetType} webhooks produce one activation and one transaction`, async () => {
    const originalPayos = { verifyWebhookSignature: payosService.verifyWebhookSignature };
    const originalWebhookLog = { create: WebhookLog.create, findOne: WebhookLog.findOne };
    const originalPayment = {
      findOne: Payment.findOne,
      findOneAndUpdate: Payment.findOneAndUpdate,
    };
    const originalTransaction = { findOneAndUpdate: Transaction.findOneAndUpdate };
    const originalProcessor = { _processPaymentSuccess: paymentController._processPaymentSuccess };
    const orderCode = 178188531000 + index;
    let claimed = false;
    let claimAttempts = 0;
    let activations = 0;
    let transactions = 0;

    try {
      payosService.verifyWebhookSignature = () => true;
      WebhookLog.create = async (doc) => ({
        ...doc,
        save: async function save() { return this; },
      });
      // Deliberately bypass the log guard to model two workers racing.
      WebhookLog.findOne = async () => null;
      Payment.findOne = async () => ({
        _id: `payment-${targetType}`,
        orderCode,
        userId: 'owner-1',
        restaurantId: 'restaurant-1',
        targetId: 'restaurant-1',
        targetType,
        amount: 249000,
        status: 'pending',
      });
      Payment.findOneAndUpdate = async (query, update) => {
        claimAttempts += 1;
        assert.deepEqual(query.status.$in, ['pending', 'processing']);
        if (claimed) return null;
        claimed = true;
        return {
          _id: `payment-${targetType}`,
          orderCode,
          userId: 'owner-1',
          restaurantId: 'restaurant-1',
          targetId: 'restaurant-1',
          targetType,
          amount: 249000,
          status: update.$set.status,
          paidAt: update.$set.paidAt,
        };
      };
      paymentController._processPaymentSuccess = async () => { activations += 1; };
      Transaction.findOneAndUpdate = async (filter, update, options) => {
        transactions += 1;
        assert.equal(filter.idempotencyKey, `payment:payment-${targetType}`);
        assert.equal(update.$setOnInsert.status, 'success');
        assert.equal(options.upsert, true);
        return {};
      };

      const req = buildWebhookRequest(orderCode);
      await webhookController.handlePayOSWebhook(req, buildRes());
      await webhookController.handlePayOSWebhook(req, buildRes());

      assert.equal(claimAttempts, 2);
      assert.equal(activations, 1);
      assert.equal(transactions, 1);
    } finally {
      restore(payosService, originalPayos);
      restore(WebhookLog, originalWebhookLog);
      restore(Payment, originalPayment);
      restore(Transaction, originalTransaction);
      restore(paymentController, originalProcessor);
    }
  });
}

test('paid monetization payment retries fulfillment after a partial webhook failure', async () => {
  const originalPayos = { verifyWebhookSignature: payosService.verifyWebhookSignature };
  const originalWebhookLog = { create: WebhookLog.create, findOne: WebhookLog.findOne };
  const originalPayment = {
    findOne: Payment.findOne,
    findOneAndUpdate: Payment.findOneAndUpdate,
  };
  const originalTransaction = { findOneAndUpdate: Transaction.findOneAndUpdate };
  const originalProcessor = { _processPaymentSuccess: paymentController._processPaymentSuccess };
  const orderCode = 178188532001;
  let paymentStatus = 'pending';
  let fulfillmentAttempts = 0;
  let transactions = 0;

  try {
    payosService.verifyWebhookSignature = () => true;
    WebhookLog.create = async (doc) => ({
      ...doc,
      save: async function save() { return this; },
    });
    WebhookLog.findOne = async () => null;
    Payment.findOne = async () => ({
      _id: 'payment-recovery',
      orderCode,
      userId: 'owner-1',
      targetId: 'restaurant-1',
      targetType: 'subscription',
      amount: 200000,
      status: paymentStatus,
    });
    Payment.findOneAndUpdate = async (_query, update) => {
      if (paymentStatus !== 'pending') return null;
      paymentStatus = update.$set.status;
      return {
        _id: 'payment-recovery',
        orderCode,
        userId: 'owner-1',
        targetId: 'restaurant-1',
        targetType: 'subscription',
        amount: 200000,
        status: paymentStatus,
        paidAt: update.$set.paidAt,
      };
    };
    paymentController._processPaymentSuccess = async () => {
      fulfillmentAttempts += 1;
      if (fulfillmentAttempts === 1) throw new Error('temporary activation failure');
    };
    Transaction.findOneAndUpdate = async () => {
      transactions += 1;
      return {};
    };

    const req = buildWebhookRequest(orderCode);
    await webhookController.handlePayOSWebhook(req, buildRes());
    await webhookController.handlePayOSWebhook(req, buildRes());

    assert.equal(paymentStatus, 'paid');
    assert.equal(fulfillmentAttempts, 2);
    assert.equal(transactions, 1);
  } finally {
    restore(payosService, originalPayos);
    restore(WebhookLog, originalWebhookLog);
    restore(Payment, originalPayment);
    restore(Transaction, originalTransaction);
    restore(paymentController, originalProcessor);
  }
});

test('pending payment expiration atomically cancels dependent monetization records', async () => {
  const originalPayment = { find: Payment.find, findOneAndUpdate: Payment.findOneAndUpdate };
  const originalFeatured = { updateMany: FeaturedPlacement.updateMany };
  const originalCampaign = { updateMany: VoucherCampaignPurchase.updateMany };
  const now = new Date('2026-06-20T10:00:00.000Z');
  const candidateIds = ['payment-featured-expired', 'payment-campaign-expired'];
  let featuredFilter = null;
  let campaignFilter = null;

  try {
    Payment.find = (filter) => {
      assert.equal(filter.status, 'pending');
      assert.equal(filter.expiredAt.$lte, now);
      return {
        select: () => ({
          limit: () => ({ lean: async () => candidateIds.map((_id) => ({ _id })) }),
        }),
      };
    };
    Payment.findOneAndUpdate = async (filter, update) => ({
      _id: filter._id,
      status: update.$set.status,
    });
    FeaturedPlacement.updateMany = async (filter) => {
      featuredFilter = filter;
      return { modifiedCount: 1 };
    };
    VoucherCampaignPurchase.updateMany = async (filter) => {
      campaignFilter = filter;
      return { modifiedCount: 1 };
    };

    const result = await expirePendingPayments({ now });

    assert.equal(result.count, 2);
    assert.deepEqual(featuredFilter.paymentId.$in, candidateIds);
    assert.equal(featuredFilter.status, 'pending');
    assert.deepEqual(campaignFilter.paymentId.$in, candidateIds);
    assert.equal(campaignFilter.status, 'pending');
  } finally {
    restore(Payment, originalPayment);
    restore(FeaturedPlacement, originalFeatured);
    restore(VoucherCampaignPurchase, originalCampaign);
  }
});

test('admin revenue counts paid subscription, featured, and campaign payments once', async () => {
  const originalPayment = { aggregate: Payment.aggregate };
  const originalSubscription = { countDocuments: Subscription.countDocuments };
  const paidRows = [
    { _id: 'subscription', total: 200000, count: 1 },
    { _id: 'featured_restaurant', total: 299000, count: 1 },
    { _id: 'voucher_campaign', total: 249000, count: 1 },
  ];
  let paidSummaryCalls = 0;

  try {
    Payment.aggregate = async (pipeline) => {
      const match = pipeline[0].$match;
      if (match.status === 'paid' && !match.paidAt) {
        paidSummaryCalls += 1;
        return paidRows;
      }
      return [];
    };
    Subscription.countDocuments = async () => 1;

    const res = buildRes();
    await adminPaymentController.getRevenue({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(paidSummaryCalls, 1);
    assert.equal(res.payload.data.subscriptionRevenue.total, 200000);
    assert.equal(res.payload.data.featuredRevenue.total, 299000);
    assert.equal(res.payload.data.voucherCampaignRevenue.total, 249000);
    assert.equal(res.payload.data.totalRevenue, 748000);
  } finally {
    restore(Payment, originalPayment);
    restore(Subscription, originalSubscription);
  }
});
