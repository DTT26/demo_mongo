'use strict';

const Restaurant = require('../models/Restaurant');
const emailService = require('../services/email.service'); // Assuming email service is available

// ────────────────────────────────────────────────────────
// A. Danh sách nhà hàng (Paginated, Search, Filter)
// ────────────────────────────────────────────────────────
const getRestaurants = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    
    const search = (req.query.search || '').trim();
    const approvalStatus = (req.query.approvalStatus || '').trim();

    const filter = {};
    if (approvalStatus) {
      filter.approvalStatus = approvalStatus;
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .populate('ownerId', 'fullName email username phoneNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Restaurant.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        restaurants: restaurants.map(r => r.toAdminJSON()),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetRestaurants] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// B. Xem chi tiết nhà hàng
// ────────────────────────────────────────────────────────
const getRestaurantById = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate('ownerId', 'fullName email username phoneNumber avatarUrl')
      .populate('approvedBy', 'fullName email');

    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    return res.json({ success: true, data: restaurant.toAdminJSON() });
  } catch (error) {
    console.error('❌ [Admin/GetRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải thông tin nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// C. Duyệt nhà hàng (Approve)
// ────────────────────────────────────────────────────────
const approveRestaurant = async (req, res) => {
  try {
    const { commissionRate } = req.body; // Optional: update commission rate when approving

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    if (restaurant.approvalStatus === 'approved') {
      return res.status(400).json({ success: false, message: 'Nhà hàng đã được duyệt trước đó' });
    }

    restaurant.approvalStatus = 'approved';
    restaurant.approvedBy = req.user._id;
    restaurant.approvedAt = new Date();
    restaurant.rejectionReason = null;
    restaurant.suspensionReason = null;
    restaurant.active = true;
    
    if (commissionRate !== undefined && commissionRate >= 0 && commissionRate <= 100) {
      restaurant.commissionRate = commissionRate;
    }

    await restaurant.save();

    // TODO: Send notification email to owner
    if (emailService.sendRestaurantApprovedEmail && restaurant.ownerId) {
      emailService.sendRestaurantApprovedEmail(restaurant.ownerId, restaurant)
        .catch(err => console.error('⚠️ Lỗi gửi email duyệt NH:', err.message));
    }

    return res.json({
      success: true,
      message: 'Đã duyệt nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/ApproveRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể duyệt nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// D. Từ chối nhà hàng (Reject)
// ────────────────────────────────────────────────────────
const rejectRestaurant = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp lý do từ chối' });
    }

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    restaurant.approvalStatus = 'rejected';
    restaurant.rejectionReason = reason.trim();
    restaurant.active = false;
    await restaurant.save();

    // TODO: Send notification email to owner
    if (emailService.sendRestaurantRejectedEmail && restaurant.ownerId) {
      emailService.sendRestaurantRejectedEmail(restaurant.ownerId, restaurant, reason)
        .catch(err => console.error('⚠️ Lỗi gửi email từ chối NH:', err.message));
    }

    return res.json({
      success: true,
      message: 'Đã từ chối nhà hàng',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/RejectRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể từ chối nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// E. Tạm ngưng nhà hàng (Suspend)
// ────────────────────────────────────────────────────────
const suspendRestaurant = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp lý do tạm ngưng' });
    }

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    restaurant.approvalStatus = 'suspended';
    restaurant.suspensionReason = reason.trim();
    restaurant.active = false; // Nhà hàng sẽ không hiển thị trên FE public
    await restaurant.save();

    // TODO: Send notification email to owner
    if (emailService.sendRestaurantSuspendedEmail && restaurant.ownerId) {
      emailService.sendRestaurantSuspendedEmail(restaurant.ownerId, restaurant, reason)
        .catch(err => console.error('⚠️ Lỗi gửi email tạm ngưng NH:', err.message));
    }

    return res.json({
      success: true,
      message: 'Đã tạm ngưng nhà hàng',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/SuspendRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tạm ngưng nhà hàng' });
  }
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  approveRestaurant,
  rejectRestaurant,
  suspendRestaurant,
};
