'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const { upload, uploadImage } = require('../controllers/upload.controller');

const router = express.Router();

// Chỉ người dùng đã đăng nhập mới được upload ảnh
router.post('/image', protect, upload.single('image'), uploadImage);

module.exports = router;
