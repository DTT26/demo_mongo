const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const Subscription = require('../src/models/Subscription');
const { SUBSCRIPTION_PLANS } = require('../src/config/payos.config');
const {
  canCreateRestaurant,
  getHighestActivePlanForOwner,
  getRestaurantUsage,
} = require('../src/services/plan-gating.service');
const ownerRestaurantCtrl = require('../src/controllers/owner.restaurant.controller');
const { restrictTo } = require('../src/middleware/auth.middleware');

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
  };
  return res;
};

const createRequest = ({ user, body = {}, query = {}, params = {} } = {}) => ({
  user,
  body,
  query,
  params,
});

const callController = async (controller, req) => {
  const res = createResponse();
  await controller(req, res, () => {});
  return res;
};

const cleanup = async (suffix) => {
  const users = await User.find({ username: new RegExp(`^${suffix}`) });
  const userIds = users.map((u) => u._id);
  await Subscription.deleteMany({ ownerId: { $in: userIds } });
  await Restaurant.deleteMany({ ownerId: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Restaurant Quota Limit by Plan test suite', async (t) => {
  const suffix = `R_LIMIT_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // Setup helper to create owner
    const createOwner = async (namePart, role = 'restaurant_owner') => {
      return await User.create({
        username: `${suffix}_${namePart}`,
        email: `${suffix}_${namePart}@example.com`,
        password: 'Password123!',
        fullName: `Owner ${namePart}`,
        role,
        emailVerified: true,
      });
    };

    // Setup helper to create restaurant
    const createRestaurantFixture = async (ownerId, namePart, isDeleted = false) => {
      return await Restaurant.create({
        ownerId,
        name: `${suffix}_Rest_${namePart}`,
        description: 'Mô tả nhà hàng kiểm thử giới hạn gói.',
        phoneNumber: '0901234567',
        email: `${suffix}_rest_${namePart}@example.com`,
        address: { street: '123 Test St', ward: 'Ward', district: 'District', city: 'City' },
        approvalStatus: 'approved',
        active: true,
        deletedAt: isDeleted ? new Date() : null,
      });
    };

    // Setup helper to create subscription
    const createSubFixture = async (ownerId, restaurantId, planCode, isExpired = false) => {
      const duration = isExpired ? -1000 * 60 * 60 : 1000 * 60 * 60 * 24 * 30; // Past or future
      return await Subscription.create({
        ownerId,
        restaurantId,
        planCode,
        plan: planCode,
        status: 'active',
        startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        currentPeriodStart: new Date(Date.now() - 1000 * 60 * 60 * 24),
        currentPeriodEnd: new Date(Date.now() + duration),
        expiredAt: new Date(Date.now() + duration),
        paymentId: new mongoose.Types.ObjectId(),
        benefitsSnapshot: SUBSCRIPTION_PLANS[planCode].benefits,
      });
    };

    await t.test('1. Free owner 0 nhà hàng → được tạo', async () => {
      const owner = await createOwner('free0');
      const req = createRequest({
        user: owner,
        body: {
          name: 'Free Rest 1',
          description: 'Mô tả nhà hàng Free 1',
          phoneNumber: '0901234567',
          email: 'free1@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
    });

    await t.test('2. Free owner 1 nhà hàng → bị chặn (code RESTAURANT_LIMIT_REACHED)', async () => {
      const owner = await createOwner('free1');
      await createRestaurantFixture(owner._id, 'F1_1');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Free Rest 2',
          description: 'Mô tả nhà hàng Free 2',
          phoneNumber: '0901234567',
          email: 'free2@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'RESTAURANT_LIMIT_REACHED');
      assert.match(res.body.message, /tối đa/i);
    });

    await t.test('3. Plus owner 2 nhà hàng → được tạo thứ 3', async () => {
      const owner = await createOwner('plus2');
      const r1 = await createRestaurantFixture(owner._id, 'P2_1');
      await createRestaurantFixture(owner._id, 'P2_2');
      await createSubFixture(owner._id, r1._id, 'plus');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Plus Rest 3',
          description: 'Mô tả nhà hàng Plus 3',
          phoneNumber: '0901234567',
          email: 'plus3@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
    });

    await t.test('4. Plus owner 3 nhà hàng → bị chặn', async () => {
      const owner = await createOwner('plus3');
      const r1 = await createRestaurantFixture(owner._id, 'P3_1');
      await createRestaurantFixture(owner._id, 'P3_2');
      await createRestaurantFixture(owner._id, 'P3_3');
      await createSubFixture(owner._id, r1._id, 'plus');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Plus Rest 4',
          description: 'Mô tả nhà hàng Plus 4',
          phoneNumber: '0901234567',
          email: 'plus4@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'RESTAURANT_LIMIT_REACHED');
    });

    await t.test('5. Pro owner 9 nhà hàng → được tạo thứ 10', async () => {
      const owner = await createOwner('pro9');
      const r1 = await createRestaurantFixture(owner._id, 'PR9_1');
      for (let i = 2; i <= 9; i++) {
        await createRestaurantFixture(owner._id, `PR9_${i}`);
      }
      await createSubFixture(owner._id, r1._id, 'pro');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Pro Rest 10',
          description: 'Mô tả nhà hàng Pro 10',
          phoneNumber: '0901234567',
          email: 'pro10@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
    });

    await t.test('6. Pro owner 10 nhà hàng → bị chặn', async () => {
      const owner = await createOwner('pro10');
      const r1 = await createRestaurantFixture(owner._id, 'PR10_1');
      for (let i = 2; i <= 10; i++) {
        await createRestaurantFixture(owner._id, `PR10_${i}`);
      }
      await createSubFixture(owner._id, r1._id, 'pro');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Pro Rest 11',
          description: 'Mô tả nhà hàng Pro 11',
          phoneNumber: '0901234567',
          email: 'pro11@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'RESTAURANT_LIMIT_REACHED');
    });

    await t.test('7. Owner không có subscription → fallback Free', async () => {
      const owner = await createOwner('nosub');
      const plan = await getHighestActivePlanForOwner(owner._id);
      assert.equal(plan, 'free');
    });

    await t.test('8. Subscription expired → fallback Free', async () => {
      const owner = await createOwner('expiredsub');
      const r = await createRestaurantFixture(owner._id, 'EX1');
      await createSubFixture(owner._id, r._id, 'plus', true);

      const plan = await getHighestActivePlanForOwner(owner._id);
      assert.equal(plan, 'free');
    });

    await t.test('9. Pro active không bị Free record cũ override', async () => {
      const owner = await createOwner('override');
      const r1 = await createRestaurantFixture(owner._id, 'OR1');
      const r2 = await createRestaurantFixture(owner._id, 'OR2');
      // Create expired free sub (status active but in the past)
      await createSubFixture(owner._id, r1._id, 'free', true);
      // Create active pro sub
      await createSubFixture(owner._id, r2._id, 'pro', false);

      const plan = await getHighestActivePlanForOwner(owner._id);
      assert.equal(plan, 'pro');
    });

    await t.test('10. Soft deleted restaurant không bị tính', async () => {
      const owner = await createOwner('softdeleted');
      await createRestaurantFixture(owner._id, 'SD1', true); // deleted

      const usage = await getRestaurantUsage(owner._id);
      assert.equal(usage, 0);

      const quota = await canCreateRestaurant(owner._id);
      assert.equal(quota.allowed, true);
      assert.equal(quota.remaining, 1);
    });

    await t.test('11. Customer/admin bị từ chối create restaurant (restrictTo middleware)', async () => {
      const middleware = restrictTo('restaurant_owner');
      const rolesToTest = ['customer', 'admin'];

      for (const role of rolesToTest) {
        const req = createRequest({ user: { role } });
        const res = createResponse();
        let nextCalled = false;
        middleware(req, res, () => {
          nextCalled = true;
        });

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /không có quyền/i);
        assert.equal(nextCalled, false);
      }
    });

    await t.test('12. Error response có code RESTAURANT_LIMIT_REACHED', async () => {
      const owner = await createOwner('errschema');
      await createRestaurantFixture(owner._id, 'ES1');

      const req = createRequest({
        user: owner,
        body: {
          name: 'Block Rest',
          description: 'Mô tả block rest',
          phoneNumber: '0901234567',
          email: 'block@example.com',
          address: { street: '1 St', ward: 'W', district: 'D', city: 'C' },
        },
      });

      const res = await callController(ownerRestaurantCtrl.createRestaurant, req);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'RESTAURANT_LIMIT_REACHED');
      assert.ok(res.body.data);
      assert.equal(res.body.data.planCode, 'free');
      assert.equal(res.body.data.currentCount, 1);
      assert.equal(res.body.data.limit, 1);
      assert.equal(res.body.data.remaining, 0);
      assert.equal(res.body.data.recommendedPlan, 'plus');
    });

    await t.test('13. getMyRestaurants trả restaurantQuota', async () => {
      const owner = await createOwner('getquota');
      const r = await createRestaurantFixture(owner._id, 'GQ1');
      await createSubFixture(owner._id, r._id, 'plus');

      const req = createRequest({
        user: owner,
        query: { page: 1, limit: 10 },
      });

      const res = await callController(ownerRestaurantCtrl.getMyRestaurants, req);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.restaurantQuota);
      assert.equal(res.body.data.restaurantQuota.planCode, 'plus');
      assert.equal(res.body.data.restaurantQuota.currentCount, 1);
      assert.equal(res.body.data.restaurantQuota.limit, 3);
      assert.equal(res.body.data.restaurantQuota.remaining, 2);
      assert.equal(res.body.data.restaurantQuota.recommendedPlan, 'pro');
    });

  } finally {
    await cleanup(suffix);
  }
});
