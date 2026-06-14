const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const ownerBillingCtrl = require('../controllers/owner.billing.controller');

// ─── Owner Billing Routes ───
router.get('/billing/current', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getCurrentSubscription);
router.get('/billing/history', protect, restrictTo('restaurant_owner'), ownerBillingCtrl.getBillingHistory);

module.exports = router;
