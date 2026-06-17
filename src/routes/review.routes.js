'use strict';

const express = require('express');
const reviewController = require('../controllers/review.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// ─── Public Routes ───
// Lấy danh sách review của nhà hàng
router.get('/restaurant/:restaurantId', reviewController.getRestaurantReviews);

// ─── Protected Routes (Yêu cầu đăng nhập) ───
router.use(protect);

// Customer gửi đánh giá mới
router.post('/', restrictTo('customer'), reviewController.createReview);

// Customer lấy danh sách đánh giá cá nhân
router.get('/my-reviews', restrictTo('customer'), reviewController.getMyReviews);

// Owner phản hồi đánh giá
router.patch('/:id/reply', restrictTo('restaurant_owner'), reviewController.replyReview);

// Admin cập nhật trạng thái ẩn/hiện đánh giá
router.patch('/:id/status', restrictTo('admin'), reviewController.updateReviewStatus);

// Admin lấy danh sách toàn bộ đánh giá để kiểm duyệt
router.get('/admin/all', restrictTo('admin'), reviewController.adminGetReviews);

module.exports = router;
