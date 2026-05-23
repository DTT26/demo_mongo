'use strict';

const cloudinary = require('../config/cloudinary');

const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_CHAT_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const createUploadError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateChatImageFile = (file) => {
  if (!file) {
    throw createUploadError(400, 'Vui long chon anh de upload');
  }

  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    throw createUploadError(400, 'Chi chap nhan file anh');
  }

  if (!ALLOWED_CHAT_IMAGE_MIMES.has(file.mimetype)) {
    throw createUploadError(400, 'Dinh dang anh khong duoc ho tro');
  }

  if (file.size > MAX_CHAT_IMAGE_SIZE) {
    throw createUploadError(413, 'Anh upload toi da 5MB');
  }

  return true;
};

const uploadBufferToCloudinary = (file, options = {}) => {
  validateChatImageFile(file);

  const folder = options.folder || process.env.CLOUDINARY_FOLDER || 'bookeat/chat';

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
      },
      (error, result) => {
        if (error) {
          reject(createUploadError(502, error.message || 'Upload Cloudinary that bai'));
          return;
        }

        resolve({
          url: result.secure_url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          width: result.width,
          height: result.height,
          format: result.format,
          resourceType: result.resource_type,
          type: 'image',
        });
      }
    );

    uploadStream.end(file.buffer);
  });
};

module.exports = {
  ALLOWED_CHAT_IMAGE_MIMES,
  MAX_CHAT_IMAGE_SIZE,
  createUploadError,
  uploadBufferToCloudinary,
  validateChatImageFile,
};
