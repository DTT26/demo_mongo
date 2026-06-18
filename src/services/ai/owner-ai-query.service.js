'use strict';

const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const RestaurantTable = require('../../models/RestaurantTable');
const Review = require('../../models/Review');
const Voucher = require('../../models/Voucher');
const VoucherRedemption = require('../../models/VoucherRedemption');
const bookingService = require('../booking.service');
const { assertOwnerCanAccessRestaurant } = require('../../utils/restaurant-permission');

const BOOKEAT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;

const OWNER_BOOKING_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]);

const REVIEW_REPLY_TONES = Object.freeze([
  'warm_professional',
  'apologetic',
  'concise',
]);

class OwnerAiQueryError extends Error {
  constructor(code, message, { status = 'failed', details } = {}) {
    super(message || code);
    this.name = 'OwnerAiQueryError';
    this.code = code;
    this.status = status;
    this.details = details || null;
  }
}

const makeOwnerError = (code, message, options = {}) => (
  new OwnerAiQueryError(code, message, options)
);

const toIdString = (value) => {
  if (!value) return null;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return value.toString();
};

const isValidObjectId = (value) => (
  typeof value === 'string' && mongoose.isValidObjectId(value)
);

const clampLimit = (value, fallback = DEFAULT_LIMIT) => {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(1, Math.min(value, MAX_LIMIT));
};

const toLocalDateString = (date = new Date()) => (
  new Intl.DateTimeFormat('sv-SE', { timeZone: BOOKEAT_TIMEZONE }).format(date)
);

const isValidDateString = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isValidTimeString = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));

const dateToUtcMidnight = (dateString) => new Date(`${dateString}T00:00:00.000Z`);

const shiftDateString = (dateString, days) => {
  const date = dateToUtcMidnight(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const dateDiffInclusive = (dateFrom, dateTo) => (
  Math.floor((dateToUtcMidnight(dateTo).getTime() - dateToUtcMidnight(dateFrom).getTime()) / DAY_MS) + 1
);

const resolveDate = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (!isValidDateString(value)) {
    throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'Invalid date.');
  }
  return value;
};

const resolveDateRange = ({
  dateFrom,
  dateTo,
  defaultDays = 7,
  maxDays = 31,
  now = new Date(),
} = {}) => {
  const today = toLocalDateString(now);
  let resolvedTo = resolveDate(dateTo, today);
  let resolvedFrom = resolveDate(dateFrom, shiftDateString(resolvedTo, -(defaultDays - 1)));

  if (dateToUtcMidnight(resolvedFrom) > dateToUtcMidnight(resolvedTo)) {
    throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'dateFrom must be before dateTo.');
  }

  if (dateDiffInclusive(resolvedFrom, resolvedTo) > maxDays) {
    resolvedFrom = shiftDateString(resolvedTo, -(maxDays - 1));
  }

  return {
    dateFrom: resolvedFrom,
    dateTo: resolvedTo,
    fromDate: dateToUtcMidnight(resolvedFrom),
    toDate: dateToUtcMidnight(resolvedTo),
  };
};

const compactText = (value, maxLength = 220) => {
  if (typeof value !== 'string') return '';
  const compact = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
};

const CONTACT_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CONTACT_PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;

const hasContactPattern = (value) => {
  const text = String(value || '');
  CONTACT_EMAIL_PATTERN.lastIndex = 0;
  CONTACT_PHONE_PATTERN.lastIndex = 0;
  return CONTACT_EMAIL_PATTERN.test(text) || CONTACT_PHONE_PATTERN.test(text);
};

const redactContactText = (value, maxLength = 220) => (
  compactText(value, maxLength)
    .replace(CONTACT_EMAIL_PATTERN, '[redacted-email]')
    .replace(CONTACT_PHONE_PATTERN, '[redacted-phone]')
);

const restaurantPayload = (restaurant) => ({
  id: toIdString(restaurant),
  name: compactText(restaurant?.name, 100) || 'Restaurant',
});

const makeCustomerLabel = (booking) => {
  const name = compactText(booking?.customerName, 80);
  if (!name || hasContactPattern(name)) {
    const shortId = toIdString(booking)?.slice(-4) || '----';
    return `Khach #${shortId}`;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0].slice(0, 24)}.`;
  return `${parts[0].slice(0, 24)} ${parts[parts.length - 1].charAt(0)}.`;
};

const toDateString = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const toSafeTable = (table) => ({
  tableNumber: compactText(table?.tableNumber, 50),
  capacity: Number(table?.capacity) || 0,
  zone: compactText(table?.zone, 100) || null,
});

const toBookingProjection = (booking, { includeDate = true } = {}) => ({
  bookingId: toIdString(booking),
  ...(includeDate ? { date: toDateString(booking?.bookingDate) } : {}),
  time: booking?.bookingTime || null,
  guestCount: Number(booking?.numberOfGuests) || 0,
  status: booking?.status || null,
  customerLabel: makeCustomerLabel(booking),
  tableNumbers: Array.isArray(booking?.tableNumbers)
    ? booking.tableNumbers.slice(0, 6).map((item) => compactText(String(item), 50)).filter(Boolean)
    : [],
});

const buildStatusCounts = (bookings) => (
  bookings.reduce((acc, booking) => {
    const status = booking?.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {})
);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const safeSearchLabel = (query) => {
  const compact = compactText(query, 80);
  if (!compact) return null;
  if (/@/.test(compact) || /\d{4,}/.test(compact)) return '[redacted]';
  return compact;
};

const readQuery = async (query) => {
  if (query && typeof query.lean === 'function') return query.lean();
  if (query && typeof query.exec === 'function') return query.exec();
  return query;
};

const findList = async (model, filter, { select, sort, limit } = {}) => {
  let query = model.find(filter);
  if (query && typeof query.select === 'function' && select) query = query.select(select);
  if (query && typeof query.sort === 'function' && sort) query = query.sort(sort);
  if (query && typeof query.limit === 'function' && limit) query = query.limit(limit);
  const result = await readQuery(query);
  return Array.isArray(result) ? result : [];
};

const countDocuments = async (model, filter) => {
  if (typeof model.countDocuments === 'function') {
    const result = await readQuery(model.countDocuments(filter));
    return Number(result) || 0;
  }
  return (await findList(model, filter)).length;
};

const createOwnerAiQueryService = ({
  bookingModel = Booking,
  tableModel = RestaurantTable,
  reviewModel = Review,
  voucherModel = Voucher,
  voucherRedemptionModel = VoucherRedemption,
  booking = bookingService,
  ownershipGuard = assertOwnerCanAccessRestaurant,
  nowProvider = () => new Date(),
} = {}) => {
  const assertOwnedRestaurant = async ({ ownerId, selectedRestaurantId }) => {
    if (!ownerId) {
      throw makeOwnerError('AUTH_REQUIRED', 'Owner login is required.', { status: 'forbidden' });
    }
    if (!selectedRestaurantId) {
      throw makeOwnerError('SELECTED_RESTAURANT_REQUIRED', 'Selected restaurant is required.');
    }
    if (!isValidObjectId(selectedRestaurantId)) {
      throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'selectedRestaurantId is invalid.');
    }

    try {
      return await ownershipGuard(ownerId, selectedRestaurantId);
    } catch (error) {
      if ([403, 404].includes(error?.status)) {
        throw makeOwnerError('OWNER_RESTAURANT_FORBIDDEN', 'Owner cannot access this restaurant.', {
          status: 'forbidden',
        });
      }
      throw error;
    }
  };

  const bookingDateFilter = ({ dateFrom, dateTo }) => ({
    $gte: dateToUtcMidnight(dateFrom),
    $lte: dateToUtcMidnight(dateTo),
  });

  const getTodayBookings = async ({
    ownerId,
    selectedRestaurantId,
    date = null,
    limit = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const resolvedDate = resolveDate(date, toLocalDateString(nowProvider()));
    const bookings = await findList(bookingModel, {
      restaurantId: selectedRestaurantId,
      bookingDate: dateToUtcMidnight(resolvedDate),
    }, {
      select: '_id bookingDate bookingTime numberOfGuests status customerName tableNumbers',
      sort: { bookingTime: 1, createdAt: 1 },
    });
    const max = clampLimit(limit);
    const upcoming = bookings
      .filter((item) => !['cancelled', 'no_show'].includes(item.status))
      .slice(0, max)
      .map((item) => toBookingProjection(item, { includeDate: false }));

    return {
      type: 'owner_booking_summary',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        date: resolvedDate,
        total: bookings.length,
        byStatus: buildStatusCounts(bookings),
        upcoming,
        sourceLabel: 'BookEat owner bookings',
      },
    };
  };

  const getAvailableTables = async ({
    ownerId,
    selectedRestaurantId,
    bookingDate = null,
    bookingTime = null,
    numberOfGuests = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const resolvedDate = resolveDate(bookingDate, toLocalDateString(nowProvider()));
    if (!isValidTimeString(bookingTime)) {
      throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'bookingTime is required.');
    }
    if (numberOfGuests !== null && (
      !Number.isInteger(numberOfGuests) || numberOfGuests < 1 || numberOfGuests > 100
    )) {
      throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'numberOfGuests is invalid.');
    }

    const activeTableFilter = {
      restaurantId: selectedRestaurantId,
      isActive: true,
      status: { $in: ['available', 'reserved'] },
    };
    const activeCount = await countDocuments(tableModel, activeTableFilter);
    const availability = numberOfGuests
      ? await booking.checkAvailability(selectedRestaurantId, resolvedDate, bookingTime, numberOfGuests)
      : { availableTables: await booking.getAvailableTables(selectedRestaurantId, resolvedDate, bookingTime) };
    const availableTables = Array.isArray(availability.availableTables)
      ? availability.availableTables
      : [];

    return {
      type: 'owner_table_availability',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        bookingDate: resolvedDate,
        bookingTime,
        ...(numberOfGuests ? { numberOfGuests } : {}),
        availableTables: availableTables.slice(0, MAX_LIMIT).map(toSafeTable),
        occupiedCount: Math.max(0, activeCount - availableTables.length),
        availableCount: availableTables.length,
        sourceLabel: 'BookEat owner table availability',
      },
    };
  };

  const getUpcomingCustomers = async ({
    ownerId,
    selectedRestaurantId,
    dateFrom = null,
    dateTo = null,
    limit = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 7, maxDays: 31, now: nowProvider() });
    const max = clampLimit(limit);
    const bookings = await findList(bookingModel, {
      restaurantId: selectedRestaurantId,
      bookingDate: bookingDateFilter(range),
      status: { $in: ['pending', 'confirmed'] },
    }, {
      select: '_id bookingDate bookingTime numberOfGuests status customerName tableNumbers',
      sort: { bookingDate: 1, bookingTime: 1 },
      limit: max,
    });

    return {
      type: 'owner_booking_summary',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        date: `${range.dateFrom}..${range.dateTo}`,
        total: bookings.length,
        byStatus: buildStatusCounts(bookings),
        upcoming: bookings.map((item) => toBookingProjection(item)),
        sourceLabel: 'BookEat owner bookings',
      },
    };
  };

  const getCancelledBookings = async ({
    ownerId,
    selectedRestaurantId,
    dateFrom = null,
    dateTo = null,
    limit = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 7, maxDays: 31, now: nowProvider() });
    const max = clampLimit(limit);
    const bookings = await findList(bookingModel, {
      restaurantId: selectedRestaurantId,
      bookingDate: bookingDateFilter(range),
      status: { $in: ['cancelled', 'no_show'] },
    }, {
      select: '_id bookingDate bookingTime numberOfGuests status customerName tableNumbers',
      sort: { bookingDate: -1, bookingTime: 1 },
      limit: max,
    });

    return {
      type: 'owner_booking_search_result',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        query: 'cancelled/no-show bookings',
        total: bookings.length,
        bookings: bookings.map((item) => toBookingProjection(item)),
        sourceLabel: 'BookEat owner booking search',
      },
    };
  };

  const getRevenueSummary = async ({
    ownerId,
    selectedRestaurantId,
    dateFrom = null,
    dateTo = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 1, maxDays: 90, now: nowProvider() });
    const bookings = await findList(bookingModel, {
      restaurantId: selectedRestaurantId,
      bookingDate: bookingDateFilter(range),
      status: { $in: ['confirmed', 'completed'] },
    }, {
      select: '_id depositAmount depositPaid discountAmount status bookingDate',
    });
    const paidBookings = bookings.filter((item) => item.depositPaid);
    const grossRevenue = paidBookings.reduce((sum, item) => sum + (Number(item.depositAmount) || 0), 0);
    const discountTotal = paidBookings.reduce((sum, item) => sum + (Number(item.discountAmount) || 0), 0);

    return {
      type: 'owner_revenue_summary',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        grossRevenue,
        netRevenue: Math.max(0, grossRevenue - discountTotal),
        bookingCount: paidBookings.length,
        currency: 'VND',
        sourceLabel: 'BookEat owner revenue',
      },
    };
  };

  const getVoucherSummary = async ({
    ownerId,
    selectedRestaurantId,
    dateFrom = null,
    dateTo = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 30, maxDays: 90, now: nowProvider() });
    const now = nowProvider();
    const vouchers = await findList(voucherModel, {
      restaurantId: selectedRestaurantId,
    }, {
      select: '_id status endDate',
    });
    const voucherIds = vouchers.map((item) => item._id || item.id).filter(Boolean);
    const redemptions = voucherIds.length
      ? await findList(voucherRedemptionModel, {
        voucherId: { $in: voucherIds },
        usedAt: {
          $gte: range.fromDate,
          $lte: new Date(range.toDate.getTime() + DAY_MS - 1),
        },
      }, {
        select: 'discountApplied usedAt',
      })
      : [];
    const isExpired = (voucher) => (
      voucher.status === 'expired'
      || (voucher.endDate && new Date(voucher.endDate).getTime() < now.getTime())
    );

    return {
      type: 'owner_voucher_summary',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        activeCount: vouchers.filter((item) => item.status === 'active' && !isExpired(item)).length,
        expiredCount: vouchers.filter(isExpired).length,
        usageCount: redemptions.length,
        estimatedDiscountTotal: redemptions.reduce((sum, item) => sum + (Number(item.discountApplied) || 0), 0),
        sourceLabel: 'BookEat owner vouchers',
      },
    };
  };

  const getReviewSummary = async ({
    ownerId,
    selectedRestaurantId,
    dateFrom = null,
    dateTo = null,
    limit = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 7, maxDays: 31, now: nowProvider() });
    const reviews = await findList(reviewModel, {
      restaurantId: selectedRestaurantId,
      status: 'approved',
      createdAt: {
        $gte: range.fromDate,
        $lte: new Date(range.toDate.getTime() + DAY_MS - 1),
      },
    }, {
      select: '_id rating comment ownerReply createdAt',
      sort: { createdAt: -1 },
    });
    const reviewCount = reviews.length;
    const averageRating = reviewCount
      ? Math.round((reviews.reduce((sum, item) => sum + (Number(item.rating) || 0), 0) / reviewCount) * 10) / 10
      : 0;

    return {
      type: 'owner_review_summary',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        averageRating,
        reviewCount,
        latestReviews: reviews.slice(0, clampLimit(limit, 5)).map((item) => ({
          reviewId: toIdString(item),
          rating: Number(item.rating) || 0,
          content: redactContactText(item.comment, 220),
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
          hasOwnerReply: Boolean(item.ownerReply?.comment),
        })),
        sourceLabel: 'BookEat owner reviews',
      },
    };
  };

  const searchBooking = async ({
    ownerId,
    selectedRestaurantId,
    query = null,
    status = null,
    dateFrom = null,
    dateTo = null,
    limit = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    if (status !== null && !OWNER_BOOKING_STATUSES.includes(status)) {
      throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'status is invalid.');
    }
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 31, maxDays: 90, now: nowProvider() });
    const filter = {
      restaurantId: selectedRestaurantId,
      bookingDate: bookingDateFilter(range),
      ...(status ? { status } : {}),
    };
    const compactQuery = compactText(query, 120);
    if (compactQuery) {
      const regex = new RegExp(escapeRegex(compactQuery), 'i');
      filter.$or = [
        { customerName: regex },
        { customerPhone: regex },
        { customerEmail: regex },
        ...(isValidObjectId(compactQuery) ? [{ _id: compactQuery }] : []),
      ];
    }

    const bookings = await findList(bookingModel, filter, {
      select: '_id bookingDate bookingTime numberOfGuests status customerName tableNumbers',
      sort: { bookingDate: -1, bookingTime: 1 },
      limit: clampLimit(limit),
    });

    return {
      type: 'owner_booking_search_result',
      version: 1,
      payload: {
        restaurant: restaurantPayload(restaurant),
        query: safeSearchLabel(compactQuery),
        total: bookings.length,
        bookings: bookings.map((item) => toBookingProjection(item)),
        sourceLabel: 'BookEat owner booking search',
      },
    };
  };

  const suggestReviewReply = async ({
    ownerId,
    selectedRestaurantId,
    reviewId,
    tone = null,
  } = {}) => {
    const restaurant = await assertOwnedRestaurant({ ownerId, selectedRestaurantId });
    if (!isValidObjectId(reviewId)) {
      throw makeOwnerError('TOOL_INVALID_ARGUMENT', 'reviewId is invalid.');
    }
    const resolvedTone = tone && REVIEW_REPLY_TONES.includes(tone) ? tone : 'warm_professional';
    let reviewQuery = reviewModel.findOne({
      _id: reviewId,
      restaurantId: selectedRestaurantId,
      status: 'approved',
    });
    if (reviewQuery && typeof reviewQuery.select === 'function') {
      reviewQuery = reviewQuery.select('_id rating comment ownerReply createdAt');
    }
    const review = await readQuery(reviewQuery);
    const reviewDoc = Array.isArray(review) ? review[0] : review;
    if (!reviewDoc) {
      throw makeOwnerError('OWNER_REVIEW_NOT_FOUND', 'Review was not found.', { status: 'failed' });
    }

    const restaurantName = restaurantPayload(restaurant).name;
    const rating = Number(reviewDoc.rating) || 0;
    const reviewHint = redactContactText(reviewDoc.comment, 120);
    const positive = rating >= 4;
    const draftReply = positive
      ? `Cam on ban da ghe ${restaurantName} va chia se trai nghiem tot. Nha hang rat vui khi ban hai long va mong som duoc don tiep ban.`
      : `Cam on ban da chia se gop y ve ${restaurantName}. Nha hang xin ghi nhan trai nghiem cua ban va se ra soat lai de phuc vu tot hon trong nhung lan tiep theo.`;

    return {
      type: 'owner_review_reply_suggestion',
      version: 1,
      payload: {
        reviewId: toIdString(reviewDoc),
        draftReply: reviewHint ? `${draftReply} Noi dung tham chieu: "${reviewHint}"` : draftReply,
        tone: resolvedTone,
        disclaimer: 'Day chi la ban nhap, chua duoc gui.',
        sourceLabel: 'BookEat review reply draft',
      },
    };
  };

  return {
    assertOwnedRestaurant,
    getTodayBookings,
    getAvailableTables,
    getUpcomingCustomers,
    getCancelledBookings,
    getRevenueSummary,
    getVoucherSummary,
    getReviewSummary,
    searchBooking,
    suggestReviewReply,
  };
};

const defaultOwnerAiQueryService = createOwnerAiQueryService();

module.exports = {
  OwnerAiQueryError,
  BOOKEAT_TIMEZONE,
  createOwnerAiQueryService,
  makeOwnerError,
  ...defaultOwnerAiQueryService,
};
