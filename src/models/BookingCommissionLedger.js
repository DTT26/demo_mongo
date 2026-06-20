const mongoose = require('mongoose');

const bookingCommissionLedgerSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    planCodeAtBooking: {
      type: String,
      enum: ['free', 'plus', 'pro'],
      required: true,
      index: true,
    },
    commissionType: {
      type: String,
      enum: ['fixed', 'percent', 'waived'],
      required: true,
    },
    baseAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ['VND'],
      default: 'VND',
    },
    status: {
      type: String,
      enum: ['pending', 'billable', 'waived', 'cancelled', 'paid'],
      required: true,
      index: true,
    },
    triggerStatus: {
      type: String,
      enum: ['completed'],
      required: true,
      default: 'completed',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    calculatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    billableAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

bookingCommissionLedgerSchema.index({ bookingId: 1 }, { unique: true });
bookingCommissionLedgerSchema.index({ ownerId: 1, createdAt: -1 });
bookingCommissionLedgerSchema.index({ restaurantId: 1, createdAt: -1 });
bookingCommissionLedgerSchema.index({ status: 1, createdAt: -1 });
bookingCommissionLedgerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BookingCommissionLedger', bookingCommissionLedgerSchema);
