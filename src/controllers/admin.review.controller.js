'use strict';

const Review = require('../models/Review');
const reviewService = require('../services/review.service');

// ─────────────────────────────────────────────
// A. Lấy Danh Sách Review Bị Report (GET /api/v1/admin/reviews/reported)
// ─────────────────────────────────────────────
const getReportedReviews = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const query = { reportCount: { $gt: 0 } };

    // Optional filter by status
    if (req.query.status) {
      if (req.query.status === 'visible') {
        query.status = { $ne: 'hidden' };
      } else if (['approved', 'reported', 'hidden'].includes(req.query.status)) {
        query.status = req.query.status;
      }
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('customerId', 'fullName email avatarUrl')
        .populate('restaurantId', 'name')
        .sort({ reportCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => {
          const item = r.toAdminJSON();
          if (r.customerId) {
            item.customer = {
              fullName: r.customerId.fullName,
              email: r.customerId.email,
              avatarUrl: r.customerId.avatarUrl,
            };
          }
          if (r.restaurantId) {
            item.restaurant = { name: r.restaurantId.name };
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
    console.error('❌ [GetReportedReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// B. Ẩn Review (PUT /api/v1/admin/reviews/:id/hide)
// ─────────────────────────────────────────────
const hideReview = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Lý do ẩn đánh giá là bắt buộc',
      });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.status === 'hidden') {
      return res.status(400).json({
        success: false,
        message: 'Đánh giá này đã bị ẩn trước đó',
      });
    }

    review.status = 'hidden';
    review.hiddenBy = adminId;
    review.hiddenAt = new Date();
    review.hideReason = reason.trim();
    await review.save();

    // Recalculate restaurant rating
    await reviewService.updateRestaurantRating(review.restaurantId);

    return res.json({
      success: true,
      message: 'Đã ẩn đánh giá thành công',
      data: review.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [HideReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

// ─────────────────────────────────────────────
// C. Khôi Phục Review (PUT /api/v1/admin/reviews/:id/restore)
// ─────────────────────────────────────────────
const restoreReview = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    if (review.status !== 'hidden') {
      return res.status(400).json({
        success: false,
        message: 'Đánh giá này đang hiển thị, không cần khôi phục',
      });
    }

    review.status = 'approved';
    review.hiddenBy = null;
    review.hiddenAt = null;
    review.hideReason = null;
    await review.save();

    // Recalculate restaurant rating
    await reviewService.updateRestaurantRating(review.restaurantId);

    return res.json({
      success: true,
      message: 'Khôi phục đánh giá thành công',
      data: review.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [RestoreReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ' });
  }
};

module.exports = {
  getReportedReviews,
  hideReview,
  restoreReview,
};
