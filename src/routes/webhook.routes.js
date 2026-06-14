const express = require('express');
const router = express.Router();
const webhookCtrl = require('../controllers/webhook.controller');

// ─── Webhook Route (Public - không cần JWT) ───
router.post('/payos', webhookCtrl.handlePayOSWebhook);

module.exports = router;
