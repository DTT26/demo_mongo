const mongoose = require('mongoose');

const voucherRedemptionSchema = new mongoose.Schema(
  {
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      required: [true, 'Voucher ID là bắt buộc'],
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID là bắt buộc'],
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking ID là bắt buộc'],
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null, // Có thể null nếu booking không có đặt cọc hoặc chưa thanh toán cọc thành công
    },
    discountApplied: {
      type: Number,
      required: [true, 'Số tiền được giảm là bắt buộc'],
      min: 0,
    },
    amountBefore: {
      type: Number,
      required: [true, 'Số tiền trước giảm giá là bắt buộc'],
      min: 0,
    },
    amountAfter: {
      type: Number,
      required: [true, 'Số tiền sau giảm giá là bắt buộc'],
      min: 0,
    },
    channel: {
      type: String,
      enum: ['booking', 'direct'],
      default: 'booking',
    },
    status: {
      type: String,
      enum: ['completed', 'reversed'],
      default: 'completed',
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedReason: {
      type: String,
      default: null,
    },
    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

voucherRedemptionSchema.index({ bookingId: 1 });
voucherRedemptionSchema.index({ status: 1, usedAt: 1 });

module.exports = mongoose.model('VoucherRedemption', voucherRedemptionSchema);
