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
      index: true,
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
    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('VoucherRedemption', voucherRedemptionSchema);
