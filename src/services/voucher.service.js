'use strict';

const Voucher = require('../models/Voucher');
const CustomerVoucher = require('../models/CustomerVoucher');
const VoucherRedemption = require('../models/VoucherRedemption');
const mongoose = require('mongoose');

/**
 * 1. Kiểm tra tính hợp lệ và tính số tiền giảm của Voucher
 */
const validateVoucher = async (code, restaurantId, customerId, orderAmount) => {
  if (!code) {
    return { valid: false, reason: 'Mã voucher không được để trống', discountAmount: 0 };
  }

  const voucher = await Voucher.findOne({
    code: code.toUpperCase(),
  });

  if (!voucher) {
    return { valid: false, reason: 'Mã giảm giá không tồn tại', discountAmount: 0 };
  }

  if (voucher.status !== 'active') {
    let reason = 'Mã giảm giá hiện không hoạt động';
    if (voucher.status === 'expired') reason = 'Mã giảm giá đã hết hạn';
    if (voucher.status === 'paused') reason = 'Mã giảm giá đang tạm dừng';
    if (voucher.status === 'disabled') reason = 'Mã giảm giá đã bị hủy';
    return { valid: false, reason, discountAmount: 0 };
  }

  const now = new Date();
  if (voucher.startDate && now < voucher.startDate) {
    return { valid: false, reason: 'Chương trình ưu đãi chưa bắt đầu', discountAmount: 0 };
  }

  if (voucher.endDate && now > voucher.endDate) {
    // Tự động cập nhật expired nếu đã quá hạn
    voucher.status = 'expired';
    await voucher.save();
    return { valid: false, reason: 'Mã giảm giá đã hết hạn sử dụng', discountAmount: 0 };
  }

  // Kiểm tra phạm vi nhà hàng (nếu restaurantId của voucher khác null và khác restaurantId truyền vào)
  if (voucher.restaurantId && restaurantId) {
    if (voucher.restaurantId.toString() !== restaurantId.toString()) {
      return { valid: false, reason: 'Mã giảm giá không áp dụng cho nhà hàng này', discountAmount: 0 };
    }
  }

  // Kiểm tra giá trị hóa đơn/đặt cọc tối thiểu
  if (voucher.minOrderAmount && orderAmount < voucher.minOrderAmount) {
    return { 
      valid: false, 
      reason: `Đơn hàng chưa đạt giá trị tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')} ₫`, 
      discountAmount: 0 
    };
  }

  // Kiểm tra giới hạn dùng toàn hệ thống
  if (voucher.globalUsageLimit !== null) {
    const totalRedemptions = await VoucherRedemption.countDocuments({ voucherId: voucher._id });
    if (totalRedemptions >= voucher.globalUsageLimit) {
      return { valid: false, reason: 'Mã giảm giá đã hết lượt sử dụng', discountAmount: 0 };
    }
  }

  // Kiểm tra số lần sử dụng của khách hàng cụ thể này
  if (voucher.perCustomerLimit !== null && customerId) {
    const customerUsage = await VoucherRedemption.countDocuments({
      voucherId: voucher._id,
      customerId: customerId,
    });
    if (customerUsage >= voucher.perCustomerLimit) {
      return { valid: false, reason: 'Bạn đã sử dụng hết số lần cho phép của mã này', discountAmount: 0 };
    }
  }

  // Tính số tiền được giảm giá
  let discountAmount = 0;
  if (voucher.discountType === 'percentage') {
    discountAmount = (orderAmount * voucher.discountValue) / 100;
    if (voucher.maxDiscountAmount !== null) {
      discountAmount = Math.min(discountAmount, voucher.maxDiscountAmount);
    }
  } else if (voucher.discountType === 'fixed_amount') {
    discountAmount = voucher.discountValue;
  }

  // Đảm bảo số tiền giảm không vượt quá tổng số tiền hóa đơn
  discountAmount = Math.min(discountAmount, orderAmount);
  discountAmount = Math.max(0, discountAmount);

  return { valid: true, reason: null, discountAmount, voucher };
};

/**
 * 2. Lưu voucher vào ví khách hàng (Save/Claim)
 */
const saveVoucherForCustomer = async (voucherId, customerId) => {
  const voucher = await Voucher.findById(voucherId);
  if (!voucher) {
    throw new Error('Voucher không tồn tại');
  }

  if (voucher.status !== 'active') {
    throw new Error('Voucher này hiện không thể lưu');
  }

  const now = new Date();
  if (voucher.endDate && now > voucher.endDate) {
    throw new Error('Voucher đã hết hạn sử dụng');
  }

  // Kiểm tra xem đã lưu chưa
  const existingSaved = await CustomerVoucher.findOne({ customerId, voucherId });
  if (existingSaved) {
    throw new Error('Bạn đã lưu voucher này trong ví rồi');
  }

  // Kiểm tra giới hạn lượt dùng toàn hệ thống
  if (voucher.globalUsageLimit !== null) {
    const totalRedemptions = await VoucherRedemption.countDocuments({ voucherId: voucher._id });
    if (totalRedemptions >= voucher.globalUsageLimit) {
      throw new Error('Voucher đã hết lượt sử dụng trên hệ thống');
    }
  }

  const savedVoucher = new CustomerVoucher({
    customerId,
    voucherId,
  });

  await savedVoucher.save();
  return savedVoucher;
};

/**
 * 3. Ghi nhận sử dụng Voucher (Redeem)
 */
const redeemVoucher = async (code, restaurantId, customerId, orderAmount, bookingId, paymentId = null) => {
  const validation = await validateVoucher(code, restaurantId, customerId, orderAmount);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const voucher = validation.voucher;
  const discountAmount = validation.discountAmount;

  // Tạo bản ghi VoucherRedemption
  const redemption = new VoucherRedemption({
    voucherId: voucher._id,
    customerId,
    bookingId,
    paymentId,
    discountApplied: discountAmount,
    amountBefore: orderAmount,
    amountAfter: orderAmount - discountAmount,
  });
  await redemption.save();

  // Cập nhật CustomerVoucher của khách hàng (nếu họ đã lưu trước đó)
  const customerVoucher = await CustomerVoucher.findOne({ customerId, voucherId: voucher._id });
  if (customerVoucher) {
    customerVoucher.timesUsed += 1;
    customerVoucher.usedAt = new Date();
    
    if (voucher.perCustomerLimit !== null && customerVoucher.timesUsed >= voucher.perCustomerLimit) {
      customerVoucher.isUsed = true;
    }
    await customerVoucher.save();
  } else {
    // Nếu khách hàng chưa lưu voucher này nhưng nhập mã và sử dụng trực tiếp -> Tự tạo bản ghi CustomerVoucher đã dùng
    const newCustomerVoucher = new CustomerVoucher({
      customerId,
      voucherId: voucher._id,
      isUsed: voucher.perCustomerLimit !== null && 1 >= voucher.perCustomerLimit,
      timesUsed: 1,
      usedAt: new Date(),
    });
    await newCustomerVoucher.save();
  }

  return redemption;
};

/**
 * 4. Lấy danh sách ví voucher của Customer
 */
const getCustomerVouchers = async (customerId, filter = 'all') => {
  const query = { customerId };
  const now = new Date();

  const saved = await CustomerVoucher.find(query)
    .populate({
      path: 'voucherId',
      populate: {
        path: 'restaurantId',
        select: 'name address logo images',
      }
    })
    .sort({ createdAt: -1 });

  return saved.filter(item => {
    const v = item.voucherId;
    if (!v) return false;

    // Phân loại bộ lọc
    const isExpired = v.endDate && now > v.endDate;
    const isInactiveOrDisabled = ['expired', 'disabled'].includes(v.status);

    if (filter === 'unused') {
      return !item.isUsed && !isExpired && !isInactiveOrDisabled && v.status === 'active';
    }
    if (filter === 'used') {
      return item.isUsed;
    }
    if (filter === 'expired') {
      return isExpired || v.status === 'expired';
    }
    return true; // 'all'
  });
};

/**
 * 5. Lấy danh sách voucher khả dụng tại trang chi tiết nhà hàng
 */
const getAvailableRestaurantVouchers = async (restaurantId, customerId = null) => {
  const now = new Date();
  
  // Tìm các voucher active của riêng nhà hàng này HOẶC voucher Global (restaurantId = null)
  const vouchers = await Voucher.find({
    status: 'active',
    startDate: { $lte: now },
    $and: [
      {
        $or: [
          { restaurantId: restaurantId },
          { restaurantId: null },
        ],
      },
      {
        $or: [
          { endDate: null },
          { endDate: { $gte: now } },
        ],
      },
    ]
  }).sort({ createdAt: -1 });

  // Nếu truyền customerId, trả về thêm thông tin đã lưu hay chưa
  if (customerId) {
    const savedVoucherIds = await CustomerVoucher.find({ customerId })
      .distinct('voucherId');
    
    return vouchers.map(v => {
      const item = v.toObject();
      item.isSaved = savedVoucherIds.some(id => id.toString() === v._id.toString());
      return item;
    });
  }

  return vouchers;
};

/**
 * 6. Thống kê hiệu quả voucher cho chủ nhà hàng (Owner)
 */
const getVoucherStats = async (voucherId, restaurantId) => {
  const voucher = await Voucher.findOne({ _id: voucherId, restaurantId });
  if (!voucher) {
    throw new Error('Voucher không tồn tại hoặc không thuộc quyền quản lý của bạn');
  }

  const savedCount = await CustomerVoucher.countDocuments({ voucherId });
  const redemptions = await VoucherRedemption.find({ voucherId });
  const usedCount = redemptions.length;
  const totalDiscount = redemptions.reduce((acc, curr) => acc + curr.discountApplied, 0);

  return {
    voucherId,
    code: voucher.code,
    status: voucher.status,
    savedCount,
    usedCount,
    totalDiscount,
    redemptions: redemptions.map(r => ({
      bookingId: r.bookingId,
      customerId: r.customerId,
      discountApplied: r.discountApplied,
      amountBefore: r.amountBefore,
      amountAfter: r.amountAfter,
      usedAt: r.usedAt
    }))
  };
};

module.exports = {
  validateVoucher,
  saveVoucherForCustomer,
  redeemVoucher,
  getCustomerVouchers,
  getAvailableRestaurantVouchers,
  getVoucherStats,
};
