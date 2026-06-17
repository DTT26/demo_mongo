const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const Booking = require('../src/models/Booking');
const Review = require('../src/models/Review');
const reviewController = require('../src/controllers/review.controller');
const reviewService = require('../src/services/review.service');

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
  await Review.deleteMany({});
  await Booking.deleteMany({ customerName: new RegExp(`^${suffix}`) });
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for review tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Review module: create, double-submit validation, owner reply, and admin moderation status', async () => {
  const suffix = `REV_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures (Owner, Customer, Restaurant, Booking)
    const owner = await User.create({
      username: `${suffix}_owner`,
      email: `${suffix}_owner@example.com`,
      password: 'Password123!',
      fullName: 'Review Owner',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const customer = await User.create({
      username: `${suffix}_customer`,
      email: `${suffix}_customer@example.com`,
      password: 'Password123!',
      fullName: 'Review Customer',
      phoneNumber: '0901112222',
      role: 'customer',
      emailVerified: true,
    });

    const restaurant = await Restaurant.create({
      ownerId: owner._id,
      name: `${suffix} Restaurant`,
      description: 'Temporary restaurant for review tests',
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

    // Bookingcompleted
    const bookingCompleted = await Booking.create({
      customerId: customer._id,
      restaurantId: restaurant._id,
      bookingDate: new Date(),
      bookingTime: '19:00',
      numberOfGuests: 2,
      customerName: `${suffix}_customer`,
      customerPhone: '0901112222',
      customerEmail: `${suffix}_customer@example.com`,
      status: 'completed',
      reviewed: false,
    });

    // Booking pending (not allowed to review)
    const bookingPending = await Booking.create({
      customerId: customer._id,
      restaurantId: restaurant._id,
      bookingDate: new Date(),
      bookingTime: '20:00',
      numberOfGuests: 2,
      customerName: `${suffix}_customer_pending`,
      customerPhone: '0901113333',
      customerEmail: `${suffix}_customer_pending@example.com`,
      status: 'pending',
      reviewed: false,
    });

    // 2. Test create review for completed booking
    const createReq = createRequest({
      user: customer,
      body: {
        bookingId: bookingCompleted._id.toString(),
        rating: 5,
        comment: 'Đồ ăn cực ngon và không gian phục vụ rất tuyệt vời.',
        images: ['https://example.com/image.jpg']
      }
    });

    const createRes = await callController(reviewController.createReview, createReq);
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.success, true);
    assert.ok(createRes.body.data.reviewId);

    const createdReviewId = createRes.body.data.reviewId;

    // Check stats of Restaurant updated
    const updatedRestaurant = await Restaurant.findById(restaurant._id);
    assert.equal(updatedRestaurant.stats.totalReviews, 1);
    assert.equal(updatedRestaurant.stats.averageRating, 5);

    // Check booking reviewed status updated
    const updatedBooking = await Booking.findById(bookingCompleted._id);
    assert.equal(updatedBooking.reviewed, true);
    assert.equal(updatedBooking.reviewId.toString(), createdReviewId.toString());

    // 3. Test double-submit validation for same booking
    const duplicateRes = await callController(reviewController.createReview, createReq);
    assert.equal(duplicateRes.statusCode, 400);
    assert.equal(duplicateRes.body.success, false);
    assert.match(duplicateRes.body.message, /đã được đánh giá/i);

    // 4. Test review creation for uncompleted booking (pending)
    const pendingReq = createRequest({
      user: customer,
      body: {
        bookingId: bookingPending._id.toString(),
        rating: 4,
        comment: 'Sẽ đánh giá tốt nếu ăn ngon.',
      }
    });
    const pendingRes = await callController(reviewController.createReview, pendingReq);
    assert.equal(pendingRes.statusCode, 400);
    assert.equal(pendingRes.body.success, false);
    assert.match(pendingRes.body.message, /hoàn thành/i);

    // 5. Test Owner reply review
    const replyReq = createRequest({
      user: owner,
      params: { id: createdReviewId.toString() },
      body: {
        comment: 'Cảm ơn quý khách đã ghé thăm nhà hàng của chúng tôi!'
      }
    });
    const replyRes = await callController(reviewController.replyReview, replyReq);
    assert.equal(replyRes.statusCode, 200);
    assert.equal(replyRes.body.success, true);
    assert.equal(replyRes.body.data.ownerReply.comment, 'Cảm ơn quý khách đã ghé thăm nhà hàng của chúng tôi!');

    // 6. Test Admin hide review (Moderation status change)
    const adminUser = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
    const hideReq = createRequest({
      user: adminUser,
      params: { id: createdReviewId.toString() },
      body: {
        status: 'hidden'
      }
    });
    const hideRes = await callController(reviewController.updateReviewStatus, hideReq);
    assert.equal(hideRes.statusCode, 200);
    assert.equal(hideRes.body.success, true);
    assert.equal(hideRes.body.data.status, 'hidden');

    // Stats of restaurant should rollback to 0
    const restaurantAfterHide = await Restaurant.findById(restaurant._id);
    assert.equal(restaurantAfterHide.stats.totalReviews, 0);
    assert.equal(restaurantAfterHide.stats.averageRating, 0);

  } finally {
    await cleanup(suffix);
  }
});
