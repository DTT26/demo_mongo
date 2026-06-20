const test = require('node:test');
const assert = require('node:assert/strict');

const adminMonetizationService = require('../src/services/admin-monetization.service');

const chain = (result) => ({
  select() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  populate() { return this; },
  lean: async () => result,
});

test('phase 5 summary separates paid PayOS revenue from projected commission', async () => {
  const paymentModel = {
    aggregate: async (pipeline) => {
      const groupId = pipeline.find((stage) => stage.$group)?.$group?._id;
      if (groupId === '$targetType') {
        assert.equal(pipeline[0].$match.status, 'paid');
        assert.deepEqual(pipeline[0].$match.targetType.$in, [
          'subscription',
          'featured_restaurant',
          'voucher_campaign',
        ]);
        return [
          { _id: 'subscription', total: 200000, count: 1 },
          { _id: 'featured_restaurant', total: 299000, count: 1 },
          { _id: 'voucher_campaign', total: 249000, count: 1 },
        ];
      }
      if (groupId === '$status') {
        return [
          { _id: 'paid', count: 3 },
          { _id: 'pending', count: 2 },
          { _id: 'failed', count: 1 },
        ];
      }
      return [];
    },
  };
  const ledgerModel = {
    aggregate: async () => [
      { _id: 'pending', total: 2000, count: 1 },
      { _id: 'billable', total: 5000, count: 1 },
      { _id: 'waived', total: 0, count: 1 },
    ],
  };
  const service = adminMonetizationService.createAdminMonetizationService({ paymentModel, ledgerModel });

  const result = await service.getRevenueSummary();

  assert.equal(result.paidRevenue.total, 748000);
  assert.equal(result.paidRevenue.subscription, 200000);
  assert.equal(result.projectedRevenue.bookingCommissionBillable, 5000);
  assert.equal(result.projectedBookingCommission, 7000);
  assert.equal(result.totalPotentialRevenue, 755000);
  assert.equal(result.paymentCounts.pending, 2);
});

test('phase 5 payment table returns safe fields and masks orderCode', async () => {
  const paymentModel = {
    find: () => chain([
      {
        _id: 'payment-1',
        userId: { _id: 'owner-1', fullName: 'Owner One', role: 'restaurant_owner' },
        restaurantId: { _id: 'restaurant-1', name: 'Bep Demo' },
        targetType: 'subscription',
        amount: 200000,
        currency: 'VND',
        status: 'paid',
        gateway: 'payos',
        orderCode: 178188530001,
        checkoutUrl: 'https://payos.example/secret',
        metadata: { webhook: 'raw' },
        createdAt: new Date('2026-06-20T01:00:00.000Z'),
        paidAt: new Date('2026-06-20T01:03:00.000Z'),
      },
    ]),
    countDocuments: async () => 1,
  };
  const service = adminMonetizationService.createAdminMonetizationService({ paymentModel });

  const result = await service.getPaymentTransactions({ page: 1, limit: 10 });
  const item = result.items[0];

  assert.equal(item.paymentId, 'payment-1');
  assert.equal(item.owner.ownerName, 'Owner One');
  assert.equal(item.orderCodeMasked, '****0001');
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'checkoutUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'metadata'), false);
});

test('phase 5 top owners merges paid revenue and projected commission', async () => {
  const paymentModel = {
    aggregate: async () => [
      { _id: 'owner-1', paidRevenue: 500000, paymentCount: 2 },
      { _id: 'owner-2', paidRevenue: 100000, paymentCount: 1 },
    ],
  };
  const ledgerModel = {
    aggregate: async () => [
      { _id: 'owner-2', projectedCommission: 250000, commissionCount: 4 },
    ],
  };
  const userModel = {
    find: () => ({
      select() { return this; },
      lean: async () => [
        { _id: 'owner-1', fullName: 'Owner One' },
        { _id: 'owner-2', username: 'owner-two' },
      ],
    }),
  };
  const service = adminMonetizationService.createAdminMonetizationService({
    paymentModel,
    ledgerModel,
    userModel,
  });

  const result = await service.getTopOwners({ limit: 10 });

  assert.equal(result.length, 2);
  assert.equal(result[0].ownerName, 'Owner One');
  assert.equal(result[0].totalPotentialRevenue, 500000);
  assert.equal(result[1].ownerName, 'owner-two');
  assert.equal(result[1].projectedCommission, 250000);
  assert.equal(result[1].totalPotentialRevenue, 350000);
});

test('phase 5 payment health detects paid payments without activation', async () => {
  const paidPayments = [
    { _id: 'payment-sub-active', targetType: 'subscription', status: 'paid', orderCode: 1001 },
    { _id: 'payment-featured-missing', targetType: 'featured_restaurant', status: 'paid', orderCode: 1002 },
    { _id: 'payment-campaign-missing', targetType: 'voucher_campaign', status: 'paid', orderCode: 1003 },
  ];
  const paymentModel = {
    aggregate: async (pipeline) => {
      const groupId = pipeline.find((stage) => stage.$group)?.$group?._id;
      if (groupId === '$status') return [{ _id: 'paid', count: 3 }];
      return [];
    },
    countDocuments: async () => 0,
    find: (filter) => {
      if (filter.status === 'pending') return chain([]);
      if (filter.status === 'paid') return chain(paidPayments);
      return chain([]);
    },
  };
  const subscriptionModel = {
    find: () => ({
      select() { return this; },
      lean: async () => [{ paymentId: 'payment-sub-active' }],
    }),
  };
  const emptyActivationModel = {
    find: () => ({
      select() { return this; },
      lean: async () => [],
    }),
  };
  const service = adminMonetizationService.createAdminMonetizationService({
    paymentModel,
    subscriptionModel,
    featuredPlacementModel: emptyActivationModel,
    voucherCampaignPurchaseModel: emptyActivationModel,
    now: () => new Date('2026-06-20T12:00:00.000Z'),
  });

  const result = await service.getPaymentHealth();

  assert.equal(result.paymentCounts.paid, 3);
  assert.equal(result.pendingOverdue.count, 0);
  assert.equal(result.activationMissing.count, 2);
  assert.deepEqual(
    result.activationMissing.items.map((item) => item.paymentId),
    ['payment-featured-missing', 'payment-campaign-missing']
  );
  assert.equal(result.webhookRecoveredCount, null);
});
