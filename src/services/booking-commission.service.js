'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const BookingCommissionLedger = require('../models/BookingCommissionLedger');
const planGatingService = require('./plan-gating.service');
const { getBookingCommissionRule } = require('./booking-commission-rules.service');

const COMMISSION_STATUSES = ['pending', 'billable', 'waived', 'cancelled', 'paid'];

class BookingCommissionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'BookingCommissionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.Types.ObjectId.isValid(String(value || ''))
    ? new mongoose.Types.ObjectId(String(value))
    : value;
};

const parsePositiveInteger = (value, fallback, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const parseDateBoundary = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BookingCommissionError('INVALID_DATE_FILTER', 'Khoảng ngày không hợp lệ.');
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

const resolveQuery = async (query, lean = false) => {
  if (lean && typeof query?.lean === 'function') return query.lean();
  return query;
};

const buildDateFilter = (fromDate, toDate) => {
  const from = parseDateBoundary(fromDate);
  const to = parseDateBoundary(toDate, true);
  if (from && to && from > to) {
    throw new BookingCommissionError('INVALID_DATE_RANGE', 'Ngày bắt đầu phải trước ngày kết thúc.');
  }
  if (!from && !to) return null;
  return {
    ...(from ? { $gte: from } : {}),
    ...(to ? { $lte: to } : {}),
  };
};

const validateStatus = (status) => {
  if (status && !COMMISSION_STATUSES.includes(status)) {
    throw new BookingCommissionError('INVALID_COMMISSION_STATUS', 'Trạng thái phí booking không hợp lệ.');
  }
};

const buildSummary = (rows = [], mode = 'owner') => {
  const amounts = Object.fromEntries(COMMISSION_STATUSES.map((status) => [status, 0]));
  const counts = Object.fromEntries(COMMISSION_STATUSES.map((status) => [status, 0]));
  let count = 0;

  rows.forEach((row) => {
    if (!row?._id) return;
    const status = String(row._id);
    amounts[status] = Number(row.total) || 0;
    counts[status] = Number(row.count) || 0;
    count += Number(row.count) || 0;
  });

  if (mode === 'admin') {
    return {
      projectedCommission: amounts.pending + amounts.billable,
      billableCommission: amounts.billable,
      waivedCommission: amounts.waived,
      cancelledCommission: amounts.cancelled,
      paidCommission: amounts.paid,
      count,
      counts,
    };
  }

  return {
    totalPending: amounts.pending,
    totalBillable: amounts.billable,
    totalWaived: amounts.waived,
    totalCancelled: amounts.cancelled,
    count,
    counts,
  };
};

const mapLedgerItem = (ledger, includeOwner = false) => {
  const source = typeof ledger?.toObject === 'function' ? ledger.toObject() : ledger;
  const booking = source.bookingId && typeof source.bookingId === 'object' ? source.bookingId : null;
  const restaurant = source.restaurantId && typeof source.restaurantId === 'object' ? source.restaurantId : null;
  const owner = source.ownerId && typeof source.ownerId === 'object' ? source.ownerId : null;

  return {
    id: source._id,
    bookingId: booking?._id || source.bookingId,
    restaurantId: restaurant?._id || source.restaurantId,
    restaurantName: restaurant?.name || null,
    bookingDate: booking?.bookingDate || null,
    bookingTime: booking?.bookingTime || null,
    planCodeAtBooking: source.planCodeAtBooking,
    commissionType: source.commissionType,
    commissionAmount: source.commissionAmount,
    currency: source.currency,
    status: source.status,
    triggerStatus: source.triggerStatus,
    reason: source.reason,
    createdAt: source.createdAt,
    ...(includeOwner ? {
      ownerId: owner?._id || source.ownerId,
      ownerName: owner?.fullName || owner?.username || null,
    } : {}),
  };
};

const createBookingCommissionService = ({
  ledgerModel = BookingCommissionLedger,
  bookingModel = Booking,
  restaurantModel = Restaurant,
  getEffectivePlan = planGatingService.getEffectivePlanForRestaurant,
  now = () => new Date(),
} = {}) => {
  const calculateCommission = async ({ ownerId, restaurantId, booking }) => {
    let resolvedOwnerId = ownerId;
    let restaurant = null;

    if (!resolvedOwnerId) {
      restaurant = await resolveQuery(
        restaurantModel.findById(restaurantId || booking?.restaurantId).select('_id ownerId name')
      );
      if (!restaurant) {
        throw new BookingCommissionError('RESTAURANT_NOT_FOUND', 'Không tìm thấy nhà hàng của booking.', 404);
      }
      resolvedOwnerId = restaurant.ownerId;
    }

    const resolvedRestaurantId = restaurantId || booking?.restaurantId || restaurant?._id;
    if (!resolvedRestaurantId) {
      throw new BookingCommissionError('RESTAURANT_REQUIRED', 'Booking chưa có nhà hàng hợp lệ.');
    }

    const effectivePlan = await getEffectivePlan(resolvedRestaurantId);
    const rule = getBookingCommissionRule(effectivePlan?.planCode);

    return {
      ownerId: resolvedOwnerId,
      restaurantId: resolvedRestaurantId,
      planCodeAtBooking: rule.planCode,
      commissionType: rule.type,
      baseAmount: 0,
      commissionAmount: rule.amount,
      currency: rule.currency,
      status: rule.type === 'waived' ? 'waived' : 'billable',
      reason: rule.type === 'waived'
        ? 'Gói Pro được miễn phí nền tảng cho booking thành công.'
        : `Phí cố định cho booking hoàn thành theo gói ${rule.planCode.toUpperCase()}.`,
    };
  };

  const createLedgerForBooking = async (bookingId, options = {}) => {
    const existingLedger = await ledgerModel.findOne({ bookingId });
    if (existingLedger) return { ledger: existingLedger, created: false };

    const booking = options.booking || await bookingModel.findById(bookingId);
    if (!booking) {
      throw new BookingCommissionError('BOOKING_NOT_FOUND', 'Không tìm thấy booking để tính phí.', 404);
    }
    if (booking.status !== 'completed') {
      return { ledger: null, created: false, skipped: 'BOOKING_NOT_COMPLETED' };
    }

    const calculatedAt = now();
    const commission = await calculateCommission({
      ownerId: options.ownerId || options.restaurant?.ownerId,
      restaurantId: booking.restaurantId,
      booking,
    });

    const payload = {
      ...commission,
      bookingId: booking._id || bookingId,
      triggerStatus: 'completed',
      calculatedAt,
      billableAt: commission.status === 'billable' ? calculatedAt : null,
      metadata: {
        source: options.source || 'booking_status_transition',
        bookingCompletedAt: booking.completedAt || calculatedAt,
      },
    };

    try {
      const ledger = await ledgerModel.create(payload);
      return { ledger, created: true };
    } catch (error) {
      if (error?.code === 11000) {
        const ledger = await ledgerModel.findOne({ bookingId: booking._id || bookingId });
        if (ledger) return { ledger, created: false };
      }
      throw error;
    }
  };

  const markCancelledForBooking = async (bookingId, reason = 'Booking đã bị huỷ') => {
    const ledger = await ledgerModel.findOne({ bookingId });
    if (!ledger || ledger.status !== 'pending') return ledger;
    ledger.status = 'cancelled';
    ledger.reason = reason;
    ledger.cancelledAt = now();
    return ledger.save();
  };

  const listCommissions = async ({ filter, page, limit, includeOwner, mode }) => {
    const [summaryRows, total, items] = await Promise.all([
      ledgerModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            total: { $sum: '$commissionAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      ledgerModel.countDocuments(filter),
      resolveQuery(
        ledgerModel.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('restaurantId', 'name')
          .populate('bookingId', 'bookingDate bookingTime')
          .populate('ownerId', 'fullName username'),
        true
      ),
    ]);

    return {
      summary: buildSummary(summaryRows, mode),
      items: (items || []).map((item) => mapLedgerItem(item, includeOwner)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  };

  const getOwnerCommissions = async (ownerId, filters = {}) => {
    validateStatus(filters.status);
    const page = parsePositiveInteger(filters.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInteger(filters.limit, 20, 100);
    const filter = { ownerId: toObjectId(ownerId) };

    if (filters.restaurantId) {
      const ownedRestaurant = await resolveQuery(
        restaurantModel.findOne({
          _id: filters.restaurantId,
          ownerId,
          deletedAt: null,
        }).select('_id')
      );
      if (!ownedRestaurant) {
        throw new BookingCommissionError(
          'OWNER_RESTAURANT_FORBIDDEN',
          'Bạn không có quyền xem phí booking của nhà hàng này.',
          403
        );
      }
      filter.restaurantId = toObjectId(filters.restaurantId);
    }
    if (filters.status) filter.status = filters.status;
    const dateFilter = buildDateFilter(filters.fromDate, filters.toDate);
    if (dateFilter) filter.createdAt = dateFilter;

    return listCommissions({ filter, page, limit, includeOwner: false, mode: 'owner' });
  };

  const getAdminCommissionSummary = async (filters = {}) => {
    validateStatus(filters.status);
    const page = parsePositiveInteger(filters.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInteger(filters.limit, 20, 100);
    const filter = {};
    if (filters.ownerId) filter.ownerId = toObjectId(filters.ownerId);
    if (filters.restaurantId) filter.restaurantId = toObjectId(filters.restaurantId);
    if (filters.status) filter.status = filters.status;
    const dateFilter = buildDateFilter(filters.fromDate, filters.toDate);
    if (dateFilter) filter.createdAt = dateFilter;

    return listCommissions({ filter, page, limit, includeOwner: true, mode: 'admin' });
  };

  return {
    calculateCommission,
    createLedgerForBooking,
    markCancelledForBooking,
    getOwnerCommissions,
    getAdminCommissionSummary,
  };
};

const defaultService = createBookingCommissionService();

module.exports = {
  ...defaultService,
  BookingCommissionError,
  COMMISSION_STATUSES,
  createBookingCommissionService,
};
