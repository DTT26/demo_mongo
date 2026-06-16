// ─────────────────────────────────────────────
// PayOS Service — Tích hợp cổng thanh toán PayOS
// ─────────────────────────────────────────────
const axios = require('axios');
const crypto = require('crypto');
const { payosConfig } = require('../config/payos.config');

class PayOSService {
  constructor() {
    this.client = axios.create({
      baseURL: payosConfig.endpoint,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Headers xác thực ───
  _getHeaders() {
    return {
      'x-client-id': payosConfig.clientId,
      'x-api-key': payosConfig.apiKey,
    };
  }

  // ─── Tạo chữ ký HMAC SHA256 cho request tạo link ───
  _signCreate(amount, cancelUrl, description, orderCode, returnUrl) {
    const data = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
    return crypto
      .createHmac('sha256', payosConfig.checksumKey)
      .update(data)
      .digest('hex');
  }

  // ─── Tạo link thanh toán PayOS ───
  async createPaymentLink(orderCode, amount, description, returnUrl, cancelUrl) {
    const returnUrlFinal = returnUrl || payosConfig.returnUrl;
    const cancelUrlFinal = cancelUrl || payosConfig.cancelUrl;
    const expiredAt = Math.floor(Date.now() / 1000) + payosConfig.expirationMinutes * 60;

    const signature = this._signCreate(amount, cancelUrlFinal, description, orderCode, returnUrlFinal);

    const payload = {
      orderCode,
      amount,
      description,
      cancelUrl: cancelUrlFinal,
      returnUrl: returnUrlFinal,
      expiredAt,
      signature,
    };

    console.log(`🔗 Tạo PayOS link: orderCode=${orderCode}, amount=${amount}`);

    const response = await this.client.post('/v2/payment-requests', payload, {
      headers: this._getHeaders(),
    });

    console.log(`✅ PayOS link tạo thành công: ${response.data?.data?.checkoutUrl}`);
    return response.data;
  }

  // ─── Lấy thông tin thanh toán từ PayOS ───
  async getPaymentInfo(orderCode) {
    const response = await this.client.get(`/v2/payment-requests/${orderCode}`, {
      headers: this._getHeaders(),
    });
    return response.data;
  }

  // ─── Xác thực chữ ký webhook ───
  verifyWebhookSignature(rawBody, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', payosConfig.checksumKey)
        .update(rawBody)
        .digest('hex');
      return expectedSignature === signature;
    } catch (error) {
      console.error('❌ Lỗi verify webhook signature:', error);
      return false;
    }
  }

  // ─── Hủy link thanh toán PayOS ───
  async cancelPaymentLink(orderCode, cancellationReason) {
    try {
      const response = await this.client.post(
        `/v2/payment-requests/${orderCode}/cancel`,
        { cancellationReason: cancellationReason || 'Người dùng hủy thanh toán' },
        { headers: this._getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error(`❌ Lỗi hủy PayOS link: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new PayOSService();
