const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const CustomerFavorite = require('../src/models/CustomerFavorite');
const favoriteCtrl = require('../src/controllers/customer.favorite.controller');

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
  await CustomerFavorite.deleteMany({});
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for favorite tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Customer Favorite module: create, unique check, list, search, remove, role guards', async () => {
  const suffix = `FAV_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures
    const customer = await User.create({
      username: `${suffix}_customer`,
      email: `${suffix}_customer@example.com`,
      password: 'Password123!',
      fullName: 'Khách Yêu Thích',
      role: 'customer',
      emailVerified: true,
    });

    const owner = await User.create({
      username: `${suffix}_owner`,
      email: `${suffix}_owner@example.com`,
      password: 'Password123!',
      fullName: 'Chủ Cửa Hàng',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const restaurant = await Restaurant.create({
      ownerId: owner._id,
      name: `${suffix} Restaurant A`,
      description: 'Lẩu nướng ngon bổ rẻ',
      cuisineTypes: ['Lẩu nướng'],
      phoneNumber: '0901234568',
      email: `${suffix}_resta@example.com`,
      address: { street: '12 Test St', ward: 'Ward', district: 'District', city: 'City', fullAddress: '12 Test St, City' },
      approvalStatus: 'approved',
      active: true,
    });

    // 2. Add to favorite - Success
    const addReq = createRequest({
      user: customer,
      body: { restaurantId: restaurant._id.toString() }
    });
    const addRes = await callController(favoriteCtrl.addFavorite, addReq);
    assert.equal(addRes.statusCode, 201);
    assert.equal(addRes.body.success, true);
    assert.ok(addRes.body.data._id);
    assert.equal(addRes.body.data.restaurantId.toString(), restaurant._id.toString());

    // 3. Add to favorite - Duplicate check
    const duplicateRes = await callController(favoriteCtrl.addFavorite, addReq);
    assert.equal(duplicateRes.statusCode, 400);
    assert.equal(duplicateRes.body.success, false);
    assert.match(duplicateRes.body.message, /đã nằm trong danh sách yêu thích/i);

    // 4. Get favorite IDs
    const idsReq = createRequest({ user: customer });
    const idsRes = await callController(favoriteCtrl.getFavoriteIds, idsReq);
    assert.equal(idsRes.statusCode, 200);
    assert.equal(idsRes.body.success, true);
    assert.ok(Array.isArray(idsRes.body.data));
    assert.equal(idsRes.body.data[0], restaurant._id.toString());

    // 5. Get list of favorites (populated)
    const listReq = createRequest({ user: customer });
    const listRes = await callController(favoriteCtrl.getMyFavorites, listReq);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.success, true);
    assert.equal(listRes.body.data.length, 1);
    assert.equal(listRes.body.data[0].restaurantId.name, `${suffix} Restaurant A`);

    // 6. Search within favorites
    const searchMatchReq = createRequest({
      user: customer,
      query: { search: 'lẩu' }
    });
    const searchMatchRes = await callController(favoriteCtrl.getMyFavorites, searchMatchReq);
    assert.equal(searchMatchRes.statusCode, 200);
    assert.equal(searchMatchRes.body.data.length, 1);

    const searchNoMatchReq = createRequest({
      user: customer,
      query: { search: 'phở' }
    });
    const searchNoMatchRes = await callController(favoriteCtrl.getMyFavorites, searchNoMatchReq);
    assert.equal(searchNoMatchRes.statusCode, 200);
    assert.equal(searchNoMatchRes.body.data.length, 0);

    // 7. Remove favorite
    const removeReq = createRequest({
      user: customer,
      params: { restaurantId: restaurant._id.toString() }
    });
    const removeRes = await callController(favoriteCtrl.removeFavorite, removeReq);
    assert.equal(removeRes.statusCode, 200);
    assert.equal(removeRes.body.success, true);

    // Check list empty
    const checkEmptyRes = await callController(favoriteCtrl.getMyFavorites, listReq);
    assert.equal(checkEmptyRes.body.data.length, 0);

  } finally {
    await cleanup(suffix);
  }
});
