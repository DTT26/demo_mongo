'use strict';

const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const reviewService = require('../services/review.service');

// Hỗ trợ gửi thông báo Socket.io realtime
const emitNotification = (io, room, event, payload) => {
  if (io) {
    io.to(room).emit(event, payload);
  }
};

/**
 * 1. Khách hàng tạo đánh giá mới (POST /api/v1/reviews)
 */
const createReview = async (req, res) => {
  try {
    const { bookingId, rating, comment, images } = req.body;
    const userId = req.user._id;

    // Validate inputs
    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đặt bàn (bookingId)' });
    }
    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
      return res.status(400).json({ success: false, message: 'Số sao đánh giá phải là số nguyên từ 1 đến 5' });
    }
    if (!comment || comment.trim().length < 10 || comment.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'Bình luận phải có độ dài từ 10 đến 1000 ký tự' });
    }

    // Kiểm tra booking tồn tại
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đặt bàn này' });
    }

    // Kiểm tra quyền sở hữu booking
    if (booking.customerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền đánh giá đặt bàn này' });
    }

    // Kiểm tra trạng thái booking phải completed
    if (booking.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể đánh giá đặt bàn đã hoàn thành (completed)' });
    }

    // Kiểm tra xem đã đánh giá chưa
    if (booking.reviewed) {
      return res.status(400).json({ success: false, message: 'Đặt bàn này đã được đánh giá trước đó' });
    }

    // Tạo review mới
    const review = new Review({
      bookingId,
      userId,
      restaurantId: booking.restaurantId,
      rating: ratingNum,
      comment: comment.trim(),
      images: images || [],
      status: 'approved' // Mặc định tự động duyệt
    });

    await review.save();

    // Cập nhật booking
    booking.reviewed = true;
    booking.reviewId = review._id;
    await booking.save();

    // Cập nhật rating trung bình và lượt review cho Restaurant
    await reviewService.updateRestaurantRating(booking.restaurantId);

    // Gửi thông báo socket realtime cho Owner và Admin
    const io = req.app.get('io');
    const restaurant = await Restaurant.findById(booking.restaurantId);
    if (restaurant) {
      // Gửi cho Owner
      emitNotification(io, `restaurant:${restaurant._id.toString()}`, 'review:created', {
        reviewId: review._id,
        restaurantId: restaurant._id,
        rating: ratingNum,
        message: `Nhà hàng của bạn nhận được đánh giá ${ratingNum}★ mới từ khách hàng ${booking.customerName}`
      });
      emitNotification(io, `user:${restaurant.ownerId.toString()}`, 'review:created', {
        reviewId: review._id,
        restaurantId: restaurant._id,
        rating: ratingNum,
        message: `Nhà hàng của bạn nhận được đánh giá ${ratingNum}★ mới từ khách hàng ${booking.customerName}`
      });
    }
    
    // Gửi cho Admin
    emitNotification(io, 'admin', 'review:created', {
      reviewId: review._id,
      restaurantId: booking.restaurantId,
      rating: ratingNum,
      message: `Đánh giá mới ${ratingNum}★ tại nhà hàng ${restaurant ? restaurant.name : ''}`
    });

    return res.status(201).json({
      success: true,
      message: 'Đánh giá nhà hàng thành công',
      data: {
        reviewId: review._id
      }
    });
  } catch (error) {
    console.error('❌ [CreateReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đánh giá' });
  }
};

/**
 * 2. Lấy danh sách đánh giá của một Nhà hàng (GET /api/v1/reviews/restaurant/:restaurantId)
 */
const getRestaurantReviews = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const rating = req.query.rating ? Number(req.query.rating) : null;

    const query = { restaurantId, status: 'approved' };
    if (rating && rating >= 1 && rating <= 5) {
      query.rating = rating;
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName avatarUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query)
    ]);

    return res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ [GetRestaurantReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải đánh giá nhà hàng' });
  }
};

/**
 * 3. Lấy danh sách đánh giá cá nhân (GET /api/v1/reviews/my-reviews)
 */
const getMyReviews = async (req, res) => {
  try {
    const userId = req.user._id;
    const reviews = await Review.find({ userId })
      .populate('restaurantId', 'name logo address')
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    console.error('❌ [GetMyReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải đánh giá cá nhân' });
  }
};

/**
 * 4. Chủ nhà hàng phản hồi đánh giá (PATCH /api/v1/reviews/:id/reply)
 */
const replyReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length < 5 || comment.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Nội dung phản hồi phải từ 5 đến 500 ký tự' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá này' });
    }

    // Kiểm tra xem nhà hàng đó có phải của user hiện tại không
    const restaurant = await Restaurant.findById(review.restaurantId);
    if (!restaurant || restaurant.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền phản hồi đánh giá này' });
    }

    review.ownerReply = {
      comment: comment.trim(),
      repliedAt: new Date()
    };

    await review.save();

    // Gửi socket notify cho người viết review
    const io = req.app.get('io');
    emitNotification(io, `user:${review.userId.toString()}`, 'review:replied', {
      reviewId: review._id,
      restaurantId: review.restaurantId,
      message: `Nhà hàng ${restaurant.name} đã phản hồi đánh giá của bạn!`
    });

    return res.json({
      success: true,
      message: 'Gửi phản hồi đánh giá thành công',
      data: review
    });
  } catch (error) {
    console.error('❌ [ReplyReview] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi gửi phản hồi đánh giá' });
  }
};

/**
 * 5. Admin ẩn/hiện đánh giá (PATCH /api/v1/reviews/:id/status)
 */
const updateReviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['approved', 'reported', 'hidden'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá này' });
    }

    review.status = status;
    await review.save();

    // Cập nhật lại stats rating nhà hàng
    await reviewService.updateRestaurantRating(review.restaurantId);

    return res.json({
      success: true,
      message: `Cập nhật trạng thái đánh giá thành công thành: ${status}`,
      data: review
    });
  } catch (error) {
    console.error('❌ [UpdateReviewStatus] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật trạng thái đánh giá' });
  }
};

/**
 * 6. Admin lấy toàn bộ đánh giá (GET /api/v1/reviews/admin/all)
 */
const adminGetReviews = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const { status } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName email')
        .populate('restaurantId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments(query)
    ]);

    return res.json({
      success: true,
      data: reviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('❌ [AdminGetReviews] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách đánh giá của quản trị viên' });
  }
};

module.exports = {
  createReview,
  getRestaurantReviews,
  getMyReviews,
  replyReview,
  updateReviewStatus,
  adminGetReviews
};
