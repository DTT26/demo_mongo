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

  _getHeaders() {
    return {
      'x-client-id': payosConfig.clientId,
      'x-api-key': payosConfig.apiKey,
    };
  }

  _signCreate(amount, cancelUrl, description, orderCode, returnUrl) {
    const data = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
    return crypto
      .createHmac('sha256', payosConfig.checksumKey)
      .update(data)
      .digest('hex');
  }

  _appendTargetType(url, targetType) {
    if (!targetType) return url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('targetType', targetType);
      return parsed.toString();
    } catch {
      const separator = String(url).includes('?') ? '&' : '?';
      return `${url}${separator}targetType=${encodeURIComponent(targetType)}`;
    }
  }

  async createPaymentLink(orderCode, amount, description, returnUrl, cancelUrl, targetType) {
    const returnUrlFinal = this._appendTargetType(returnUrl || payosConfig.returnUrl, targetType);
    const cancelUrlFinal = this._appendTargetType(cancelUrl || payosConfig.cancelUrl, targetType);
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

    console.log(`PayOS create link requested: orderCode=${orderCode}, amount=${amount}`);

    const response = await this.client.post('/v2/payment-requests', payload, {
      headers: this._getHeaders(),
    });

    console.log(`PayOS create link succeeded: orderCode=${orderCode}, hasCheckoutUrl=${Boolean(response.data?.data?.checkoutUrl)}`);
    return response.data;
  }

  async getPaymentInfo(orderCode) {
    const response = await this.client.get(`/v2/payment-requests/${orderCode}`, {
      headers: this._getHeaders(),
    });
    return response.data;
  }

  verifyWebhookSignature(rawBody, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', payosConfig.checksumKey)
        .update(rawBody)
        .digest('hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(String(signature || ''), 'utf8');
      return expectedBuffer.length === signatureBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch (error) {
      console.error('PayOS webhook signature verification error:', error.message);
      return false;
    }
  }

  async cancelPaymentLink(orderCode, cancellationReason) {
    try {
      const response = await this.client.post(
        `/v2/payment-requests/${orderCode}/cancel`,
        { cancellationReason: cancellationReason || 'User cancelled payment' },
        { headers: this._getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error(`PayOS cancel link error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new PayOSService();
