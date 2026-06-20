'use strict';

const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const RestaurantTable = require('../models/RestaurantTable');
const bookingService = require('../services/booking.service');
const emailService = require('../services/email.service');
const notificationService = require('../services/notification.service');
const bookingCommissionService = require('../services/booking-commission.service');

const emitBookingEvent = (io, room, event, payload) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

const sendBookingEmail = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[OwnerBookingEmail/${label}] ${error.message}`);
  });
};

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[OwnerBookingNotification/${label}] ${error.message}`);
  });
};

/**
 * A. Lấy Danh Sách Đặt Bàn Của Nhà Hàng (GET /api/v1/owner/bookings)
 */
const getRestaurantBookings = async (req, res) => {
  try {
    const { restaurantId, status, fromDate, toDate, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    if (!restaurantId) {
      return res.status(400).json({ success: false, message: 'Thiếu restaurantId' });
    }

    // 1. Kiểm tra quyền sở hữu nhà hàng
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền quản lý nhà hàng này hoặc nhà hàng không tồn tại',
      });
    }

    // 2. Xây dựng filter
    const filter = { restaurantId };

    if (status) {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.bookingDate = {};
      if (fromDate) filter.bookingDate.$gte = bookingService.normalizeDate(fromDate);
      if (toDate) filter.bookingDate.$lte = bookingService.normalizeDate(toDate);
    }

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    // 3. Thực thi query
    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email phoneNumber avatarUrl')
        .sort({ bookingDate: -1, bookingTime: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        bookings: bookings.map(b => b.toAdminJSON()), // Owner xem được cả ghi chú nội bộ và lịch sử trạng thái
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetRestaurantBookings] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải danh sách đặt bàn' });
  }
};

/**
 * B. Xem Chi Tiết Đặt Bàn (GET /api/v1/owner/bookings/:id)
 */
const getBookingDetail = async (req, res) => {
  try {
    // req.booking đã được xác thực qua verifyOwnerBookingAccess middleware
    const booking = await Booking.findById(req.booking._id)
      .populate('customerId', 'fullName email phoneNumber avatarUrl')
      .populate('confirmedBy', 'fullName email');

    return res.json({
      success: true,
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [GetBookingDetail] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải chi tiết đặt bàn' });
  }
};

/**
 * C. Xác Nhận Đặt Bàn (PUT /api/v1/owner/bookings/:id/confirm)
 */
const confirmBooking = async (req, res) => {
  try {
    const booking = req.booking; // Từ middleware verifyOwnerBookingAccess
    
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể xác nhận đặt bàn đang ở trạng thái chờ duyệt',
      });
    }

    booking.status = 'confirmed';
    booking.confirmedAt = new Date();
    booking.confirmedBy = req.user._id;

    booking.statusHistory.push({
      status: 'confirmed',
      changedBy: req.user._id,
      note: 'Nhà hàng xác nhận đặt bàn',
    });

    await booking.save();

    // Gửi thông báo real-time qua Socket.io
    const io = req.app.get('io');
    emitBookingEvent(io, `user:${booking.customerId.toString()}`, 'booking:confirmed', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      status: booking.status,
      message: 'Don dat ban cua ban da duoc xac nhan',
    });
    sendNotification(
      notificationService.notifyBookingStatusChanged(io, {
        booking,
        restaurant: req.restaurant,
        status: 'confirmed',
        actorRole: 'restaurant_owner',
      }),
      'confirmed'
    );
    sendBookingEmail(
      emailService.sendBookingConfirmedEmail(booking.customerId, req.restaurant, booking),
      'confirmed'
    );
    const legacyRawRoomNotificationsEnabled = process.env.BOOKING_LEGACY_RAW_SOCKET_ROOMS === 'true';
    if (legacyRawRoomNotificationsEnabled && io) {
      io.to(booking.customerId.toString()).emit('booking:confirmed', {
        bookingId: booking._id,
        restaurantId: booking.restaurantId,
        message: 'Đơn đặt bàn của bạn đã được xác nhận',
      });
    }

    return res.json({
      success: true,
      message: 'Xác nhận đặt bàn thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [ConfirmBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác nhận đặt bàn' });
  }
};

/**
 * D. Hủy Đặt Bàn (PUT /api/v1/owner/bookings/:id/cancel)
 */
const cancelBooking = async (req, res) => {
  try {
    const booking = req.booking;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp lý do hủy đặt bàn',
      });
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể hủy đặt bàn đang chờ duyệt hoặc đã xác nhận',
      });
    }

    booking.status = 'cancelled';
    booking.cancelledBy = 'restaurant';
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason;

    booking.statusHistory.push({
      status: 'cancelled',
      changedBy: req.user._id,
      note: `Nhà hàng hủy đặt bàn. Lý do: ${reason}`,
    });

    await booking.save();

    // Reverse voucher redemption if any
    if (booking.voucherId) {
      try {
        const voucherService = require('../services/voucher.service');
        await voucherService.reverseRedemption(booking._id, reason || 'Nhà hàng hủy đặt bàn', req.user);
      } catch (reverseErr) {
        console.error('❌ Lỗi hoàn nguyên voucher khi nhà hàng hủy đặt bàn:', reverseErr.message);
      }
    }

    // Gửi thông báo real-time qua Socket.io
    const io = req.app.get('io');
    bookingCommissionService.markCancelledForBooking(
      booking._id,
      `Nhà hàng huỷ booking trước khi phí trở thành khoản phải thu: ${reason}`
    ).catch((error) => {
      console.warn(`[BookingCommission/cancelled] ${error.message}`);
    });
    emitBookingEvent(io, `user:${booking.customerId.toString()}`, 'booking:cancelled', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      status: booking.status,
      cancelledBy: 'restaurant',
      reason,
    });
    sendNotification(
      notificationService.notifyBookingStatusChanged(io, {
        booking,
        restaurant: req.restaurant,
        status: 'cancelled',
        reason,
        actorRole: 'restaurant_owner',
      }),
      'cancelled'
    );
    sendBookingEmail(
      emailService.sendBookingCancelledEmail(booking.customerId, req.restaurant, booking, reason),
      'cancelled'
    );
    const legacyRawRoomNotificationsEnabled = process.env.BOOKING_LEGACY_RAW_SOCKET_ROOMS === 'true';
    if (legacyRawRoomNotificationsEnabled && io) {
      io.to(booking.customerId.toString()).emit('booking:cancelled', {
        bookingId: booking._id,
        restaurantId: booking.restaurantId,
        cancelledBy: 'restaurant',
        reason,
      });
    }

    return res.json({
      success: true,
      message: 'Hủy đặt bàn thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [CancelBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hủy đặt bàn' });
  }
};

/**
 * E. Hoàn Thành Đặt Bàn (PUT /api/v1/owner/bookings/:id/complete)
 */
const completeBooking = async (req, res) => {
  try {
    const booking = req.booking;
    const { actualGuestCount } = req.body;

    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể hoàn thành đặt bàn đã được xác nhận',
      });
    }

    booking.status = 'completed';
    booking.completedAt = new Date();
    if (actualGuestCount !== undefined) {
      booking.actualGuestCount = Number(actualGuestCount);
    }

    booking.statusHistory.push({
      status: 'completed',
      changedBy: req.user._id,
      note: 'Khách đã dùng bữa xong và hoàn tất đặt bàn',
    });

    await booking.save();

    // Cập nhật statistics cho nhà hàng
    const restaurant = req.restaurant;
    await bookingCommissionService.createLedgerForBooking(booking._id, {
      booking,
      restaurant,
      source: booking.sourceAiPendingActionId ? 'ai_booking_completed' : 'owner_booking_completed',
    });
    restaurant.stats.completedBookings += 1;
    await restaurant.save();

    const io = req.app.get('io');
    emitBookingEvent(io, `user:${booking.customerId.toString()}`, 'booking:completed', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      status: booking.status,
      message: 'Dat ban da hoan thanh',
    });
    sendNotification(
      notificationService.notifyBookingStatusChanged(io, {
        booking,
        restaurant,
        status: 'completed',
        actorRole: 'restaurant_owner',
      }),
      'completed'
    );

    return res.json({
      success: true,
      message: 'Hoàn thành đặt bàn thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [CompleteBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hoàn thành đặt bàn' });
  }
};

/**
 * F. Đánh Dấu Khách Không Đến (PUT /api/v1/owner/bookings/:id/no-show)
 */
const markNoShow = async (req, res) => {
  try {
    const booking = req.booking;

    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể đánh dấu no-show đối với đặt bàn đã được xác nhận',
      });
    }

    booking.status = 'no_show';
    
    booking.statusHistory.push({
      status: 'no_show',
      changedBy: req.user._id,
      note: 'Khách hàng không đến theo giờ đặt',
    });

    await booking.save();

    const io = req.app.get('io');
    emitBookingEvent(io, `user:${booking.customerId.toString()}`, 'booking:no_show', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      status: booking.status,
      message: 'Dat ban duoc danh dau no-show',
    });
    sendNotification(
      notificationService.notifyBookingStatusChanged(io, {
        booking,
        restaurant: req.restaurant,
        status: 'no_show',
        actorRole: 'restaurant_owner',
      }),
      'no_show'
    );

    return res.json({
      success: true,
      message: 'Đã đánh dấu khách hàng không đến (no-show)',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [MarkNoShow] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đánh dấu đặt bàn' });
  }
};

/**
 * G. Đổi Bàn Ăn (PUT /api/v1/owner/bookings/:id/change-table)
 */
const changeTable = async (req, res) => {
  try {
    const booking = req.booking;
    const { newTableNumbers } = req.body;

    if (!newTableNumbers || !Array.isArray(newTableNumbers) || newTableNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp danh sách số bàn mới hợp lệ',
      });
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể đổi bàn cho đặt bàn ở trạng thái chờ duyệt hoặc đã xác nhận',
      });
    }

    // 1. Kiểm tra sức chứa bàn mới
    const capacityValidation = await bookingService.validateTableCapacity(
      newTableNumbers,
      booking.numberOfGuests,
      booking.restaurantId
    );
    if (!capacityValidation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Lựa chọn bàn mới không hợp lệ',
        errors: capacityValidation.errors,
      });
    }

    // 2. Kiểm tra conflict bàn mới (loại trừ chính booking này)
    for (const tableNumber of newTableNumbers) {
      const { hasConflict } = await bookingService.checkTimeConflict(
        booking.restaurantId,
        tableNumber,
        booking.bookingDate,
        booking.bookingTime,
        booking._id
      );
      if (hasConflict) {
        return res.status(400).json({
          success: false,
          message: `Bàn ${tableNumber} đã bị trùng giờ trong khung giờ này`,
        });
      }
    }

    const oldTables = booking.tableNumbers.join(', ');
    booking.tableNumbers = newTableNumbers;

    booking.statusHistory.push({
      status: booking.status,
      changedBy: req.user._id,
      note: `Thay đổi bàn ăn từ [${oldTables}] sang [${newTableNumbers.join(', ')}]`,
    });

    await booking.save();

    return res.json({
      success: true,
      message: 'Thay đổi bàn ăn cho đặt bàn thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [ChangeTable] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đổi bàn ăn' });
  }
};

/**
 * H. Danh Sách Bàn Trống (GET /api/v1/owner/bookings/:id/available-tables)
 */
const getAvailableTables = async (req, res) => {
  try {
    const booking = req.booking;

    const availableTables = await bookingService.getAvailableTables(
      booking.restaurantId,
      booking.bookingDate,
      booking.bookingTime
    );

    return res.json({
      success: true,
      data: availableTables,
    });
  } catch (error) {
    console.error('❌ [Owner/GetAvailableTables] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải danh sách bàn trống' });
  }
};

/**
 * I. Thêm Ghi Chú Nội Bộ (POST /api/v1/owner/bookings/:id/internal-notes)
 */
const addInternalNote = async (req, res) => {
  try {
    const booking = req.booking;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Nội dung ghi chú là bắt buộc' });
    }

    const timeStr = new Date().toLocaleString('vi-VN');
    const author = req.user.fullName;
    const noteBlock = `[${timeStr} - ${author}]: ${content}`;

    booking.internalNotes = booking.internalNotes
      ? `${booking.internalNotes}\n${noteBlock}`
      : noteBlock;

    await booking.save();

    return res.json({
      success: true,
      message: 'Thêm ghi chú nội bộ thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [AddInternalNote] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi thêm ghi chú nội bộ' });
  }
};

/**
 * J. Xóa Ghi Chú Nội Bộ (DELETE /api/v1/owner/bookings/:id/internal-notes)
 * Do internalNotes là string, API này sẽ xóa toàn bộ ghi chú nội bộ
 */
const deleteInternalNote = async (req, res) => {
  try {
    const booking = req.booking;
    booking.internalNotes = null;
    await booking.save();

    return res.json({
      success: true,
      message: 'Đã xóa toàn bộ ghi chú nội bộ',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [DeleteInternalNote] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xóa ghi chú nội bộ' });
  }
};

/**
 * K. Thống Kê Đặt Bàn Cho Nhà Hàng (GET /api/v1/owner/bookings/stats)
 */
const getBookingStats = async (req, res) => {
  try {
    const { restaurantId, period } = req.query; // period: today, week, month, year, all

    if (!restaurantId) {
      return res.status(400).json({ success: false, message: 'Thiếu restaurantId' });
    }

    // Kiểm tra quyền sở hữu nhà hàng
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem thống kê nhà hàng này',
      });
    }

    const filter = { restaurantId };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (period === 'today') {
      filter.bookingDate = today;
    } else if (period === 'week') {
      const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      filter.bookingDate = { $gte: oneWeekAgo, $lte: today };
    } else if (period === 'month') {
      const oneMonthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      filter.bookingDate = { $gte: oneMonthAgo, $lte: today };
    }

    const bookings = await Booking.find(filter);

    const stats = {
      totalBookings: bookings.length,
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      no_show: 0,
    };

    bookings.forEach(b => {
      if (stats[b.status] !== undefined) {
        stats[b.status]++;
      }
    });

    // Tính tỷ lệ
    stats.completionRate = stats.totalBookings > 0 ? ((stats.completed / stats.totalBookings) * 100).toFixed(1) : 0;
    stats.cancellationRate = stats.totalBookings > 0 ? ((stats.cancelled / stats.totalBookings) * 100).toFixed(1) : 0;

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('❌ [GetBookingStats] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy thống kê' });
  }
};

module.exports = {
  getRestaurantBookings,
  getBookingDetail,
  confirmBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
  changeTable,
  getAvailableTables,
  addInternalNote,
  deleteInternalNote,
  getBookingStats,
};
