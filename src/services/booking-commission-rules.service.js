'use strict';

const BOOKING_COMMISSION_RULES = Object.freeze({
  free: Object.freeze({ type: 'fixed', amount: 5000, currency: 'VND' }),
  plus: Object.freeze({ type: 'fixed', amount: 2000, currency: 'VND' }),
  pro: Object.freeze({ type: 'waived', amount: 0, currency: 'VND' }),
});

const normalizePlanCode = (planCode) => {
  const normalized = String(planCode || 'free').trim().toLowerCase();
  return Object.hasOwn(BOOKING_COMMISSION_RULES, normalized) ? normalized : 'free';
};

const getBookingCommissionRule = (planCode) => {
  const normalizedPlanCode = normalizePlanCode(planCode);
  return {
    planCode: normalizedPlanCode,
    ...BOOKING_COMMISSION_RULES[normalizedPlanCode],
  };
};

module.exports = {
  BOOKING_COMMISSION_RULES,
  getBookingCommissionRule,
  normalizePlanCode,
};
