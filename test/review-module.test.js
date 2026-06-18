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
const ownerReviewController = require('../src/controllers/owner.review.controller');
const adminReviewController = require('../src/controllers/admin.review.controller');
const reviewService = require('../src/services/review.service');

// ─── Helpers ───

const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const makeOperatingHours = () => Object.fromEntries(
  dayNames.map((day) => [day, { open: '10:00', close: '22:00', closed: false }])
);

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
  app: {
    get() { return null; },
  },
});

const callController = async (controller, req) => {
  const res = createResponse();
  await controller(req, res, () => {});
  return res;
};

const createFixture = async (suffix) => {
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
    phoneNumber: '0901234567',
    role: 'customer',
    emailVerified: true,
  });

  const customer2 = await User.create({
    username: `${suffix}_customer2`,
    email: `${suffix}_customer2@example.com`,
    password: 'Password123!',
    fullName: 'Review Customer 2',
    phoneNumber: '0907654321',
    role: 'customer',
    emailVerified: true,
  });

  const admin = await User.create({
    username: `${suffix}_admin`,
    email: `${suffix}_admin@example.com`,
    password: 'Password123!',
    fullName: 'Review Admin',
    role: 'admin',
    emailVerified: true,
  });

  const restaurant = await Restaurant.create({
    ownerId: owner._id,
    name: `${suffix} Restaurant`,
    description: 'Temporary restaurant for review tests',
    phoneNumber: '0901234567',
    email: `${suffix}_restaurant@example.com`,
    address: {
      street: '1 Test',
      ward: 'Ward',
      district: 'District',
      city: 'City',
      fullAddress: '1 Test, City',
    },
    operatingHours: makeOperatingHours(),
    approvalStatus: 'approved',
    active: true,
  });

  const completedBooking = await Booking.create({
    customerId: customer._id,
    restaurantId: restaurant._id,
    bookingDate: new Date('2026-06-10T00:00:00.000Z'),
    bookingTime: '18:00',
    numberOfGuests: 2,
    customerName: 'Review Customer',
    customerPhone: '0901234567',
    customerEmail: `${suffix}_customer@example.com`,
    status: 'completed',
    completedAt: new Date('2026-06-10T20:00:00.000Z'),
    statusHistory: [{ status: 'completed', note: 'seed completed' }],
  });

  const pendingBooking = await Booking.create({
    customerId: customer._id,
    restaurantId: restaurant._id,
    bookingDate: new Date('2026-06-15T00:00:00.000Z'),
    bookingTime: '19:00',
    numberOfGuests: 4,
    customerName: 'Review Customer',
    customerPhone: '0901234567',
    customerEmail: `${suffix}_customer@example.com`,
    status: 'pending',
    statusHistory: [{ status: 'pending', note: 'seed pending' }],
  });

  const completedBooking2 = await Booking.create({
    customerId: customer._id,
    restaurantId: restaurant._id,
    bookingDate: new Date('2026-06-12T00:00:00.000Z'),
    bookingTime: '20:00',
    numberOfGuests: 3,
    customerName: 'Review Customer',
    customerPhone: '0901234567',
    customerEmail: `${suffix}_customer@example.com`,
    status: 'completed',
    completedAt: new Date('2026-06-12T22:00:00.000Z'),
    statusHistory: [{ status: 'completed', note: 'seed completed 2' }],
  });

  return {
    owner,
    customer,
    customer2,
    admin,
    restaurant,
    completedBooking,
    pendingBooking,
    completedBooking2,
  };
};

const cleanup = async (suffix) => {
  const restaurants = await Restaurant.find({ name: new RegExp(`^${suffix}`) }).select('_id');
  const restaurantIds = restaurants.map((r) => r._id);
  const bookings = await Booking.find({ restaurantId: { $in: restaurantIds } }).select('_id');
  const bookingIds = bookings.map((b) => b._id);

  await Review.deleteMany({ bookingId: { $in: bookingIds } });
  await Booking.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

// ─── Tests ───

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

// ─── Test 1: Review validation ───
test('review validation rejects invalid rating and short comment', async () => {
  const suffix = `review_val_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Missing fields
    const missingRes = await callController(
      reviewController.createReview,
      createRequest({ user: fixture.customer, body: {} })
    );
    assert.equal(missingRes.statusCode, 400);

    // Rating < 1
    const lowRatingRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 0,
          comment: 'This is a valid comment text',
        },
      })
    );
    assert.equal(lowRatingRes.statusCode, 400);

    // Rating > 5
    const highRatingRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 6,
          comment: 'This is a valid comment text',
        },
      })
    );
    assert.equal(highRatingRes.statusCode, 400);

    // Non-integer rating
    const floatRatingRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 3.5,
          comment: 'This is a valid comment text',
        },
      })
    );
    assert.equal(floatRatingRes.statusCode, 400);

    // Short comment
    const shortRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 4,
          comment: 'Short',
        },
      })
    );
    assert.equal(shortRes.statusCode, 400);

    // Cannot review non-completed booking
    const pendingRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.pendingBooking._id.toString(),
          rating: 4,
          comment: 'This is a valid comment text but booking not completed',
        },
      })
    );
    assert.equal(pendingRes.statusCode, 400);
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 2: Create, update, delete review ───
test('customer can create, update, and delete a review', async () => {
  const suffix = `review_crud_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Create review
    const createRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 4,
          title: 'Rất tuyệt vời',
          comment: 'Nhà hàng phục vụ rất tốt, đồ ăn ngon',
        },
      })
    );
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.data.rating, 4);
    assert.equal(createRes.body.data.title, 'Rất tuyệt vời');

    const reviewId = createRes.body.data.id;

    // Verify booking updated
    const updatedBooking = await Booking.findById(fixture.completedBooking._id);
    assert.equal(updatedBooking.reviewed, true);
    assert.equal(updatedBooking.reviewId.toString(), reviewId);

    // Update review
    const updateRes = await callController(
      reviewController.updateReview,
      createRequest({
        user: fixture.customer,
        params: { id: reviewId },
        body: { rating: 5, comment: 'Cập nhật: Nhà hàng phục vụ tuyệt vời, chắc chắn sẽ quay lại' },
      })
    );
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.body.data.rating, 5);

    // Delete review
    const deleteRes = await callController(
      reviewController.deleteReview,
      createRequest({
        user: fixture.customer,
        params: { id: reviewId },
      })
    );
    assert.equal(deleteRes.statusCode, 200);

    // Verify booking reset
    const resetBooking = await Booking.findById(fixture.completedBooking._id);
    assert.equal(resetBooking.reviewed, false);
    assert.equal(resetBooking.reviewId, null);

    // Verify review deleted
    const deletedReview = await Review.findById(reviewId);
    assert.equal(deletedReview, null);
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 3: Duplicate review by bookingId ───
test('cannot create duplicate review for same booking', async () => {
  const suffix = `review_dup_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // First review — success
    const firstRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 4,
          comment: 'Đánh giá lần đầu, đồ ăn rất ngon',
        },
      })
    );
    assert.equal(firstRes.statusCode, 201);

    // Second review — duplicate
    const dupRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 3,
          comment: 'Đánh giá lần hai — không nên được phép',
        },
      })
    );
    assert.equal(dupRes.statusCode, 400);
    assert.ok(dupRes.body.message.includes('đã đánh giá'));
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 4: Helpful idempotency ───
test('helpful toggle is idempotent — toggle on then off', async () => {
  const suffix = `review_help_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Create a review first
    const createRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 4,
          comment: 'Đánh giá cho test helpful, đồ ăn ngon',
        },
      })
    );
    const reviewId = createRes.body.data.id;

    // Toggle helpful ON (by customer2)
    const onRes = await callController(
      reviewController.toggleHelpful,
      createRequest({
        user: fixture.customer2,
        params: { id: reviewId },
      })
    );
    assert.equal(onRes.statusCode, 200);
    assert.equal(onRes.body.data.helpful, true);
    assert.equal(onRes.body.data.helpfulCount, 1);

    // Toggle helpful OFF (same user)
    const offRes = await callController(
      reviewController.toggleHelpful,
      createRequest({
        user: fixture.customer2,
        params: { id: reviewId },
      })
    );
    assert.equal(offRes.statusCode, 200);
    assert.equal(offRes.body.data.helpful, false);
    assert.equal(offRes.body.data.helpfulCount, 0);

    // Toggle ON again
    const onAgainRes = await callController(
      reviewController.toggleHelpful,
      createRequest({
        user: fixture.customer2,
        params: { id: reviewId },
      })
    );
    assert.equal(onAgainRes.statusCode, 200);
    assert.equal(onAgainRes.body.data.helpful, true);
    assert.equal(onAgainRes.body.data.helpfulCount, 1);
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 5: Report idempotency ───
test('report is idempotent — second report by same user is no-op', async () => {
  const suffix = `review_report_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    const createRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 2,
          comment: 'Đánh giá cho test report vi phạm nội dung',
        },
      })
    );
    const reviewId = createRes.body.data.id;

    // First report
    const reportRes = await callController(
      reviewController.reportReview,
      createRequest({
        user: fixture.customer2,
        params: { id: reviewId },
      })
    );
    assert.equal(reportRes.statusCode, 200);
    assert.equal(reportRes.body.data.alreadyReported, false);
    assert.equal(reportRes.body.data.reportCount, 1);

    // Second report by same user — idempotent
    const dupReportRes = await callController(
      reviewController.reportReview,
      createRequest({
        user: fixture.customer2,
        params: { id: reviewId },
      })
    );
    assert.equal(dupReportRes.statusCode, 200);
    assert.equal(dupReportRes.body.data.alreadyReported, true);
    assert.equal(dupReportRes.body.data.reportCount, 1); // Count unchanged
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 6: Restaurant owner reply ───
test('restaurant owner can reply to review', async () => {
  const suffix = `review_reply_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Create review
    const createRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 3,
          comment: 'Đồ ăn bình thường, phục vụ chậm quá',
        },
      })
    );
    const reviewId = createRes.body.data.id;

    // Owner reply
    const replyRes = await callController(
      ownerReviewController.replyToReview,
      createRequest({
        user: fixture.owner,
        params: { id: reviewId },
        body: { content: 'Cảm ơn bạn đã phản hồi, chúng tôi sẽ cải thiện!' },
      })
    );
    assert.equal(replyRes.statusCode, 200);
    assert.ok(replyRes.body.data.ownerReply);

    // Verify reply in DB
    const review = await Review.findById(reviewId);
    assert.equal(review.ownerReply.content, 'Cảm ơn bạn đã phản hồi, chúng tôi sẽ cải thiện!');
    assert.ok(review.ownerReply.repliedAt);
    assert.equal(review.ownerReply.repliedBy.toString(), fixture.owner._id.toString());

    // Empty reply — should fail
    const emptyReplyRes = await callController(
      ownerReviewController.replyToReview,
      createRequest({
        user: fixture.owner,
        params: { id: reviewId },
        body: { content: '' },
      })
    );
    assert.equal(emptyReplyRes.statusCode, 400);
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 7: Admin hide/restore ───
test('admin can hide and restore review', async () => {
  const suffix = `review_admin_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Create review
    const createRes = await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 1,
          comment: 'Nội dung vi phạm quy định cộng đồng',
        },
      })
    );
    const reviewId = createRes.body.data.id;

    // Hide review — missing reason should fail
    const noReasonRes = await callController(
      adminReviewController.hideReview,
      createRequest({
        user: fixture.admin,
        params: { id: reviewId },
        body: {},
      })
    );
    assert.equal(noReasonRes.statusCode, 400);

    // Hide review — with reason
    const hideRes = await callController(
      adminReviewController.hideReview,
      createRequest({
        user: fixture.admin,
        params: { id: reviewId },
        body: { reason: 'Vi phạm quy định cộng đồng' },
      })
    );
    assert.equal(hideRes.statusCode, 200);
    assert.equal(hideRes.body.data.status, 'hidden');
    assert.equal(hideRes.body.data.hideReason, 'Vi phạm quy định cộng đồng');

    // Cannot hide already hidden
    const doubleHideRes = await callController(
      adminReviewController.hideReview,
      createRequest({
        user: fixture.admin,
        params: { id: reviewId },
        body: { reason: 'Another reason' },
      })
    );
    assert.equal(doubleHideRes.statusCode, 400);

    // Restore review
    const restoreRes = await callController(
      adminReviewController.restoreReview,
      createRequest({
        user: fixture.admin,
        params: { id: reviewId },
      })
    );
    assert.equal(restoreRes.statusCode, 200);
    assert.equal(restoreRes.body.data.status, 'visible');
    assert.equal(restoreRes.body.data.hideReason, null);

    // Cannot restore already visible
    const doubleRestoreRes = await callController(
      adminReviewController.restoreReview,
      createRequest({
        user: fixture.admin,
        params: { id: reviewId },
      })
    );
    assert.equal(doubleRestoreRes.statusCode, 400);
  } finally {
    await cleanup(suffix);
  }
});

// ─── Test 8: Rating summary logic ───
test('rating summary correctly calculates average and distribution', async () => {
  const suffix = `review_summary_${Date.now()}`;
  await cleanup(suffix);

  try {
    const fixture = await createFixture(suffix);

    // Create first review (rating 4)
    await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking._id.toString(),
          rating: 4,
          comment: 'Đánh giá 4 sao cho nhà hàng rất tốt',
        },
      })
    );

    // Create second review (rating 2) using completedBooking2
    await callController(
      reviewController.createReview,
      createRequest({
        user: fixture.customer,
        body: {
          bookingId: fixture.completedBooking2._id.toString(),
          rating: 2,
          comment: 'Đánh giá 2 sao, đồ ăn không ngon lắm',
        },
      })
    );

    // Check rating summary
    const summary = await reviewService.calculateRatingSummary(fixture.restaurant._id);
    assert.equal(summary.totalReviews, 2);
    assert.equal(summary.averageRating, 3); // (4+2)/2 = 3.0
    assert.equal(summary.distribution[4], 1);
    assert.equal(summary.distribution[2], 1);
    assert.equal(summary.distribution[1], 0);
    assert.equal(summary.distribution[3], 0);
    assert.equal(summary.distribution[5], 0);

    // Check restaurant stats were updated
    const restaurant = await Restaurant.findById(fixture.restaurant._id);
    assert.equal(restaurant.stats.averageRating, 3);
    assert.equal(restaurant.stats.totalReviews, 2);

    // Hide one review and verify summary updates
    const reviews = await Review.find({ restaurantId: fixture.restaurant._id });
    const review4star = reviews.find((r) => r.rating === 4);

    await callController(
      adminReviewController.hideReview,
      createRequest({
        user: fixture.admin,
        params: { id: review4star._id.toString() },
        body: { reason: 'Test hide' },
      })
    );

    const summaryAfterHide = await reviewService.calculateRatingSummary(fixture.restaurant._id);
    assert.equal(summaryAfterHide.totalReviews, 1);
    assert.equal(summaryAfterHide.averageRating, 2); // Only 2-star review remains

    const restaurantAfterHide = await Restaurant.findById(fixture.restaurant._id);
    assert.equal(restaurantAfterHide.stats.averageRating, 2);
    assert.equal(restaurantAfterHide.stats.totalReviews, 1);
  } finally {
    await cleanup(suffix);
  }
});
