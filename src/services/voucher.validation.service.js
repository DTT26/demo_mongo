'use strict';

const Voucher = require('../models/Voucher');
const CustomerVoucher = require('../models/CustomerVoucher');
const VoucherRedemption = require('../models/VoucherRedemption');
const Restaurant = require('../models/Restaurant');
const Booking = require('../models/Booking');

// Rate limiting in-memory store
const rateLimits = {
  ip: new Map(), // ip -> array of timestamps
  user: new Map(), // userId -> array of timestamps
};

/**
 * Checks and updates rate limits for voucher validation
 */
const checkRateLimit = (ip, userId) => {
  const now = Date.now();

  if (ip) {
    let ipTimes = rateLimits.ip.get(ip) || [];
    ipTimes = ipTimes.filter(t => now - t < 60 * 1000); // 1 minute window
    if (ipTimes.length >= 5) {
      return { limited: true, reason: 'Quá giới hạn thử mã (tối đa 5 lần/phút từ cùng một IP). Vui lòng thử lại sau.' };
    }
    ipTimes.push(now);
    rateLimits.ip.set(ip, ipTimes);
  }

  if (userId) {
    const userStr = userId.toString();
    let userTimes = rateLimits.user.get(userStr) || [];
    userTimes = userTimes.filter(t => now - t < 3600 * 1000); // 1 hour window
    if (userTimes.length >= 20) {
      return { limited: true, reason: 'Quá giới hạn thử mã (tối đa 20 lần/giờ). Vui lòng thử lại sau.' };
    }
    userTimes.push(now);
    rateLimits.user.set(userStr, userTimes);
  }

  return { limited: false };
};

/**
 * Checks if voucher exists
 */
const checkExistence = async (code) => {
  if (!code) {
    return { valid: false, reason: 'Mã voucher không được để trống' };
  }
  const voucher = await Voucher.findOne({ code: code.toUpperCase() });
  if (!voucher) {
    return { valid: false, reason: 'Mã giảm giá không tồn tại' };
  }
  return { valid: true, voucher };
};

/**
 * Checks status of voucher
 */
const checkStatus = (voucher) => {
  if (voucher.status !== 'active') {
    let reason = 'Mã giảm giá hiện không hoạt động';
    if (voucher.status === 'expired') reason = 'Mã giảm giá đã hết hạn';
    if (voucher.status === 'paused') reason = 'Mã giảm giá đang tạm dừng';
    if (voucher.status === 'disabled') reason = 'Mã giảm giá đã bị hủy';
    if (voucher.status === 'scheduled') reason = 'Mã giảm giá chưa bắt đầu thời gian áp dụng';
    return { valid: false, reason };
  }
  return { valid: true };
};

/**
 * Checks date range of voucher
 */
const checkDateRange = async (voucher) => {
  const now = new Date();
  if (voucher.startDate && now < voucher.startDate) {
    return { valid: false, reason: 'Chương trình ưu đãi chưa bắt đầu' };
  }
  if (voucher.endDate && now > voucher.endDate) {
    // Auto update status to expired
    voucher.status = 'expired';
    await voucher.save();
    return { valid: false, reason: 'Mã giảm giá đã hết hạn sử dụng' };
  }
  return { valid: true };
};

/**
 * Checks if voucher is applicable to restaurant, city and categories
 */
const checkRestaurantScope = async (voucher, restaurantId) => {
  // 1. Direct restaurantId match
  if (voucher.restaurantId && restaurantId) {
    if (voucher.restaurantId.toString() !== restaurantId.toString()) {
      return { valid: false, reason: 'Mã giảm giá không áp dụng cho nhà hàng này' };
    }
  }

  // 2. applicableRestaurants check (Admin platform voucher scoping)
  if (voucher.applicableRestaurants && voucher.applicableRestaurants.length > 0) {
    if (!restaurantId) {
      return { valid: false, reason: 'Mã này yêu cầu thông tin nhà hàng cụ thể' };
    }
    const isApplicable = voucher.applicableRestaurants.some(
      id => id.toString() === restaurantId.toString()
    );
    if (!isApplicable) {
      return { valid: false, reason: 'Mã giảm giá không áp dụng cho nhà hàng này' };
    }
  }

  // 3. applicableCities and applicableCategories check
  const needsCityCheck = voucher.applicableCities && voucher.applicableCities.length > 0;
  const needsCategoryCheck = voucher.applicableCategories && voucher.applicableCategories.length > 0;

  if (needsCityCheck || needsCategoryCheck) {
    if (!restaurantId) {
      return { valid: false, reason: 'Thiếu thông tin nhà hàng để kiểm tra điều kiện khu vực/danh mục' };
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return { valid: false, reason: 'Nhà hàng không tồn tại' };
    }

    if (needsCityCheck) {
      const city = restaurant.address?.city;
      const isCityApplicable = voucher.applicableCities.some(
        c => c.toLowerCase().trim() === city?.toLowerCase().trim()
      );
      if (!isCityApplicable) {
        return { valid: false, reason: `Mã giảm giá chỉ áp dụng tại khu vực: ${voucher.applicableCities.join(', ')}` };
      }
    }

    if (needsCategoryCheck) {
      const cuisineTypes = restaurant.cuisineTypes || [];
      const hasMatchingCategory = cuisineTypes.some(type =>
        voucher.applicableCategories.some(cat => cat.toLowerCase().trim() === type.toLowerCase().trim())
      );
      if (!hasMatchingCategory) {
        return { valid: false, reason: `Mã giảm giá chỉ áp dụng cho danh mục ẩm thực: ${voucher.applicableCategories.join(', ')}` };
      }
    }
  }

  return { valid: true };
};

/**
 * Checks minimum spend condition
 */
const checkMinSpend = (voucher, orderAmount) => {
  if (voucher.minOrderAmount && orderAmount < voucher.minOrderAmount) {
    return {
      valid: false,
      reason: `Đơn hàng chưa đạt giá trị tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')} ₫`,
    };
  }
  return { valid: true };
};

/**
 * Checks total global usage limit
 */
const checkGlobalLimit = async (voucher) => {
  // Check global limit from the DB count of completions
  if (voucher.globalUsageLimit !== null) {
    // Atomic safety: check currentUsage in database vs limit
    if (voucher.currentUsage >= voucher.globalUsageLimit) {
      return { valid: false, reason: 'Mã giảm giá đã hết lượt sử dụng trên hệ thống' };
    }
    
    // Backup check in case currentUsage counter is out of sync
    const totalRedemptions = await VoucherRedemption.countDocuments({
      voucherId: voucher._id,
      status: 'completed',
    });
    if (totalRedemptions >= voucher.globalUsageLimit) {
      // Correct the currentUsage value
      voucher.currentUsage = totalRedemptions;
      await voucher.save();
      return { valid: false, reason: 'Mã giảm giá đã hết lượt sử dụng trên hệ thống' };
    }
  }
  return { valid: true };
};

/**
 * Checks per customer usage limit
 */
const checkPerUserLimit = async (voucher, customerId) => {
  if (voucher.perCustomerLimit !== null && customerId) {
    // 1. Check in CustomerVoucher wallet to see if marked used
    const walletItem = await CustomerVoucher.findOne({
      customerId,
      voucherId: voucher._id,
    });
    if (walletItem && walletItem.isUsed) {
      return { valid: false, reason: 'Bạn đã sử dụng hết số lần cho phép của mã này' };
    }

    // 2. Count actual redemptions for complete safety
    const customerUsage = await VoucherRedemption.countDocuments({
      voucherId: voucher._id,
      customerId: customerId,
      status: 'completed',
    });
    if (customerUsage >= voucher.perCustomerLimit) {
      if (walletItem && !walletItem.isUsed) {
        walletItem.isUsed = true;
        walletItem.timesUsed = customerUsage;
        await walletItem.save();
      }
      return { valid: false, reason: 'Bạn đã sử dụng hết số lần cho phép của mã này' };
    }
  }
  return { valid: true };
};

/**
 * Checks if user segment matches
 */
const checkCustomerSegment = async (voucher, customerId) => {
  if (!voucher.customerSegments || voucher.customerSegments.includes('all') || voucher.customerSegments.length === 0) {
    return { valid: true };
  }

  if (!customerId) {
    return { valid: false, reason: 'Vui lòng đăng nhập để áp dụng mã giảm giá giới hạn phân khúc này' };
  }

  // Fetch count of completed bookings
  const completedCount = await Booking.countDocuments({
    customerId,
    status: 'completed',
  });

  const userSegments = [];
  if (completedCount === 0) {
    userSegments.push('new_user');
  } else if (completedCount >= 5) {
    userSegments.push('vip');
  }

  if (completedCount > 0) {
    const lastBooking = await Booking.findOne({
      customerId,
      status: 'completed',
    }).sort({ bookingDate: -1 });

    if (lastBooking) {
      const daysSinceLastBooking = (Date.now() - new Date(lastBooking.bookingDate).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastBooking > 30) {
        userSegments.push('inactive');
      }
    }
  }

  const isMatch = voucher.customerSegments.some(seg => userSegments.includes(seg));
  if (!isMatch) {
    return {
      valid: false,
      reason: `Mã giảm giá này chỉ áp dụng cho nhóm khách hàng: ${voucher.customerSegments.join(', ')}`,
    };
  }

  return { valid: true };
};

module.exports = {
  checkRateLimit,
  checkExistence,
  checkStatus,
  checkDateRange,
  checkRestaurantScope,
  checkMinSpend,
  checkGlobalLimit,
  checkPerUserLimit,
  checkCustomerSegment,
};
