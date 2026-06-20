const Restaurant = require('../models/Restaurant');
const Subscription = require('../models/Subscription');
const { SUBSCRIPTION_PLANS, getPlanCode } = require('../config/payos.config');
const { getPlanByCode } = require('./monetization-plan.service');

const FEATURE_TO_BENEFIT = {
  owner_ai: 'allowAiOwner',
  ownerAi: 'allowAiOwner',
  'ai.owner.basic': 'allowAiOwner',
  'ai.owner.analytics': 'allowAnalytics',
  featured_restaurant: 'allowFeaturedPurchase',
  featuredPurchase: 'allowFeaturedPurchase',
  'featured.purchase': 'allowFeaturedPurchase',
  'voucher.basic': 'allowVoucherBasic',
  'voucher.advanced': 'allowVoucherAdvanced',
  voucher_campaign: 'allowVoucherCampaignPurchase',
  voucherCampaignPurchase: 'allowVoucherCampaignPurchase',
  'voucherCampaign.purchase': 'allowVoucherCampaignPurchase',
  booking_fee_waived: 'bookingFeeWaived',
  'booking.monthly.limit': 'bookingMonthlyLimit',
  realtime: 'allowRealtime',
  analytics: 'allowAnalytics',
  'analytics.advanced': 'allowAnalytics',
  priority_support: 'prioritySupport',
};

const isSubscriptionExpired = (subscription, now = new Date()) => {
  const end = subscription.currentPeriodEnd || subscription.expiredAt;
  return Boolean(end && end <= now);
};

const expireSubscriptionIfNeeded = async (subscription, now = new Date()) => {
  if (!subscription || subscription.status !== 'active' || !isSubscriptionExpired(subscription, now)) {
    return subscription;
  }
  subscription.status = 'expired';
  await subscription.save();
  return null;
};

const getActiveSubscriptionForRestaurant = async (restaurantId) => {
  let restaurant = null;
  try {
    const query = Restaurant.findById(restaurantId);
    if (query && typeof query.select === 'function') {
      const selected = query.select('ownerId');
      restaurant = typeof selected.lean === 'function' ? await selected.lean() : await selected;
    } else if (query) {
      restaurant = await query;
    }
  } catch (err) {
    // ignored
  }

  let filter = { restaurantId, status: 'active' };
  if (restaurant?.ownerId) {
    filter = { ownerId: restaurant.ownerId, status: 'active' };
  }

  const subscription = await Subscription.findOne(filter)
    .sort({ planCode: -1, currentPeriodEnd: -1, expiredAt: -1, createdAt: -1 });

  return expireSubscriptionIfNeeded(subscription);
};

const getEffectivePlanForRestaurant = async (restaurantId) => {
  const subscription = await getActiveSubscriptionForRestaurant(restaurantId);
  const planCode = getPlanCode(subscription?.planCode || subscription?.plan || 'free') || 'free';
  const plan = SUBSCRIPTION_PLANS[planCode] || await getPlanByCode(planCode);
  return {
    planCode,
    plan,
    subscription,
    benefits: subscription?.benefitsSnapshot || plan?.benefits || SUBSCRIPTION_PLANS.free.benefits,
  };
};

const assertOwnerRestaurant = async (ownerId, restaurantId) => {
  const restaurant = await Restaurant.findById(restaurantId).select('_id ownerId name');
  if (!restaurant) {
    const error = new Error('Restaurant not found');
    error.statusCode = 404;
    error.code = 'RESTAURANT_NOT_FOUND';
    throw error;
  }
  if (String(restaurant.ownerId) !== String(ownerId)) {
    const error = new Error('Restaurant does not belong to owner');
    error.statusCode = 403;
    error.code = 'OWNER_RESTAURANT_FORBIDDEN';
    throw error;
  }
  return restaurant;
};

const canUseFeature = async (ownerId, featureCode, restaurantId) => {
  if (!restaurantId) {
    return {
      allowed: false,
      reason: 'RESTAURANT_REQUIRED',
      planCode: 'free',
    };
  }

  await assertOwnerRestaurant(ownerId, restaurantId);
  const { planCode, subscription, benefits } = await getEffectivePlanForRestaurant(restaurantId);
  const benefitKey = FEATURE_TO_BENEFIT[featureCode] || featureCode;
  const benefitValue = benefits?.[benefitKey];
  const isLimit = typeof benefitValue === 'number';
  const allowed = isLimit ? benefitValue !== 0 : Boolean(benefitValue);

  return {
    allowed,
    reason: allowed ? null : 'FEATURE_NOT_INCLUDED_IN_PLAN',
    planCode,
    subscriptionId: subscription?._id || null,
    benefitKey,
    limit: isLimit ? benefitValue : undefined,
  };
};

const getHighestActivePlanForOwner = async (ownerId) => {
  const subscriptions = await Subscription.find({
    ownerId,
    status: 'active',
  });

  let highestPlanCode = 'free';
  let highestPlanLevel = 0; // free

  const planLevels = { free: 0, plus: 1, pro: 2 };

  for (const sub of subscriptions) {
    const activeSub = await expireSubscriptionIfNeeded(sub);
    if (activeSub && activeSub.status === 'active') {
      const code = getPlanCode(activeSub.planCode || activeSub.plan || 'free') || 'free';
      const level = planLevels[code] || 0;
      if (level > highestPlanLevel) {
        highestPlanLevel = level;
        highestPlanCode = code;
      }
    }
  }

  return highestPlanCode;
};

const getRestaurantUsage = async (ownerId) => {
  return await Restaurant.countDocuments({ ownerId, deletedAt: null });
};

const canCreateRestaurant = async (ownerId) => {
  const planCode = await getHighestActivePlanForOwner(ownerId);
  const plan = SUBSCRIPTION_PLANS[planCode];
  const limit = plan?.limits?.maxRestaurants ?? 1;
  const currentCount = await getRestaurantUsage(ownerId);
  const allowed = currentCount < limit;
  const remaining = Math.max(0, limit - currentCount);

  let recommendedPlan = null;
  if (planCode === 'free') {
    recommendedPlan = 'plus';
  } else if (planCode === 'plus') {
    recommendedPlan = 'pro';
  }

  return {
    allowed,
    planCode,
    currentCount,
    limit,
    remaining,
    reasonCode: allowed ? null : 'RESTAURANT_LIMIT_REACHED',
    recommendedPlan,
  };
};

module.exports = {
  FEATURE_TO_BENEFIT,
  assertOwnerRestaurant,
  canUseFeature,
  expireSubscriptionIfNeeded,
  getActiveSubscriptionForRestaurant,
  getEffectivePlanForRestaurant,
  getHighestActivePlanForOwner,
  getRestaurantUsage,
  canCreateRestaurant,
};
