// ─────────────────────────────────────────────
// PayOS Configuration
// ─────────────────────────────────────────────

const payosConfig = {
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
  endpoint: process.env.PAYOS_ENDPOINT || 'https://api-merchant.payos.vn',
  returnUrl: process.env.PAYOS_RETURN_URL || 'http://localhost:5173/payment-success',
  cancelUrl: process.env.PAYOS_CANCEL_URL || 'http://localhost:5173/payment-cancel',
  expirationMinutes: parseInt(process.env.PAYOS_EXPIRATION_MINUTES || '30', 10),
};

// Validate PayOS config at startup
const validatePayosConfig = () => {
  const required = ['clientId', 'apiKey', 'checksumKey'];
  const missing = required.filter(key => !payosConfig[key]);
  if (missing.length > 0) {
    console.warn(`⚠️ PayOS config missing: ${missing.join(', ')}. Payment features will be disabled.`);
    return false;
  }
  console.log('✅ PayOS config loaded successfully');
  return true;
};

// ─── Subscription Plans ───
const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    durationDays: 0, // Unlimited
    benefits: {
      maxMenuItems: 20,
      maxTables: 5,
      allowRealtime: false,
      allowAnalytics: false,
      prioritySupport: false,
    },
  },
  plus: {
    name: 'Plus',
    price: 200000, // 200,000 VNĐ/tháng
    durationDays: 30,
    benefits: {
      maxMenuItems: 100,
      maxTables: 20,
      allowRealtime: true,
      allowAnalytics: false,
      prioritySupport: false,
    },
  },
  pro: {
    name: 'Pro',
    price: 500000, // 500,000 VNĐ/tháng
    durationDays: 30,
    benefits: {
      maxMenuItems: -1, // Unlimited
      maxTables: -1, // Unlimited
      allowRealtime: true,
      allowAnalytics: true,
      prioritySupport: true,
    },
  },
};

module.exports = { payosConfig, validatePayosConfig, SUBSCRIPTION_PLANS };
