'use strict';

const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { getAiConfig } = require('../../config/ai.config');
const AiPendingAction = require('../../models/AiPendingAction');
const AiToolAuditLog = require('../../models/AiToolAuditLog');
const Booking = require('../../models/Booking');
const {
  BookingApplicationError,
  createBookingApplicationService,
} = require('../application/booking-application.service');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;
const FAILED_ACTION_CODES = new Set([
  'TABLE_NO_LONGER_AVAILABLE',
  'VOUCHER_NO_LONGER_VALID',
  'BOOKING_POLICY_BLOCKED',
  'RESTAURANT_NOT_FOUND',
]);

class AiBookingConfirmationError extends Error {
  constructor(code, message, {
    statusCode = 409,
    details = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'AiBookingConfirmationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.cause = cause;
  }
}

const toIdString = (value) => value?.toString?.() || String(value || '');

const normalizeBookingDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const toSafeBooking = (booking) => ({
  id: toIdString(booking?._id || booking?.id),
  status: booking?.status || 'pending',
  restaurantId: toIdString(booking?.restaurantId),
  bookingDate: normalizeBookingDate(booking?.bookingDate),
  bookingTime: booking?.bookingTime || null,
  numberOfGuests: Number(booking?.numberOfGuests) || 0,
  tableNumbers: Array.isArray(booking?.tableNumbers) ? booking.tableNumbers : [],
  depositAmount: Math.max(0, Number(booking?.depositAmount) || 0),
  discountAmount: Math.max(0, Number(booking?.discountAmount) || 0),
  amountDue: Math.max(
    0,
    (Number(booking?.depositAmount) || 0) - (Number(booking?.discountAmount) || 0),
  ),
});

const toSafeConfirmedAction = (action) => ({
  id: toIdString(action?._id || action?.id),
  status: action?.status || 'confirmed',
  confirmedAt: action?.confirmedAt ? new Date(action.confirmedAt).toISOString() : null,
});

const createRequestFingerprint = ({ pendingActionId, confirmation }) => (
  createHash('sha256')
    .update(JSON.stringify({
      pendingActionId: toIdString(pendingActionId),
      confirmation: confirmation === true,
    }))
    .digest('hex')
);

const validateIdempotencyKey = (value) => (
  typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value.trim())
);

const auditSafely = async (auditLogger, payload) => {
  try {
    await auditLogger.create(payload);
  } catch (error) {
    console.warn(`[AI Confirm Audit] code=${error.message}`);
  }
};

const mapApplicationError = (error) => {
  if (!(error instanceof BookingApplicationError)) return null;

  if (error.code === 'TABLE_NO_LONGER_AVAILABLE') {
    return new AiBookingConfirmationError(
      'TABLE_NO_LONGER_AVAILABLE',
      error.message,
      { statusCode: 409, details: error.errors ? { errors: error.errors } : null, cause: error },
    );
  }
  if (error.code === 'VOUCHER_NO_LONGER_VALID') {
    return new AiBookingConfirmationError(
      'VOUCHER_NO_LONGER_VALID',
      error.message,
      { statusCode: 409, cause: error },
    );
  }
  if (error.code === 'PERMISSION_DENIED') {
    return new AiBookingConfirmationError(
      'PERMISSION_DENIED',
      'Bạn không có quyền xác nhận bản xem trước này.',
      { statusCode: 403, cause: error },
    );
  }

  return new AiBookingConfirmationError(
    'BOOKING_POLICY_BLOCKED',
    error.message || 'Booking không còn đáp ứng chính sách hiện tại.',
    {
      statusCode: 422,
      details: error.errors ? { errors: error.errors } : null,
      cause: error,
    },
  );
};

const createAiBookingConfirmationService = ({
  pendingActionModel = AiPendingAction,
  bookingModel = Booking,
  bookingApplication = createBookingApplicationService(),
  auditLogger = AiToolAuditLog,
  configProvider = getAiConfig,
  now = () => new Date(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  processingWaitMs = 600,
} = {}) => {
  const getAction = async (pendingActionId) => {
    if (!mongoose.Types.ObjectId.isValid(String(pendingActionId || ''))) return null;
    return pendingActionModel.findOne({
      _id: pendingActionId,
      actionType: 'prepare_booking',
    });
  };

  const getResultBooking = async (action) => {
    if (!action?.resultId) return null;
    return bookingModel.findById(action.resultId);
  };

  const makeSuccess = async (action, { idempotent = false } = {}) => {
    const booking = await getResultBooking(action);
    if (!booking) {
      throw new AiBookingConfirmationError(
        'BOOKING_CREATE_FAILED',
        'Không thể tải booking đã tạo. Vui lòng kiểm tra My Bookings.',
        { statusCode: 500 },
      );
    }
    return {
      pendingAction: toSafeConfirmedAction(action),
      booking: toSafeBooking(booking),
      idempotent,
    };
  };

  const markExpired = async (action, currentTime) => {
    if (action.status === 'pending') {
      await pendingActionModel.findOneAndUpdate(
        { _id: action._id, status: 'pending' },
        {
          $set: {
            status: 'expired',
            errorCode: 'PENDING_ACTION_EXPIRED',
          },
        },
        { new: true },
      );
    }
    throw new AiBookingConfirmationError(
      'PENDING_ACTION_EXPIRED',
      'Bản xem trước đã hết hạn. Vui lòng tạo bản mới.',
      {
        statusCode: 409,
        details: {
          expiredAt: action.expiresAt ? new Date(action.expiresAt).toISOString() : null,
          checkedAt: currentTime.toISOString(),
        },
      },
    );
  };

  const resolveExistingState = async ({
    action,
    userId,
    idempotencyKey,
    currentTime,
    allowWait = true,
  }) => {
    if (!action) {
      throw new AiBookingConfirmationError(
        'PENDING_ACTION_NOT_FOUND',
        'Không tìm thấy bản xem trước đặt bàn.',
        { statusCode: 404 },
      );
    }
    if (toIdString(action.userId) !== toIdString(userId)) {
      throw new AiBookingConfirmationError(
        'PERMISSION_DENIED',
        'Bạn không có quyền xác nhận bản xem trước này.',
        { statusCode: 403 },
      );
    }
    if (action.status === 'confirmed') {
      return makeSuccess(action, { idempotent: true });
    }
    if (action.status === 'cancelled') {
      throw new AiBookingConfirmationError(
        'PENDING_ACTION_CANCELLED',
        'Bản xem trước đã bị hủy. Vui lòng tạo bản mới.',
        { statusCode: 409 },
      );
    }
    if (
      action.status === 'expired'
      || (action.status === 'pending' && new Date(action.expiresAt) <= currentTime)
    ) {
      return markExpired(action, currentTime);
    }
    if (action.status === 'failed') {
      const code = FAILED_ACTION_CODES.has(action.errorCode)
        ? action.errorCode
        : 'BOOKING_CREATE_FAILED';
      const messages = {
        TABLE_NO_LONGER_AVAILABLE: 'Bàn không còn trống. Vui lòng tạo bản xem trước mới.',
        VOUCHER_NO_LONGER_VALID: 'Voucher không còn hợp lệ. Vui lòng tạo bản xem trước mới.',
        BOOKING_POLICY_BLOCKED: 'Booking không còn đáp ứng chính sách. Vui lòng tạo bản xem trước mới.',
        RESTAURANT_NOT_FOUND: 'Nhà hàng không còn khả dụng. Vui lòng chọn nhà hàng khác.',
        BOOKING_CREATE_FAILED: 'Lần xác nhận trước không thành công. Vui lòng tạo bản xem trước mới.',
      };
      throw new AiBookingConfirmationError(code, messages[code], {
        statusCode: code === 'BOOKING_POLICY_BLOCKED' ? 422 : 409,
      });
    }
    if (action.status === 'processing') {
      if (action.idempotencyKey !== idempotencyKey) {
        throw new AiBookingConfirmationError(
          'IDEMPOTENCY_CONFLICT',
          'Bản xem trước đang được xác nhận bởi một yêu cầu khác.',
          { statusCode: 409, details: { retryable: true } },
        );
      }
      const recoveredBooking = await bookingModel.findOne({
        sourceAiPendingActionId: action._id,
      });
      if (recoveredBooking) {
        const recoveredAction = await pendingActionModel.findOneAndUpdate(
          {
            _id: action._id,
            userId,
            status: 'processing',
            idempotencyKey,
          },
          {
            $set: {
              status: 'confirmed',
              confirmedAt: now(),
              resultType: 'booking',
              resultId: recoveredBooking._id,
              errorCode: null,
            },
          },
          { new: true },
        );
        const finalAction = recoveredAction || await getAction(action._id);
        return {
          pendingAction: toSafeConfirmedAction(finalAction || action),
          booking: toSafeBooking(recoveredBooking),
          idempotent: true,
        };
      }
      if (allowWait) {
        await wait(processingWaitMs);
        const refreshed = await getAction(action._id);
        return resolveExistingState({
          action: refreshed,
          userId,
          idempotencyKey,
          currentTime: now(),
          allowWait: false,
        });
      }
      throw new AiBookingConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        'Yêu cầu xác nhận đang được xử lý. Vui lòng thử lại với cùng mã idempotency.',
        { statusCode: 409, details: { retryable: true } },
      );
    }
    return null;
  };

  return {
    async confirmPendingBooking({
      pendingActionId,
      user,
      confirmation,
      idempotencyKey,
      requestId = 'unknown',
      io = null,
    }) {
      const startedAt = process.hrtime.bigint();
      const userId = user?._id || user?.id;
      const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';

      const finishAudit = async (status, errorCode = null, resultId = null) => {
        const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        await auditSafely(auditLogger, {
          requestId,
          userId: userId || null,
          role: user?.role || 'guest',
          toolName: 'confirm_booking',
          argsRedacted: {
            pendingActionId: toIdString(pendingActionId),
            idempotencyKeyHash: key
              ? createHash('sha256').update(key).digest('hex').slice(0, 16)
              : null,
            resultId: resultId ? toIdString(resultId) : null,
          },
          status,
          latencyMs,
          errorCode,
          createdAt: now(),
        });
      };

      try {
        let config;
        try {
          config = configProvider();
        } catch (error) {
          throw new AiBookingConfirmationError(
            'AI_BOOKING_CONFIRM_DISABLED',
            'Tính năng xác nhận booking đang tạm tắt.',
            { statusCode: 503, cause: error },
          );
        }
        if (config.bookingConfirmEnabled === false) {
          throw new AiBookingConfirmationError(
            'AI_BOOKING_CONFIRM_DISABLED',
            'Tính năng xác nhận booking đang tạm tắt.',
            { statusCode: 503 },
          );
        }
        if (confirmation !== true) {
          throw new AiBookingConfirmationError(
            'CONFIRMATION_REQUIRED',
            'Bạn cần xác nhận rõ trước khi tạo booking.',
            { statusCode: 400 },
          );
        }
        if (!validateIdempotencyKey(key)) {
          throw new AiBookingConfirmationError(
            'IDEMPOTENCY_KEY_REQUIRED',
            'Idempotency-Key không hợp lệ hoặc bị thiếu.',
            { statusCode: 400 },
          );
        }

        const currentTime = now();
        const existingAction = await getAction(pendingActionId);
        const existingResult = await resolveExistingState({
          action: existingAction,
          userId,
          idempotencyKey: key,
          currentTime,
        });
        if (existingResult) {
          await finishAudit('success', null, existingResult.booking.id);
          return existingResult;
        }

        const fingerprint = createRequestFingerprint({
          pendingActionId,
          confirmation,
        });
        let claimedAction;
        try {
          claimedAction = await pendingActionModel.findOneAndUpdate(
            {
              _id: pendingActionId,
              userId,
              actionType: 'prepare_booking',
              status: 'pending',
              expiresAt: { $gt: currentTime },
              $or: [
                { idempotencyKey: null },
                { idempotencyKey: { $exists: false } },
              ],
            },
            {
              $set: {
                status: 'processing',
                processingAt: currentTime,
                idempotencyKey: key,
                requestFingerprint: fingerprint,
                errorCode: null,
              },
            },
            { new: true },
          );
        } catch (error) {
          if (error?.code === 11000) {
            throw new AiBookingConfirmationError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key đã được dùng cho một yêu cầu khác.',
              { statusCode: 409, cause: error },
            );
          }
          throw error;
        }

        if (!claimedAction) {
          const refreshedAction = await getAction(pendingActionId);
          const resolved = await resolveExistingState({
            action: refreshedAction,
            userId,
            idempotencyKey: key,
            currentTime: now(),
          });
          if (resolved) {
            await finishAudit('success', null, resolved.booking.id);
            return resolved;
          }
          throw new AiBookingConfirmationError(
            'IDEMPOTENCY_CONFLICT',
            'Không thể claim bản xem trước để xác nhận.',
            { statusCode: 409, details: { retryable: true } },
          );
        }

        const payload = claimedAction.payload || {};
        if (toIdString(payload.customerId) !== toIdString(userId)) {
          await pendingActionModel.findOneAndUpdate(
            { _id: claimedAction._id, status: 'processing', idempotencyKey: key },
            { $set: { status: 'failed', errorCode: 'PERMISSION_DENIED' } },
            { new: true },
          );
          throw new AiBookingConfirmationError(
            'PERMISSION_DENIED',
            'Dữ liệu booking không thuộc khách hàng hiện tại.',
            { statusCode: 403 },
          );
        }

        let applicationResult;
        try {
          applicationResult = await bookingApplication.createBooking({
            actor: {
              userId,
              user,
            },
            command: {
              restaurantId: payload.restaurantId,
              bookingDate: payload.bookingDate,
              bookingTime: payload.bookingTime,
              numberOfGuests: payload.numberOfGuests,
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              customerEmail: payload.customerEmail,
              specialRequests: payload.specialRequests || null,
              occasion: payload.occasion || null,
              tableNumbers: payload.tableNumbers || [],
              voucherCode: payload.voucherCode || null,
              voucherId: payload.voucherId || null,
            },
            context: {
              customer: user,
              io,
              sourceAiPendingActionId: claimedAction._id,
              requestId,
            },
          });
        } catch (error) {
          const mappedError = mapApplicationError(error);
          if (mappedError) {
            await pendingActionModel.findOneAndUpdate(
              { _id: claimedAction._id, status: 'processing', idempotencyKey: key },
              {
                $set: {
                  status: 'failed',
                  errorCode: mappedError.code,
                },
              },
              { new: true },
            );
            throw mappedError;
          }

          let recoveredBooking = null;
          try {
            recoveredBooking = await bookingModel.findOne({
              sourceAiPendingActionId: claimedAction._id,
            });
          } catch (lookupError) {
            console.error(
              `[AI Confirm] requestId=${requestId} code=RECOVERY_LOOKUP_FAILED message=${lookupError.message}`,
            );
          }
          if (recoveredBooking) {
            applicationResult = {
              booking: recoveredBooking,
              created: false,
            };
          } else {
            await pendingActionModel.findOneAndUpdate(
              { _id: claimedAction._id, status: 'processing', idempotencyKey: key },
              {
                $set: {
                  status: 'failed',
                  errorCode: 'BOOKING_CREATE_FAILED',
                },
              },
              { new: true },
            );
            console.error(
              `[AI Confirm] requestId=${requestId} code=BOOKING_CREATE_FAILED message=${error.message}`,
            );
            throw new AiBookingConfirmationError(
              'BOOKING_CREATE_FAILED',
              'Không thể tạo booking lúc này. Vui lòng tạo bản xem trước mới hoặc kiểm tra My Bookings.',
              { statusCode: 500, cause: error },
            );
          }
        }

        const confirmedAt = now();
        let confirmedAction = await pendingActionModel.findOneAndUpdate(
          {
            _id: claimedAction._id,
            userId,
            status: 'processing',
            idempotencyKey: key,
            requestFingerprint: fingerprint,
          },
          {
            $set: {
              status: 'confirmed',
              confirmedAt,
              resultType: 'booking',
              resultId: applicationResult.booking._id,
              errorCode: null,
            },
          },
          { new: true },
        );

        if (!confirmedAction) {
          confirmedAction = await getAction(claimedAction._id);
          if (confirmedAction?.status !== 'confirmed') {
            throw new AiBookingConfirmationError(
              'BOOKING_CREATE_FAILED',
              'Booking đã được tạo nhưng trạng thái xác nhận chưa đồng bộ. Vui lòng kiểm tra My Bookings.',
              { statusCode: 500 },
            );
          }
        }

        const result = {
          pendingAction: toSafeConfirmedAction(confirmedAction),
          booking: toSafeBooking(applicationResult.booking),
          idempotent: applicationResult.created === false,
        };
        await finishAudit('success', null, applicationResult.booking._id);
        return result;
      } catch (error) {
        const normalized = error instanceof AiBookingConfirmationError
          ? error
          : new AiBookingConfirmationError(
            'BOOKING_CREATE_FAILED',
            'Không thể xác nhận booking lúc này.',
            { statusCode: 500, cause: error },
          );
        await finishAudit(
          normalized.statusCode === 403 ? 'forbidden' : 'failed',
          normalized.code,
        );
        throw normalized;
      }
    },
  };
};

module.exports = {
  AiBookingConfirmationError,
  createAiBookingConfirmationService,
  createRequestFingerprint,
  toSafeBooking,
  validateIdempotencyKey,
};
