const payosConfig = {
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
  endpoint: process.env.PAYOS_ENDPOINT || 'https://api-merchant.payos.vn',
  returnUrl: process.env.PAYOS_RETURN_URL || 'http://localhost:5173/payment-success',
  cancelUrl: process.env.PAYOS_CANCEL_URL || 'http://localhost:5173/payment-cancel',
  expirationMinutes: parseInt(process.env.PAYOS_EXPIRATION_MINUTES || '30', 10),
};

const BASE_FEATURES = {
  allowAiOwner: false,
  allowFeaturedPurchase: false,
  allowVoucherBasic: true,
  allowVoucherAdvanced: false,
  allowVoucherCampaignPurchase: false,
  bookingFeeWaived: false,
  bookingMonthlyLimit: 50,
  allowRealtime: false,
  allowAnalytics: false,
  prioritySupport: false,
};

const SUBSCRIPTION_PLANS = {
  free: {
    code: 'free',
    name: 'Free',
    price: 0,
    priceMonthly: 0,
    priceYearly: 0,
    durationDays: 0,
    sortOrder: 0,
    features: [
      'Hồ sơ nhà hàng cơ bản',
      'Quản lý thực đơn và bàn ở mức giới hạn',
      'Nhận đặt bàn từ khách hàng',
    ],
    limits: {
      maxMenuItems: 20,
      maxTables: 5,
      bookingMonthlyLimit: 50,
      maxRestaurants: 1,
    },
    benefits: {
      ...BASE_FEATURES,
      maxMenuItems: 20,
      maxTables: 5,
      bookingMonthlyLimit: 50,
      maxRestaurants: 1,
    },
  },
  plus: {
    code: 'plus',
    name: 'Plus',
    price: 200000,
    priceMonthly: 200000,
    priceYearly: 2000000,
    durationDays: 30,
    sortOrder: 1,
    features: [
      'Mở rộng giới hạn thực đơn và sơ đồ bàn',
      'Sử dụng trợ lý AI cho chủ nhà hàng',
      'Được mua gói đặt nổi bật và chiến dịch voucher',
    ],
    limits: {
      maxMenuItems: 100,
      maxTables: 20,
      bookingMonthlyLimit: 500,
      maxRestaurants: 3,
    },
    benefits: {
      ...BASE_FEATURES,
      maxMenuItems: 100,
      maxTables: 20,
      allowVoucherAdvanced: true,
      allowAiOwner: true,
      allowFeaturedPurchase: true,
      allowVoucherCampaignPurchase: true,
      bookingMonthlyLimit: 500,
      allowRealtime: true,
      maxRestaurants: 3,
    },
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    price: 500000,
    priceMonthly: 500000,
    priceYearly: 5000000,
    durationDays: 30,
    sortOrder: 2,
    features: [
      'Không giới hạn thực đơn và sơ đồ bàn',
      'AI cho chủ nhà hàng và phân tích nâng cao',
      'Được mua gói nổi bật/chiến dịch voucher, ưu tiên hỗ trợ',
      'Miễn phí đặt bàn nền tăng nếu cấu hình có thu phí',
    ],
    limits: {
      maxMenuItems: -1,
      maxTables: -1,
      bookingMonthlyLimit: -1,
      maxRestaurants: 10,
    },
    benefits: {
      ...BASE_FEATURES,
      maxMenuItems: -1,
      maxTables: -1,
      allowVoucherAdvanced: true,
      allowAiOwner: true,
      allowFeaturedPurchase: true,
      allowVoucherCampaignPurchase: true,
      bookingFeeWaived: true,
      bookingMonthlyLimit: -1,
      allowRealtime: true,
      allowAnalytics: true,
      prioritySupport: true,
      maxRestaurants: 10,
    },
  },
};

const PLAN_ORDER = Object.fromEntries(
  Object.keys(SUBSCRIPTION_PLANS).map((code, index) => [code, index])
);

const FEATURED_PACKAGES = Object.freeze({
  FEATURED_7D: {
    code: 'FEATURED_7D',
    name: 'Nổi bật 7 ngày',
    amount: 99000,
    currency: 'VND',
    durationDays: 7,
    priorityWeight: 10,
    isActive: true,
    benefits: [
      'Hiện huy hiệu Nổi bật trên danh sách nhà hàng',
      'Ưu tiên sắp xếp trong kết quả tìm kiếm',
      'Phù hợp để thử nghiệm chiến dịch ngắn ngày',
    ],
  },
  FEATURED_30D: {
    code: 'FEATURED_30D',
    name: 'Nổi bật 30 ngày',
    amount: 299000,
    currency: 'VND',
    durationDays: 30,
    priorityWeight: 20,
    isActive: true,
    benefits: [
      'Hiện huy hiệu Nổi bật trên danh sách nhà hàng',
      'Ưu tiên sắp xếp cao hơn gói 7 ngày',
      'Phù hợp chiến dịch theo tháng',
    ],
  },
  FEATURED_60D: {
    code: 'FEATURED_60D',
    name: 'Nổi bật 60 ngày',
    amount: 499000,
    currency: 'VND',
    durationDays: 60,
    priorityWeight: 30,
    isActive: true,
    benefits: [
      'Hiện huy hiệu Nổi bật trên danh sách nhà hàng',
      'Ưu tiên sắp xếp cao nhất trong nhóm nổi bật',
      'Phù hợp nhà hàng cần duy trì hiện diện dài hơn',
    ],
  },
});

const VOUCHER_CAMPAIGN_PACKAGES = Object.freeze({
  VOUCHER_HOME_7D: {
    code: 'VOUCHER_HOME_7D',
    name: 'Homepage 7 ngày',
    placement: 'homepage',
    amount: 79000,
    currency: 'VND',
    durationDays: 7,
    priorityWeight: 10,
    isActive: true,
    benefits: [
      'Xuất hiện trong khu vực voucher nổi bật trang chủ',
      'Gắn nhãn Được tài trợ minh bạch',
      'Phù hợp chiến dịch ngắn ngày',
    ],
  },
  VOUCHER_HOME_30D: {
    code: 'VOUCHER_HOME_30D',
    name: 'Homepage 30 ngày',
    placement: 'homepage',
    amount: 199000,
    currency: 'VND',
    durationDays: 30,
    priorityWeight: 20,
    isActive: true,
    benefits: [
      'Xuất hiện trong khu vực voucher nổi bật trang chủ',
      'Ưu tiên cao hơn gói homepage 7 ngày',
      'Phù hợp chiến dịch theo tháng',
    ],
  },
  VOUCHER_AI_7D: {
    code: 'VOUCHER_AI_7D',
    name: 'AI suggestion 7 ngày',
    placement: 'ai_suggestion',
    amount: 99000,
    currency: 'VND',
    durationDays: 7,
    priorityWeight: 10,
    isActive: true,
    benefits: [
      'Tăng ưu tiên trong kết quả gợi ý AI phù hợp',
      'Vẫn kiểm tra voucher thật trước khi đặt bàn',
      'Phù hợp để thử nghiệm kênh AI',
    ],
  },
  VOUCHER_AI_30D: {
    code: 'VOUCHER_AI_30D',
    name: 'AI suggestion 30 ngày',
    placement: 'ai_suggestion',
    amount: 249000,
    currency: 'VND',
    durationDays: 30,
    priorityWeight: 20,
    isActive: true,
    benefits: [
      'Tăng ưu tiên trong kết quả gợi ý AI phù hợp',
      'Ưu tiên cao hơn gói AI 7 ngày',
      'Vẫn kiểm tra voucher thật trước khi đặt bàn',
    ],
  },
  VOUCHER_SEARCH_7D: {
    code: 'VOUCHER_SEARCH_7D',
    name: 'Search boost 7 ngày',
    placement: 'search_boost',
    amount: 69000,
    currency: 'VND',
    durationDays: 7,
    priorityWeight: 10,
    isActive: true,
    benefits: [
      'Tăng ưu tiên nhà hàng trong danh sách tìm kiếm',
      'Hiện huy hiệu Voucher nổi bật',
      'Phù hợp chiến dịch ngắn ngày',
    ],
  },
  VOUCHER_SEARCH_30D: {
    code: 'VOUCHER_SEARCH_30D',
    name: 'Search boost 30 ngày',
    placement: 'search_boost',
    amount: 179000,
    currency: 'VND',
    durationDays: 30,
    priorityWeight: 20,
    isActive: true,
    benefits: [
      'Tăng ưu tiên nhà hàng trong danh sách tìm kiếm',
      'Ưu tiên cao hơn gói search 7 ngày',
      'Hiện huy hiệu Voucher nổi bật',
    ],
  },
});

const getPlanCode = (value) => String(value || '').trim().toLowerCase();

const getPlanInfo = (value) => SUBSCRIPTION_PLANS[getPlanCode(value)] || null;

const getFeaturedPackage = (value) => FEATURED_PACKAGES[String(value || '').trim().toUpperCase()] || null;
const getVoucherCampaignPackage = (value) => (
  VOUCHER_CAMPAIGN_PACKAGES[String(value || '').trim().toUpperCase()] || null
);

const validatePayosConfig = () => {
  const required = ['clientId', 'apiKey', 'checksumKey'];
  const missing = required.filter((key) => !payosConfig[key]);
  if (missing.length > 0) {
    console.warn(`PayOS config missing: ${missing.join(', ')}. Payment features will be disabled.`);
    return false;
  }
  console.log('PayOS config loaded successfully');
  return true;
};

module.exports = {
  payosConfig,
  validatePayosConfig,
  SUBSCRIPTION_PLANS,
  PLAN_ORDER,
  FEATURED_PACKAGES,
  VOUCHER_CAMPAIGN_PACKAGES,
  getPlanCode,
  getPlanInfo,
  getFeaturedPackage,
  getVoucherCampaignPackage,
};
