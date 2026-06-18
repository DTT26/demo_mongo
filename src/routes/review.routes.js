'use strict';

const express = require('express');
const reviewController = require('../controllers/review.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// ─── Public Routes ───
// Lấy danh sách review của nhà hàng
router.get('/restaurant/:restaurantId', reviewController.getRestaurantReviews);

// Lấy thông tin tóm tắt rating (biểu đồ sao) của nhà hàng
router.get('/restaurant/:restaurantId/rating-summary', reviewController.getRatingSummary);

// ─── Protected Routes (Yêu cầu đăng nhập) ───
router.use(protect);

// Customer lấy danh sách đánh giá cá nhân (hỗ trợ cả /my-reviews và /my để tương thích ngược)
router.get('/my-reviews', reviewController.getMyReviews);
router.get('/my', reviewController.getMyReviews);

// Customer gửi đánh giá mới
router.post('/', restrictTo('customer'), reviewController.createReview);

// Customer chỉnh sửa/xóa đánh giá
router.put('/:id', restrictTo('customer'), reviewController.updateReview);
router.delete('/:id', restrictTo('customer'), reviewController.deleteReview);

// Customer bấm hữu ích hoặc báo cáo vi phạm
router.post('/:id/helpful', reviewController.toggleHelpful);
router.post('/:id/report', reviewController.reportReview);

// Owner phản hồi đánh giá
router.patch('/:id/reply', restrictTo('restaurant_owner'), reviewController.replyReview);
router.post('/:id/reply', restrictTo('restaurant_owner'), reviewController.replyReview); // Hỗ trợ cả POST /reply để tương thích ngược

// Admin cập nhật trạng thái ẩn/hiện đánh giá
router.patch('/:id/status', restrictTo('admin'), reviewController.updateReviewStatus);
router.put('/:id/status', restrictTo('admin'), reviewController.updateReviewStatus); // Hỗ trợ cả PUT /status

// Admin lấy danh sách toàn bộ đánh giá để kiểm duyệt
router.get('/admin/all', restrictTo('admin'), reviewController.adminGetReviews);
router.get('/admin/reported', restrictTo('admin'), reviewController.adminGetReviews); // Hỗ trợ cả /admin/reported

module.exports = router;
