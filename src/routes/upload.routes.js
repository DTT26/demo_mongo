'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { uploadImage, uploadImageMiddleware } = require('../controllers/upload.controller');

const router = express.Router();

// Chỉ người dùng đã đăng nhập mới được upload ảnh
router.post('/image', protect, uploadImageMiddleware, uploadImage);

module.exports = router;
