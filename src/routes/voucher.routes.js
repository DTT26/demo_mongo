'use strict';

const express = require('express');
const router = express.Router();
const voucherCtrl = require('../controllers/voucher.controller');
const ownerVoucherCtrl = require('../controllers/owner.voucher.controller');
const adminVoucherCtrl = require('../controllers/admin.voucher.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

// ─── Public Routes ───
router.get('/restaurant/:restaurantId', voucherCtrl.getRestaurantVouchers);
router.get('/platform', voucherCtrl.getPlatformVouchers); // Get platform vouchers list

// ─── Customer Routes (Auth required, role customer) ───
router.post('/validate', protect, restrictTo('customer'), voucherCtrl.validateVoucherForBooking);
router.post('/save', protect, restrictTo('customer'), voucherCtrl.saveVoucher);
router.delete('/unsave/:voucherId', protect, restrictTo('customer'), voucherCtrl.unsaveVoucher);
router.get('/my-vouchers', protect, restrictTo('customer'), voucherCtrl.getMyVouchers);
router.get('/my-history', protect, restrictTo('customer'), voucherCtrl.getMyVouchersHistory);

// ─── Public Routes (Parameterized must be defined after static) ───
router.get('/:id', voucherCtrl.getVoucherById);

// ─── Owner Routes (Auth required, role restaurant_owner) ───
router.get('/owner/list', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.getOwnerVouchers);
router.post('/owner/vouchers', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.createOwnerVoucher);
router.get('/owner/vouchers/redemptions', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.getOwnerRestaurantRedemptions);
router.put('/owner/vouchers/:id', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.updateOwnerVoucher);
router.patch('/owner/vouchers/:id/status', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.changeOwnerVoucherStatus);
router.delete('/owner/vouchers/:id', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.deleteOwnerVoucher);
router.get('/owner/vouchers/:id/stats', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.getOwnerVoucherStats);
router.get('/owner/vouchers/:id/redemptions', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.getOwnerVoucherRedemptions);
router.get('/owner/vouchers/analytics', protect, restrictTo('restaurant_owner'), ownerVoucherCtrl.getOwnerVouchersAnalytics);

// ─── Admin Routes (Auth required, role admin) ───
router.get('/admin/list', protect, restrictTo('admin'), adminVoucherCtrl.getAdminVouchers);
router.post('/admin/vouchers', protect, restrictTo('admin'), adminVoucherCtrl.createPlatformVoucher);
router.put('/admin/vouchers/:id', protect, restrictTo('admin'), adminVoucherCtrl.updateAdminVoucher);
router.patch('/admin/vouchers/:id/status', protect, restrictTo('admin'), adminVoucherCtrl.changeAdminVoucherStatus);
router.delete('/admin/vouchers/:id', protect, restrictTo('admin'), adminVoucherCtrl.deleteAdminVoucher);
router.get('/admin/vouchers/analytics', protect, restrictTo('admin'), adminVoucherCtrl.getAdminVouchersAnalytics);
router.get('/admin/vouchers/fraud-report', protect, restrictTo('admin'), adminVoucherCtrl.getAdminVouchersFraudReport);
router.post('/admin/vouchers/:id/reset-usage', protect, restrictTo('admin'), adminVoucherCtrl.resetAdminVoucherUsage);
router.post('/admin/vouchers/compensation', protect, restrictTo('admin'), adminVoucherCtrl.issueAdminVoucherCompensation);

// ─── Admin Campaign Routes ───
router.post('/admin/campaigns', protect, restrictTo('admin'), adminVoucherCtrl.createAdminCampaign);
router.get('/admin/campaigns', protect, restrictTo('admin'), adminVoucherCtrl.getAdminCampaigns);
router.put('/admin/campaigns/:id', protect, restrictTo('admin'), adminVoucherCtrl.updateAdminCampaign);

// ─── Shared Owner & Admin Legacy Routes (for backwards compatibility/routing integrity) ───
router.post('/', protect, restrictTo('restaurant_owner', 'admin'), (req, res, next) => {
  if (req.user.role === 'admin') return adminVoucherCtrl.createPlatformVoucher(req, res, next);
  return ownerVoucherCtrl.createOwnerVoucher(req, res, next);
});
router.put('/:id', protect, restrictTo('restaurant_owner', 'admin'), (req, res, next) => {
  if (req.user.role === 'admin') return adminVoucherCtrl.updateAdminVoucher(req, res, next);
  return ownerVoucherCtrl.updateOwnerVoucher(req, res, next);
});
router.delete('/:id', protect, restrictTo('restaurant_owner', 'admin'), (req, res, next) => {
  if (req.user.role === 'admin') return adminVoucherCtrl.deleteAdminVoucher(req, res, next);
  return ownerVoucherCtrl.deleteOwnerVoucher(req, res, next);
});
router.get('/:id/stats', protect, restrictTo('restaurant_owner', 'admin'), (req, res, next) => {
  if (req.user.role === 'admin') return adminVoucherCtrl.resetAdminVoucherUsage(req, res, next);
  return ownerVoucherCtrl.getOwnerVoucherStats(req, res, next);
});

// ─── Internal APIs (Server-to-server validation & execution loops) ───
router.post('/internal/redeem', voucherCtrl.redeemVoucherInternal);
router.post('/internal/reverse', voucherCtrl.reverseVoucherInternal);

module.exports = router;
