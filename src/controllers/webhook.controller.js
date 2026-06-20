// ─────────────────────────────────────────────
// Webhook Controller — Xử lý PayOS Webhook (IPN)
// ─────────────────────────────────────────────
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const WebhookLog = require('../models/WebhookLog');
const payosService = require('../services/payos.service');
const paymentController = require('./payment.controller');
const notificationService = require('../services/notification.service');
const featuredPlacementService = require('../services/featured-placement.service');
const voucherCampaignService = require('../services/voucher-campaign.service');

const RETRYABLE_MONETIZATION_TARGETS = new Set([
  'subscription',
  'featured_restaurant',
  'voucher_campaign',
]);

// ─── POST /api/v1/webhooks/payos ───
exports.handlePayOSWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-payos-signature'] || '';
    const rawBody = req.rawBody || JSON.stringify(req.body);

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
      log.processed = true;
      log.processedAt = new Date();
      log.error = 'Duplicate webhook ignored';
      await log.save();
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
      const claimedPayment = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: { $in: ['pending', 'processing'] },
        },
        {
          $set: {
            status: 'paid',
            paidAt: new Date(),
          },
        },
        { new: true }
      );

      const paymentToFulfill = claimedPayment || (
        payment.status === 'paid' && RETRYABLE_MONETIZATION_TARGETS.has(payment.targetType)
          ? payment
          : null
      );

      if (paymentToFulfill) {

        // Retry paid monetization payments safely if a previous fulfillment failed midway.
        try {
          await paymentController._processPaymentSuccess(paymentToFulfill, req.app?.get?.('io') || null);
        } catch (error) {
          log.error = `Payment fulfillment failed: ${error.message}`;
          await log.save();
          throw error;
        }

        // Transaction payment dung idempotency key rieng de khong double-create.
        await Transaction.findOneAndUpdate(
          { idempotencyKey: `payment:${paymentToFulfill._id}` },
          {
            $setOnInsert: {
              paymentId: paymentToFulfill._id,
              idempotencyKey: `payment:${paymentToFulfill._id}`,
              type: 'payment',
              amount: paymentToFulfill.amount,
              status: 'success',
              gateway: 'payos',
              gatewayTransactionId: data.reference || data.paymentLinkId || null,
              rawPayload: data,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`✅ Webhook xử lý thành công: orderCode=${orderCode}, paymentId=${paymentToFulfill._id}`);

        // Bắn socket notification
        try {
          const io = req.app.get('io');
          if (io) {
            io.to(`user_${paymentToFulfill.userId}`).emit('payment_success', {
              paymentId: paymentToFulfill._id,
              orderCode,
              targetType: paymentToFulfill.targetType,
              targetId: paymentToFulfill.targetId,
              amount: paymentToFulfill.amount,
            });
          }
        } catch (socketErr) {
          console.error('Socket emit error:', socketErr.message);
        }
      }
    } else {
      const failedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $in: ['pending', 'processing'] } },
        { $set: { status: 'failed' } },
        { new: true }
      );
      if (failedPayment) {
        await featuredPlacementService.cancelFeaturedPlacementForPayment(failedPayment);
        await voucherCampaignService.cancelVoucherCampaignForPayment(failedPayment);
        notificationService.notifyPaymentStatus(req.app?.get?.('io') || null, {
          payment: failedPayment,
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
