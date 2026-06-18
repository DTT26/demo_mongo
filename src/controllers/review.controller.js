'use strict';

const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const reviewService = require('../services/review.service');

// ─────────────────────────────────────────────
// A. Tạo Đánh Giá (POST /api/v1/reviews)
// ─────────────────────────────────────────────
const createReview = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { bookingId, rating, title, comment, mediaUrls } = req.body;

    // 1. Validate required fields
    if (!bookingId || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp bookingId, rating và comment',
      });
    }

    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({
        success: false,
        message: 'Điểm đánh giá phải là số nguyên từ 1 đến 5',
      });
    }

    if (comment.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Nội dung đánh giá phải có ít nhất 10 ký tự',
      });
    }

    // 2. Check booking exists and belongs to customer
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy booking',
      });
    }

    if (booking.customerId.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền đánh giá booking này',
      });
    }

    // 3. Check booking is completed
    if (booking.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể đánh giá các booking đã hoàn thành',
      });
    }

    // 4. Check duplicate review
    const existingReview = await Review.findOne({ bookingId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã đánh giá booking này rồi',
      });
    }

    // 5. Create review
    const review = new Review({
      customerId,
      restaurantId: booking.restaurantId,
      bookingId,
      rating,
      title: title || null,
      comment,
      mediaUrls: mediaUrls || [],
    });

    await review.save();

    // 6. Update booking reviewed status
    booking.reviewId = review._id;
    booking.reviewed = true;
    await booking.save();

    // 7. Update restaurant rating stats
    await reviewService.updateRestaurantRating(booking.restaurantId);

    return res.status(201).json({
      success: true,
      message: 'Đánh giá đã được tạo thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    // Handle mongoose unique constraint violation
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã đánh giá booking này rồi',
      });
    }
    console.error('❌ [CreateReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đánh giá' });
  }
};

// ─────────────────────────────────────────────
// B. Cập Nhật Đánh Giá (PUT /api/v1/reviews/:id)
// ─────────────────────────────────────────────
const updateReview = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { id } = req.params;
    const { rating, title, comment, mediaUrls } = req.body;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.customerId.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền chỉnh sửa đánh giá này',
      });
    }

    // Validate rating if provided
    if (rating !== undefined) {
      if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({
          success: false,
          message: 'Điểm đánh giá phải là số nguyên từ 1 đến 5',
        });
      }
      review.rating = rating;
    }

    if (comment !== undefined) {
      if (comment.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Nội dung đánh giá phải có ít nhất 10 ký tự',
        });
      }
      review.comment = comment;
    }

    if (title !== undefined) review.title = title;
    if (mediaUrls !== undefined) review.mediaUrls = mediaUrls;

    await review.save();

    // Update restaurant rating if rating changed
    if (rating !== undefined) {
      await reviewService.updateRestaurantRating(review.restaurantId);
    }

    return res.json({
      success: true,
      message: 'Cập nhật đánh giá thành công',
      data: review.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [UpdateReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật đánh giá' });
  }
};

// ─────────────────────────────────────────────
// C. Xóa Đánh Giá (DELETE /api/v1/reviews/:id)
// ─────────────────────────────────────────────
const deleteReview = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.customerId.toString() !== customerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xóa đánh giá này',
      });
    }

    const restaurantId = review.restaurantId;
    const bookingId = review.bookingId;

    await Review.findByIdAndDelete(id);

    // Reset booking reviewed status
    await Booking.findByIdAndUpdate(bookingId, {
      reviewId: null,
      reviewed: false,
    });

    // Update restaurant rating stats
    await reviewService.updateRestaurantRating(restaurantId);

    return res.json({
      success: true,
      message: 'Xóa đánh giá thành công',
    });
  } catch (error) {
    console.error('❌ [DeleteReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xóa đánh giá' });
  }
};

// ─────────────────────────────────────────────
// D. Toggle Helpful (POST /api/v1/reviews/:id/helpful)
// ─────────────────────────────────────────────
const toggleHelpful = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    const alreadyHelpful = review.helpfulUsers.some(
      (uid) => uid.toString() === userId.toString()
    );

    if (alreadyHelpful) {
      // Remove helpful (toggle off)
      review.helpfulUsers = review.helpfulUsers.filter(
        (uid) => uid.toString() !== userId.toString()
      );
      review.helpfulCount = Math.max(0, review.helpfulCount - 1);
    } else {
      // Add helpful (toggle on)
      review.helpfulUsers.push(userId);
      review.helpfulCount += 1;
    }

    await review.save();

    return res.json({
      success: true,
      message: alreadyHelpful ? 'Đã bỏ đánh dấu hữu ích' : 'Đã đánh dấu hữu ích',
      data: {
        helpful: !alreadyHelpful,
        helpfulCount: review.helpfulCount,
      },
    });
  } catch (error) {
    console.error('❌ [ToggleHelpful] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// E. Report Review (POST /api/v1/reviews/:id/report)
// ─────────────────────────────────────────────
const reportReview = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    const alreadyReported = review.reportedBy.some(
      (uid) => uid.toString() === userId.toString()
    );

    if (alreadyReported) {
      return res.json({
        success: true,
        message: 'Bạn đã báo cáo đánh giá này trước đó',
        data: { alreadyReported: true, reportCount: review.reportCount },
      });
    }

    review.reportedBy.push(userId);
    review.reportCount += 1;
    await review.save();

    return res.json({
      success: true,
      message: 'Báo cáo đánh giá thành công',
      data: { alreadyReported: false, reportCount: review.reportCount },
    });
  } catch (error) {
    console.error('❌ [ReportReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// F. Lấy Danh Sách Review Của Customer (GET /api/v1/reviews/my)
// ─────────────────────────────────────────────
const getMyReviews = async (req, res) => {
  try {
    const customerId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ customerId })
        .populate('restaurantId', 'name logo images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments({ customerId }),
    ]);

    return res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => {
          const item = r.toPublicJSON();
          if (r.restaurantId) {
            item.restaurant = {
              name: r.restaurantId.name,
              logo: r.restaurantId.logo,
              primaryImage: r.restaurantId.images?.[0]?.url || null,
            };
          }
          return item;
        }),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetMyReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// G. Lấy Reviews Nhà Hàng — Public (GET /api/v1/restaurants/:restaurantId/reviews)
// ─────────────────────────────────────────────
const getRestaurantReviews = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sort || 'newest'; // newest, oldest, highest, lowest, helpful

    let sort = { createdAt: -1 };
    if (sortBy === 'oldest') sort = { createdAt: 1 };
    else if (sortBy === 'highest') sort = { rating: -1, createdAt: -1 };
    else if (sortBy === 'lowest') sort = { rating: 1, createdAt: -1 };
    else if (sortBy === 'helpful') sort = { helpfulCount: -1, createdAt: -1 };

    const query = { restaurantId, status: 'visible' };

    // Optional filter by rating
    if (req.query.rating) {
      const ratingFilter = parseInt(req.query.rating);
      if (ratingFilter >= 1 && ratingFilter <= 5) {
        query.rating = ratingFilter;
      }
    }

    const [reviews, total, summary] = await Promise.all([
      Review.find(query)
        .populate('customerId', 'fullName avatarUrl')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query),
      reviewService.calculateRatingSummary(
        typeof restaurantId === 'string'
          ? new (require('mongoose').Types.ObjectId)(restaurantId)
          : restaurantId
      ),
    ]);

    return res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => {
          const item = r.toPublicJSON();
          if (r.customerId) {
            item.customer = {
              fullName: r.customerId.fullName,
              avatarUrl: r.customerId.avatarUrl,
            };
          }
          return item;
        }),
        summary,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetRestaurantReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// H. Rating Summary (GET /api/v1/restaurants/:restaurantId/rating-summary)
// ─────────────────────────────────────────────
const getRatingSummary = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const mongoose = require('mongoose');
    const summary = await reviewService.calculateRatingSummary(
      new mongoose.Types.ObjectId(restaurantId)
    );

    return res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('❌ [GetRatingSummary] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

module.exports = {
  createReview,
  updateReview,
  deleteReview,
  toggleHelpful,
  reportReview,
  getMyReviews,
  getRestaurantReviews,
  getRatingSummary,
};
