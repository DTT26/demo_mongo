'use strict';

const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuCategory',
      default: null,
    },
    name: {
      type: String,
      required: [true, 'Tên món ăn là bắt buộc'],
      trim: true,
      maxlength: [200, 'Tên món ăn không được vượt quá 200 ký tự'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Mô tả không được vượt quá 1000 ký tự'],
      default: null,
    },
    price: {
      type: Number,
      required: [true, 'Giá món ăn là bắt buộc'],
      min: [0, 'Giá không thể âm'],
    },
    image: {
      type: String,
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['available', 'unavailable', 'hidden'],
      default: 'available',
    },
    preparationTime: {
      type: Number,
      default: null,
      min: [0, 'Thời gian chuẩn bị không thể âm'],
    },
    tags: [{
      type: String,
      trim: true,
      maxlength: [50, 'Tag không được vượt quá 50 ký tự'],
    }],
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
menuItemSchema.index({ restaurantId: 1, categoryId: 1 });
menuItemSchema.index({ restaurantId: 1, status: 1 });
menuItemSchema.index({ restaurantId: 1, isAvailable: 1 });
menuItemSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('MenuItem', menuItemSchema);
