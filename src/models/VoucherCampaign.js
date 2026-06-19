'use strict';

const mongoose = require('mongoose');

const voucherCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tên chiến dịch là bắt buộc'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['flash_sale', 'seasonal', 'event', 'custom'],
      required: [true, 'Loại chiến dịch là bắt buộc'],
    },
    startDate: {
      type: Date,
      required: [true, 'Ngày bắt đầu là bắt buộc'],
    },
    endDate: {
      type: Date,
      required: [true, 'Ngày kết thúc là bắt buộc'],
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'ended', 'cancelled'],
      default: 'draft',
      index: true,
    },
    targetSegments: {
      type: [String],
      enum: ['all', 'new_user', 'vip', 'inactive'],
      default: ['all'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người tạo chiến dịch là bắt buộc'],
    },
    voucherCount: {
      type: Number,
      default: 0,
    },
    autoDistribute: {
      type: Boolean,
      default: false,
    },
    distributionRule: {
      trigger: {
        type: String, // 'user_registration', 'first_booking', 'milestone', etc.
        default: null,
      },
      condition: {
        type: mongoose.Schema.Types.Mixed, // Extra parameters
        default: {},
      },
    },
  },
  {
    timestamps: true,
  }
);

voucherCampaignSchema.index({ startDate: 1, endDate: 1, status: 1 });

module.exports = mongoose.model('VoucherCampaign', voucherCampaignSchema);
