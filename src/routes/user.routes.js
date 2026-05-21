'use strict';

const express         = require('express');
const authController  = require('../controllers/auth.controller');
const { protect }     = require('../middleware/auth.middleware');

const router = express.Router();

// ─── Tất cả routes đều yêu cầu đăng nhập ───
router.use(protect);

// GET  /api/v1/users/me  — Lấy profile của user đang đăng nhập
router.get('/me', authController.getProfile);

// PUT  /api/v1/users/me  — Cập nhật thông tin cá nhân (fullName, phoneNumber, address)
router.put('/me', authController.updateProfile);

// PUT  /api/v1/users/me/password  — Đổi mật khẩu
router.put('/me/password', authController.changePassword);

// TODO: POST /api/v1/users/me/avatar — Upload avatar (cần cài multer/cloudinary)
// router.post('/me/avatar', uploadMiddleware, authController.uploadAvatar);

module.exports = router;
