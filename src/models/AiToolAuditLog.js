'use strict';

const mongoose = require('mongoose');

const aiToolAuditLogSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ['guest', 'customer', 'restaurant_owner', 'admin'],
      default: 'guest',
      index: true,
    },
    toolName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    argsRedacted: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'forbidden'],
      required: true,
      index: true,
    },
    latencyMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    errorCode: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

aiToolAuditLogSchema.index({ toolName: 1, createdAt: -1 });
aiToolAuditLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AiToolAuditLog', aiToolAuditLogSchema);
