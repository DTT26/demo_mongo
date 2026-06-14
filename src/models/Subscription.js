const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
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
    plan: {
      type: String,
      enum: ['free', 'plus', 'pro'],
      default: 'free',
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    expiredAt: {
      type: Date,
      required: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    benefitsSnapshot: {
      maxMenuItems: { type: Number, default: 0 },
      maxTables: { type: Number, default: 0 },
      allowRealtime: { type: Boolean, default: false },
      allowAnalytics: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ ownerId: 1, status: 1 });
subscriptionSchema.index({ expiredAt: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
