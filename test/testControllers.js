const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const assert = require('assert');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const RestaurantActivityLog = require('../src/models/RestaurantActivityLog');
const adminControllers = require('../src/controllers/admin.restaurant.controller');

// Mock response creator
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    }
  };
  return res;
}

async function run() {
  console.log('Starting moderation integration tests...');
  
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // 1. Ensure an Admin user exists
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.log('Creating a temporary admin user...');
      admin = await User.create({
        fullName: 'System Test Admin',
        email: 'testadmin@bookeat.com',
        username: 'testadmin',
        password: 'password123',
        role: 'admin',
        active: true
      });
    }
    console.log(`Using admin: ${admin.email} (ID: ${admin._id})`);

    // 2. Find the pending restaurant (Phở Thìn)
    let restaurant = await Restaurant.findOne({ name: 'Phở Thìn' });
    if (!restaurant) {
      console.log('Restaurant "Phở Thìn" not found. Creating a pending restaurant...');
      
      // Find or create an owner user
      let owner = await User.findOne({ role: 'restaurant_owner' });
      if (!owner) {
        owner = await User.create({
          fullName: 'Test Owner',
          email: 'testowner@bookeat.com',
          username: 'testowner',
          password: 'password123',
          role: 'restaurant_owner',
          active: true
        });
      }
      
      restaurant = await Restaurant.create({
        ownerId: owner._id,
        name: 'Phở Thìn',
        description: 'Phở Thìn Hà Nội truyền thống thơm ngon đậm đà',
        phoneNumber: '0987654321',
        email: 'phothin@gmail.com',
        address: {
          street: '13 Lò Đúc',
          ward: 'Ngô Thì Nhậm',
          district: 'Hai Bà Trưng',
          city: 'Hà Nội',
          fullAddress: '13 Lò Đúc, Hai Bà Trưng, Hà Nội'
        },
        cuisineTypes: ['Phở', 'Món Việt'],
        priceRange: 'moderate',
        capacity: 50,
        approvalStatus: 'pending',
        active: false
      });
    }
    console.log(`Target Restaurant: ${restaurant.name} [ID: ${restaurant._id}, Status: ${restaurant.approvalStatus}]`);

    // Reset status to pending before starting testing flow
    restaurant.approvalStatus = 'pending';
    restaurant.deletedAt = null;
    restaurant.deletedBy = null;
    restaurant.deleteReason = null;
    restaurant.suspensionReason = null;
    restaurant.rejectionReason = null;
    restaurant.active = false;
    restaurant.featured = false;
    restaurant.commissionRate = 10;
    await restaurant.save();
    
    // Clear old logs for this restaurant to make assertions clean
    await RestaurantActivityLog.deleteMany({ restaurantId: restaurant._id });
    console.log('Reset restaurant state and cleared logs.');

    // ────────────────────────────────────────────────────────
    // Test A: Approve Restaurant
    // ────────────────────────────────────────────────────────
    console.log('\n--- 1. Testing Approve Restaurant ---');
    const reqApprove = {
      params: { id: restaurant._id.toString() },
      body: { commissionRate: 12 },
      user: admin
    };
    const resApprove = createMockResponse();
    await adminControllers.approveRestaurant(reqApprove, resApprove);

    assert.equal(resApprove.statusCode, 200, 'Approve should return status 200');
    assert.equal(resApprove.jsonData.success, true, 'Approve response success should be true');
    assert.equal(resApprove.jsonData.data.approvalStatus, 'approved', 'Restaurant status should be approved');
    assert.equal(resApprove.jsonData.data.commissionRate, 12, 'Commission rate should be 12');
    assert.equal(resApprove.jsonData.data.active, true, 'Restaurant active should be true');
    console.log('✅ Approve test passed.');

    // Verify Log
    let log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'approved' });
    assert.ok(log, 'Approve activity log should be created');
    assert.equal(log.performedBy.toString(), admin._id.toString(), 'PerformedBy should be admin ID');
    assert.equal(log.metadata.commissionRate, 12, 'Log metadata should include commissionRate');
    console.log('✅ Approve log verified.');

    // ────────────────────────────────────────────────────────
    // Test B: Suspend Restaurant
    // ────────────────────────────────────────────────────────
    console.log('\n--- 2. Testing Suspend Restaurant ---');
    const reqSuspend = {
      params: { id: restaurant._id.toString() },
      body: { reason: 'Vi phạm điều khoản hoạt động' },
      user: admin
    };
    const resSuspend = createMockResponse();
    await adminControllers.suspendRestaurant(reqSuspend, resSuspend);

    assert.equal(resSuspend.statusCode, 200);
    assert.equal(resSuspend.jsonData.data.approvalStatus, 'suspended');
    assert.equal(resSuspend.jsonData.data.suspensionReason, 'Vi phạm điều khoản hoạt động');
    assert.equal(resSuspend.jsonData.data.active, false, 'Suspended restaurant should be inactive');
    console.log('✅ Suspend test passed.');

    // Verify Log
    log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'suspended' });
    assert.ok(log);
    assert.equal(log.reason, 'Vi phạm điều khoản hoạt động');
    console.log('✅ Suspend log verified.');

    // ────────────────────────────────────────────────────────
    // Test C: Unsuspend Restaurant
    // ────────────────────────────────────────────────────────
    console.log('\n--- 3. Testing Unsuspend Restaurant ---');
    const reqUnsuspend = {
      params: { id: restaurant._id.toString() },
      user: admin
    };
    const resUnsuspend = createMockResponse();
    await adminControllers.unsuspendRestaurant(reqUnsuspend, resUnsuspend);

    assert.equal(resUnsuspend.statusCode, 200);
    assert.equal(resUnsuspend.jsonData.data.approvalStatus, 'approved');
    assert.equal(resUnsuspend.jsonData.data.suspensionReason, null);
    assert.equal(resUnsuspend.jsonData.data.active, true);
    console.log('✅ Unsuspend test passed.');

    // Verify Log
    log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'unsuspended' });
    assert.ok(log);
    console.log('✅ Unsuspend log verified.');

    // ────────────────────────────────────────────────────────
    // Test D: Soft Delete Restaurant
    // ────────────────────────────────────────────────────────
    console.log('\n--- 4. Testing Soft Delete Restaurant ---');
    const reqDelete = {
      params: { id: restaurant._id.toString() },
      body: { reason: 'Chủ quán yêu cầu dừng hợp tác' },
      user: admin
    };
    const resDelete = createMockResponse();
    await adminControllers.softDeleteRestaurant(reqDelete, resDelete);

    assert.equal(resDelete.statusCode, 200);
    assert.ok(resDelete.jsonData.data.deletedAt, 'deletedAt should be set');
    assert.equal(resDelete.jsonData.data.deleteReason, 'Chủ quán yêu cầu dừng hợp tác');
    assert.equal(resDelete.jsonData.data.active, false);
    console.log('✅ Soft Delete test passed.');

    // Verify Log
    log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'deleted' });
    assert.ok(log);
    assert.equal(log.reason, 'Chủ quán yêu cầu dừng hợp tác');
    console.log('✅ Soft Delete log verified.');

    // Verify that getRestaurants excludes deleted restaurants by default
    const reqGetActive = {
      query: { deleted: 'false' }
    };
    const resGetActive = createMockResponse();
    await adminControllers.getRestaurants(reqGetActive, resGetActive);
    const hasDeletedInActiveList = resGetActive.jsonData.data.restaurants.some(r => r.id === restaurant._id.toString());
    assert.equal(hasDeletedInActiveList, false, 'Deleted restaurant should not appear in active getRestaurants list');
    
    // Verify that getRestaurants can fetch deleted restaurants when requested
    const reqGetDeleted = {
      query: { deleted: 'true' }
    };
    const resGetDeleted = createMockResponse();
    await adminControllers.getRestaurants(reqGetDeleted, resGetDeleted);
    const hasDeletedInDeletedList = resGetDeleted.jsonData.data.restaurants.some(r => r.id === restaurant._id.toString());
    assert.equal(hasDeletedInDeletedList, true, 'Deleted restaurant should appear in deleted getRestaurants list');
    console.log('✅ getRestaurants soft delete filtering verified.');

    // ────────────────────────────────────────────────────────
    // Test E: Restore Restaurant
    // ────────────────────────────────────────────────────────
    console.log('\n--- 5. Testing Restore Restaurant ---');
    const reqRestore = {
      params: { id: restaurant._id.toString() },
      user: admin
    };
    const resRestore = createMockResponse();
    await adminControllers.restoreRestaurant(reqRestore, resRestore);

    assert.equal(resRestore.statusCode, 200);
    assert.equal(resRestore.jsonData.data.deletedAt, null, 'deletedAt should be cleared');
    assert.equal(resRestore.jsonData.data.active, true);
    assert.equal(resRestore.jsonData.data.approvalStatus, 'approved');
    console.log('✅ Restore test passed.');

    // Verify Log
    log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'restored' });
    assert.ok(log);
    console.log('✅ Restore log verified.');

    // ────────────────────────────────────────────────────────
    // Test F: Admin Edit (updateRestaurant)
    // ────────────────────────────────────────────────────────
    console.log('\n--- 6. Testing Admin Update Restaurant ---');
    const reqUpdate = {
      params: { id: restaurant._id.toString() },
      body: { featured: true, commissionRate: 15 },
      user: admin
    };
    const resUpdate = createMockResponse();
    await adminControllers.updateRestaurant(reqUpdate, resUpdate);

    assert.equal(resUpdate.statusCode, 200);
    assert.equal(resUpdate.jsonData.data.featured, true);
    assert.equal(resUpdate.jsonData.data.commissionRate, 15);
    console.log('✅ Admin Update test passed.');

    // Verify Log
    log = await RestaurantActivityLog.findOne({ restaurantId: restaurant._id, action: 'updated' });
    assert.ok(log);
    assert.ok(log.metadata.changes.featured, 'Log metadata should track featured change');
    assert.ok(log.metadata.changes.commissionRate, 'Log metadata should track commissionRate change');
    console.log('✅ Admin Update log verified.');

    // ────────────────────────────────────────────────────────
    // Test G: Get Activity Logs
    // ────────────────────────────────────────────────────────
    console.log('\n--- 7. Testing Get Activity Logs ---');
    const reqLogs = {
      params: { id: restaurant._id.toString() },
      query: { page: 1, limit: 10 }
    };
    const resLogs = createMockResponse();
    await adminControllers.getActivityLogs(reqLogs, resLogs);

    assert.equal(resLogs.statusCode, 200);
    assert.equal(resLogs.jsonData.data.logs.length, 6, 'Should find 6 activity logs from the tests');
    console.log('✅ Get Activity Logs test passed.');
    
    console.log('\n======================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('======================================');

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from DB.');
  }
}

run();
