'use strict';

const { createAiPendingActionService } = require('../services/ai/ai-pending-action.service');
const {
  AiBookingConfirmationError,
  createAiBookingConfirmationService,
} = require('../services/ai/ai-booking-confirmation.service');
const { sendError } = require('./ai.controller');

const validateCancelBody = (body) => {
  if (body === undefined || body === null) return { reason: null };
  if (Array.isArray(body) || typeof body !== 'object') {
    return { error: 'Dữ liệu hủy phải là JSON object.' };
  }

  const allowedKeys = new Set(['reason']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return { error: 'Yêu cầu hủy chứa field không được hỗ trợ.' };
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return { error: 'reason phải là chuỗi.' };
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
  if (reason && reason.length > 300) {
    return { error: 'reason không được vượt quá 300 ký tự.' };
  }
  return { reason: reason || null };
};

const validateConfirmBody = (body) => {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return {
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Bạn cần gửi confirmation=true để xác nhận booking.',
      },
    };
  }
  const allowedKeys = new Set(['confirmation']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return {
      error: {
        code: 'INVALID_REQUEST',
        message: 'Yêu cầu xác nhận chỉ được chứa trường confirmation.',
      },
    };
  }
  if (body.confirmation !== true) {
    return {
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Bạn cần xác nhận rõ trước khi tạo booking.',
      },
    };
  }
  return { confirmation: true };
};

const createAiPendingActionController = ({
  pendingActionService = createAiPendingActionService(),
  confirmationService = createAiBookingConfirmationService(),
} = {}) => ({
  async getPendingAction(req, res) {
    try {
      const data = await pendingActionService.getOwnedActionSafe(req.params.id, req.user._id);
      if (!data) {
        return sendError(
          res,
          404,
          'PENDING_ACTION_NOT_FOUND',
          'Không tìm thấy bản xem trước đặt bàn.',
          req.aiRequestId,
        );
      }
      return res.json({ success: true, data, requestId: req.aiRequestId });
    } catch (error) {
      console.error(`[AI Pending Action] requestId=${req.aiRequestId} code=READ_FAILED`);
      return sendError(
        res,
        500,
        'AI_INTERNAL_ERROR',
        'Không thể tải bản xem trước đặt bàn.',
        req.aiRequestId,
      );
    }
  },

  async cancelPendingAction(req, res) {
    const validation = validateCancelBody(req.body);
    if (validation.error) {
      return sendError(
        res,
        400,
        'INVALID_REQUEST',
        validation.error,
        req.aiRequestId,
      );
    }

    try {
      const data = await pendingActionService.cancelOwnedActionSafe({
        id: req.params.id,
        userId: req.user._id,
        reason: validation.reason,
        requestId: req.aiRequestId,
      });
      if (!data) {
        return sendError(
          res,
          404,
          'PENDING_ACTION_NOT_FOUND',
          'Không tìm thấy bản xem trước đặt bàn.',
          req.aiRequestId,
        );
      }
      return res.json({
        success: true,
        message: data.status === 'cancelled'
          ? 'Đã hủy bản xem trước đặt bàn.'
          : 'Bản xem trước không còn ở trạng thái chờ.',
        data,
        requestId: req.aiRequestId,
      });
    } catch (error) {
      console.error(`[AI Pending Action] requestId=${req.aiRequestId} code=CANCEL_FAILED`);
      return sendError(
        res,
        500,
        'AI_INTERNAL_ERROR',
        'Không thể hủy bản xem trước đặt bàn.',
        req.aiRequestId,
      );
    }
  },

  async confirmPendingAction(req, res) {
    const validation = validateConfirmBody(req.body);
    if (validation.error) {
      return sendError(
        res,
        400,
        validation.error.code,
        validation.error.message,
        req.aiRequestId,
      );
    }

    try {
      const data = await confirmationService.confirmPendingBooking({
        pendingActionId: req.params.id,
        user: req.user,
        confirmation: validation.confirmation,
        idempotencyKey: req.get('Idempotency-Key'),
        requestId: req.aiRequestId,
        io: req.app.get('io'),
      });
      return res.status(data.idempotent ? 200 : 201).json({
        success: true,
        data,
        requestId: req.aiRequestId,
      });
    } catch (error) {
      if (error instanceof AiBookingConfirmationError || error?.code) {
        return sendError(
          res,
          error.statusCode || 500,
          error.code || 'BOOKING_CREATE_FAILED',
          error.message || 'Không thể xác nhận booking lúc này.',
          req.aiRequestId,
          error.details || undefined,
        );
      }
      console.error(
        `[AI Pending Action] requestId=${req.aiRequestId} code=BOOKING_CREATE_FAILED message=${error.message}`,
      );
      return sendError(
        res,
        500,
        'BOOKING_CREATE_FAILED',
        'Không thể xác nhận booking lúc này.',
        req.aiRequestId,
      );
    }
  },
});

module.exports = {
  ...createAiPendingActionController(),
  createAiPendingActionController,
  validateCancelBody,
  validateConfirmBody,
};
