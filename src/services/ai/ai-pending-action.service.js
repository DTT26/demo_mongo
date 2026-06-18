'use strict';

const mongoose = require('mongoose');
const AiPendingAction = require('../../models/AiPendingAction');
const AiToolAuditLog = require('../../models/AiToolAuditLog');

const DEFAULT_TTL_MINUTES = 10;

const parseTtlMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) return DEFAULT_TTL_MINUTES;
  return parsed;
};

const getPendingActionTtlMinutes = () => (
  parseTtlMinutes(process.env.AI_PENDING_ACTION_TTL_MINUTES)
);

const toIdString = (value) => value?.toString?.() || String(value || '');

const getAllowedActions = (status) => ({
  confirm: status === 'pending',
  cancel: status === 'pending',
  edit: ['pending', 'cancelled', 'expired'].includes(status),
});

const toSafePendingAction = (action) => {
  if (!action) return null;

  return {
    id: toIdString(action._id || action.id),
    actionType: action.actionType,
    schemaVersion: action.schemaVersion,
    preview: action.preview,
    status: action.status,
    expiresAt: action.expiresAt ? new Date(action.expiresAt).toISOString() : null,
    createdAt: action.createdAt ? new Date(action.createdAt).toISOString() : null,
    updatedAt: action.updatedAt ? new Date(action.updatedAt).toISOString() : null,
    confirmedAt: action.confirmedAt ? new Date(action.confirmedAt).toISOString() : null,
    result: action.status === 'confirmed' && action.resultId
      ? {
        type: action.resultType || 'booking',
        id: toIdString(action.resultId),
      }
      : null,
    allowedActions: getAllowedActions(action.status),
  };
};

const auditSafely = async (auditLogger, payload) => {
  try {
    await auditLogger.create(payload);
  } catch (error) {
    console.warn(`[AI Pending Action Audit] code=${error.message}`);
  }
};

const markExpiredIfNeeded = async (action, now = new Date()) => {
  if (!action || action.status !== 'pending' || new Date(action.expiresAt) > now) return action;
  action.status = 'expired';
  action.errorCode = 'PENDING_ACTION_EXPIRED';
  await action.save();
  return action;
};

const createAiPendingActionService = ({
  pendingActionModel = AiPendingAction,
  auditLogger = AiToolAuditLog,
  now = () => new Date(),
  ttlMinutes = getPendingActionTtlMinutes(),
} = {}) => ({
  async createBookingPreview({
    userId,
    conversationId = null,
    payload,
    preview,
    requestId = 'unknown',
  }) {
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + ttlMinutes * 60 * 1000);
    const action = await pendingActionModel.create({
      userId,
      conversationId,
      role: 'customer',
      actionType: 'prepare_booking',
      schemaVersion: 'booking_preview@1',
      payload,
      preview,
      status: 'pending',
      expiresAt,
    });

    await auditSafely(auditLogger, {
      requestId,
      userId,
      role: 'customer',
      toolName: 'pending_action.create',
      argsRedacted: {
        pendingActionId: toIdString(action._id),
        actionType: 'prepare_booking',
      },
      status: 'success',
      latencyMs: 0,
      errorCode: null,
      createdAt,
    });

    return action;
  },

  async getOwnedAction(id, userId) {
    if (!mongoose.Types.ObjectId.isValid(String(id || ''))) return null;
    const action = await pendingActionModel.findOne({ _id: id, userId });
    if (!action) return null;
    return markExpiredIfNeeded(action, now());
  },

  async getOwnedActionSafe(id, userId) {
    return toSafePendingAction(await this.getOwnedAction(id, userId));
  },

  async cancelOwnedAction({
    id,
    userId,
    reason = null,
    requestId = 'unknown',
  }) {
    const action = await this.getOwnedAction(id, userId);
    if (!action) return null;

    if (action.status === 'pending') {
      action.status = 'cancelled';
      action.cancelledAt = now();
      action.cancellationReason = reason || 'Khách hàng hủy bản xem trước đặt bàn';
      await action.save();
    }

    await auditSafely(auditLogger, {
      requestId,
      userId,
      role: 'customer',
      toolName: 'pending_action.cancel',
      argsRedacted: {
        pendingActionId: toIdString(action._id),
        status: action.status,
      },
      status: 'success',
      latencyMs: 0,
      errorCode: null,
      createdAt: now(),
    });

    return action;
  },

  async cancelOwnedActionSafe(input) {
    return toSafePendingAction(await this.cancelOwnedAction(input));
  },
});

module.exports = {
  DEFAULT_TTL_MINUTES,
  createAiPendingActionService,
  getAllowedActions,
  getPendingActionTtlMinutes,
  markExpiredIfNeeded,
  toSafePendingAction,
};
