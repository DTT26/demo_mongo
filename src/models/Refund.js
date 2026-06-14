const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedByRole: {
      type: String,
      enum: ['customer', 'restaurant_owner'],
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'Số tiền hoàn trả là bắt buộc'],
      min: [0, 'Số tiền hoàn trả không thể âm'],
    },
    reason: {
      type: String,
      required: [true, 'Lý do hoàn tiền là bắt buộc'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'processing', 'refunded', 'failed', 'cancelled'],
      default: 'requested',
      index: true,
    },
    gatewayRefundId: {
      type: String,
      default: null,
    },
    adminNote: {
      type: String,
      default: null,
    },
    bankInfo: {
      bankName: { type: String, default: null },
      accountNumber: { type: String, default: null },
      accountHolder: { type: String, default: null },
    },
    refundedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

refundSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Refund', refundSchema);
