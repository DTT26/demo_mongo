const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const ownerBillingCtrl = require('../controllers/owner.billing.controller');
const ownerFeaturedCtrl = require('../controllers/owner.featured.controller');
const ownerVoucherCampaignCtrl = require('../controllers/owner.voucher-campaign.controller');
const ownerWithdrawalCtrl = require('../controllers/owner.withdrawal.controller');
const bookingCommissionCtrl = require('../controllers/booking-commission.controller');

// ─── Owner Billing Routes ───
router.get('/billing/plans', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getPlans);
router.get('/billing/current-subscription', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getCurrentSubscription);
router.post('/billing/subscription/checkout', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.checkoutSubscription);
router.get('/billing/transactions', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getTransactions);
router.get('/billing/transactions/:id', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getTransactionById);

// Backward-compatible aliases used by the existing frontend.
router.get('/billing/current', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getCurrentSubscription);
router.get('/billing/history', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getBillingHistory);

// ─── Owner Withdrawal Routes ───
router.get('/monetization/featured/packages', protect, restrictTo('restaurant_owner'), ownerFeaturedCtrl.getFeaturedPackages);
router.post('/monetization/featured/checkout', protect, restrictTo('restaurant_owner'), ownerFeaturedCtrl.checkoutFeaturedPlacement);
router.get('/monetization/featured', protect, restrictTo('restaurant_owner'), ownerFeaturedCtrl.getFeaturedPlacements);
router.get('/monetization/voucher-campaign/packages', protect, restrictTo('restaurant_owner'), ownerVoucherCampaignCtrl.getPackages);
router.post('/monetization/voucher-campaign/checkout', protect, restrictTo('restaurant_owner'), ownerVoucherCampaignCtrl.checkout);
router.get('/monetization/voucher-campaigns', protect, restrictTo('restaurant_owner'), ownerVoucherCampaignCtrl.getCampaigns);
router.get('/monetization/booking-commissions', protect, restrictTo('restaurant_owner'), bookingCommissionCtrl.getOwnerCommissions);

router.post('/withdrawals', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.createWithdrawal);
router.get('/withdrawals', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.getMyWithdrawals);
router.get('/withdrawals/:id', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.getWithdrawalById);

module.exports = router;
