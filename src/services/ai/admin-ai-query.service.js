'use strict';

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const Refund = require('../../models/Refund');
const Restaurant = require('../../models/Restaurant');

const BOOKEAT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;

const PAYMENT_STATUSES = Object.freeze([
  'pending',
  'processing',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
]);

const REFUND_STATUSES = Object.freeze([
  'pending',
  'requested',
  'approved',
  'rejected',
  'processing',
  'refunded',
  'failed',
  'cancelled',
]);

const DRAFT_TONES = Object.freeze([
  'supportive_professional',
  'apologetic',
  'concise',
]);

class AdminAiQueryError extends Error {
  constructor(code, message, { status = 'failed', details } = {}) {
    super(message || code);
    this.name = 'AdminAiQueryError';
    this.code = code;
    this.status = status;
    this.details = details || null;
  }
}

const makeAdminError = (code, message, options = {}) => (
  new AdminAiQueryError(code, message, options)
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

const dateToUtcMidnight = (dateString) => new Date(`${dateString}T00:00:00.000Z`);

const shiftDateString = (dateString, days) => {
  const date = dateToUtcMidnight(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isValidDateString = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = dateToUtcMidnight(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const dateDiffInclusive = (dateFrom, dateTo) => (
  Math.floor((dateToUtcMidnight(dateTo).getTime() - dateToUtcMidnight(dateFrom).getTime()) / DAY_MS) + 1
);

const resolveDate = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (!isValidDateString(value)) {
    throw makeAdminError('TOOL_INVALID_ARGUMENT', 'Invalid date.');
  }
  return value;
};

const resolveDateRange = ({
  dateFrom,
  dateTo,
  defaultDays = 30,
  maxDays = 90,
  now = new Date(),
} = {}) => {
  const today = toLocalDateString(now);
  let resolvedTo = resolveDate(dateTo, today);
  let resolvedFrom = resolveDate(dateFrom, shiftDateString(resolvedTo, -(defaultDays - 1)));

  if (dateToUtcMidnight(resolvedFrom) > dateToUtcMidnight(resolvedTo)) {
    throw makeAdminError('TOOL_INVALID_ARGUMENT', 'dateFrom must be before dateTo.');
  }

  if (dateDiffInclusive(resolvedFrom, resolvedTo) > maxDays) {
    resolvedFrom = shiftDateString(resolvedTo, -(maxDays - 1));
  }

  return {
    dateFrom: resolvedFrom,
    dateTo: resolvedTo,
    fromDate: dateToUtcMidnight(resolvedFrom),
    toDate: new Date(dateToUtcMidnight(resolvedTo).getTime() + DAY_MS - 1),
  };
};

const compactText = (value, maxLength = 160) => {
  if (typeof value !== 'string') return '';
  const compact = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
};

const CONTACT_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CONTACT_PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;
const ORDER_CODE_PATTERN = /\b(?:ORD|ORDER|PAY|PMT|REF)[-_]?[A-Z0-9]{2,}\b/gi;
const PAYMENT_PRIVATE_PATTERN = /\b(bank|account|order|payment|gateway|card|otp|qr|withdrawal)\b/gi;

const redactSensitiveText = (value, maxLength = 160) => (
  compactText(value, maxLength)
    .replace(CONTACT_EMAIL_PATTERN, '[redacted-email]')
    .replace(CONTACT_PHONE_PATTERN, '[redacted-phone]')
    .replace(ORDER_CODE_PATTERN, '[redacted-private]')
    .replace(PAYMENT_PRIVATE_PATTERN, '[redacted-private]')
);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const buildStatusCounts = (items) => (
  items.reduce((acc, item) => {
    const status = item?.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {})
);

const sumAmounts = (items) => items.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);

const normalizeRefundStatus = (status) => {
  if (status === 'pending') return 'requested';
  return status;
};

const toDateTimeString = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const safeOwnerLabel = (ownerId) => {
  const id = toIdString(ownerId);
  return id ? `Owner #${id.slice(-4)}` : 'Owner';
};

const toPendingRestaurantProjection = (restaurant) => ({
  restaurantId: toIdString(restaurant),
  name: compactText(restaurant?.name, 100) || 'Restaurant',
  status: restaurant?.approvalStatus || 'pending',
  ownerLabel: safeOwnerLabel(restaurant?.ownerId),
  submittedAt: toDateTimeString(restaurant?.createdAt || restaurant?.updatedAt),
});

const toRefundProjection = (refund) => ({
  refundId: toIdString(refund),
  status: refund?.status || 'unknown',
  amount: Number(refund?.amount) || 0,
  reason: redactSensitiveText(refund?.reason, 120) || null,
  createdAt: toDateTimeString(refund?.createdAt),
});

const createDateFilter = (range) => ({
  $gte: range.fromDate,
  $lte: range.toDate,
});

const makeQueryRegex = (query) => {
  const compact = compactText(query, 80);
  if (!compact) return null;
  return new RegExp(escapeRegex(compact), 'i');
};

const assertAdminActor = ({ adminId, role }) => {
  if (!adminId || role !== 'admin') {
    throw makeAdminError('AUTH_REQUIRED', 'Admin login is required.', { status: 'forbidden' });
  }
};

const createAdminAiQueryService = ({
  paymentModel = Payment,
  refundModel = Refund,
  restaurantModel = Restaurant,
  nowProvider = () => new Date(),
} = {}) => {
  const getPendingRestaurants = async ({
    adminId,
    role,
    query = null,
    limit = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    const regex = makeQueryRegex(query);
    const filter = {
      approvalStatus: 'pending',
      deletedAt: null,
      ...(regex ? { name: regex } : {}),
    };
    const restaurants = await findList(restaurantModel, filter, {
      select: '_id name ownerId approvalStatus createdAt updatedAt',
      sort: { createdAt: -1 },
      limit: clampLimit(limit),
    });

    return {
      type: 'admin_pending_restaurants',
      version: 1,
      payload: {
        total: restaurants.length,
        restaurants: restaurants.map(toPendingRestaurantProjection),
        sourceLabel: 'BookEat admin restaurants',
      },
    };
  };

  const getTransactions = async ({
    adminId,
    role,
    dateFrom = null,
    dateTo = null,
    status = null,
    query = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    if (status !== null && !PAYMENT_STATUSES.includes(status)) {
      throw makeAdminError('TOOL_INVALID_ARGUMENT', 'status is invalid.');
    }
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 30, maxDays: 90, now: nowProvider() });
    const regex = makeQueryRegex(query);
    const filter = {
      createdAt: createDateFilter(range),
      ...(status ? { status } : {}),
      ...(regex ? { $or: [{ status: regex }, { targetType: regex }, { gateway: regex }] } : {}),
    };
    const payments = await findList(paymentModel, filter, {
      select: '_id amount currency status targetType gateway createdAt',
      sort: { createdAt: -1 },
    });

    return {
      type: 'admin_transaction_summary',
      version: 1,
      payload: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        totalTransactions: payments.length,
        totalAmount: sumAmounts(payments),
        byStatus: buildStatusCounts(payments),
        currency: payments.find((item) => item.currency)?.currency || 'VND',
        sourceLabel: 'BookEat admin transactions',
      },
    };
  };

  const getRefunds = async ({
    adminId,
    role,
    dateFrom = null,
    dateTo = null,
    status = null,
    query = null,
    limit = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    const normalizedStatus = normalizeRefundStatus(status);
    if (normalizedStatus !== null && !REFUND_STATUSES.includes(normalizedStatus)) {
      throw makeAdminError('TOOL_INVALID_ARGUMENT', 'status is invalid.');
    }
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 30, maxDays: 90, now: nowProvider() });
    const regex = makeQueryRegex(query);
    const filter = {
      createdAt: createDateFilter(range),
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(regex ? { $or: [{ status: regex }, { reason: regex }] } : {}),
    };
    const refunds = await findList(refundModel, filter, {
      select: '_id amount status reason createdAt',
      sort: { createdAt: -1 },
      limit: clampLimit(limit),
    });

    return {
      type: 'admin_refund_summary',
      version: 1,
      payload: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        totalRefunds: refunds.length,
        totalAmount: sumAmounts(refunds),
        byStatus: buildStatusCounts(refunds),
        items: refunds.map(toRefundProjection),
        currency: 'VND',
        sourceLabel: 'BookEat admin refunds',
      },
    };
  };

  const getRevenueSummary = async ({
    adminId,
    role,
    dateFrom = null,
    dateTo = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 30, maxDays: 90, now: nowProvider() });
    const payments = await findList(paymentModel, {
      createdAt: createDateFilter(range),
      status: 'paid',
    }, {
      select: '_id amount currency status createdAt',
    });
    const grossRevenue = sumAmounts(payments);
    const platformFee = Math.round(grossRevenue * 0.1);

    return {
      type: 'admin_revenue_summary',
      version: 1,
      payload: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        grossRevenue,
        platformFee,
        restaurantPayout: Math.max(0, grossRevenue - platformFee),
        paidTransactionCount: payments.length,
        currency: payments.find((item) => item.currency)?.currency || 'VND',
        sourceLabel: 'BookEat admin revenue',
      },
    };
  };

  const detectAbnormalActivity = async ({
    adminId,
    role,
    dateFrom = null,
    dateTo = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    const range = resolveDateRange({ dateFrom, dateTo, defaultDays: 7, maxDays: 31, now: nowProvider() });
    const dateFilter = { createdAt: createDateFilter(range) };
    const payments = await findList(paymentModel, dateFilter, {
      select: '_id amount status createdAt',
    });
    const refunds = await findList(refundModel, dateFilter, {
      select: '_id amount status createdAt',
    });
    const pendingRestaurantCount = await countDocuments(restaurantModel, {
      approvalStatus: 'pending',
      deletedAt: null,
    });

    const failedPaymentCount = payments.filter((item) => (
      ['failed', 'cancelled', 'expired'].includes(item.status)
    )).length;
    const refundRate = payments.length ? refunds.length / payments.length : 0;
    const signals = [];

    if (refunds.length >= 5 && refundRate >= 0.2) {
      signals.push({
        code: 'high_refund_rate',
        type: 'high_refund_rate',
        severity: refundRate >= 0.4 ? 'high' : 'medium',
        label: 'High refund rate',
        count: refunds.length,
        reason: 'Refund volume is high compared with payment volume.',
        summary: 'Refund volume is high compared with payment volume.',
      });
    }
    if (failedPaymentCount >= 5) {
      signals.push({
        code: 'payment_failures',
        type: 'payment_failures',
        severity: failedPaymentCount >= 10 ? 'high' : 'medium',
        label: 'Payment failures',
        count: failedPaymentCount,
        reason: 'Many payments ended as failed, cancelled, or expired.',
        summary: 'Many payments ended as failed, cancelled, or expired.',
      });
    }
    if (pendingRestaurantCount >= 10) {
      signals.push({
        code: 'pending_restaurant_backlog',
        type: 'pending_restaurant_backlog',
        severity: pendingRestaurantCount >= 20 ? 'high' : 'medium',
        label: 'Pending restaurant backlog',
        count: pendingRestaurantCount,
        reason: 'Pending restaurant approvals may need admin review.',
        summary: 'Pending restaurant approvals may need admin review.',
      });
    }

    return {
      type: 'admin_abnormal_activity',
      version: 1,
      payload: {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        paymentCount: payments.length,
        refundCount: refunds.length,
        refundRate: Math.round(refundRate * 1000) / 1000,
        pendingRestaurantCount,
        signals,
        sourceLabel: 'BookEat admin anomaly scan',
      },
    };
  };

  const draftComplaintReply = async ({
    adminId,
    role,
    complaintText = null,
    tone = null,
    subjectType = null,
  } = {}) => {
    assertAdminActor({ adminId, role });
    const resolvedTone = tone && DRAFT_TONES.includes(tone) ? tone : 'supportive_professional';
    const resolvedSubject = subjectType || 'general';
    const safeHint = redactSensitiveText(complaintText, 90);
    const prefix = resolvedTone === 'concise'
      ? 'Cam on ban da lien he BookEat.'
      : 'Cam on ban da chia se trai nghiem voi BookEat. Chung toi xin ghi nhan phan anh cua ban.';
    const apology = resolvedTone === 'apologetic'
      ? ' BookEat thanh that xin loi vi bat tien nay.'
      : '';
    const followUp = resolvedSubject === 'refund'
      ? ' Doi ngu ho tro se kiem tra chinh sach hoan tien va phan hoi tren kenh ho tro chinh thuc.'
      : ' Doi ngu ho tro se ra soat thong tin lien quan va phan hoi tren kenh ho tro chinh thuc.';
    const reference = safeHint ? ` Tom tat da an danh: "${safeHint}".` : '';

    return {
      type: 'admin_draft_reply',
      version: 1,
      payload: {
        subjectType: resolvedSubject,
        tone: resolvedTone,
        draftReply: `${prefix}${apology}${followUp}${reference}`,
        disclaimer: 'Day chi la ban nhap, chua duoc gui va khong thay doi trang thai ticket/refund.',
        sourceLabel: 'BookEat admin draft reply',
      },
    };
  };

  return {
    detectAbnormalActivity,
    draftComplaintReply,
    getPendingRestaurants,
    getRefunds,
    getRevenueSummary,
    getTransactions,
  };
};

const defaultAdminAiQueryService = createAdminAiQueryService();

module.exports = {
  AdminAiQueryError,
  BOOKEAT_TIMEZONE,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  createAdminAiQueryService,
  makeAdminError,
  ...defaultAdminAiQueryService,
};
