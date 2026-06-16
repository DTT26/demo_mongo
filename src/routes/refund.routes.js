const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const refundCtrl = require('../controllers/refund.controller');

// ─── User/Owner Refund Routes ───
router.post('/request', protect, refundCtrl.createRefundRequest);

module.exports = router;
