'use strict';

const ownerQueryService = require('../owner-ai-query.service');

const getOwnerId = (context = {}) => context.actor?.userId || context.user?._id || context.user?.id || null;

const getSelectedRestaurantId = (context = {}) => (
  context.ownerContext?.selectedRestaurantId || null
);

const createOwnerTools = ({
  ownerQuery = ownerQueryService,
} = {}) => {
  const withOwnerContext = (args, context) => ({
    ...args,
    ownerId: getOwnerId(context),
    selectedRestaurantId: getSelectedRestaurantId(context),
  });

  return {
    owner_get_today_bookings: (args = {}, context = {}) => (
      ownerQuery.getTodayBookings(withOwnerContext(args, context))
    ),

    owner_get_available_tables: (args = {}, context = {}) => (
      ownerQuery.getAvailableTables(withOwnerContext(args, context))
    ),

    owner_get_upcoming_customers: (args = {}, context = {}) => (
      ownerQuery.getUpcomingCustomers(withOwnerContext(args, context))
    ),

    owner_get_cancelled_bookings: (args = {}, context = {}) => (
      ownerQuery.getCancelledBookings(withOwnerContext(args, context))
    ),

    owner_get_revenue_summary: (args = {}, context = {}) => (
      ownerQuery.getRevenueSummary(withOwnerContext(args, context))
    ),

    owner_get_voucher_summary: (args = {}, context = {}) => (
      ownerQuery.getVoucherSummary(withOwnerContext(args, context))
    ),

    owner_get_review_summary: (args = {}, context = {}) => (
      ownerQuery.getReviewSummary(withOwnerContext(args, context))
    ),

    owner_search_booking: (args = {}, context = {}) => (
      ownerQuery.searchBooking(withOwnerContext(args, context))
    ),

    owner_suggest_review_reply: (args = {}, context = {}) => (
      ownerQuery.suggestReviewReply(withOwnerContext(args, context))
    ),
  };
};

module.exports = {
  createOwnerTools,
};
