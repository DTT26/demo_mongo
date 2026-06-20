const cron = require('node-cron');
const Subscription = require('../models/Subscription');

const expireSubscriptions = async () => {
  const now = new Date();
  const expiredSubs = await Subscription.find({
    status: 'active',
    $or: [
      { currentPeriodEnd: { $lte: now } },
      { expiredAt: { $lte: now } },
    ],
  });

  for (const subscription of expiredSubs) {
    subscription.status = 'expired';
    await subscription.save();
    console.log(`Subscription expired: owner=${subscription.ownerId}, restaurant=${subscription.restaurantId}, plan=${subscription.planCode || subscription.plan}`);
  }

  return expiredSubs.length;
};

const startSubscriptionExpiryJob = () => {
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running subscription expiry check...');
      const expiredCount = await expireSubscriptions();
      console.log(`${expiredCount} subscription(s) expired. Effective plan falls back to Free.`);
    } catch (error) {
      console.error('Subscription expiry job error:', error);
    }
  });

  console.log('Subscription expiry cron job scheduled (daily at 00:00)');
};

module.exports = { expireSubscriptions, startSubscriptionExpiryJob };
