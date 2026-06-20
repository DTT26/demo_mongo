'use strict';

const VoucherRedemption = require('../models/VoucherRedemption');
const VoucherAuditLog = require('../models/VoucherAuditLog');
const Voucher = require('../models/Voucher');
const mongoose = require('mongoose');

/**
 * Gets top vouchers by usage count and total discount
 */
const getTopVouchers = async (dateRange = {}, limit = 10, restaurantId = null) => {
  const match = { status: 'completed' };
  
  if (dateRange.startDate || dateRange.endDate) {
    match.usedAt = {};
    if (dateRange.startDate) match.usedAt.$gte = new Date(dateRange.startDate);
    if (dateRange.endDate) match.usedAt.$lte = new Date(dateRange.endDate);
  }

  // If owner queries, filter by their vouchers
  let voucherIds = [];
  if (restaurantId) {
    const vouchers = await Voucher.find({ restaurantId }).distinct('_id');
    voucherIds = vouchers.map(id => new mongoose.Types.ObjectId(id));
    match.voucherId = { $in: voucherIds };
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$voucherId',
        usageCount: { $sum: 1 },
        totalDiscount: { $sum: '$discountApplied' },
        revenueGenerated: { $sum: '$amountAfter' },
      },
    },
    { $sort: { usageCount: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'vouchers',
        localField: '_id',
        foreignField: '_id',
        as: 'voucherInfo',
      },
    },
    { $unwind: '$voucherInfo' },
    {
      $project: {
        _id: 1,
        usageCount: 1,
        totalDiscount: 1,
        revenueGenerated: 1,
        code: '$voucherInfo.code',
        name: '$voucherInfo.name',
        discountType: '$voucherInfo.discountType',
        discountValue: '$voucherInfo.discountValue',
      },
    },
  ];

  return VoucherRedemption.aggregate(pipeline);
};

/**
 * Gets conversion rate (Validate -> Save -> Redeem)
 */
const getConversionRate = async (dateRange = {}, restaurantId = null) => {
  const matchLog = {};
  const matchRedeem = { status: 'completed' };

  if (dateRange.startDate || dateRange.endDate) {
    matchLog.createdAt = {};
    matchRedeem.usedAt = {};
    if (dateRange.startDate) {
      matchLog.createdAt.$gte = new Date(dateRange.startDate);
      matchRedeem.usedAt.$gte = new Date(dateRange.startDate);
    }
    if (dateRange.endDate) {
      matchLog.createdAt.$lte = new Date(dateRange.endDate);
      matchRedeem.usedAt.$lte = new Date(dateRange.endDate);
    }
  }

  let voucherIds = [];
  if (restaurantId) {
    const vouchers = await Voucher.find({ restaurantId }).distinct('_id');
    voucherIds = vouchers.map(id => new mongoose.Types.ObjectId(id));
    matchLog.voucherId = { $in: voucherIds };
    matchRedeem.voucherId = { $in: voucherIds };
  }

  // Count total validates
  const totalValidates = await VoucherAuditLog.countDocuments({
    ...matchLog,
    action: 'validate',
    result: 'success',
  });

  // Count total saves
  const totalSaves = await VoucherAuditLog.countDocuments({
    ...matchLog,
    action: 'save',
    result: 'success',
  });

  // Count total redeems
  const totalRedeems = await VoucherRedemption.countDocuments(matchRedeem);

  const validateToSaveRate = totalValidates > 0 ? (totalSaves / totalValidates) * 100 : 0;
  const saveToRedeemRate = totalSaves > 0 ? (totalRedeems / totalSaves) * 100 : 0;
  const validateToRedeemRate = totalValidates > 0 ? (totalRedeems / totalValidates) * 100 : 0;

  return {
    funnel: {
      validates: totalValidates,
      saves: totalSaves,
      redeems: totalRedeems,
    },
    conversionRates: {
      validateToSave: parseFloat(validateToSaveRate.toFixed(2)),
      saveToRedeem: parseFloat(saveToRedeemRate.toFixed(2)),
      validateToRedeem: parseFloat(validateToRedeemRate.toFixed(2)),
    },
  };
};

/**
 * Gets usage counts over time grouped by date
 */
const getUsageByDate = async (dateRange = {}, granularity = 'day', restaurantId = null, voucherId = null) => {
  const match = { status: 'completed' };

  if (dateRange.startDate || dateRange.endDate) {
    match.usedAt = {};
    if (dateRange.startDate) match.usedAt.$gte = new Date(dateRange.startDate);
    if (dateRange.endDate) match.usedAt.$lte = new Date(dateRange.endDate);
  }

  if (voucherId) {
    match.voucherId = new mongoose.Types.ObjectId(voucherId);
  } else if (restaurantId) {
    const vouchers = await Voucher.find({ restaurantId }).distinct('_id');
    const voucherIds = vouchers.map(id => new mongoose.Types.ObjectId(id));
    match.voucherId = { $in: voucherIds };
  }

  let formatStr = '%Y-%m-%d';
  if (granularity === 'week') formatStr = '%Y-%U';
  if (granularity === 'month') formatStr = '%Y-%m';

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: formatStr, date: '$usedAt' } },
        count: { $sum: 1 },
        totalDiscount: { $sum: '$discountApplied' },
        revenue: { $sum: '$amountAfter' },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const results = await VoucherRedemption.aggregate(pipeline);
  return results.map(r => ({
    date: r._id,
    count: r.count,
    totalDiscount: r.totalDiscount,
    revenue: r.revenue,
  }));
};

/**
 * Gets overall ROI and financial impact
 */
const getRevenueImpact = async (dateRange = {}, restaurantId = null) => {
  const match = { status: 'completed' };

  if (dateRange.startDate || dateRange.endDate) {
    match.usedAt = {};
    if (dateRange.startDate) match.usedAt.$gte = new Date(dateRange.startDate);
    if (dateRange.endDate) match.usedAt.$lte = new Date(dateRange.endDate);
  }

  if (restaurantId) {
    const vouchers = await Voucher.find({ restaurantId }).distinct('_id');
    const voucherIds = vouchers.map(id => new mongoose.Types.ObjectId(id));
    match.voucherId = { $in: voucherIds };
  }

  const result = await VoucherRedemption.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRedeemed: { $sum: 1 },
        totalDiscountIssued: { $sum: '$discountApplied' },
        totalRevenueGenerated: { $sum: '$amountAfter' },
        totalBookingValue: { $sum: '$amountBefore' },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      totalRedeemed: 0,
      totalDiscountIssued: 0,
      totalRevenueGenerated: 0,
      totalBookingValue: 0,
      roi: 0,
    };
  }

  const data = result[0];
  const roi = data.totalDiscountIssued > 0 ? (data.totalRevenueGenerated / data.totalDiscountIssued) : 0;

  return {
    totalRedeemed: data.totalRedeemed,
    totalDiscountIssued: data.totalDiscountIssued,
    totalRevenueGenerated: data.totalRevenueGenerated,
    totalBookingValue: data.totalBookingValue,
    roi: parseFloat(roi.toFixed(2)),
  };
};

/**
 * Audit log aggregation to detect abnormal/suspicious voucher activities
 */
const getFraudPatterns = async () => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Pattern 1: Same IP validating multiple distinct codes in short duration
  const ipMultiCode = await VoucherAuditLog.aggregate([
    { $match: { createdAt: { $gte: oneDayAgo }, action: 'validate' } },
    {
      $group: {
        _id: '$ipAddress',
        distinctVouchers: { $addToSet: '$voucherId' },
        attempts: { $sum: 1 },
      },
    },
    {
      $project: {
        ipAddress: '$_id',
        distinctVoucherCount: { $size: '$distinctVouchers' },
        attempts: 1,
      },
    },
    { $match: { distinctVoucherCount: { $gt: 3 } } },
    { $sort: { distinctVoucherCount: -1 } },
  ]);

  // Pattern 2: Same customer validating code repeatedly but failing (spamming / guess code)
  const customerSpam = await VoucherAuditLog.aggregate([
    { $match: { createdAt: { $gte: oneDayAgo }, action: 'validate', result: 'failure' } },
    {
      $group: {
        _id: '$customerId',
        failures: { $sum: 1 },
        reasons: { $addToSet: '$errorReason' },
      },
    },
    { $match: { failures: { $gt: 5 } } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        customerId: '$_id',
        failures: 1,
        reasons: 1,
        customerName: '$customerInfo.fullName',
        customerEmail: '$customerInfo.email',
      },
    },
  ]);

  return {
    suspiciousIPs: ipMultiCode,
    suspiciousCustomers: customerSpam,
  };
};

module.exports = {
  getTopVouchers,
  getConversionRate,
  getUsageByDate,
  getRevenueImpact,
  getFraudPatterns,
};
