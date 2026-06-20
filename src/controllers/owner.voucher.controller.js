'use strict';

const Voucher = require('../models/Voucher');
const Restaurant = require('../models/Restaurant');
const VoucherRedemption = require('../models/VoucherRedemption');
const voucherService = require('../services/voucher.service');
const voucherAnalyticsService = require('../services/voucher.analytics.service');

/**
 * [DEPRECATED] Chỉ lấy nhà hàng đầu tiên — dùng verifyOwnerRestaurant thay thế
 */
const getOwnerRestaurant = async (userId) => {
  const restaurant = await Restaurant.findOne({ ownerId: userId });
  if (!restaurant) {
    throw new Error('Bạn không sở hữu nhà hàng nào để thực hiện thao tác này.');
  }
  return restaurant;
};

/**
 * Multi-restaurant safe helper: verify owner sở hữu nhà hàng restaurantId.
 * Nếu restaurantId không được cung cấp, fallback về nhà hàng đầu tiên của owner.
 * @param {string} userId - ID của user đang đăng nhập (owner)
 * @param {string|null} restaurantId - ID nhà hàng cần verify (từ query hoặc body)
 * @returns {Promise<Restaurant>} restaurant document đã xác thực
 */
const verifyOwnerRestaurant = async (userId, restaurantId) => {
  if (restaurantId) {
    const restaurant = await Restaurant.findOne({ _id: restaurantId, ownerId: userId });
    if (!restaurant) {
      throw new Error('Bạn không có quyền truy cập nhà hàng này hoặc nhà hàng không tồn tại.');
    }
    return restaurant;
  }
  // fallback: lấy nhà hàng đầu tiên nếu không cung cấp restaurantId
  const restaurant = await Restaurant.findOne({ ownerId: userId });
  if (!restaurant) {
    throw new Error('Bạn không sở hữu nhà hàng nào để thực hiện thao tác này.');
  }
  return restaurant;
};

/**
 * GET /api/v1/owner/vouchers
 * List owner vouchers with pagination, status filters, and sorting
 */
exports.getOwnerVouchers = async (req, res) => {
  try {
    const { restaurantId, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 10 } = req.query;
    const restaurant = await verifyOwnerRestaurant(req.user._id, restaurantId);

    const filter = { restaurantId: restaurant._id };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: 'disabled' }; // Hide disabled/soft-deleted vouchers by default
    }

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter)
        .sort(sort)
        .skip(skipIndex)
        .limit(parseInt(limit)),
      Voucher.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: vouchers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/owner/vouchers
 * Create a voucher under the owner's restaurant
 */
exports.createOwnerVoucher = async (req, res) => {
  try {
    const {
      restaurantId,
      name,
      code,
      description,
      discountType,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      startDate,
      endDate,
      globalUsageLimit,
      perCustomerLimit,
    } = req.body;

    if (!endDate) {
      return res.status(400).json({ success: false, message: 'Nhà hàng bắt buộc phải đặt ngày kết thúc cho voucher.' });
    }

    const restaurant = await verifyOwnerRestaurant(req.user._id, restaurantId);

    const uppercaseCode = code.toUpperCase().trim();
    const existing = await Voucher.findOne({ code: uppercaseCode });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Mã voucher này đã tồn tại trên hệ thống.' });
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau ngày bắt đầu.' });
    }

    const initialStatus = start > now ? 'scheduled' : 'active';

    const voucher = new Voucher({
      name,
      code: uppercaseCode,
      description,
      type: 'restaurant',
      createdByRole: 'owner',
      discountType,
      discountValue,
      maxDiscountAmount: discountType === 'percentage' ? (maxDiscountAmount || null) : null,
      minOrderAmount: minOrderAmount || 0,
      startDate: start,
      endDate: end,
      globalUsageLimit: globalUsageLimit ? parseInt(globalUsageLimit) : null,
      perCustomerLimit: perCustomerLimit ? parseInt(perCustomerLimit) : 1,
      restaurantId: restaurant._id,
      createdBy: req.user._id,
      status: initialStatus,
    });

    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'create',
      actorId: req.user._id,
      actorRole: 'owner',
      result: 'success',
    });

    return res.status(201).json({ success: true, message: 'Tạo voucher nhà hàng thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/v1/owner/vouchers/:id
 * Update an owner's voucher. Blocking code updates if redemptions already occurred.
 */
exports.updateOwnerVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, endDate, status, minOrderAmount, maxDiscountAmount, globalUsageLimit, perCustomerLimit } = req.body;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy voucher hoặc bạn không có quyền.' });
    }

    // Verify ownership of the restaurant this voucher belongs to
    await verifyOwnerRestaurant(req.user._id, voucher.restaurantId);

    // If change stats or rules, verify if there are redemptions
    const redemptionCount = await VoucherRedemption.countDocuments({ voucherId: id, status: 'completed' });
    if (redemptionCount > 0 && req.body.code && req.body.code.toUpperCase() !== voucher.code) {
      return res.status(400).json({ success: false, message: 'Không thể chỉnh sửa mã voucher khi đã có khách hàng sử dụng.' });
    }

    if (name) voucher.name = name;
    if (description !== undefined) voucher.description = description;
    if (minOrderAmount !== undefined) voucher.minOrderAmount = minOrderAmount;
    if (maxDiscountAmount !== undefined) voucher.maxDiscountAmount = maxDiscountAmount;
    
    if (globalUsageLimit !== undefined) {
      const limit = globalUsageLimit ? parseInt(globalUsageLimit) : null;
      if (limit !== null && limit < voucher.currentUsage) {
        return res.status(400).json({ success: false, message: `Giới hạn hệ thống không thể nhỏ hơn số lượt đã dùng hiện tại (${voucher.currentUsage}).` });
      }
      voucher.globalUsageLimit = limit;
    }
    
    if (perCustomerLimit !== undefined) voucher.perCustomerLimit = perCustomerLimit ? parseInt(perCustomerLimit) : 1;

    if (endDate) {
      const newEnd = new Date(endDate);
      if (newEnd <= voucher.startDate) {
        return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau ngày bắt đầu.' });
      }
      voucher.endDate = newEnd;
    }

    if (status) {
      voucher.status = status;
    }

    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'update',
      actorId: req.user._id,
      actorRole: 'owner',
      result: 'success',
    });

    return res.status(200).json({ success: true, message: 'Cập nhật voucher thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/v1/owner/vouchers/:id/status
 * Pause or resume owner's voucher
 */
exports.changeOwnerVoucherStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái chuyển đổi không hợp lệ. Chỉ cho phép active hoặc paused.' });
    }

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy voucher hoặc bạn không có quyền.' });
    }

    // Verify ownership of the restaurant this voucher belongs to
    await verifyOwnerRestaurant(req.user._id, voucher.restaurantId);

    voucher.status = status;
    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'status_change',
      actorId: req.user._id,
      actorRole: 'owner',
      result: 'success',
      metadata: { newStatus: status },
    });

    return res.status(200).json({ success: true, message: `Đã đổi trạng thái voucher sang ${status === 'active' ? 'Hoạt động' : 'Tạm dừng'}`, data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/v1/owner/vouchers/:id
 * Soft delete (set status to disabled)
 */
exports.deleteOwnerVoucher = async (req, res) => {
  try {
    const { id } = req.params;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy voucher hoặc bạn không có quyền.' });
    }

    // Verify ownership of the restaurant this voucher belongs to
    await verifyOwnerRestaurant(req.user._id, voucher.restaurantId);

    voucher.status = 'disabled';
    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'delete',
      actorId: req.user._id,
      actorRole: 'owner',
      result: 'success',
    });

    return res.status(200).json({ success: true, message: 'Đã hủy kích hoạt voucher thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/owner/vouchers/:id/stats
 * Stats for a single voucher
 */
exports.getOwnerVoucherStats = async (req, res) => {
  try {
    const { id } = req.params;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy voucher hoặc bạn không có quyền.' });
    }

    // Verify ownership of the restaurant this voucher belongs to
    await verifyOwnerRestaurant(req.user._id, voucher.restaurantId);

    const stats = await voucherService.getVoucherStats(id, voucher.restaurantId);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/owner/vouchers/:id/redemptions
 * Redemption logs for a single voucher
 */
exports.getOwnerVoucherRedemptions = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy voucher hoặc bạn không có quyền.' });
    }

    // Verify ownership of the restaurant this voucher belongs to
    await verifyOwnerRestaurant(req.user._id, voucher.restaurantId);

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);

    const [redemptions, total] = await Promise.all([
      VoucherRedemption.find({ voucherId: id })
        .populate({
          path: 'customerId',
          select: 'fullName email phoneNumber',
        })
        .sort({ usedAt: -1 })
        .skip(skipIndex)
        .limit(parseInt(limit)),
      VoucherRedemption.countDocuments({ voucherId: id }),
    ]);

    // Mask sensitive customer details for restaurant staff
    const maskedRedemptions = redemptions.map(r => {
      const customer = r.customerId ? r.customerId.toObject() : null;
      if (customer) {
        if (customer.email) {
          const [name, domain] = customer.email.split('@');
          customer.email = `${name.slice(0, 3)}***@${domain}`;
        }
        if (customer.phoneNumber) {
          customer.phoneNumber = `${customer.phoneNumber.slice(0, 4)}***${customer.phoneNumber.slice(-3)}`;
        }
      }
      return {
        _id: r._id,
        bookingId: r.bookingId,
        discountApplied: r.discountApplied,
        amountBefore: r.amountBefore,
        amountAfter: r.amountAfter,
        status: r.status,
        channel: r.channel,
        usedAt: r.usedAt,
        customer,
      };
    });

    return res.status(200).json({
      success: true,
      data: maskedRedemptions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/owner/vouchers/redemptions
 * All redemption logs for a restaurant
 */
exports.getOwnerRestaurantRedemptions = async (req, res) => {
  try {
    const { restaurantId, page = 1, limit = 10 } = req.query;
    const restaurant = await verifyOwnerRestaurant(req.user._id, restaurantId);

    const restaurantVouchers = await Voucher.find({ restaurantId: restaurant._id }).distinct('_id');

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);

    const [redemptions, total] = await Promise.all([
      VoucherRedemption.find({ voucherId: { $in: restaurantVouchers } })
        .populate({
          path: 'voucherId',
          select: 'code name discountType discountValue'
        })
        .populate({
          path: 'customerId',
          select: 'fullName email phoneNumber',
        })
        .sort({ usedAt: -1 })
        .skip(skipIndex)
        .limit(parseInt(limit)),
      VoucherRedemption.countDocuments({ voucherId: { $in: restaurantVouchers } }),
    ]);

    // Mask sensitive customer details for restaurant staff
    const maskedRedemptions = redemptions.map(r => {
      const customer = r.customerId ? r.customerId.toObject() : null;
      if (customer) {
        if (customer.email) {
          const [name, domain] = customer.email.split('@');
          customer.email = `${name.slice(0, 3)}***@${domain}`;
        }
        if (customer.phoneNumber) {
          customer.phoneNumber = `${customer.phoneNumber.slice(0, 4)}***${customer.phoneNumber.slice(-3)}`;
        }
      }
      return {
        _id: r._id,
        bookingId: r.bookingId,
        discountApplied: r.discountApplied,
        amountBefore: r.amountBefore,
        amountAfter: r.amountAfter,
        status: r.status,
        channel: r.channel,
        usedAt: r.usedAt,
        customer,
        voucher: r.voucherId,
      };
    });

    return res.status(200).json({
      success: true,
      data: maskedRedemptions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/owner/vouchers/analytics
 * Total aggregated metrics for all of owner's vouchers
 */
exports.getOwnerVouchersAnalytics = async (req, res) => {
  try {
    const { restaurantId, startDate, endDate, granularity = 'day' } = req.query;
    const restaurant = await verifyOwnerRestaurant(req.user._id, restaurantId);

    const dateRange = {};
    if (startDate) dateRange.startDate = startDate;
    if (endDate) dateRange.endDate = endDate;

    const [topVouchers, conversion, usageTrend, finance] = await Promise.all([
      voucherAnalyticsService.getTopVouchers(dateRange, 5, restaurant._id),
      voucherAnalyticsService.getConversionRate(dateRange, restaurant._id),
      voucherAnalyticsService.getUsageByDate(dateRange, granularity, restaurant._id),
      voucherAnalyticsService.getRevenueImpact(dateRange, restaurant._id),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        topVouchers,
        conversion,
        usageTrend,
        finance,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
