const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../src/models/Payment');
const Restaurant = require('../src/models/Restaurant');
const Subscription = require('../src/models/Subscription');
const Voucher = require('../src/models/Voucher');
const VoucherCampaignPurchase = require('../src/models/VoucherCampaignPurchase');
const notificationService = require('../src/services/notification.service');
const payosService = require('../src/services/payos.service');
const featuredPlacementService = require('../src/services/featured-placement.service');
const voucherCampaignService = require('../src/services/voucher-campaign.service');
const restaurantQueryService = require('../src/services/restaurant-query.service');
const paymentController = require('../src/controllers/payment.controller');
const adminPaymentController = require('../src/controllers/admin.payment.controller');
const { createPublicCustomerTools } = require('../src/services/ai/tools/public-customer.tools');

const OWNER_ID = '507f1f77bcf86cd799439011';
const RESTAURANT_ID = '507f1f77bcf86cd799439012';
const OTHER_RESTAURANT_ID = '507f1f77bcf86cd799439013';
const VOUCHER_ID = '507f1f77bcf86cd799439014';

const restore = (target, original) => {
  Object.entries(original).forEach(([key, value]) => {
    target[key] = value;
  });
};

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

const chainFindById = (doc) => ({
  select: async () => doc,
});

const activeVoucher = (overrides = {}) => ({
  _id: VOUCHER_ID,
  restaurantId: RESTAURANT_ID,
  code: 'PHASE3',
  description: 'Voucher Phase 3',
  discountType: 'percentage',
  discountValue: 15,
  status: 'active',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
  toObject() {
    return { ...this };
  },
  ...overrides,
});

test('voucher campaign packages are backend-owned and match Phase 3 pricing', () => {
  const packages = voucherCampaignService.listVoucherCampaignPackages();
  assert.deepEqual(
    packages.map((pkg) => [pkg.code, pkg.placement, pkg.amount, pkg.durationDays, pkg.priorityWeight]),
    [
      ['VOUCHER_HOME_7D', 'homepage', 79000, 7, 10],
      ['VOUCHER_HOME_30D', 'homepage', 199000, 30, 20],
      ['VOUCHER_AI_7D', 'ai_suggestion', 99000, 7, 10],
      ['VOUCHER_AI_30D', 'ai_suggestion', 249000, 30, 20],
      ['VOUCHER_SEARCH_7D', 'search_boost', 69000, 7, 10],
      ['VOUCHER_SEARCH_30D', 'search_boost', 179000, 30, 20],
    ]
  );
});

test('owner checkout calculates voucher campaign amount and metadata server-side', async () => {
  const originalPayment = {
    find: Payment.find,
    findOne: Payment.findOne,
    create: Payment.create,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };
  const originalVoucher = { findOne: Voucher.findOne };
  const originalCampaign = {
    findOne: VoucherCampaignPurchase.findOne,
    create: VoucherCampaignPurchase.create,
    updateMany: VoucherCampaignPurchase.updateMany,
  };
  const originalPayos = {
    createPaymentLink: payosService.createPaymentLink,
    cancelPaymentLink: payosService.cancelPaymentLink,
  };
  let createdPayment = null;
  let createdCampaign = null;

  try {
    Restaurant.findById = () => chainFindById({ _id: RESTAURANT_ID, ownerId: OWNER_ID, name: 'Phase 3 Bistro' });
    Subscription.findOne = () => ({
      sort: async () => ({
        _id: 'subscription-plus',
        status: 'active',
        planCode: 'plus',
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: { allowVoucherCampaignPurchase: true },
      }),
    });
    Voucher.findOne = async () => activeVoucher();
    VoucherCampaignPurchase.findOne = () => ({ sort: async () => null });
    VoucherCampaignPurchase.updateMany = async () => ({ modifiedCount: 0 });
    Payment.find = () => ({ sort: () => ({ limit: async () => [] }) });
    Payment.findOne = async () => null;
    Payment.create = async (doc) => {
      createdPayment = {
        _id: 'payment-campaign',
        ...doc,
        save: async function save() { return this; },
        toObject() { return { ...this }; },
      };
      return createdPayment;
    };
    VoucherCampaignPurchase.create = async (doc) => {
      createdCampaign = {
        _id: 'campaign-pending',
        ...doc,
        save: async function save() { return this; },
        toObject() { return { ...this }; },
      };
      return createdCampaign;
    };
    payosService.cancelPaymentLink = async () => ({ data: { status: 'CANCELLED' } });
    payosService.createPaymentLink = async (orderCode) => ({
      data: {
        checkoutUrl: `https://payos.test/${orderCode}`,
        paymentLinkId: `plink-${orderCode}`,
        qrCode: 'payos-qr-payload',
      },
    });

    const result = await voucherCampaignService.createVoucherCampaignCheckout({
      ownerId: OWNER_ID,
      restaurantId: RESTAURANT_ID,
      voucherId: VOUCHER_ID,
      packageCode: 'VOUCHER_HOME_30D',
      amount: 1,
      placement: 'ai_suggestion',
    });

    assert.equal(createdPayment.amount, 199000);
    assert.equal(createdPayment.targetType, 'voucher_campaign');
    assert.equal(String(createdPayment.targetId), VOUCHER_ID);
    assert.equal(createdPayment.metadata.placement, 'homepage');
    assert.equal(createdPayment.metadata.durationDays, 30);
    assert.equal(createdPayment.metadata.priorityWeight, 20);
    assert.equal(createdPayment.metadata.amount, 199000);
    assert.equal(createdCampaign.status, 'pending');
    assert.equal(result.payment.qrCode, 'payos-qr-payload');
  } finally {
    restore(Payment, originalPayment);
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
    restore(Voucher, originalVoucher);
    restore(VoucherCampaignPurchase, originalCampaign);
    restore(payosService, originalPayos);
  }
});

test('owner cannot buy a campaign for a voucher outside the selected restaurant', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };
  const originalVoucher = { findOne: Voucher.findOne };

  try {
    Restaurant.findById = () => chainFindById({ _id: RESTAURANT_ID, ownerId: OWNER_ID, name: 'Phase 3 Bistro' });
    Subscription.findOne = () => ({
      sort: async () => ({
        status: 'active',
        planCode: 'plus',
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: { allowVoucherCampaignPurchase: true },
      }),
    });
    Voucher.findOne = async () => null;

    await assert.rejects(
      () => voucherCampaignService.createVoucherCampaignCheckout({
        ownerId: OWNER_ID,
        restaurantId: RESTAURANT_ID,
        voucherId: VOUCHER_ID,
        packageCode: 'VOUCHER_HOME_7D',
      }),
      (error) => error.code === 'VOUCHER_RESTAURANT_MISMATCH'
    );
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
    restore(Voucher, originalVoucher);
  }
});

test('inactive or too-short voucher cannot purchase a campaign', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };
  const originalVoucher = { findOne: Voucher.findOne };
  const originalCampaign = { findOne: VoucherCampaignPurchase.findOne };

  try {
    Restaurant.findById = () => chainFindById({ _id: RESTAURANT_ID, ownerId: OWNER_ID, name: 'Phase 3 Bistro' });
    Subscription.findOne = () => ({
      sort: async () => ({
        status: 'active',
        planCode: 'plus',
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: { allowVoucherCampaignPurchase: true },
      }),
    });

    Voucher.findOne = async () => activeVoucher({ status: 'paused' });
    await assert.rejects(
      () => voucherCampaignService.createVoucherCampaignCheckout({
        ownerId: OWNER_ID,
        restaurantId: RESTAURANT_ID,
        voucherId: VOUCHER_ID,
        packageCode: 'VOUCHER_HOME_7D',
      }),
      (error) => error.code === 'VOUCHER_NOT_CAMPAIGN_ELIGIBLE'
    );

    Voucher.findOne = async () => activeVoucher({
      endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    VoucherCampaignPurchase.findOne = () => ({ sort: async () => null });
    await assert.rejects(
      () => voucherCampaignService.createVoucherCampaignCheckout({
        ownerId: OWNER_ID,
        restaurantId: RESTAURANT_ID,
        voucherId: VOUCHER_ID,
        packageCode: 'VOUCHER_HOME_7D',
      }),
      (error) => error.code === 'VOUCHER_VALIDITY_TOO_SHORT'
    );
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
    restore(Voucher, originalVoucher);
    restore(VoucherCampaignPurchase, originalCampaign);
  }
});

test('paid voucher campaign activation is idempotent and stacks by voucher plus placement', async () => {
  const originalCampaign = {
    findOne: VoucherCampaignPurchase.findOne,
    findOneAndUpdate: VoucherCampaignPurchase.findOneAndUpdate,
  };
  const originalVoucher = { findOne: Voucher.findOne };
  const oldEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const oldCampaign = {
    _id: 'old-campaign',
    voucherId: VOUCHER_ID,
    placement: 'homepage',
    status: 'active',
    endAt: oldEnd,
  };
  let activated = null;
  let updateCount = 0;

  try {
    Voucher.findOne = async () => activeVoucher();
    VoucherCampaignPurchase.findOne = (query) => {
      if (query.paymentId && query.status === 'active') {
        return Promise.resolve(activated);
      }
      if (query.voucherId && query.placement) {
        return { sort: async () => oldCampaign };
      }
      return Promise.resolve(null);
    };
    VoucherCampaignPurchase.findOneAndUpdate = async (filter, update) => {
      assert.equal(filter.status, 'pending');
      updateCount += 1;
      activated = {
        _id: 'campaign-active',
        paymentId: filter.paymentId,
        ...update.$set,
      };
      return activated;
    };

    const payment = {
      _id: 'payment-paid',
      userId: OWNER_ID,
      targetType: 'voucher_campaign',
      targetId: VOUCHER_ID,
      restaurantId: RESTAURANT_ID,
      amount: 79000,
      currency: 'VND',
      status: 'paid',
      metadata: {
        voucherId: VOUCHER_ID,
        restaurantId: RESTAURANT_ID,
        packageCode: 'VOUCHER_HOME_7D',
      },
    };

    const first = await voucherCampaignService.activateVoucherCampaignFromPayment(payment);
    const second = await voucherCampaignService.activateVoucherCampaignFromPayment(payment);

    assert.equal(updateCount, 1);
    assert.equal(first.status, 'active');
    assert.equal(second._id, first._id);
    assert.equal(first.startAt.toISOString(), oldEnd.toISOString());
    assert.equal(
      first.endAt.toISOString(),
      new Date(oldEnd.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
  } finally {
    restore(VoucherCampaignPurchase, originalCampaign);
    restore(Voucher, originalVoucher);
  }
});

test('payment success branch activates voucher campaign and notifies owner', async () => {
  const originalCampaignService = {
    activateVoucherCampaignFromPayment: voucherCampaignService.activateVoucherCampaignFromPayment,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };
  let activationCount = 0;
  let notifiedStatus = null;

  try {
    voucherCampaignService.activateVoucherCampaignFromPayment = async () => {
      activationCount += 1;
      return { _id: 'campaign-active' };
    };
    Restaurant.findById = () => chainFindById({ _id: RESTAURANT_ID, ownerId: OWNER_ID, name: 'Phase 3 Bistro' });
    notificationService.notifyPaymentStatus = async (io, payload) => {
      notifiedStatus = payload.status;
    };

    await paymentController._processPaymentSuccess({
      _id: 'payment-paid',
      targetType: 'voucher_campaign',
      restaurantId: RESTAURANT_ID,
      metadata: { restaurantId: RESTAURANT_ID },
    });

    assert.equal(activationCount, 1);
    assert.equal(notifiedStatus, 'success');
  } finally {
    restore(voucherCampaignService, originalCampaignService);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});

test('search boost annotates and sorts campaign restaurant above normal results', async () => {
  const originalRestaurant = { find: Restaurant.find };
  const originalFeatured = { getActivePlacementMap: featuredPlacementService.getActivePlacementMap };
  const originalCampaignService = {
    getActiveCampaignMapByRestaurant: voucherCampaignService.getActiveCampaignMapByRestaurant,
  };
  const normal = {
    _id: '507f1f77bcf86cd799439021',
    name: 'A Normal',
    address: { fullAddress: 'Da Nang' },
    cuisineTypes: ['Viet Nam'],
    stats: { averageRating: 4.9 },
  };
  const boosted = {
    _id: '507f1f77bcf86cd799439022',
    name: 'B Boosted',
    address: { fullAddress: 'Da Nang' },
    cuisineTypes: ['Viet Nam'],
    stats: { averageRating: 4.1 },
  };

  try {
    Restaurant.find = () => ({ sort: () => ({ lean: async () => [normal, boosted] }) });
    featuredPlacementService.getActivePlacementMap = async () => new Map();
    voucherCampaignService.getActiveCampaignMapByRestaurant = async (ids, placement) => {
      assert.equal(placement, 'search_boost');
      return new Map([[
        String(boosted._id),
        {
          _id: 'campaign-search',
          placement: 'search_boost',
          packageCode: 'VOUCHER_SEARCH_30D',
          priorityWeight: 20,
          endAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          voucherId: activeVoucher(),
        },
      ]]);
    };

    const result = await restaurantQueryService.searchPublicRestaurants({ limit: 2 });
    assert.equal(result.restaurants[0].id, String(boosted._id));
    assert.equal(result.restaurants[0].hasVoucherCampaign, true);
    assert.equal(result.restaurants[0].voucherCampaign.voucher.code, 'PHASE3');
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(featuredPlacementService, originalFeatured);
    restore(voucherCampaignService, originalCampaignService);
  }
});

test('AI restaurant search requests ai_suggestion boost and exposes sponsored voucher safely', async () => {
  let capturedQuery = null;
  const tools = createPublicCustomerTools({
    restaurantService: {
      async searchPublicRestaurants(query) {
        capturedQuery = query;
        return {
          total: 1,
          restaurants: [{
            id: RESTAURANT_ID,
            name: 'AI Bistro',
            address: 'Da Nang',
            voucherCampaign: {
              placement: 'ai_suggestion',
              endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              sponsoredLabel: 'Duoc tai tro',
              voucher: voucherCampaignService.serializeVoucher(activeVoucher()),
            },
          }],
        };
      },
    },
  });

  const result = await tools.search_restaurants({
    query: 'mon Viet co voucher',
    cuisineType: null,
    city: null,
    priceRange: null,
    limit: 5,
  });

  assert.equal(capturedQuery.boostPlacement, 'ai_suggestion');
  assert.equal(result.payload.restaurants[0].sponsoredVoucher.code, 'PHASE3');
  assert.equal(result.payload.restaurants[0].sponsoredVoucher.placement, 'ai_suggestion');
});

test('admin revenue includes paid voucher campaign transactions', async () => {
  const originalPayment = { aggregate: Payment.aggregate };
  const originalSubscription = { countDocuments: Subscription.countDocuments };

  try {
    Payment.aggregate = async (pipeline) => {
      if (pipeline[0].$match.status === 'paid') {
        return [
          { _id: 'subscription', total: 200000, count: 1 },
          { _id: 'voucher_campaign', total: 249000, count: 1 },
        ];
      }
      return [];
    };
    Subscription.countDocuments = async () => 1;

    const res = buildRes();
    await adminPaymentController.getRevenue({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.voucherCampaignRevenue.total, 249000);
    assert.equal(res.payload.data.voucherCampaignRevenue.count, 1);
    assert.equal(res.payload.data.totalRevenue, 449000);
  } finally {
    restore(Payment, originalPayment);
    restore(Subscription, originalSubscription);
  }
});

test('cancelling a campaign payment only cancels pending campaign records', async () => {
  const originalCampaign = { updateMany: VoucherCampaignPurchase.updateMany };
  let capturedFilter = null;

  try {
    VoucherCampaignPurchase.updateMany = async (filter) => {
      capturedFilter = filter;
      return { modifiedCount: 1 };
    };
    const modified = await voucherCampaignService.cancelVoucherCampaignForPayment({
      _id: 'payment-pending',
      targetType: 'voucher_campaign',
    });

    assert.equal(modified, 1);
    assert.deepEqual(capturedFilter, {
      paymentId: 'payment-pending',
      status: 'pending',
    });
  } finally {
    restore(VoucherCampaignPurchase, originalCampaign);
  }
});

test('expired PayOS payment cancels pending voucher campaign without activation', async () => {
  const originalPayment = { find: Payment.find, findOne: Payment.findOne };
  const originalPayos = { getPaymentInfo: payosService.getPaymentInfo };
  const originalCampaignService = {
    cancelVoucherCampaignForPayment: voucherCampaignService.cancelVoucherCampaignForPayment,
    activateVoucherCampaignFromPayment: voucherCampaignService.activateVoucherCampaignFromPayment,
  };
  const originalFeatured = {
    cancelFeaturedPlacementForPayment: featuredPlacementService.cancelFeaturedPlacementForPayment,
  };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };
  let cancelCount = 0;

  try {
    const payment = {
      _id: 'payment-expired',
      orderCode: 178188520001,
      userId: OWNER_ID,
      targetType: 'voucher_campaign',
      status: 'pending',
      save: async function save() { return this; },
      toObject() { return { ...this }; },
    };
    Payment.find = () => ({
      select: () => ({ limit: () => ({ lean: async () => [] }) }),
    });
    Payment.findOne = async () => payment;
    payosService.getPaymentInfo = async () => ({ data: { status: 'EXPIRED' } });
    featuredPlacementService.cancelFeaturedPlacementForPayment = async () => 0;
    voucherCampaignService.cancelVoucherCampaignForPayment = async () => {
      cancelCount += 1;
      return 1;
    };
    voucherCampaignService.activateVoucherCampaignFromPayment = async () => {
      throw new Error('expired polling must not activate campaign');
    };
    notificationService.notifyPaymentStatus = async () => {};

    const res = buildRes();
    await paymentController.checkPaymentStatus({
      params: { orderCode: String(payment.orderCode) },
      user: { _id: OWNER_ID, role: 'restaurant_owner' },
      app: { get: () => null },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(payment.status, 'expired');
    assert.equal(cancelCount, 1);
  } finally {
    restore(Payment, originalPayment);
    restore(payosService, originalPayos);
    restore(voucherCampaignService, originalCampaignService);
    restore(featuredPlacementService, originalFeatured);
    restore(notificationService, originalNotification);
  }
});

test('foreign restaurant ownership is rejected before voucher campaign checkout', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  try {
    Restaurant.findById = () => chainFindById({
      _id: OTHER_RESTAURANT_ID,
      ownerId: '507f1f77bcf86cd799439099',
      name: 'Foreign Restaurant',
    });

    await assert.rejects(
      () => voucherCampaignService.createVoucherCampaignCheckout({
        ownerId: OWNER_ID,
        restaurantId: OTHER_RESTAURANT_ID,
        voucherId: VOUCHER_ID,
        packageCode: 'VOUCHER_HOME_7D',
      }),
      (error) => error.code === 'OWNER_RESTAURANT_FORBIDDEN'
    );
  } finally {
    restore(Restaurant, originalRestaurant);
  }
});
