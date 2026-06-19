const mongoose = require('mongoose');

const customerVoucherSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID là bắt buộc'],
      index: true,
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      required: [true, 'Voucher ID là bắt buộc'],
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    timesUsed: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['saved', 'used', 'expired'],
      default: 'saved',
    },
    source: {
      type: String,
      enum: ['manual_save', 'auto_assign', 'milestone', 'referral'],
      default: 'manual_save',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Đảm bảo mỗi khách hàng chỉ lưu một voucher một lần duy nhất trong danh sách ví của họ
customerVoucherSchema.index({ customerId: 1, voucherId: 1 }, { unique: true });
customerVoucherSchema.index({ customerId: 1, status: 1 });
customerVoucherSchema.index({ customerId: 1, expiresAt: 1 });

module.exports = mongoose.model('CustomerVoucher', customerVoucherSchema);
