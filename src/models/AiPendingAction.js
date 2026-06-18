'use strict';

const mongoose = require('mongoose');

const aiPendingActionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120,
    },
    role: {
      type: String,
      enum: ['customer'],
      default: 'customer',
      required: true,
    },
    actionType: {
      type: String,
      enum: ['prepare_booking', 'confirm_booking'],
      default: 'prepare_booking',
      required: true,
      index: true,
    },
    schemaVersion: {
      type: String,
      default: 'booking_preview@1',
      required: true,
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    preview: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'cancelled', 'expired', 'processing', 'confirmed', 'failed'],
      default: 'pending',
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 300,
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
      maxlength: 160,
    },
    requestFingerprint: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
    },
    processingAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    resultType: {
      type: String,
      enum: ['booking', null],
      default: null,
    },
    resultId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

aiPendingActionSchema.index({ userId: 1, status: 1, expiresAt: 1 });
aiPendingActionSchema.index({ _id: 1, userId: 1, status: 1 });
aiPendingActionSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

module.exports = mongoose.model('AiPendingAction', aiPendingActionSchema);
