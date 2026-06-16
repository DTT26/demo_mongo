const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema(
  {
    gateway: {
      type: String,
      default: 'payos',
    },
    eventType: {
      type: String,
      default: null,
    },
    orderCode: {
      type: Number,
      required: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    signatureValid: {
      type: Boolean,
      required: true,
    },
    processed: {
      type: Boolean,
      default: false,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

webhookLogSchema.index({ orderCode: 1, processed: 1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
