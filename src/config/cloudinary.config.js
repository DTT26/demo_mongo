'use strict';

const { v2: cloudinary } = require('cloudinary');

// ─────────────────────────────────────────────
// Cloudinary Configuration
// ─────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     process.env.CLOUDINARY_SECURE === 'true',
});

module.exports = cloudinary;
