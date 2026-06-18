const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const WithdrawalRequest = require('../src/models/WithdrawalRequest');
const ownerWithdrawalCtrl = require('../src/controllers/owner.withdrawal.controller');
const adminWithdrawalCtrl = require('../src/controllers/admin.withdrawal.controller');

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

const createRequest = ({ user, body = {}, query = {}, params = {}, app = {} } = {}) => ({
  user,
  body,
  query,
  params,
  app: {
    get: (key) => {
      if (key === 'io') return null; // Mock socket io
      return app[key];
    }
  }
});

const callController = async (controller, req) => {
  const res = createResponse();
  await controller(req, res, () => {});
  return res;
};

const cleanup = async (suffix) => {
  await WithdrawalRequest.deleteMany({});
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for withdrawal tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Withdrawal module: Owner create, validate, duplicate check, Owner list, and Admin moderation flow (approve/reject/complete)', async () => {
  const suffix = `WITHDRAW_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures (Owner 1, Owner 2, Restaurant 1, Restaurant 2, Admin)
    const owner1 = await User.create({
      username: `${suffix}_owner1`,
      email: `${suffix}_owner1@example.com`,
      password: 'Password123!',
      fullName: 'Owner Một',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const owner2 = await User.create({
      username: `${suffix}_owner2`,
      email: `${suffix}_owner2@example.com`,
      password: 'Password123!',
      fullName: 'Owner Hai',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const admin = await User.create({
      username: `${suffix}_admin`,
      email: `${suffix}_admin@example.com`,
      password: 'Password123!',
      fullName: 'Admin Sàn',
      role: 'admin',
      emailVerified: true,
    });

    const restaurant1 = await Restaurant.create({
      ownerId: owner1._id,
      name: `${suffix} Restaurant 1`,
      description: 'Test Rest 1',
      phoneNumber: '0901234561',
      email: `${suffix}_rest1@example.com`,
      address: { street: '1 Test St', ward: 'Ward', district: 'District', city: 'City', fullAddress: '1 Test St, City' },
      approvalStatus: 'approved',
      active: true,
    });

    const restaurant2 = await Restaurant.create({
      ownerId: owner2._id,
      name: `${suffix} Restaurant 2`,
      description: 'Test Rest 2',
      phoneNumber: '0901234562',
      email: `${suffix}_rest2@example.com`,
      address: { street: '2 Test St', ward: 'Ward', district: 'District', city: 'City', fullAddress: '2 Test St, City' },
      approvalStatus: 'approved',
      active: true,
    });

    // 2. Test create withdrawal: Validation checks (Amount < 10000)
    const invalidAmountReq = createRequest({
      user: owner1,
      body: {
        restaurantId: restaurant1._id.toString(),
        amount: 5000,
        bankName: 'Vietcombank',
        accountNumber: '123456789',
        accountHolder: 'OWNER MOT',
      }
    });
    const invalidAmountRes = await callController(ownerWithdrawalCtrl.createWithdrawal, invalidAmountReq);
    assert.equal(invalidAmountRes.statusCode, 400);
    assert.equal(invalidAmountRes.body.success, false);
    assert.match(invalidAmountRes.body.message, /tối thiểu là 10,000/i);

    // 3. Test create withdrawal: Validation checks (Missing Bank Info)
    const missingBankReq = createRequest({
      user: owner1,
      body: {
        restaurantId: restaurant1._id.toString(),
        amount: 20000,
        bankName: '',
        accountNumber: '123456789',
        accountHolder: 'OWNER MOT',
      }
    });
    const missingBankRes = await callController(ownerWithdrawalCtrl.createWithdrawal, missingBankReq);
    assert.equal(missingBankRes.statusCode, 400);
    assert.equal(missingBankRes.body.success, false);
    assert.match(missingBankRes.body.message, /thông tin tài khoản/i);

    // 4. Test create withdrawal: Success
    const validReq = createRequest({
      user: owner1,
      body: {
        restaurantId: restaurant1._id.toString(),
        amount: 150000,
        bankName: 'Vietcombank',
        accountNumber: '123456789',
        accountHolder: 'OWNER MOT',
        note: 'Rút tiền đợt 1',
      }
    });
    const validRes = await callController(ownerWithdrawalCtrl.createWithdrawal, validReq);
    assert.equal(validRes.statusCode, 201);
    assert.equal(validRes.body.success, true);
    assert.ok(validRes.body.data._id);
    const withdrawalId1 = validRes.body.data._id;

    // 5. Test create withdrawal: Duplicate pending check
    const duplicateRes = await callController(ownerWithdrawalCtrl.createWithdrawal, validReq);
    assert.equal(duplicateRes.statusCode, 400);
    assert.equal(duplicateRes.body.success, false);
    assert.match(duplicateRes.body.message, /đang chờ xử lý/i);

    // 6. Test Security Guard: Owner 2 cannot view Owner 1's request
    const unauthorizedViewReq = createRequest({
      user: owner2,
      params: { id: withdrawalId1.toString() }
    });
    const unauthorizedViewRes = await callController(ownerWithdrawalCtrl.getWithdrawalById, unauthorizedViewReq);
    assert.equal(unauthorizedViewRes.statusCode, 403);
    assert.equal(unauthorizedViewRes.body.success, false);

    // Owner 1 can view their own request
    const authorizedViewReq = createRequest({
      user: owner1,
      params: { id: withdrawalId1.toString() }
    });
    const authorizedViewRes = await callController(ownerWithdrawalCtrl.getWithdrawalById, authorizedViewReq);
    assert.equal(authorizedViewRes.statusCode, 200);
    assert.equal(authorizedViewRes.body.success, true);
    assert.equal(authorizedViewRes.body.data.amount, 150000);

    // 7. Test Owner list withdrawals
    const listReq = createRequest({
      user: owner1,
      query: { status: 'pending' }
    });
    const listRes = await callController(ownerWithdrawalCtrl.getMyWithdrawals, listReq);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.success, true);
    assert.equal(listRes.body.data.length, 1);

    // 8. Test Admin moderation: Approve withdrawal request
    const approveReq = createRequest({
      user: admin,
      params: { id: withdrawalId1.toString() },
      body: { adminNote: 'Thông tin hợp lệ, chuyển sang approved' }
    });
    const approveRes = await callController(adminWithdrawalCtrl.approveWithdrawal, approveReq);
    assert.equal(approveRes.statusCode, 200);
    assert.equal(approveRes.body.success, true);
    assert.equal(approveRes.body.data.status, 'approved');
    assert.equal(approveRes.body.data.adminNote, 'Thông tin hợp lệ, chuyển sang approved');

    // 9. Test Admin moderation: Complete withdrawal request
    const completeReq = createRequest({
      user: admin,
      params: { id: withdrawalId1.toString() },
      body: { adminNote: 'Đã chuyển khoản thành công' }
    });
    const completeRes = await callController(adminWithdrawalCtrl.completeWithdrawal, completeReq);
    assert.equal(completeRes.statusCode, 200);
    assert.equal(completeRes.body.success, true);
    assert.equal(completeRes.body.data.status, 'completed');

    // 10. Test Admin moderation: Reject request (Create another request from Owner 2)
    const owner2WithdrawReq = createRequest({
      user: owner2,
      body: {
        restaurantId: restaurant2._id.toString(),
        amount: 200000,
        bankName: 'Techcombank',
        accountNumber: '987654321',
        accountHolder: 'OWNER HAI',
      }
    });
    const owner2WithdrawRes = await callController(ownerWithdrawalCtrl.createWithdrawal, owner2WithdrawReq);
    assert.equal(owner2WithdrawRes.statusCode, 201);
    const withdrawalId2 = owner2WithdrawRes.body.data._id;

    // Test reject request without adminNote -> should fail
    const rejectNoNoteReq = createRequest({
      user: admin,
      params: { id: withdrawalId2.toString() },
      body: { adminNote: '' }
    });
    const rejectNoNoteRes = await callController(adminWithdrawalCtrl.rejectWithdrawal, rejectNoNoteReq);
    assert.equal(rejectNoNoteRes.statusCode, 400);
    assert.equal(rejectNoNoteRes.body.success, false);

    // Test reject request with adminNote -> success
    const rejectReq = createRequest({
      user: admin,
      params: { id: withdrawalId2.toString() },
      body: { adminNote: 'Tên chủ tài khoản không khớp' }
    });
    const rejectRes = await callController(adminWithdrawalCtrl.rejectWithdrawal, rejectReq);
    assert.equal(rejectRes.statusCode, 200);
    assert.equal(rejectRes.body.success, true);
    assert.equal(rejectRes.body.data.status, 'rejected');

  } finally {
    await cleanup(suffix);
  }
});
