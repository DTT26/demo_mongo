const mongoose = require('mongoose');

const BENEFIT_DEFAULTS = {
  maxMenuItems: 0,
  maxTables: 0,
  allowAiOwner: false,
  allowFeaturedPurchase: false,
  allowVoucherCampaignPurchase: false,
  bookingFeeWaived: false,
  allowRealtime: false,
  allowAnalytics: false,
  prioritySupport: false,
  maxRestaurants: 1,
};

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
    planCode: {
      type: String,
      enum: ['free', 'plus', 'pro'],
      default: 'free',
      index: true,
    },
    status: {
      type: String,
      enum: ['free', 'active', 'pending_payment', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    expiredAt: {
      type: Date,
      default: null,
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
      unique: true,
      sparse: true,
    },
    benefitsSnapshot: {
      maxMenuItems: { type: Number, default: BENEFIT_DEFAULTS.maxMenuItems },
      maxTables: { type: Number, default: BENEFIT_DEFAULTS.maxTables },
      allowAiOwner: { type: Boolean, default: BENEFIT_DEFAULTS.allowAiOwner },
      allowFeaturedPurchase: { type: Boolean, default: BENEFIT_DEFAULTS.allowFeaturedPurchase },
      allowVoucherBasic: { type: Boolean, default: true },
      allowVoucherAdvanced: { type: Boolean, default: false },
      allowVoucherCampaignPurchase: { type: Boolean, default: BENEFIT_DEFAULTS.allowVoucherCampaignPurchase },
      bookingFeeWaived: { type: Boolean, default: BENEFIT_DEFAULTS.bookingFeeWaived },
      bookingMonthlyLimit: { type: Number, default: 50 },
      allowRealtime: { type: Boolean, default: BENEFIT_DEFAULTS.allowRealtime },
      allowAnalytics: { type: Boolean, default: BENEFIT_DEFAULTS.allowAnalytics },
      prioritySupport: { type: Boolean, default: BENEFIT_DEFAULTS.prioritySupport },
      maxRestaurants: { type: Number, default: 1 },
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.pre('validate', function normalizePlanFields() {
  const normalizedPlan = String(this.planCode || this.plan || 'free').toLowerCase();
  this.planCode = normalizedPlan;
  this.plan = normalizedPlan;
  if (!this.currentPeriodStart && this.startedAt) this.currentPeriodStart = this.startedAt;
  if (!this.currentPeriodEnd && this.expiredAt) this.currentPeriodEnd = this.expiredAt;
  if (!this.expiredAt && this.currentPeriodEnd) this.expiredAt = this.currentPeriodEnd;
});

subscriptionSchema.index({ ownerId: 1, status: 1 });
subscriptionSchema.index({ restaurantId: 1, status: 1, currentPeriodEnd: -1 });
subscriptionSchema.index({ expiredAt: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
