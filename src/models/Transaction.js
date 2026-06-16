const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['payment', 'refund', 'adjustment'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
    gateway: {
      type: String,
      default: 'payos',
    },
    gatewayTransactionId: {
      type: String,
      default: null,
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
