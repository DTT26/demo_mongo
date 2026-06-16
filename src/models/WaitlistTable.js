'use strict';

const mongoose = require('mongoose');

const waitlistTableSchema = new mongoose.Schema(
  {
    waitlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Waitlist',
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RestaurantTable',
      required: true,
    },
    tableNumberSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    capacitySnapshot: {
      type: Number,
      required: true,
      min: 1,
    },
    zoneSnapshot: {
      type: String,
      default: null,
      trim: true,
    },
    tableFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    selectionType: {
      type: String,
      enum: ['preferred', 'assigned'],
      default: 'preferred',
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

waitlistTableSchema.index({ waitlistId: 1, selectionType: 1 });
waitlistTableSchema.index({ restaurantId: 1, tableId: 1 });

module.exports = mongoose.model('WaitlistTable', waitlistTableSchema);
