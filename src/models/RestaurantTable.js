'use strict';

const mongoose = require('mongoose');

const restaurantTableSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    tableNumber: {
      type: String,
      required: [true, 'Số/tên bàn là bắt buộc'],
      trim: true,
      maxlength: [50, 'Số bàn không được vượt quá 50 ký tự'],
    },
    capacity: {
      type: Number,
      required: [true, 'Sức chứa là bắt buộc'],
      min: [1, 'Sức chứa phải ít nhất 1 người'],
    },
    zone: {
      type: String,
      trim: true,
      maxlength: [100, 'Khu vực không được vượt quá 100 ký tự'],
      default: null,
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'inactive', 'maintenance'],
      default: 'available',
    },
    depositAmount: {
      type: Number,
      default: 0,
      min: [0, 'Tiền đặt cọc không thể âm'],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Ghi chú không được vượt quá 500 ký tự'],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
restaurantTableSchema.index({ restaurantId: 1, status: 1 });
restaurantTableSchema.index({ restaurantId: 1, zone: 1 });
restaurantTableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantTable', restaurantTableSchema);
