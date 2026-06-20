'use strict';

const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Subscription = require('../models/Subscription');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const VoucherCampaignPurchase = require('../models/VoucherCampaignPurchase');
const BookingCommissionLedger = require('../models/BookingCommissionLedger');

const PAID_REVENUE_TARGET_TYPES = ['subscription', 'featured_restaurant', 'voucher_campaign'];
const PAYMENT_TARGET_TYPES = [
  'subscription',
  'featured_restaurant',
  'voucher_campaign',
  'booking_fee',
  'deposit_platform_fee',
  'booking',
];
const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
];
const LEDGER_STATUSES = ['pending', 'billable', 'waived', 'cancelled', 'paid'];

class AdminMonetizationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AdminMonetizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const parsePositiveInteger = (value, fallback, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const parseDateBoundary = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AdminMonetizationError('INVALID_DATE_FILTER', 'Khoang ngay khong hop le.');
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

const buildDateRange = (filters = {}) => {
  const fromDate = parseDateBoundary(filters.fromDate || filters.startDate);
  const toDate = parseDateBoundary(filters.toDate || filters.endDate, true);
  if (fromDate && toDate && fromDate > toDate) {
    throw new AdminMonetizationError('INVALID_DATE_RANGE', 'Ngay bat dau phai truoc ngay ket thuc.');
  }
  return { fromDate, toDate };
};

const buildDateFilter = (filters, fieldName) => {
  const { fromDate, toDate } = buildDateRange(filters);
  if (!fromDate && !toDate) return null;
  return {
    [fieldName]: {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {}),
    },
  };
};

const isObjectIdLike = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toObjectId = (value, fieldName) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!isObjectIdLike(value)) {
    throw new AdminMonetizationError('INVALID_OBJECT_ID', `${fieldName} khong hop le.`);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const validateEnum = (value, allowedValues, code, message) => {
  if (value && !allowedValues.includes(value)) {
    throw new AdminMonetizationError(code, message);
  }
};

const resolveQuery = async (query, lean = false) => {
  if (lean && typeof query?.lean === 'function') return query.lean();
  return query;
};

const buildPeriod = (filters = {}) => {
  const { fromDate, toDate } = buildDateRange(filters);
  return {
    fromDate: fromDate ? fromDate.toISOString() : null,
    toDate: toDate ? toDate.toISOString() : null,
  };
};

const normalizeFilters = (filters = {}) => {
  validateEnum(filters.targetType, PAYMENT_TARGET_TYPES, 'INVALID_TARGET_TYPE', 'Loai doanh thu khong hop le.');
  validateEnum(
    filters.status,
    [...new Set([...PAYMENT_STATUSES, ...LEDGER_STATUSES])],
    'INVALID_STATUS',
    'Trang thai khong hop le.'
  );

  return {
    ...filters,
    page: parsePositiveInteger(filters.page, 1, Number.MAX_SAFE_INTEGER),
    limit: parsePositiveInteger(filters.limit, 20, 100),
    ownerId: filters.ownerId ? toObjectId(filters.ownerId, 'ownerId') : null,
    restaurantId: filters.restaurantId ? toObjectId(filters.restaurantId, 'restaurantId') : null,
  };
};

const shouldIncludePaidRevenue = (filters = {}) => {
  if (filters.status && filters.status !== 'paid') return false;
  if (filters.targetType && !PAID_REVENUE_TARGET_TYPES.includes(filters.targetType)) return false;
  return true;
};

const shouldIncludeLedger = (filters = {}) => {
  if (filters.targetType && filters.targetType !== 'booking_fee') return false;
  if (filters.status && !LEDGER_STATUSES.includes(filters.status)) return false;
  return true;
};

const buildPaidPaymentMatch = (filters = {}) => {
  if (!shouldIncludePaidRevenue(filters)) return null;

  const match = {
    status: 'paid',
    targetType: filters.targetType || { $in: PAID_REVENUE_TARGET_TYPES },
  };
  if (filters.ownerId) match.userId = filters.ownerId;
  if (filters.restaurantId) match.restaurantId = filters.restaurantId;

  const paidAtFilter = buildDateFilter(filters, 'paidAt');
  if (paidAtFilter) Object.assign(match, paidAtFilter);

  return match;
};

const buildPaymentListMatch = (filters = {}) => {
  const match = {};
  if (filters.status) match.status = filters.status;
  if (filters.targetType) match.targetType = filters.targetType;
  if (filters.ownerId) match.userId = filters.ownerId;
  if (filters.restaurantId) match.restaurantId = filters.restaurantId;

  const createdAtFilter = buildDateFilter(filters, 'createdAt');
  if (createdAtFilter) Object.assign(match, createdAtFilter);

  return match;
};

const buildLedgerMatch = (filters = {}) => {
  if (!shouldIncludeLedger(filters)) return null;

  const match = {};
  if (filters.ownerId) match.ownerId = filters.ownerId;
  if (filters.restaurantId) match.restaurantId = filters.restaurantId;
  if (filters.status) match.status = filters.status;

  const createdAtFilter = buildDateFilter(filters, 'createdAt');
  if (createdAtFilter) Object.assign(match, createdAtFilter);

  return match;
};

const zeroPaymentCounts = () => ({
  paid: 0,
  pending: 0,
  cancelled: 0,
  expired: 0,
  failed: 0,
});

const zeroProjectedRevenue = () => ({
  bookingCommissionPending: 0,
  bookingCommissionBillable: 0,
  bookingCommissionWaived: 0,
  bookingCommissionCancelled: 0,
  bookingCommissionPaid: 0,
});

const maskOrderCode = (orderCode) => {
  const text = String(orderCode || '');
  if (!text) return null;
  if (text.length <= 4) return `****${text}`;
  return `****${text.slice(-4)}`;
};

const asId = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return value._id;
  return value;
};

const idText = (value) => String(asId(value) || '');

const ownerName = (owner) => owner?.fullName || owner?.username || null;

const mapPayment = (payment) => {
  const source = typeof payment?.toObject === 'function' ? payment.toObject() : payment;
  const owner = source.userId && typeof source.userId === 'object' ? source.userId : null;
  const restaurant = source.restaurantId && typeof source.restaurantId === 'object' ? source.restaurantId : null;

  return {
    paymentId: source._id,
    owner: {
      ownerId: owner?._id || source.userId || null,
      ownerName: ownerName(owner),
      ownerRole: owner?.role || null,
    },
    restaurant: source.restaurantId ? {
      restaurantId: restaurant?._id || source.restaurantId,
      restaurantName: restaurant?.name || null,
    } : null,
    targetType: source.targetType,
    amount: source.amount,
    currency: source.currency || 'VND',
    status: source.status,
    provider: source.gateway || 'payos',
    orderCodeMasked: maskOrderCode(source.orderCode),
    createdAt: source.createdAt,
    paidAt: source.paidAt,
    expiredAt: source.expiredAt,
    cancelledAt: source.cancelledAt,
  };
};

const mapLedger = (ledger) => {
  const source = typeof ledger?.toObject === 'function' ? ledger.toObject() : ledger;
  const owner = source.ownerId && typeof source.ownerId === 'object' ? source.ownerId : null;
  const restaurant = source.restaurantId && typeof source.restaurantId === 'object' ? source.restaurantId : null;
  const booking = source.bookingId && typeof source.bookingId === 'object' ? source.bookingId : null;

  return {
    id: source._id,
    ledgerId: source._id,
    bookingId: booking?._id || source.bookingId,
    ownerId: owner?._id || source.ownerId,
    ownerName: ownerName(owner),
    restaurantId: restaurant?._id || source.restaurantId,
    restaurantName: restaurant?.name || null,
    bookingDate: booking?.bookingDate || null,
    bookingTime: booking?.bookingTime || null,
    planCodeAtBooking: source.planCodeAtBooking,
    commissionType: source.commissionType,
    commissionAmount: source.commissionAmount,
    currency: source.currency || 'VND',
    status: source.status,
    triggerStatus: source.triggerStatus,
    reason: source.reason,
    createdAt: source.createdAt,
    billableAt: source.billableAt,
    cancelledAt: source.cancelledAt,
    paidAt: source.paidAt,
  };
};

const buildLedgerSummary = (rows = []) => {
  const summary = zeroProjectedRevenue();
  const counts = Object.fromEntries(LEDGER_STATUSES.map((status) => [status, 0]));
  rows.forEach((row) => {
    const total = Number(row.total) || 0;
    const count = Number(row.count) || 0;
    counts[row._id] = count;
    if (row._id === 'pending') summary.bookingCommissionPending = total;
    if (row._id === 'billable') summary.bookingCommissionBillable = total;
    if (row._id === 'waived') summary.bookingCommissionWaived = total;
    if (row._id === 'cancelled') summary.bookingCommissionCancelled = total;
    if (row._id === 'paid') summary.bookingCommissionPaid = total;
  });
  return { summary, counts };
};

const csvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const createAdminMonetizationService = ({
  paymentModel = Payment,
  userModel = User,
  restaurantModel = Restaurant,
  subscriptionModel = Subscription,
  featuredPlacementModel = FeaturedPlacement,
  voucherCampaignPurchaseModel = VoucherCampaignPurchase,
  ledgerModel = BookingCommissionLedger,
  now = () => new Date(),
} = {}) => {
  const getRevenueSummary = async (rawFilters = {}) => {
    const filters = normalizeFilters(rawFilters);
    const paidMatch = buildPaidPaymentMatch(filters);
    const paymentCountMatch = buildPaymentListMatch(filters);
    const ledgerMatch = buildLedgerMatch(filters);

    const [paidRows, paymentCountRows, ledgerRows, paidSeriesRows] = await Promise.all([
      paidMatch
        ? paymentModel.aggregate([
          { $match: paidMatch },
          { $group: { _id: '$targetType', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ])
        : [],
      paymentModel.aggregate([
        { $match: paymentCountMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ledgerMatch
        ? ledgerModel.aggregate([
          { $match: ledgerMatch },
          { $group: { _id: '$status', total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
        ])
        : [],
      paidMatch
        ? paymentModel.aggregate([
          { $match: { ...paidMatch, paidAt: { ...(paidMatch.paidAt || {}), $ne: null } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
              total: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        : [],
    ]);

    const byType = Object.fromEntries(
      paidRows.map((row) => [row._id, { total: Number(row.total) || 0, count: Number(row.count) || 0 }])
    );
    const paidRevenue = {
      total: paidRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
      subscription: byType.subscription?.total || 0,
      featuredRestaurant: byType.featured_restaurant?.total || 0,
      voucherCampaign: byType.voucher_campaign?.total || 0,
    };
    const paidRevenueCounts = {
      subscription: byType.subscription?.count || 0,
      featuredRestaurant: byType.featured_restaurant?.count || 0,
      voucherCampaign: byType.voucher_campaign?.count || 0,
    };

    const paymentCounts = zeroPaymentCounts();
    paymentCountRows.forEach((row) => {
      if (Object.prototype.hasOwnProperty.call(paymentCounts, row._id)) {
        paymentCounts[row._id] = Number(row.count) || 0;
      }
    });

    const { summary: projectedRevenue, counts: bookingCommissionCounts } = buildLedgerSummary(ledgerRows);
    const projectedBookingCommission =
      projectedRevenue.bookingCommissionPending + projectedRevenue.bookingCommissionBillable;

    return {
      paidRevenue,
      paidRevenueCounts,
      projectedRevenue,
      projectedBookingCommission,
      totalPotentialRevenue: paidRevenue.total + projectedBookingCommission,
      paymentCounts,
      bookingCommissionCounts,
      paidRevenueByTargetType: paidRows.map((row) => ({
        targetType: row._id,
        total: row.total,
        count: row.count,
      })),
      paidRevenueSeries: paidSeriesRows,
      period: buildPeriod(filters),
    };
  };

  const getPaymentTransactions = async (rawFilters = {}) => {
    const filters = normalizeFilters(rawFilters);
    const match = buildPaymentListMatch(filters);
    const page = filters.page;
    const limit = filters.limit;

    const query = paymentModel.find(match)
      .select('_id userId restaurantId targetType amount currency status gateway orderCode createdAt paidAt expiredAt cancelledAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'fullName username role')
      .populate('restaurantId', 'name');

    const [items, total] = await Promise.all([
      resolveQuery(query, true),
      paymentModel.countDocuments(match),
    ]);

    return {
      items: (items || []).map(mapPayment),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  };

  const getBookingCommissionSummary = async (rawFilters = {}) => {
    const filters = normalizeFilters(rawFilters);
    validateEnum(filters.status, [...PAYMENT_STATUSES, ...LEDGER_STATUSES], 'INVALID_STATUS', 'Trang thai khong hop le.');
    const match = buildLedgerMatch(filters);
    const page = filters.page;
    const limit = filters.limit;

    if (!match) {
      return {
        summary: {
          projectedCommission: 0,
          billableCommission: 0,
          waivedCommission: 0,
          cancelledCommission: 0,
          paidCommission: 0,
          count: 0,
          counts: Object.fromEntries(LEDGER_STATUSES.map((status) => [status, 0])),
        },
        items: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
      };
    }

    const query = ledgerModel.find(match)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('ownerId', 'fullName username')
      .populate('restaurantId', 'name')
      .populate('bookingId', 'bookingDate bookingTime');

    const [summaryRows, total, items] = await Promise.all([
      ledgerModel.aggregate([
        { $match: match },
        { $group: { _id: '$status', total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
      ]),
      ledgerModel.countDocuments(match),
      resolveQuery(query, true),
    ]);

    const { summary: projectedRevenue, counts } = buildLedgerSummary(summaryRows);
    return {
      summary: {
        projectedCommission:
          projectedRevenue.bookingCommissionPending + projectedRevenue.bookingCommissionBillable,
        billableCommission: projectedRevenue.bookingCommissionBillable,
        waivedCommission: projectedRevenue.bookingCommissionWaived,
        cancelledCommission: projectedRevenue.bookingCommissionCancelled,
        paidCommission: projectedRevenue.bookingCommissionPaid,
        count: Object.values(counts).reduce((sum, count) => sum + count, 0),
        counts,
      },
      items: (items || []).map(mapLedger),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  };

  const getTopEntities = async (rawFilters = {}, entity = 'owner') => {
    const filters = normalizeFilters(rawFilters);
    const limit = parsePositiveInteger(rawFilters.limit, 10, 50);
    const paymentIdFieldName = entity === 'restaurant' ? 'restaurantId' : 'userId';
    const idField = `$${paymentIdFieldName}`;
    const ledgerField = entity === 'restaurant' ? '$restaurantId' : '$ownerId';
    const paidMatch = buildPaidPaymentMatch(filters);
    const ledgerMatch = buildLedgerMatch({ ...filters, status: undefined });
    const paidTopMatch = paidMatch ? { ...paidMatch } : null;
    if (paidTopMatch && !paidTopMatch[paymentIdFieldName]) {
      paidTopMatch[paymentIdFieldName] = { $ne: null };
    }

    const [paidRows, ledgerRows] = await Promise.all([
      paidTopMatch
        ? paymentModel.aggregate([
          { $match: paidTopMatch },
          {
            $group: {
              _id: idField,
              paidRevenue: { $sum: '$amount' },
              paymentCount: { $sum: 1 },
            },
          },
          { $sort: { paidRevenue: -1 } },
          { $limit: limit * 2 },
        ])
        : [],
      ledgerMatch
        ? ledgerModel.aggregate([
          { $match: { ...ledgerMatch, status: { $in: ['pending', 'billable'] } } },
          {
            $group: {
              _id: ledgerField,
              projectedCommission: { $sum: '$commissionAmount' },
              commissionCount: { $sum: 1 },
            },
          },
        ])
        : [],
    ]);

    const map = new Map();
    paidRows.forEach((row) => {
      const key = idText(row._id);
      if (!key) return;
      map.set(key, {
        id: row._id,
        paidRevenue: Number(row.paidRevenue) || 0,
        projectedCommission: 0,
        paymentCount: Number(row.paymentCount) || 0,
        commissionCount: 0,
      });
    });
    ledgerRows.forEach((row) => {
      const key = idText(row._id);
      if (!key) return;
      const current = map.get(key) || {
        id: row._id,
        paidRevenue: 0,
        projectedCommission: 0,
        paymentCount: 0,
        commissionCount: 0,
      };
      current.projectedCommission = Number(row.projectedCommission) || 0;
      current.commissionCount = Number(row.commissionCount) || 0;
      map.set(key, current);
    });

    const rows = Array.from(map.values());
    const ids = rows.map((row) => row.id).filter(Boolean);
    const docs = entity === 'restaurant'
      ? await resolveQuery(restaurantModel.find({ _id: { $in: ids } }).select('name ownerId'), true)
      : await resolveQuery(userModel.find({ _id: { $in: ids } }).select('fullName username'), true);
    const docMap = new Map((docs || []).map((doc) => [idText(doc._id), doc]));

    return rows
      .map((row) => {
        const key = idText(row.id);
        const doc = docMap.get(key);
        const common = {
          paidRevenue: row.paidRevenue,
          projectedCommission: row.projectedCommission,
          totalPotentialRevenue: row.paidRevenue + row.projectedCommission,
          paymentCount: row.paymentCount,
          commissionCount: row.commissionCount,
        };
        if (entity === 'restaurant') {
          return {
            restaurantId: row.id,
            restaurantName: doc?.name || null,
            ownerId: doc?.ownerId || null,
            ...common,
          };
        }
        return {
          ownerId: row.id,
          ownerName: ownerName(doc),
          ...common,
        };
      })
      .sort((a, b) => b.totalPotentialRevenue - a.totalPotentialRevenue)
      .slice(0, limit);
  };

  const getTopOwners = (filters = {}) => getTopEntities(filters, 'owner');

  const getTopRestaurants = (filters = {}) => getTopEntities(filters, 'restaurant');

  const findActivationMissing = async (filters = {}) => {
    const paidMatch = buildPaidPaymentMatch(filters);
    if (!paidMatch) return [];

    const paidPayments = await resolveQuery(
      paymentModel.find(paidMatch)
        .select('_id userId restaurantId targetType amount status orderCode createdAt paidAt')
        .sort({ paidAt: -1 })
        .limit(500),
      true
    );
    if (!paidPayments?.length) return [];

    const byType = PAID_REVENUE_TARGET_TYPES.reduce((acc, targetType) => {
      acc[targetType] = paidPayments.filter((payment) => payment.targetType === targetType).map((payment) => payment._id);
      return acc;
    }, {});

    const [activeSubscriptions, activeFeatured, activeCampaigns] = await Promise.all([
      byType.subscription.length
        ? resolveQuery(subscriptionModel.find({
          paymentId: { $in: byType.subscription },
          status: 'active',
        }).select('paymentId'), true)
        : [],
      byType.featured_restaurant.length
        ? resolveQuery(featuredPlacementModel.find({
          paymentId: { $in: byType.featured_restaurant },
          status: 'active',
        }).select('paymentId'), true)
        : [],
      byType.voucher_campaign.length
        ? resolveQuery(voucherCampaignPurchaseModel.find({
          paymentId: { $in: byType.voucher_campaign },
          status: 'active',
        }).select('paymentId'), true)
        : [],
    ]);

    const activeIds = new Set([
      ...(activeSubscriptions || []).map((item) => idText(item.paymentId)),
      ...(activeFeatured || []).map((item) => idText(item.paymentId)),
      ...(activeCampaigns || []).map((item) => idText(item.paymentId)),
    ]);

    return paidPayments
      .filter((payment) => !activeIds.has(idText(payment._id)))
      .slice(0, 25)
      .map(mapPayment);
  };

  const getPaymentHealth = async (rawFilters = {}) => {
    const filters = normalizeFilters(rawFilters);
    const paymentCountMatch = buildPaymentListMatch(filters);
    const overdueBefore = new Date(now().getTime() - 30 * 60 * 1000);
    const pendingMatch = {
      ...buildPaymentListMatch({ ...filters, status: 'pending' }),
      $or: [
        { expiredAt: { $lte: now() } },
        { expiredAt: null, createdAt: { $lte: overdueBefore } },
      ],
    };

    const [countRows, pendingOverdueCount, pendingOverdueItems, duplicateOrderCodes, activationMissing] = await Promise.all([
      paymentModel.aggregate([
        { $match: paymentCountMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      paymentModel.countDocuments(pendingMatch),
      resolveQuery(
        paymentModel.find(pendingMatch)
          .select('_id userId restaurantId targetType amount currency status gateway orderCode createdAt paidAt expiredAt')
          .sort({ createdAt: 1 })
          .limit(10)
          .populate('userId', 'fullName username role')
          .populate('restaurantId', 'name'),
        true
      ),
      paymentModel.aggregate([
        { $match: { orderCode: { $ne: null } } },
        { $group: { _id: '$orderCode', count: { $sum: 1 }, paymentIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 10 },
      ]),
      findActivationMissing(filters),
    ]);

    const paymentCounts = zeroPaymentCounts();
    countRows.forEach((row) => {
      if (Object.prototype.hasOwnProperty.call(paymentCounts, row._id)) {
        paymentCounts[row._id] = Number(row.count) || 0;
      }
    });

    return {
      paymentCounts,
      pendingOverdue: {
        count: pendingOverdueCount,
        items: (pendingOverdueItems || []).map(mapPayment),
      },
      activationMissing: {
        count: activationMissing.length,
        items: activationMissing,
      },
      duplicateOrderCodes: duplicateOrderCodes.map((row) => ({
        orderCodeMasked: maskOrderCode(row._id),
        count: row.count,
        paymentIds: row.paymentIds,
      })),
      webhookRecoveredCount: null,
      technicalDebt: [
        'Webhook recovery count chua co field rieng trong WebhookLog, khong suy dien so lieu.',
      ],
      generatedAt: now().toISOString(),
    };
  };

  const getSettlementReadiness = async (filters = {}) => {
    const [summary, health, commissions] = await Promise.all([
      getRevenueSummary(filters),
      getPaymentHealth(filters),
      getBookingCommissionSummary({ ...filters, status: undefined, page: 1, limit: 1 }),
    ]);

    const checklist = [
      {
        key: 'payos_paid_revenue',
        label: 'PayOS paid payments trong ky',
        status: 'ready',
        value: summary.paidRevenue.total,
        description: 'Chi tinh Payment status paid cho subscription, featured va voucher campaign.',
      },
      {
        key: 'activation_missing',
        label: 'Paid nhung activation thieu',
        status: health.activationMissing.count === 0 ? 'ready' : 'attention',
        value: health.activationMissing.count,
        description: 'Can doi soat payment paid voi subscription/featured/voucher campaign active.',
      },
      {
        key: 'pending_overdue',
        label: 'Pending qua han',
        status: health.pendingOverdue.count === 0 ? 'ready' : 'attention',
        value: health.pendingOverdue.count,
        description: 'Can huy/expire hoac doi soat cac payment pending qua han.',
      },
      {
        key: 'duplicate_order_code',
        label: 'Duplicate orderCode',
        status: health.duplicateOrderCodes.length === 0 ? 'ready' : 'attention',
        value: health.duplicateOrderCodes.length,
        description: 'Unique index nen chan truong hop nay, neu co can dieu tra ngay.',
      },
      {
        key: 'booking_commission_billable',
        label: 'Booking commission billable',
        status: 'info',
        value: commissions.summary.billableCommission,
        description: 'Khoan co the thu sau MVP, khong tinh vao Paid Revenue.',
      },
    ];

    return {
      period: summary.period,
      payosPaidRevenue: summary.paidRevenue,
      bookingCommission: commissions.summary,
      abnormalPayments: {
        pendingOverdue: health.pendingOverdue,
        activationMissing: health.activationMissing,
        duplicateOrderCodes: health.duplicateOrderCodes,
      },
      checklist,
    };
  };

  const exportRevenueCsv = async (rawFilters = {}) => {
    const filters = { ...rawFilters, page: 1, limit: 5000 };
    const [payments, commissions] = await Promise.all([
      getPaymentTransactions(filters),
      getBookingCommissionSummary({ ...filters, status: undefined }),
    ]);

    const rows = [
      [
        'source',
        'id',
        'owner',
        'restaurant',
        'targetType',
        'status',
        'amount',
        'currency',
        'createdAt',
        'recognizedAt',
        'maskedReference',
      ],
    ];

    payments.items.forEach((payment) => {
      rows.push([
        'payos_payment',
        payment.paymentId,
        payment.owner?.ownerName || payment.owner?.ownerId || '',
        payment.restaurant?.restaurantName || payment.restaurant?.restaurantId || '',
        payment.targetType,
        payment.status,
        payment.amount,
        payment.currency,
        payment.createdAt,
        payment.paidAt,
        payment.orderCodeMasked,
      ]);
    });

    commissions.items.forEach((ledger) => {
      rows.push([
        'booking_commission',
        ledger.ledgerId,
        ledger.ownerName || ledger.ownerId || '',
        ledger.restaurantName || ledger.restaurantId || '',
        'booking_fee',
        ledger.status,
        ledger.commissionAmount,
        ledger.currency,
        ledger.createdAt,
        ledger.billableAt || ledger.paidAt || ledger.createdAt,
        ledger.bookingId,
      ]);
    });

    return rows.map((row) => row.map(csvValue).join(',')).join('\n');
  };

  return {
    getRevenueSummary,
    getPaymentTransactions,
    getBookingCommissionSummary,
    getTopOwners,
    getTopRestaurants,
    getPaymentHealth,
    getSettlementReadiness,
    exportRevenueCsv,
  };
};

const defaultService = createAdminMonetizationService();

module.exports = {
  ...defaultService,
  AdminMonetizationError,
  PAID_REVENUE_TARGET_TYPES,
  PAYMENT_TARGET_TYPES,
  PAYMENT_STATUSES,
  LEDGER_STATUSES,
  createAdminMonetizationService,
  maskOrderCode,
};
