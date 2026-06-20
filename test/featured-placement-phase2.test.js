const test = require('node:test');
const assert = require('node:assert/strict');

const Payment = require('../src/models/Payment');
const Restaurant = require('../src/models/Restaurant');
const Subscription = require('../src/models/Subscription');
const FeaturedPlacement = require('../src/models/FeaturedPlacement');
const notificationService = require('../src/services/notification.service');
const payosService = require('../src/services/payos.service');
const featuredPlacementService = require('../src/services/featured-placement.service');
const restaurantQueryService = require('../src/services/restaurant-query.service');
const paymentController = require('../src/controllers/payment.controller');
const adminPaymentController = require('../src/controllers/admin.payment.controller');

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

const chainFindById = (doc) => ({
  select: async () => doc,
});

test('featured packages are fixed and backend-owned', () => {
  const packages = featuredPlacementService.listFeaturedPackages();
  assert.deepEqual(
    packages.map((pkg) => [pkg.code, pkg.amount, pkg.durationDays, pkg.priorityWeight]),
    [
      ['FEATURED_7D', 99000, 7, 10],
      ['FEATURED_30D', 299000, 30, 20],
      ['FEATURED_60D', 499000, 60, 30],
    ]
  );
});

test('featured checkout calculates amount server-side and creates PayOS payment safely', async () => {
  const originalPayment = {
    find: Payment.find,
    findOne: Payment.findOne,
    create: Payment.create,
  };
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };
  const originalFeatured = { create: FeaturedPlacement.create, updateMany: FeaturedPlacement.updateMany };
  const originalPayos = {
    createPaymentLink: payosService.createPaymentLink,
    cancelPaymentLink: payosService.cancelPaymentLink,
  };

  let createdPayment = null;
  let createdPlacement = null;

  try {
    Restaurant.findById = () => chainFindById({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Pho Phase 2' });
    Subscription.findOne = () => ({
      sort: async () => ({
        _id: 'sub-plus',
        status: 'active',
        planCode: 'plus',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        benefitsSnapshot: { allowFeaturedPurchase: true },
        save: async function save() { return this; },
      }),
    });
    Payment.find = () => ({ sort: () => ({ limit: async () => [] }) });
    Payment.findOne = async () => null;
    Payment.create = async (doc) => {
      createdPayment = {
        _id: 'payment-featured-1',
        ...doc,
        save: async function save() { return this; },
        toObject() { return { ...this }; },
      };
      return createdPayment;
    };
    FeaturedPlacement.create = async (doc) => {
      createdPlacement = { _id: 'placement-1', ...doc, toObject() { return { ...this }; } };
      return createdPlacement;
    };
    FeaturedPlacement.updateMany = async () => ({ modifiedCount: 0 });
    payosService.cancelPaymentLink = async () => ({ data: { status: 'CANCELLED' } });
    payosService.createPaymentLink = async (orderCode, amount, description) => ({
      data: {
        checkoutUrl: `https://payos.test/${orderCode}`,
        paymentLinkId: `plink-${orderCode}`,
        qrCode: 'qr-code',
        amount,
        description,
      },
    });

    const result = await featuredPlacementService.createFeaturedCheckout({
      ownerId: 'owner-1',
      restaurantId: 'restaurant-1',
      packageCode: 'FEATURED_30D',
    });

    assert.equal(createdPayment.amount, 299000);
    assert.equal(createdPayment.targetType, 'featured_restaurant');
    assert.equal(createdPayment.targetId, 'restaurant-1');
    assert.equal(createdPayment.metadata.packageCode, 'FEATURED_30D');
    assert.equal(createdPayment.metadata.durationDays, 30);
    assert.equal(createdPayment.metadata.priorityWeight, 20);
    assert.equal(createdPlacement.status, 'pending');
    assert.equal(result.payment.checkoutUrl.startsWith('https://payos.test/'), true);
  } finally {
    restore(Payment, originalPayment);
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
    restore(FeaturedPlacement, originalFeatured);
    restore(payosService, originalPayos);
  }
});

test('owner cannot checkout featured for a foreign restaurant', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalPayment = { create: Payment.create };

  try {
    Restaurant.findById = () => chainFindById({ _id: 'restaurant-2', ownerId: 'other-owner', name: 'Other Pho' });
    Payment.create = async () => {
      throw new Error('Payment must not be created for forbidden restaurant');
    };

    await assert.rejects(
      () => featuredPlacementService.createFeaturedCheckout({
        ownerId: 'owner-1',
        restaurantId: 'restaurant-2',
        packageCode: 'FEATURED_7D',
      }),
      (error) => error.code === 'OWNER_RESTAURANT_FORBIDDEN'
    );
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(Payment, originalPayment);
  }
});

test('free plan cannot purchase featured placement through gating', async () => {
  const originalRestaurant = { findById: Restaurant.findById };
  const originalSubscription = { findOne: Subscription.findOne };

  try {
    Restaurant.findById = () => chainFindById({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Free Pho' });
    Subscription.findOne = () => ({ sort: async () => null });

    await assert.rejects(
      () => featuredPlacementService.createFeaturedCheckout({
        ownerId: 'owner-1',
        restaurantId: 'restaurant-1',
        packageCode: 'FEATURED_7D',
      }),
      (error) => error.statusCode === 403 && error.code === 'FEATURE_NOT_INCLUDED_IN_PLAN'
    );
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(Subscription, originalSubscription);
  }
});

test('paid webhook activation is idempotent and stacks from existing featured endAt', async () => {
  const originalFeatured = {
    findOne: FeaturedPlacement.findOne,
    findOneAndUpdate: FeaturedPlacement.findOneAndUpdate,
    exists: FeaturedPlacement.exists,
  };
  const originalRestaurant = {
    findById: Restaurant.findById,
    updateOne: Restaurant.updateOne,
  };
  const originalNotification = { notifyPaymentStatus: notificationService.notifyPaymentStatus };

  const oldEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const currentPlacement = { _id: 'placement-old', restaurantId: 'restaurant-1', status: 'active', endAt: oldEnd, priorityWeight: 10 };
  const pendingPlacement = {
    _id: 'placement-new',
    status: 'pending',
    restaurantId: 'restaurant-1',
    saveCount: 0,
    save: async function save() {
      this.saveCount += 1;
      return this;
    },
  };

  try {
    FeaturedPlacement.findOne = (query) => {
      if (query.paymentId && query.status === 'active') {
        return Promise.resolve(pendingPlacement.status === 'active' ? pendingPlacement : null);
      }
      if (query.restaurantId && query.status === 'active') {
        return { sort: async () => currentPlacement };
      }
      if (query.paymentId) {
        return Promise.resolve(pendingPlacement);
      }
      return Promise.resolve(null);
    };
    FeaturedPlacement.findOneAndUpdate = async (query, update) => {
      if (query.paymentId !== payment._id || pendingPlacement.status !== 'pending') return null;
      Object.assign(pendingPlacement, update.$set);
      pendingPlacement.saveCount += 1;
      return pendingPlacement;
    };
    FeaturedPlacement.exists = async () => ({ _id: 'placement-new' });
    Restaurant.updateOne = async () => ({ modifiedCount: 1 });
    Restaurant.findById = () => chainFindById({ _id: 'restaurant-1', ownerId: 'owner-1', name: 'Featured Pho' });
    notificationService.notifyPaymentStatus = async () => {};

    const payment = {
      _id: 'payment-featured-paid',
      userId: 'owner-1',
      targetType: 'featured_restaurant',
      targetId: 'restaurant-1',
      restaurantId: 'restaurant-1',
      amount: 99000,
      currency: 'VND',
      status: 'paid',
      orderCode: 178188220001,
      metadata: { packageCode: 'FEATURED_7D' },
    };

    await paymentController._processPaymentSuccess(payment);
    await paymentController._processPaymentSuccess(payment);

    assert.equal(pendingPlacement.status, 'active');
    assert.equal(pendingPlacement.saveCount, 1);
    assert.equal(pendingPlacement.startAt.toISOString(), oldEnd.toISOString());
    assert.equal(
      pendingPlacement.endAt.toISOString(),
      new Date(oldEnd.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
  } finally {
    restore(FeaturedPlacement, originalFeatured);
    restore(Restaurant, originalRestaurant);
    restore(notificationService, originalNotification);
  }
});

test('public restaurant listing annotates featured and sorts it above normal results', async () => {
  const originalRestaurant = { find: Restaurant.find };
  const originalFeaturedService = { getActivePlacementMap: featuredPlacementService.getActivePlacementMap };

  const normal = {
    _id: 'restaurant-normal',
    name: 'A Normal',
    description: 'Normal restaurant',
    address: { fullAddress: 'Da Nang' },
    cuisineTypes: ['Viet Nam'],
    stats: { averageRating: 4.8, totalReviews: 10 },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const featured = {
    _id: 'restaurant-featured',
    name: 'B Featured',
    description: 'Featured restaurant',
    address: { fullAddress: 'Da Nang' },
    cuisineTypes: ['Viet Nam'],
    stats: { averageRating: 4.1, totalReviews: 5 },
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  try {
    Restaurant.find = () => ({
      sort: () => ({
        lean: async () => [normal, featured],
      }),
    });
    featuredPlacementService.getActivePlacementMap = async () => new Map([
      ['restaurant-featured', { restaurantId: 'restaurant-featured', endAt: new Date('2026-07-01T00:00:00.000Z'), priorityWeight: 30 }],
    ]);

    const result = await restaurantQueryService.searchPublicRestaurants({ limit: 2, sortBy: 'name', sortDir: 'asc' });

    assert.equal(result.restaurants[0].id, 'restaurant-featured');
    assert.equal(result.restaurants[0].isFeatured, true);
    assert.equal(result.restaurants[0].featuredPriorityWeight, 30);
    assert.equal(result.restaurants[1].id, 'restaurant-normal');
    assert.equal(result.restaurants[1].isFeatured, false);
  } finally {
    restore(Restaurant, originalRestaurant);
    restore(featuredPlacementService, originalFeaturedService);
  }
});

test('admin revenue includes paid featured_restaurant payments only', async () => {
  const originalPayment = { aggregate: Payment.aggregate };
  const originalSubscription = { countDocuments: Subscription.countDocuments };

  try {
    Payment.aggregate = async (pipeline) => {
      const match = pipeline[0].$match;
      if (match.status === 'paid') {
        return [
          { _id: 'subscription', total: 200000, count: 1 },
          { _id: 'featured_restaurant', total: 299000, count: 1 },
        ];
      }
      return [];
    };
    Subscription.countDocuments = async () => 1;

    const res = buildRes();
    await adminPaymentController.getRevenue({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.featuredRevenue.total, 299000);
    assert.equal(res.payload.data.featuredRevenue.count, 1);
    assert.equal(res.payload.data.totalRevenue, 499000);
  } finally {
    restore(Payment, originalPayment);
    restore(Subscription, originalSubscription);
  }
});
