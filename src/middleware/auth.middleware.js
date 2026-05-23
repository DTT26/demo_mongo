const User = require('../models/User');
const { verifyJwtToken } = require('../utils/jwt');

// ─────────────────────────────────────────────
// Middleware: Xác thực JWT Token
// ─────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    // Lấy token từ header Authorization: Bearer <token>
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.',
      });
    }

    // Verify token
    const decoded = verifyJwtToken(token);

    // Tìm user trong DB
    const user = await User.findById(decoded.id || decoded.sub).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ hoặc user không tồn tại.',
      });
    }

    // Kiểm tra tài khoản còn active
    if (!user.active) {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản đã bị vô hiệu hóa.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Token không hợp lệ.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    return res.status(500).json({ success: false, message: 'Lỗi xác thực.' });
  }
};

// ─────────────────────────────────────────────
// Middleware: Phân quyền theo role
// ─────────────────────────────────────────────
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
      });
    }
    next();
  };
};

module.exports = { protect, restrictTo };
