const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const Voucher = require('../src/models/Voucher');
const CustomerVoucher = require('../src/models/CustomerVoucher');
const VoucherRedemption = require('../src/models/VoucherRedemption');
const Booking = require('../src/models/Booking');

const voucherService = require('../src/services/voucher.service');
const voucherController = require('../src/controllers/payment.controller'); // wait, let's use the actual controller
const voucherRealController = require('../src/controllers/voucher.controller');

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
  await VoucherRedemption.deleteMany({});
  await CustomerVoucher.deleteMany({});
  await Voucher.deleteMany({ code: new RegExp(`^${suffix}`) });
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for voucher tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Voucher service and controller validation and checkout flow', async () => {
  const suffix = `VOUCH_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures (Owner, Customer, Restaurant)
    const owner = await User.create({
      username: `${suffix}_owner`,
      email: `${suffix}_owner@example.com`,
      password: 'Password123!',
      fullName: 'Voucher Owner',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const customer = await User.create({
      username: `${suffix}_customer`,
      email: `${suffix}_customer@example.com`,
      password: 'Password123!',
      fullName: 'Voucher Customer',
      phoneNumber: '0907777777',
      role: 'customer',
      emailVerified: true,
    });

    const restaurant = await Restaurant.create({
      ownerId: owner._id,
      name: `${suffix} Restaurant`,
      description: 'Temporary restaurant for voucher tests',
      phoneNumber: '0901234567',
      email: `${suffix}_restaurant@example.com`,
      address: {
        street: '1 Test St',
        ward: 'Ward',
        district: 'District',
        city: 'City',
        fullAddress: '1 Test St, City',
      },
      approvalStatus: 'approved',
      active: true,
    });

    // 2. Create Voucher (Percentage type)
    const voucherPercent = await Voucher.create({
      restaurantId: restaurant._id,
      code: `${suffix}_PCT10`,
      description: '10% discount',
      discountType: 'percentage',
      discountValue: 10,
      maxDiscountAmount: 50000,
      minOrderAmount: 100000,
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
      globalUsageLimit: 10,
      perCustomerLimit: 2,
      status: 'active',
      createdBy: owner._id,
    });

    // 3. Test Validate Voucher Service
    // 3a. Invalid order amount
    const valResult1 = await voucherService.validateVoucher(
      voucherPercent.code,
      restaurant._id,
      customer._id,
      50000 // Less than minOrderAmount 100k
    );
    assert.equal(valResult1.valid, false);
    assert.match(valResult1.reason, /chưa đạt giá trị tối thiểu/i);

    // 3b. Valid validation
    const valResult2 = await voucherService.validateVoucher(
      voucherPercent.code,
      restaurant._id,
      customer._id,
      200000 // 200k
    );
    assert.equal(valResult2.valid, true);
    assert.equal(valResult2.discountAmount, 20000); // 10% of 200k is 20k

    // 4. Test Save Voucher for Customer
    const saved = await voucherService.saveVoucherForCustomer(voucherPercent._id, customer._id);
    assert.ok(saved);
    assert.equal(saved.customerId.toString(), customer._id.toString());
    assert.equal(saved.voucherId.toString(), voucherPercent._id.toString());

    // 5. Test getCustomerVouchers
    const customerWallet = await voucherService.getCustomerVouchers(customer._id, 'unused');
    assert.equal(customerWallet.length, 1);
    assert.equal(customerWallet[0].voucherId._id.toString(), voucherPercent._id.toString());

    // 6. Test Controller: getRestaurantVouchers
    const getAvailReq = createRequest({
      user: customer,
      params: { restaurantId: restaurant._id.toString() },
    });
    const getAvailRes = await callController(voucherRealController.getRestaurantVouchers, getAvailReq);
    assert.equal(getAvailRes.statusCode, 200);
    assert.equal(getAvailRes.body.success, true);
    assert.equal(getAvailRes.body.data.length, 1);
    assert.equal(getAvailRes.body.data[0].code, `${suffix}_PCT10`);
    assert.equal(getAvailRes.body.data[0].isSaved, true); // Since customer saved it

  } finally {
    await cleanup(suffix);
  }
});
