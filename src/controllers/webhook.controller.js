// ─────────────────────────────────────────────
// Webhook Controller — Xử lý PayOS Webhook (IPN)
// ─────────────────────────────────────────────
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const WebhookLog = require('../models/WebhookLog');
const payosService = require('../services/payos.service');
const { _processPaymentSuccess } = require('./payment.controller');
const notificationService = require('../services/notification.service');

// ─── POST /api/v1/webhooks/payos ───
exports.handlePayOSWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-payos-signature'] || '';
    const rawBody = JSON.stringify(req.body);

    // ─── Verify chữ ký ───
    const signatureValid = payosService.verifyWebhookSignature(rawBody, signature);

    const webhookData = req.body;
    const orderCode = webhookData?.data?.orderCode;

    // Lưu WebhookLog bất kể chữ ký hợp lệ hay không (để debug)
    const log = await WebhookLog.create({
      gateway: 'payos',
      eventType: webhookData?.success ? 'payment_success' : 'payment_failed',
      orderCode: orderCode || 0,
      payload: webhookData,
      signatureValid,
    });

    if (!signatureValid) {
      console.warn('⚠️ PayOS webhook: chữ ký không hợp lệ');
      log.error = 'Invalid signature';
      await log.save();
      return res.status(200).json({ success: true }); // Trả 200 để PayOS không retry liên tục
    }

    if (!orderCode) {
      log.error = 'Missing orderCode';
      await log.save();
      return res.status(200).json({ success: true });
    }

    // ─── Idempotency: kiểm tra đã xử lý chưa ───
    const existingLog = await WebhookLog.findOne({
      orderCode,
      processed: true,
    });

    if (existingLog) {
      console.log(`⏩ Webhook đã xử lý trước đó: orderCode=${orderCode}`);
      return res.status(200).json({ success: true });
    }

    // ─── Tìm payment ───
    const payment = await Payment.findOne({ orderCode });
    if (!payment) {
      log.error = `Payment not found for orderCode: ${orderCode}`;
      await log.save();
      console.error(`❌ Payment not found: orderCode=${orderCode}`);
      return res.status(200).json({ success: true });
    }

    // ─── Xử lý kết quả ───
    const data = webhookData.data;
    const isSuccess = webhookData.success && data.code === '00';

    if (isSuccess) {
      // Chỉ cập nhật nếu đang pending
      if (payment.status === 'pending' || payment.status === 'processing') {
        payment.status = 'paid';
        payment.paidAt = new Date();
        await payment.save();

        // Xử lý entity liên quan (Booking/Subscription)
        await _processPaymentSuccess(payment, req.app?.get?.('io') || null);

        // Tạo transaction log
        await Transaction.create({
          paymentId: payment._id,
          type: 'payment',
          amount: payment.amount,
          status: 'success',
          gateway: 'payos',
          gatewayTransactionId: data.reference || data.paymentLinkId || null,
          rawPayload: data,
        });

        console.log(`✅ Webhook xử lý thành công: orderCode=${orderCode}, paymentId=${payment._id}`);

        // Bắn socket notification
        try {
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${payment.userId}`).emit('payment_success', {
              paymentId: payment._id,
              orderCode,
              targetType: payment.targetType,
              targetId: payment.targetId,
              amount: payment.amount,
            });
          }
        } catch (socketErr) {
          console.error('Socket emit error:', socketErr.message);
        }
      }
    } else {
      if (payment.status === 'pending') {
        payment.status = 'failed';
        await payment.save();
        notificationService.notifyPaymentStatus(req.app?.get?.('io') || null, {
          payment,
          status: 'failed',
        }).catch((error) => console.warn(`[WebhookNotification/payment_failed] ${error.message}`));
      }
      console.warn(`⚠️ Payment failed via webhook: orderCode=${orderCode}`);
    }

    // Đánh dấu log đã xử lý
    log.processed = true;
    log.processedAt = new Date();
    await log.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(200).json({ success: true }); // Luôn trả 200 cho PayOS
  }
};
