'use strict';

const express = require('express');
const router = express.Router();
const voucherCtrl = require('../controllers/voucher.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

// ─── Public Routes ───
// Lấy danh sách voucher khả dụng trên trang chi tiết nhà hàng (khách vãng lai có thể xem)
router.get('/restaurant/:restaurantId', voucherCtrl.getRestaurantVouchers);
router.get('/campaigns/homepage', voucherCtrl.getHomepageVoucherCampaigns);

// ─── Customer Routes (Yêu cầu đăng nhập + role customer) ───
router.post('/validate', protect, restrictTo('customer'), voucherCtrl.validateVoucherForBooking);
router.post('/save', protect, restrictTo('customer'), voucherCtrl.saveVoucher);
router.get('/my-vouchers', protect, restrictTo('customer'), voucherCtrl.getMyVouchers);

// ─── Owner Routes (Yêu cầu đăng nhập + role owner) ───
router.get('/owner/list', protect, restrictTo('restaurant_owner'), voucherCtrl.getOwnerVouchers);

// ─── Admin Routes (Yêu cầu đăng nhập + role admin) ───
router.get('/admin/list', protect, restrictTo('admin'), voucherCtrl.getAdminVouchers);

// ─── Shared Owner & Admin Routes (Yêu cầu đăng nhập + role owner/admin) ───
router.post('/', protect, restrictTo('restaurant_owner', 'admin'), voucherCtrl.createVoucher);
router.put('/:id', protect, restrictTo('restaurant_owner', 'admin'), voucherCtrl.updateVoucher);
router.delete('/:id', protect, restrictTo('restaurant_owner', 'admin'), voucherCtrl.deleteVoucher);
router.get('/:id/stats', protect, restrictTo('restaurant_owner', 'admin'), voucherCtrl.getVoucherStats);

module.exports = router;
