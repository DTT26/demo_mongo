const mongoose = require('mongoose');

const voucherCampaignPurchaseSchema = new mongoose.Schema(
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
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      unique: true,
      index: true,
    },
    orderCode: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    packageCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    placement: {
      type: String,
      enum: ['homepage', 'ai_suggestion', 'search_boost'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    startAt: {
      type: Date,
      default: null,
      index: true,
    },
    endAt: {
      type: Date,
      default: null,
      index: true,
    },
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },
    priorityWeight: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'VND',
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
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

voucherCampaignPurchaseSchema.index({
  voucherId: 1,
  placement: 1,
  status: 1,
  startAt: 1,
  endAt: -1,
});
voucherCampaignPurchaseSchema.index({
  restaurantId: 1,
  placement: 1,
  status: 1,
  startAt: 1,
  endAt: -1,
});
voucherCampaignPurchaseSchema.index({
  ownerId: 1,
  restaurantId: 1,
  createdAt: -1,
});

module.exports = mongoose.model('VoucherCampaignPurchase', voucherCampaignPurchaseSchema);
