const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const ownerBillingCtrl = require('../controllers/owner.billing.controller');
const ownerWithdrawalCtrl = require('../controllers/owner.withdrawal.controller');

// ─── Owner Billing Routes ───
router.get('/billing/current', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getCurrentSubscription);
router.get('/billing/history', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getBillingHistory);

// ─── Owner Withdrawal Routes ───
router.post('/withdrawals', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.createWithdrawal);
router.get('/withdrawals', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.getMyWithdrawals);
router.get('/withdrawals/:id', protect, restrictTo('restaurant_owner'), ownerWithdrawalCtrl.getWithdrawalById);

module.exports = router;
