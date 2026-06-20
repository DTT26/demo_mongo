'use strict';

const bookingCommissionService = require('../services/booking-commission.service');

const handleError = (res, error) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) console.error('[BookingCommission]', error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Không thể tải dữ liệu phí booking.',
    ...(error.code ? { code: error.code } : {}),
  });
};

exports.getOwnerCommissions = async (req, res) => {
  try {
    const result = await bookingCommissionService.getOwnerCommissions(req.user._id, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getAdminCommissions = async (req, res) => {
  try {
    const result = await bookingCommissionService.getAdminCommissionSummary(req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};
