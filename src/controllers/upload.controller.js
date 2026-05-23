'use strict';

const multer = require('multer');
const cloudinary = require('../config/cloudinary.config');

// ─────────────────────────────────────────────
// Multer — memory storage (upload buffer to Cloudinary)
// ─────────────────────────────────────────────
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận file ảnh (JPEG, PNG, GIF, WebP)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ─────────────────────────────────────────────
// POST /api/v1/upload/image — Upload ảnh lên Cloudinary
// ─────────────────────────────────────────────
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn file ảnh để upload',
      });
    }

    // Upload buffer to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const folder = req.body.folder || 'bookeat/restaurants';
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { width: 800, height: 800, crop: 'limit', quality: 'auto' },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    return res.status(200).json({
      success: true,
      message: 'Upload ảnh thành công',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      },
    });
  } catch (error) {
    console.error('❌ Error uploading image:', error);

    if (error.message?.includes('Chỉ chấp nhận file ảnh')) {
      return res.status(400).json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi upload ảnh. Vui lòng thử lại.',
    });
  }
};

module.exports = { upload, uploadImage };
