// ─────────────────────────────────────────────
// Owner Billing Controller
// ─────────────────────────────────────────────
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const Restaurant = require('../models/Restaurant');
const { SUBSCRIPTION_PLANS } = require('../config/payos.config');

// ─── GET /api/v1/owner/billing/current ───
exports.getCurrentSubscription = async (req, res) => {
  try {
    const userId = req.user._id;

    // Tìm nhà hàng thuộc owner
    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Bạn chưa có nhà hàng.' });
    }

    // Tìm subscription active
    const subscription = await Subscription.findOne({
      restaurantId: restaurant._id,
      status: 'active',
      expiredAt: { $gt: new Date() },
    }).populate('paymentId', 'amount paidAt');

    // Nếu không có subscription active -> đang ở gói Free
    const currentPlan = subscription ? subscription.plan : 'free';
    const planInfo = SUBSCRIPTION_PLANS[currentPlan];

    return res.status(200).json({
      success: true,
      data: {
        restaurantId: restaurant._id,
        restaurantName: restaurant.name,
        currentPlan,
        planInfo,
        subscription: subscription || null,
        availablePlans: Object.entries(SUBSCRIPTION_PLANS).map(([key, value]) => ({
          key,
          ...value,
          isCurrent: key === currentPlan,
          canSelect: _canSelectPlan(currentPlan, key),
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/owner/billing/history ───
exports.getBillingHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const payments = await Payment.find({
      userId,
      targetType: 'subscription',
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('restaurantId', 'name');

    const total = await Payment.countDocuments({ userId, targetType: 'subscription' });

    return res.status(200).json({
      success: true,
      data: payments,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Kiểm tra quyền chọn gói ───
function _canSelectPlan(currentPlan, targetPlan) {
  const planOrder = { free: 0, plus: 1, pro: 2 };
  // Chỉ có thể mua gói cao hơn hoặc gia hạn gói hiện tại
  if (targetPlan === 'free') return false; // Free miễn phí, không cần mua
  return planOrder[targetPlan] > planOrder[currentPlan] || targetPlan === currentPlan;
}
