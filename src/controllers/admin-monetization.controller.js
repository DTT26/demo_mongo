'use strict';

const adminMonetizationService = require('../services/admin-monetization.service');

const handleError = (res, error) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) console.error('[AdminMonetization]', error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Khong the tai du lieu monetization.',
    ...(error.code ? { code: error.code } : {}),
  });
};

exports.getRevenueSummary = async (req, res) => {
  try {
    const data = await adminMonetizationService.getRevenueSummary(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getPaymentTransactions = async (req, res) => {
  try {
    const data = await adminMonetizationService.getPaymentTransactions(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getBookingCommissions = async (req, res) => {
  try {
    const data = await adminMonetizationService.getBookingCommissionSummary(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getTopOwners = async (req, res) => {
  try {
    const data = await adminMonetizationService.getTopOwners(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getTopRestaurants = async (req, res) => {
  try {
    const data = await adminMonetizationService.getTopRestaurants(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getPaymentHealth = async (req, res) => {
  try {
    const data = await adminMonetizationService.getPaymentHealth(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getSettlementReadiness = async (req, res) => {
  try {
    const data = await adminMonetizationService.getSettlementReadiness(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.exportRevenueCsv = async (req, res) => {
  try {
    const csv = await adminMonetizationService.exportRevenueCsv(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookeat-monetization-report.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return handleError(res, error);
  }
};
