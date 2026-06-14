'use strict';

const mongoose = require('mongoose');

const WAITLIST_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'];

const waitlistSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    preferredDate: {
      type: Date,
      required: [true, 'Ngày mong muốn là bắt buộc'],
      index: true,
    },
    preferredTime: {
      type: String,
      required: [true, 'Giờ mong muốn là bắt buộc'],
      trim: true,
    },
    preferredDateTime: {
      type: Date,
      required: true,
      index: true,
    },
    numberOfGuests: {
      type: Number,
      required: [true, 'Số khách là bắt buộc'],
      min: [1, 'Số khách phải ít nhất là 1'],
      max: [100, 'Số khách không được vượt quá 100'],
    },
    customerName: {
      type: String,
      required: [true, 'Tên khách hàng là bắt buộc'],
      trim: true,
      maxlength: [200, 'Tên khách hàng không được vượt quá 200 ký tự'],
    },
    customerPhone: {
      type: String,
      required: [true, 'Số điện thoại là bắt buộc'],
      trim: true,
    },
    customerEmail: {
      type: String,
      required: [true, 'Email là bắt buộc'],
      lowercase: true,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Ghi chú không được vượt quá 500 ký tự'],
      default: null,
    },
    internalNotes: [{
      content: {
        type: String,
        trim: true,
        maxlength: [1000, 'Ghi chú nội bộ không được vượt quá 1000 ký tự'],
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    }],
    status: {
      type: String,
      enum: WAITLIST_STATUSES,
      default: 'pending',
      index: true,
    },
    priorityNumber: {
      type: Number,
      default: 0,
      index: true,
    },
    queuePositionSnapshot: {
      type: Number,
      default: null,
    },
    estimatedWaitMinutes: {
      type: Number,
      min: 0,
      default: null,
    },
    maxWaitMinutes: {
      type: Number,
      min: [5, 'Thời gian chờ tối thiểu là 5 phút'],
      max: [240, 'Thời gian chờ tối đa là 240 phút'],
      default: 45,
    },
    maxWaitUntil: {
      type: Date,
      required: true,
      index: true,
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },
    cancelledBy: {
      type: String,
      enum: ['customer', 'restaurant', 'admin', null],
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    convertedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    expiredAt: {
      type: Date,
      default: null,
    },
    expireReason: {
      type: String,
      trim: true,
      default: null,
    },
    statusHistory: [{
      status: {
        type: String,
        enum: WAITLIST_STATUSES,
        required: true,
      },
      changedAt: {
        type: Date,
        default: Date.now,
      },
      changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      note: {
        type: String,
        default: null,
      },
    }],
  },
  {
    timestamps: true,
  }
);

waitlistSchema.index({ restaurantId: 1, status: 1, priorityNumber: -1, createdAt: 1 });
waitlistSchema.index({ customerId: 1, status: 1, preferredDateTime: -1 });
waitlistSchema.index({ restaurantId: 1, preferredDate: 1, preferredTime: 1 });
waitlistSchema.index({ status: 1, maxWaitUntil: 1 });

waitlistSchema.methods.canCancel = function () {
  return this.status === 'pending';
};

waitlistSchema.methods.canConfirm = function () {
  return this.status === 'pending' && this.maxWaitUntil > new Date();
};

waitlistSchema.methods.isExpired = function () {
  return this.status === 'pending' && this.maxWaitUntil <= new Date();
};

waitlistSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    customerId: this.customerId,
    restaurantId: this.restaurantId,
    preferredDate: this.preferredDate,
    preferredTime: this.preferredTime,
    preferredDateTime: this.preferredDateTime,
    numberOfGuests: this.numberOfGuests,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    customerEmail: this.customerEmail,
    note: this.note,
    status: this.status,
    queuePositionSnapshot: this.queuePositionSnapshot,
    estimatedWaitMinutes: this.estimatedWaitMinutes,
    maxWaitMinutes: this.maxWaitMinutes,
    maxWaitUntil: this.maxWaitUntil,
    cancellationReason: this.cancellationReason,
    cancelledBy: this.cancelledBy,
    cancelledAt: this.cancelledAt,
    confirmedAt: this.confirmedAt,
    convertedBookingId: this.convertedBookingId,
    expiredAt: this.expiredAt,
    expireReason: this.expireReason,
    statusHistory: this.statusHistory,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

waitlistSchema.methods.toOwnerJSON = function () {
  return {
    ...this.toPublicJSON(),
    priorityNumber: this.priorityNumber,
    confirmedBy: this.confirmedBy,
    internalNotes: this.internalNotes,
  };
};

waitlistSchema.methods.toAdminJSON = function () {
  return this.toOwnerJSON();
};

module.exports = mongoose.model('Waitlist', waitlistSchema);
