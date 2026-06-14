// ─────────────────────────────────────────────
// Subscription Service — Cron job hết hạn gói dịch vụ
// ─────────────────────────────────────────────
const cron = require('node-cron');
const Subscription = require('../models/Subscription');

// Chạy mỗi ngày lúc 0:00
const startSubscriptionExpiryJob = () => {
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('🔄 Running subscription expiry check...');

      const now = new Date();
      const expiredSubs = await Subscription.find({
        status: 'active',
        expiredAt: { $lte: now },
      });

      if (expiredSubs.length === 0) {
        console.log('✅ No expired subscriptions found.');
        return;
      }

      for (const sub of expiredSubs) {
        sub.status = 'expired';
        await sub.save();
        console.log(`⏰ Subscription expired: owner=${sub.ownerId}, restaurant=${sub.restaurantId}, plan=${sub.plan}`);
      }

      console.log(`✅ ${expiredSubs.length} subscription(s) expired and downgraded to Free.`);
    } catch (error) {
      console.error('❌ Subscription expiry job error:', error);
    }
  });

  console.log('⏰ Subscription expiry cron job scheduled (daily at 00:00)');
};

module.exports = { startSubscriptionExpiryJob };
