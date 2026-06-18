'use strict';

const adminQueryService = require('../admin-ai-query.service');

const getAdminId = (context = {}) => context.actor?.userId || context.user?._id || context.user?.id || null;

const getAdminRole = (context = {}) => context.actor?.role || context.user?.role || null;

const createAdminTools = ({
  adminQuery = adminQueryService,
} = {}) => {
  const withAdminContext = (args, context) => ({
    ...args,
    adminId: getAdminId(context),
    role: getAdminRole(context),
  });

  return {
    admin_get_pending_restaurants: (args = {}, context = {}) => (
      adminQuery.getPendingRestaurants(withAdminContext(args, context))
    ),

    admin_get_transactions: (args = {}, context = {}) => (
      adminQuery.getTransactions(withAdminContext(args, context))
    ),

    admin_get_refunds: (args = {}, context = {}) => (
      adminQuery.getRefunds(withAdminContext(args, context))
    ),

    admin_get_revenue_summary: (args = {}, context = {}) => (
      adminQuery.getRevenueSummary(withAdminContext(args, context))
    ),

    admin_detect_abnormal_activity: (args = {}, context = {}) => (
      adminQuery.detectAbnormalActivity(withAdminContext(args, context))
    ),

    admin_draft_complaint_reply: (args = {}, context = {}) => (
      adminQuery.draftComplaintReply(withAdminContext(args, context))
    ),
  };
};

module.exports = {
  createAdminTools,
};
