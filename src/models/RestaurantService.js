'use strict';

const mongoose = require('mongoose');

const restaurantServiceSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Tên dịch vụ là bắt buộc'],
      trim: true,
      maxlength: [200, 'Tên dịch vụ không được vượt quá 200 ký tự'],
    },
    category: {
      type: String,
      trim: true,
      maxlength: [100, 'Danh mục không được vượt quá 100 ký tự'],
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Mô tả không được vượt quá 1000 ký tự'],
      default: null,
    },
    price: {
      type: Number,
      required: [true, 'Giá dịch vụ là bắt buộc'],
      min: [0, 'Giá dịch vụ không thể âm'],
    },
    status: {
      type: String,
      enum: ['available', 'unavailable', 'hidden'],
      default: 'available',
      index: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

restaurantServiceSchema.index({ restaurantId: 1, status: 1 });
restaurantServiceSchema.index({ restaurantId: 1, isAvailable: 1 });
restaurantServiceSchema.index({ restaurantId: 1, displayOrder: 1 });

restaurantServiceSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    restaurantId: this.restaurantId,
    name: this.name,
    category: this.category,
    description: this.description,
    price: this.price,
    status: this.status,
    isAvailable: this.isAvailable,
    displayOrder: this.displayOrder,
  };
};

restaurantServiceSchema.methods.toAdminJSON = function () {
  return {
    ...this.toPublicJSON(),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('RestaurantService', restaurantServiceSchema);
