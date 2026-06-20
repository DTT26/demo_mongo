const mongoose = require('mongoose');

const monetizationPlanSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: ['free', 'plus', 'pro'],
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    priceMonthly: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    priceYearly: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    features: [{
      type: String,
      trim: true,
    }],
    limits: {
      maxMenuItems: { type: Number, default: 0 },
      maxTables: { type: Number, default: 0 },
      maxRestaurants: { type: Number, default: 1 },
    },
    benefits: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MonetizationPlan', monetizationPlanSchema);
