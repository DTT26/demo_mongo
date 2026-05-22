'use strict';

const Booking = require('../models/Booking');

// ────────────────────────────────────────────────────────
// A. Danh sách Bookings (Paginated, Search, Filter)
// ────────────────────────────────────────────────────────
const getBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;

    const filter = {};
    
    if (status) {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.bookingDate = {};
      if (fromDate) filter.bookingDate.$gte = new Date(fromDate);
      if (toDate) filter.bookingDate.$lte = new Date(toDate);
    }

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email')
        .populate('restaurantId', 'name address')
        .sort({ bookingDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        bookings: bookings.map(b => b.toAdminJSON()),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetBookings] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách đặt bàn' });
  }
};

// ────────────────────────────────────────────────────────
// B. Xem chi tiết Booking
// ────────────────────────────────────────────────────────
const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'fullName email phoneNumber avatarUrl')
      .populate('restaurantId', 'name address phoneNumber logo')
      .populate('confirmedBy', 'fullName email');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đặt bàn' });
    }

    return res.json({ success: true, data: booking.toAdminJSON() });
  } catch (error) {
    console.error('❌ [Admin/GetBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải chi tiết đặt bàn' });
  }
};

// ────────────────────────────────────────────────────────
// C. Cập nhật trạng thái Booking
// ────────────────────────────────────────────────────────
const updateBookingStatus = async (req, res) => {
  try {
    const { status, note, internalNotes } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đặt bàn' });
    }

    if (booking.status === status) {
      return res.status(400).json({ success: false, message: 'Trạng thái này đã được cập nhật' });
    }

    // Logic update status
    booking.status = status;
    booking.statusHistory.push({
      status,
      changedBy: req.user._id,
      note: note || `Admin updated status to ${status}`,
    });

    if (status === 'cancelled') {
      booking.cancelledBy = 'admin';
      booking.cancelledAt = new Date();
      booking.cancellationReason = note || 'Admin cancelled';
    } else if (status === 'confirmed') {
      booking.confirmedBy = req.user._id;
      booking.confirmedAt = new Date();
    } else if (status === 'completed') {
      booking.completedAt = new Date();
    }

    if (internalNotes !== undefined) {
      booking.internalNotes = internalNotes;
    }

    await booking.save();

    // Re-fetch with populated data to return full details
    const updatedBooking = await Booking.findById(booking._id)
      .populate('customerId', 'fullName email phoneNumber avatarUrl')
      .populate('restaurantId', 'name address phoneNumber logo')
      .populate('confirmedBy', 'fullName email');

    return res.json({
      success: true,
      message: 'Cập nhật trạng thái đặt bàn thành công',
      data: updatedBooking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/UpdateBookingStatus] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái đặt bàn' });
  }
};

module.exports = {
  getBookings,
  getBookingById,
  updateBookingStatus,
};
