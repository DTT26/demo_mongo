'use strict';

const bcrypt = require('bcryptjs');
const User   = require('../models/User');

// ────────────────────────────────────────────────────────
// A. Dashboard — Thống kê tổng quan
// ────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      totalCustomers,
      totalOwners,
      totalAdmins,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'restaurant_owner' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ active: true }),
      User.countDocuments({ active: false }),
      User.countDocuments({ emailVerified: true }),
      User.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username email fullName role active createdAt'),
    ]);

    // Thống kê đăng ký theo 7 ngày gần nhất
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const registrationTrend = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalCustomers,
          totalOwners,
          totalAdmins,
          activeUsers,
          inactiveUsers,
          verifiedUsers,
        },
        registrationTrend: registrationTrend.map((item) => ({
          date: item._id,
          count: item.count,
        })),
        recentUsers: recentUsers.map((u) => u.toPublicJSON()),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/Dashboard] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải dữ liệu dashboard' });
  }
};

// ────────────────────────────────────────────────────────
// B. Users — Danh sách users (paginated, searchable)
// ────────────────────────────────────────────────────────

const getUsers = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip   = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const role   = (req.query.role || '').trim();
    const status = (req.query.status || '').trim(); // 'active' | 'inactive' | ''

    // Build filter
    const filter = {};
    if (role && ['customer', 'restaurant_owner', 'admin'].includes(role)) {
      filter.role = role;
    }
    if (status === 'active')   filter.active = true;
    if (status === 'inactive') filter.active = false;
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email:    { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-password -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires'),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        users: users.map((u) => u.toPublicJSON()),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetUsers] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách người dùng' });
  }
};

// ────────────────────────────────────────────────────────
// C. User Detail — Xem chi tiết user
// ────────────────────────────────────────────────────────

const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    return res.json({ success: true, data: user.toPublicJSON() });
  } catch (error) {
    console.error('❌ [Admin/GetUser] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải thông tin người dùng' });
  }
};

// ────────────────────────────────────────────────────────
// D. Create User — Admin tạo user mới (bất kỳ role)
// ────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^(0[35789])[0-9]{8}$/;

const createUser = async (req, res) => {
  try {
    const { username, email, password, fullName, phoneNumber, address, role } = req.body;

    // Validate
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Username phải có ít nhất 3 ký tự' });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 8 ký tự' });
    }
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ success: false, message: 'Họ và tên không được để trống' });
    }
    if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) {
      return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ' });
    }
    if (role && !['customer', 'restaurant_owner', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role không hợp lệ' });
    }

    // Check duplicate
    const existing = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }],
    });
    if (existing) {
      const msg = existing.email === email.trim().toLowerCase() ? 'Email đã tồn tại' : 'Username đã tồn tại';
      return res.status(409).json({ success: false, message: msg });
    }

    const user = await User.create({
      username:      username.trim(),
      email:         email.trim().toLowerCase(),
      password,
      fullName:      fullName.trim(),
      phoneNumber:   phoneNumber || null,
      address:       address || null,
      role:          role || 'customer',
      emailVerified: true,   // Admin tạo → tự động verified
      active:        true,
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo người dùng thành công',
      data: user.toPublicJSON(),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Username hoặc email đã tồn tại' });
    }
    console.error('❌ [Admin/CreateUser] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tạo người dùng' });
  }
};

// ────────────────────────────────────────────────────────
// E. Update User — Admin cập nhật thông tin user
// ────────────────────────────────────────────────────────

const updateUser = async (req, res) => {
  try {
    const { fullName, phoneNumber, address, role, active } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Validate
    if (phoneNumber && !PHONE_REGEX.test(phoneNumber)) {
      return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ' });
    }
    if (role && !['customer', 'restaurant_owner', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role không hợp lệ' });
    }

    // Không cho admin tự vô hiệu hóa chính mình
    if (req.params.id === req.user._id.toString() && active === false) {
      return res.status(400).json({ success: false, message: 'Không thể vô hiệu hóa tài khoản của chính bạn' });
    }

    // Build updates
    const updates = {};
    if (fullName !== undefined)    updates.fullName = fullName.trim();
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber || null;
    if (address !== undefined)     updates.address = address || null;
    if (role !== undefined)        updates.role = role;
    if (active !== undefined)      updates.active = active;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires');

    return res.json({
      success: true,
      message: 'Cập nhật người dùng thành công',
      data: updatedUser.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/UpdateUser] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật người dùng' });
  }
};

// ────────────────────────────────────────────────────────
// F. Toggle User Status — Kích hoạt / Vô hiệu hóa
// ────────────────────────────────────────────────────────

const toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Không cho tự vô hiệu hóa chính mình
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Không thể thay đổi trạng thái tài khoản của chính bạn' });
    }

    const newStatus = req.body.active !== undefined ? req.body.active : !user.active;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { active: newStatus } },
      { new: true }
    );

    return res.json({
      success: true,
      message: newStatus ? 'Đã kích hoạt tài khoản' : 'Đã vô hiệu hóa tài khoản',
      data: updatedUser.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/ToggleStatus] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể thay đổi trạng thái' });
  }
};

// ────────────────────────────────────────────────────────
// G. Delete User — Soft delete (set active = false)
// ────────────────────────────────────────────────────────

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Không cho xóa chính mình
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản của chính bạn' });
    }

    // Không cho xóa admin khác (cần super admin)
    if (user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Không thể xóa tài khoản admin' });
    }

    // Soft delete — vô hiệu hóa tài khoản
    await User.findByIdAndUpdate(req.params.id, { $set: { active: false } });

    return res.json({
      success: true,
      message: 'Đã xóa người dùng (vô hiệu hóa tài khoản)',
    });
  } catch (error) {
    console.error('❌ [Admin/DeleteUser] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể xóa người dùng' });
  }
};

// ────────────────────────────────────────────────────────
// H. Reset Password — Admin đặt lại mật khẩu cho user
// ────────────────────────────────────────────────────────

const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 8 ký tự' });
    }

    const user = await User.findById(req.params.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Cập nhật password — pre('save') hook sẽ hash tự động
    user.password = newPassword;
    await user.save();

    return res.json({
      success: true,
      message: 'Đặt lại mật khẩu thành công',
    });
  } catch (error) {
    console.error('❌ [Admin/ResetPassword] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể đặt lại mật khẩu' });
  }
};

// ────────────────────────────────────────────────────────
// I. Setup — Tạo admin user ban đầu (public endpoint)
// ────────────────────────────────────────────────────────

const setupAdmin = async (req, res) => {
  try {
    // Kiểm tra đã có admin chưa
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(409).json({ success: false, message: 'Admin đã tồn tại trong hệ thống' });
    }

    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ thông tin' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 8 ký tự' });
    }

    const admin = await User.create({
      username:      username.trim(),
      email:         email.trim().toLowerCase(),
      password,
      fullName:      fullName.trim(),
      role:          'admin',
      emailVerified: true,
      active:        true,
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo tài khoản admin thành công',
      data: admin.toPublicJSON(),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Username hoặc email đã tồn tại' });
    }
    console.error('❌ [Admin/Setup] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tạo tài khoản admin' });
  }
};

// ────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────

module.exports = {
  getDashboard,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
  resetUserPassword,
  setupAdmin,
};
