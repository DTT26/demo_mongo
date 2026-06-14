'use strict';

const Voucher = require('../models/Voucher');
const Restaurant = require('../models/Restaurant');
const voucherService = require('../services/voucher.service');

// ─── POST /api/v1/vouchers/validate ───
exports.validateVoucherForBooking = async (req, res) => {
  try {
    const { code, restaurantId, orderAmount } = req.body;
    const customerId = req.user ? req.user._id : null;

    const result = await voucherService.validateVoucher(code, restaurantId, customerId, orderAmount);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── POST /api/v1/vouchers/save ───
exports.saveVoucher = async (req, res) => {
  try {
    const { voucherId } = req.body;
    const customerId = req.user._id;

    const saved = await voucherService.saveVoucherForCustomer(voucherId, customerId);
    return res.status(200).json({ success: true, message: 'Đã lưu voucher vào ví thành công', data: saved });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/vouchers/my-vouchers ───
exports.getMyVouchers = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { filter = 'all' } = req.query;

    const list = await voucherService.getCustomerVouchers(customerId, filter);
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/vouchers/restaurant/:restaurantId ───
exports.getRestaurantVouchers = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const customerId = req.user ? req.user._id : null;

    const list = await voucherService.getAvailableRestaurantVouchers(restaurantId, customerId);
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── POST /api/v1/owner/vouchers (Owner tạo voucher của mình) ───
exports.createVoucher = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { 
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
      restaurantId 
    } = req.body;

    let finalRestaurantId = null;
    if (userRole === 'owner') {
      const restaurant = await Restaurant.findOne({ ownerId: userId });
      if (!restaurant) {
        return res.status(403).json({ success: false, message: 'Bạn không sở hữu nhà hàng nào để tạo voucher.' });
      }
      finalRestaurantId = restaurant._id;
    } else if (userRole === 'admin') {
      finalRestaurantId = restaurantId || null;
    } else {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền tạo voucher.' });
    }

    const existing = await Voucher.findOne({ code: code.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Mã voucher này đã tồn tại trên hệ thống.' });
    }

    const voucher = new Voucher({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      startDate: startDate || new Date(),
      endDate: endDate || null,
      globalUsageLimit: globalUsageLimit !== undefined && globalUsageLimit !== '' ? globalUsageLimit : null,
      perCustomerLimit: perCustomerLimit || 1,
      restaurantId: finalRestaurantId,
      createdBy: userId,
    });

    await voucher.save();
    return res.status(201).json({ success: true, message: 'Tạo voucher thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PUT /api/v1/vouchers/:id ───
exports.updateVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { description, endDate, status } = req.body;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại' });
    }

    if (userRole === 'owner') {
      const restaurant = await Restaurant.findOne({ ownerId: userId });
      if (!restaurant || (voucher.restaurantId && voucher.restaurantId.toString() !== restaurant._id.toString())) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa voucher này.' });
      }
    }

    if (description !== undefined) voucher.description = description;
    if (endDate !== undefined) voucher.endDate = endDate;
    if (status !== undefined) voucher.status = status;

    await voucher.save();
    return res.status(200).json({ success: true, message: 'Cập nhật voucher thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── DELETE /api/v1/vouchers/:id ───
exports.deleteVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại' });
    }

    if (userRole === 'owner') {
      const restaurant = await Restaurant.findOne({ ownerId: userId });
      if (!restaurant || (voucher.restaurantId && voucher.restaurantId.toString() !== restaurant._id.toString())) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa voucher này.' });
      }
    }

    voucher.status = 'disabled';
    await voucher.save();

    return res.status(200).json({ success: true, message: 'Đã vô hiệu hóa voucher thành công' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/vouchers/:id/stats ───
exports.getVoucherStats = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    let restaurantId = null;
    if (userRole === 'owner') {
      const restaurant = await Restaurant.findOne({ ownerId: userId });
      if (!restaurant) {
        return res.status(403).json({ success: false, message: 'Bạn không sở hữu nhà hàng nào.' });
      }
      restaurantId = restaurant._id.toString();
    }

    const stats = await voucherService.getVoucherStats(id, restaurantId);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/owner/vouchers ───
exports.getOwnerVouchers = async (req, res) => {
  try {
    const userId = req.user._id;
    const restaurant = await Restaurant.findOne({ ownerId: userId });
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Bạn chưa có nhà hàng.' });
    }

    const vouchers = await Voucher.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: vouchers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/admin/vouchers ───
exports.getAdminVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find().populate('restaurantId', 'name').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: vouchers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
