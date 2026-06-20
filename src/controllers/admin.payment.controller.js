// ─────────────────────────────────────────────
// Admin Payment/Revenue Controller
// ─────────────────────────────────────────────
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const WebhookLog = require('../models/WebhookLog');
const Subscription = require('../models/Subscription');
const BookingCommissionLedger = require('../models/BookingCommissionLedger');

// ─── GET /api/v1/admin/payments ───
exports.getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, targetType, startDate, endDate } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (targetType) filter.targetType = targetType;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('userId', 'fullName email role')
      .populate('restaurantId', 'name');

    const total = await Payment.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: payments,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/admin/transactions ───
exports.getAllTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate({
        path: 'paymentId',
        select: 'userId targetType targetId amount orderCode restaurantId',
        populate: [
          { path: 'userId', select: 'fullName email' },
          { path: 'restaurantId', select: 'name' },
        ],
      });

    const total = await Transaction.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/admin/revenue ───
exports.getRevenue = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const matchDate = {};
    if (startDate) matchDate.$gte = new Date(startDate);
    if (endDate) matchDate.$lte = new Date(endDate);

    const dateFilter = Object.keys(matchDate).length > 0 ? { paidAt: matchDate } : {};

    // Tổng doanh thu theo loại
    const revenueByType = await Payment.aggregate([
      { $match: { status: 'paid', ...dateFilter } },
      {
        $group: {
          _id: '$targetType',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Tổng hoàn tiền
    const refundTotal = await Payment.aggregate([
      { $match: { status: { $in: ['refunded', 'partially_refunded'] }, ...dateFilter } },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Doanh thu theo ngày (30 ngày gần nhất)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'paid',
          paidAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Tổng hợp
    const subscriptionRevenue = revenueByType.find(r => r._id === 'subscription') || { total: 0, count: 0 };
    const bookingRevenue = revenueByType.find(r => r._id === 'booking') || { total: 0, count: 0 };
    const featuredRevenue = revenueByType.find(r => r._id === 'featured_restaurant') || { total: 0, count: 0 };
    const voucherCampaignRevenue = revenueByType.find(r => r._id === 'voucher_campaign') || { total: 0, count: 0 };
    const bookingFeeRevenue = revenueByType.find(r => r._id === 'booking_fee') || { total: 0, count: 0 };
    const depositPlatformFeeRevenue = revenueByType.find(r => r._id === 'deposit_platform_fee') || { total: 0, count: 0 };
    const refund = refundTotal[0] || { total: 0, count: 0 };

    const totalRevenue = revenueByType.reduce((sum, item) => sum + item.total, 0);
    const netRevenue = totalRevenue - refund.total;

    // Số lượng subscription active
    const activeSubscriptions = await Subscription.countDocuments({
      status: 'active',
      $or: [
        { currentPeriodEnd: { $gt: new Date() } },
        { expiredAt: { $gt: new Date() } },
      ],
    });

    const commissionDateFilter = Object.keys(matchDate).length > 0 ? { createdAt: matchDate } : {};
    let commissionRows = [];
    if (BookingCommissionLedger.db.readyState === 1) {
      try {
        commissionRows = await BookingCommissionLedger.aggregate([
          { $match: commissionDateFilter },
          {
            $group: {
              _id: '$status',
              total: { $sum: '$commissionAmount' },
              count: { $sum: 1 },
            },
          },
        ]);
      } catch (commissionError) {
        // Paid PayOS revenue remains available if the projected ledger summary is unavailable.
        console.warn(`[AdminRevenue/BookingCommission] ${commissionError.message}`);
      }
    }
    const commissionByStatus = Object.fromEntries(
      commissionRows.map((item) => [item._id, { total: item.total, count: item.count }])
    );
    const pendingCommission = commissionByStatus.pending || { total: 0, count: 0 };
    const billableCommission = commissionByStatus.billable || { total: 0, count: 0 };
    const paidCommission = commissionByStatus.paid || { total: 0, count: 0 };

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        paidRevenue: totalRevenue,
        netRevenue,
        projectedBookingCommission: pendingCommission.total + billableCommission.total,
        billableBookingCommission: billableCommission.total,
        paidBookingCommission: paidCommission.total,
        revenueByType,
        subscriptionRevenue: { total: subscriptionRevenue.total, count: subscriptionRevenue.count },
        bookingRevenue: { total: bookingRevenue.total, count: bookingRevenue.count },
        featuredRevenue: { total: featuredRevenue.total, count: featuredRevenue.count },
        voucherCampaignRevenue: { total: voucherCampaignRevenue.total, count: voucherCampaignRevenue.count },
        bookingFeeRevenue: { total: bookingFeeRevenue.total, count: bookingFeeRevenue.count },
        depositPlatformFeeRevenue: { total: depositPlatformFeeRevenue.total, count: depositPlatformFeeRevenue.count },
        refundTotal: { total: refund.total, count: refund.count },
        activeSubscriptions,
        dailyRevenue,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/admin/webhook-logs ───
exports.getWebhookLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const logs = await WebhookLog.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await WebhookLog.countDocuments();

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
