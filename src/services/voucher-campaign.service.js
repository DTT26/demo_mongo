const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Restaurant = require('../models/Restaurant');
const Voucher = require('../models/Voucher');
const VoucherCampaignPurchase = require('../models/VoucherCampaignPurchase');
const payosService = require('./payos.service');
const { assertOwnerRestaurant, canUseFeature } = require('./plan-gating.service');
const { expirePendingPayments } = require('./payment-lifecycle.service');
const {
  payosConfig,
  VOUCHER_CAMPAIGN_PACKAGES,
  getVoucherCampaignPackage,
} = require('../config/payos.config');

const VOUCHER_CAMPAIGN_TARGET_TYPE = 'voucher_campaign';
const CAMPAIGN_PLACEMENTS = Object.freeze(['homepage', 'ai_suggestion', 'search_boost']);
const DAY_MS = 24 * 60 * 60 * 1000;

const toId = (value) => {
  if (!value) return null;
  if (value._id) return value._id;
  return value;
};

const serializePackage = (pkg) => ({
  code: pkg.code,
  name: pkg.name,
  placement: pkg.placement,
  amount: pkg.amount,
  currency: pkg.currency || 'VND',
  durationDays: pkg.durationDays,
  priorityWeight: pkg.priorityWeight,
  isActive: pkg.isActive !== false,
  benefits: pkg.benefits || [],
});

const serializeVoucher = (voucher) => {
  if (!voucher) return null;
  const raw = typeof voucher.toObject === 'function' ? voucher.toObject() : voucher;
  return {
    _id: raw._id,
    code: raw.code,
    description: raw.description,
    discountType: raw.discountType,
    discountValue: raw.discountValue,
    maxDiscountAmount: raw.maxDiscountAmount,
    minOrderAmount: raw.minOrderAmount,
    startDate: raw.startDate,
    endDate: raw.endDate,
    status: raw.status,
    restaurantId: toId(raw.restaurantId),
  };
};

const serializePayment = (payment) => {
  if (!payment) return null;
  const raw = typeof payment.toObject === 'function' ? payment.toObject() : payment;
  return {
    _id: raw._id,
    targetType: raw.targetType,
    targetId: raw.targetId,
    restaurantId: toId(raw.restaurantId),
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    gateway: raw.gateway,
    orderCode: raw.orderCode,
    paymentLinkId: raw.paymentLinkId,
    checkoutUrl: raw.checkoutUrl,
    qrCode: raw.qrCode,
    description: raw.description,
    paidAt: raw.paidAt,
    expiredAt: raw.expiredAt,
    cancelledAt: raw.cancelledAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const serializeCampaign = (campaign) => {
  if (!campaign) return null;
  const raw = typeof campaign.toObject === 'function' ? campaign.toObject() : campaign;
  const voucher = raw.voucherId && typeof raw.voucherId === 'object' && raw.voucherId.code
    ? serializeVoucher(raw.voucherId)
    : null;
  const payment = raw.paymentId && typeof raw.paymentId === 'object' && raw.paymentId.status
    ? serializePayment(raw.paymentId)
    : null;
  const restaurant = raw.restaurantId && typeof raw.restaurantId === 'object' && raw.restaurantId.name
    ? { _id: raw.restaurantId._id, name: raw.restaurantId.name }
    : null;

  return {
    _id: raw._id,
    ownerId: raw.ownerId,
    restaurantId: restaurant || toId(raw.restaurantId),
    voucherId: voucher || toId(raw.voucherId),
    paymentId: payment || toId(raw.paymentId),
    orderCode: raw.orderCode,
    packageCode: raw.packageCode,
    placement: raw.placement,
    status: raw.status,
    startAt: raw.startAt,
    endAt: raw.endAt,
    durationDays: raw.durationDays,
    priorityWeight: raw.priorityWeight,
    amount: raw.amount,
    currency: raw.currency,
    activatedAt: raw.activatedAt,
    cancelledAt: raw.cancelledAt,
    metadata: raw.metadata || {},
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const listVoucherCampaignPackages = () => Object.values(VOUCHER_CAMPAIGN_PACKAGES)
  .filter((pkg) => pkg.isActive !== false)
  .map(serializePackage);

const generateOrderCode = async () => {
  let orderCode;
  let exists = true;
  while (exists) {
    orderCode = Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
    if (orderCode > Number.MAX_SAFE_INTEGER) {
      orderCode = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    }
    exists = Boolean(await Payment.findOne({ orderCode }));
  }
  return orderCode;
};

const isVoucherCurrentlyValid = (voucher, now = new Date()) => Boolean(
  voucher
  && voucher.status === 'active'
  && (!voucher.startDate || voucher.startDate <= now)
  && (!voucher.endDate || voucher.endDate > now)
);

const getActiveCampaignFilter = (now = new Date()) => ({
  status: 'active',
  startAt: { $lte: now },
  endAt: { $gt: now },
});

const expireVoucherCampaigns = async (now = new Date(), filters = {}) => {
  const result = await VoucherCampaignPurchase.updateMany(
    {
      status: 'active',
      endAt: { $lte: now },
      ...filters,
    },
    { status: 'expired' }
  );
  return result.modifiedCount || result.nModified || 0;
};

const getLatestScheduledCampaign = ({ voucherId, placement, now = new Date() }) => (
  VoucherCampaignPurchase.findOne({
    voucherId,
    placement,
    status: 'active',
    endAt: { $gt: now },
  }).sort({ endAt: -1, createdAt: -1 })
);

const getExpectedCampaignWindow = async ({ voucherId, placement, durationDays, now = new Date() }) => {
  const latest = await getLatestScheduledCampaign({ voucherId, placement, now });
  const baseDate = latest?.endAt && latest.endAt > now ? latest.endAt : now;
  const startAt = new Date(baseDate);
  const endAt = new Date(startAt.getTime() + durationDays * DAY_MS);
  return { latest, startAt, endAt };
};

const assertCampaignVoucher = async ({
  ownerId,
  restaurantId,
  voucherId,
  pkg,
  now = new Date(),
}) => {
  await assertOwnerRestaurant(ownerId, restaurantId);
  if (!mongoose.Types.ObjectId.isValid(String(voucherId || ''))) {
    const error = new Error('Voucher not found.');
    error.statusCode = 404;
    error.code = 'VOUCHER_NOT_FOUND';
    throw error;
  }

  const voucher = await Voucher.findOne({ _id: voucherId, restaurantId });
  if (!voucher) {
    const error = new Error('Voucher does not belong to the selected restaurant.');
    error.statusCode = 403;
    error.code = 'VOUCHER_RESTAURANT_MISMATCH';
    throw error;
  }
  if (!isVoucherCurrentlyValid(voucher, now)) {
    const error = new Error('Voucher must be active and currently valid.');
    error.statusCode = 400;
    error.code = 'VOUCHER_NOT_CAMPAIGN_ELIGIBLE';
    throw error;
  }

  const window = await getExpectedCampaignWindow({
    voucherId: voucher._id,
    placement: pkg.placement,
    durationDays: pkg.durationDays,
    now,
  });
  if (voucher.endDate && voucher.endDate < window.endAt) {
    const error = new Error('Voucher validity must cover the full campaign period.');
    error.statusCode = 400;
    error.code = 'VOUCHER_VALIDITY_TOO_SHORT';
    error.details = {
      voucherEndDate: voucher.endDate,
      expectedCampaignEndAt: window.endAt,
    };
    throw error;
  }

  return { voucher, window };
};

const cancelPendingCampaignPayment = async ({
  ownerId,
  restaurantId,
  voucherId,
  placement,
}) => {
  const payments = await Payment.find({
    userId: ownerId,
    restaurantId,
    targetType: VOUCHER_CAMPAIGN_TARGET_TYPE,
    status: 'pending',
    'metadata.voucherId': String(voucherId),
    'metadata.placement': placement,
  }).sort({ createdAt: -1 }).limit(10);

  await Promise.all(payments.map(async (payment) => {
    try {
      await payosService.cancelPaymentLink(payment.orderCode);
    } catch (error) {
      console.warn(`[VoucherCampaign] PayOS cancel pending failed: ${error.message}`);
    }
    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    await payment.save();
    await VoucherCampaignPurchase.updateMany(
      { paymentId: payment._id, status: 'pending' },
      { status: 'cancelled', cancelledAt: payment.cancelledAt }
    );
  }));
};

const createVoucherCampaignCheckout = async ({
  ownerId,
  restaurantId,
  voucherId,
  packageCode,
}) => {
  const pkg = getVoucherCampaignPackage(packageCode);
  if (!pkg || pkg.isActive === false) {
    const error = new Error('Invalid voucher campaign package.');
    error.statusCode = 400;
    error.code = 'VOUCHER_CAMPAIGN_PACKAGE_INVALID';
    throw error;
  }

  const gate = await canUseFeature(ownerId, 'voucherCampaign.purchase', restaurantId);
  if (!gate.allowed) {
    const error = new Error('Current subscription plan cannot purchase voucher campaigns.');
    error.statusCode = 403;
    error.code = gate.reason || 'VOUCHER_CAMPAIGN_PURCHASE_NOT_ALLOWED';
    error.details = gate;
    throw error;
  }

  const { voucher } = await assertCampaignVoucher({
    ownerId,
    restaurantId,
    voucherId,
    pkg,
  });

  await cancelPendingCampaignPayment({
    ownerId,
    restaurantId,
    voucherId: voucher._id,
    placement: pkg.placement,
  });

  const orderCode = await generateOrderCode();
  const description = `QC voucher ${voucher.code}`.substring(0, 25);
  const metadata = {
    ownerId: String(ownerId),
    restaurantId: String(restaurantId),
    voucherId: String(voucher._id),
    packageCode: pkg.code,
    placement: pkg.placement,
    durationDays: pkg.durationDays,
    priorityWeight: pkg.priorityWeight,
    amount: pkg.amount,
    targetType: VOUCHER_CAMPAIGN_TARGET_TYPE,
  };

  const payment = await Payment.create({
    userId: ownerId,
    targetType: VOUCHER_CAMPAIGN_TARGET_TYPE,
    targetId: voucher._id,
    restaurantId,
    amount: pkg.amount,
    currency: pkg.currency || 'VND',
    orderCode,
    description,
    metadata,
    status: 'pending',
  });

  const campaign = await VoucherCampaignPurchase.create({
    ownerId,
    restaurantId,
    voucherId: voucher._id,
    paymentId: payment._id,
    orderCode,
    packageCode: pkg.code,
    placement: pkg.placement,
    status: 'pending',
    durationDays: pkg.durationDays,
    priorityWeight: pkg.priorityWeight,
    amount: pkg.amount,
    currency: pkg.currency || 'VND',
    metadata,
  });

  try {
    const payosResponse = await payosService.createPaymentLink(
      orderCode,
      pkg.amount,
      description,
      undefined,
      undefined,
      VOUCHER_CAMPAIGN_TARGET_TYPE
    );
    if (payosResponse?.data) {
      payment.checkoutUrl = payosResponse.data.checkoutUrl;
      payment.paymentLinkId = payosResponse.data.paymentLinkId;
      payment.qrCode = payosResponse.data.qrCode || null;
      payment.expiredAt = new Date(Date.now() + payosConfig.expirationMinutes * 60 * 1000);
      await payment.save();
    }
  } catch (error) {
    payment.status = 'failed';
    await payment.save();
    campaign.status = 'cancelled';
    campaign.cancelledAt = new Date();
    await campaign.save();
    throw error;
  }

  return {
    package: serializePackage(pkg),
    voucher: serializeVoucher(voucher),
    payment: serializePayment(payment),
    campaign: serializeCampaign(campaign),
  };
};

const activateVoucherCampaignFromPayment = async (payment) => {
  if (!payment || payment.targetType !== VOUCHER_CAMPAIGN_TARGET_TYPE || payment.status !== 'paid') {
    return null;
  }

  const existingActive = await VoucherCampaignPurchase.findOne({
    paymentId: payment._id,
    status: 'active',
  });
  if (existingActive) return existingActive;

  const pkg = getVoucherCampaignPackage(payment.metadata?.packageCode);
  if (!pkg) return null;

  const now = new Date();
  const voucherId = payment.metadata?.voucherId || payment.targetId;
  const restaurantId = payment.metadata?.restaurantId || payment.restaurantId;
  const voucher = await Voucher.findOne({ _id: voucherId, restaurantId });
  if (!isVoucherCurrentlyValid(voucher, now)) {
    await VoucherCampaignPurchase.updateMany(
      { paymentId: payment._id, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          'metadata.activationFailure': 'VOUCHER_NOT_CAMPAIGN_ELIGIBLE',
        },
      }
    );
    return null;
  }

  const { latest, startAt, endAt } = await getExpectedCampaignWindow({
    voucherId,
    placement: pkg.placement,
    durationDays: pkg.durationDays,
    now,
  });
  if (voucher.endDate && voucher.endDate < endAt) {
    await VoucherCampaignPurchase.updateMany(
      { paymentId: payment._id, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          'metadata.activationFailure': 'VOUCHER_VALIDITY_TOO_SHORT',
        },
      }
    );
    return null;
  }

  const campaign = await VoucherCampaignPurchase.findOneAndUpdate(
    { paymentId: payment._id, status: 'pending' },
    {
      $set: {
        status: 'active',
        startAt,
        endAt,
        durationDays: pkg.durationDays,
        priorityWeight: pkg.priorityWeight,
        amount: payment.amount,
        currency: payment.currency || 'VND',
        activatedAt: now,
        metadata: {
          ...(payment.metadata || {}),
          stackedFromCampaignId: latest?._id || null,
        },
      },
    },
    { new: true }
  );

  if (campaign) return campaign;
  return VoucherCampaignPurchase.findOne({ paymentId: payment._id, status: 'active' });
};

const cancelVoucherCampaignForPayment = async (payment, cancelledAt = new Date()) => {
  if (!payment || payment.targetType !== VOUCHER_CAMPAIGN_TARGET_TYPE) return 0;
  const result = await VoucherCampaignPurchase.updateMany(
    { paymentId: payment._id, status: 'pending' },
    { status: 'cancelled', cancelledAt }
  );
  return result.modifiedCount || result.nModified || 0;
};

const getEligibleOwnerVouchers = async (restaurantId, now = new Date()) => {
  const vouchers = await Voucher.find({ restaurantId }).sort({ createdAt: -1 }).lean();
  return vouchers.map((voucher) => {
    let eligibilityReason = null;
    if (voucher.status !== 'active') eligibilityReason = 'Voucher khong o trang thai active.';
    else if (voucher.startDate && voucher.startDate > now) eligibilityReason = 'Voucher chua bat dau.';
    else if (voucher.endDate && voucher.endDate <= now) eligibilityReason = 'Voucher da het han.';

    return {
      ...serializeVoucher(voucher),
      isCampaignEligible: !eligibilityReason,
      campaignEligibilityReason: eligibilityReason,
    };
  });
};

const getOwnerVoucherCampaignSummary = async ({ ownerId, restaurantId }) => {
  const filter = { ownerId };
  let restaurant = null;
  if (restaurantId) {
    restaurant = await assertOwnerRestaurant(ownerId, restaurantId);
    filter.restaurantId = restaurant._id;
  }

  await expirePendingPayments({
    userId: ownerId,
    restaurantId,
    targetType: VOUCHER_CAMPAIGN_TARGET_TYPE,
  });

  await expireVoucherCampaigns(new Date(), restaurantId ? { restaurantId } : {});

  const [campaigns, pendingPayment, vouchers] = await Promise.all([
    VoucherCampaignPurchase.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('restaurantId', 'name')
      .populate('voucherId', 'code description discountType discountValue maxDiscountAmount minOrderAmount startDate endDate status restaurantId')
      .populate('paymentId', 'status amount orderCode checkoutUrl qrCode expiredAt paidAt cancelledAt')
      .lean(),
    restaurantId
      ? Payment.findOne({
        userId: ownerId,
        restaurantId,
        targetType: VOUCHER_CAMPAIGN_TARGET_TYPE,
        status: 'pending',
        $or: [
          { expiredAt: null },
          { expiredAt: { $gt: new Date() } },
        ],
      }).sort({ createdAt: -1 }).lean()
      : null,
    restaurantId ? getEligibleOwnerVouchers(restaurantId) : [],
  ]);

  return {
    restaurant: restaurant ? { id: restaurant._id, name: restaurant.name } : null,
    packages: listVoucherCampaignPackages(),
    pendingPayment: serializePayment(pendingPayment),
    vouchers,
    campaigns: campaigns.map(serializeCampaign),
  };
};

const getActiveCampaigns = async ({
  placement,
  restaurantIds = null,
  voucherIds = null,
  now = new Date(),
} = {}) => {
  if (placement && !CAMPAIGN_PLACEMENTS.includes(placement)) return [];
  const filter = {
    ...getActiveCampaignFilter(now),
    ...(placement ? { placement } : {}),
  };
  if (restaurantIds?.length) filter.restaurantId = { $in: restaurantIds };
  if (voucherIds?.length) filter.voucherId = { $in: voucherIds };

  await expireVoucherCampaigns(now, {
    ...(placement ? { placement } : {}),
    ...(restaurantIds?.length ? { restaurantId: { $in: restaurantIds } } : {}),
    ...(voucherIds?.length ? { voucherId: { $in: voucherIds } } : {}),
  });

  const campaigns = await VoucherCampaignPurchase.find(filter)
    .sort({ priorityWeight: -1, endAt: -1, createdAt: -1 })
    .populate('voucherId', 'code description discountType discountValue maxDiscountAmount minOrderAmount startDate endDate status restaurantId')
    .populate('restaurantId', 'name approvalStatus active deletedAt logo images address cuisineTypes')
    .lean();

  return campaigns.filter((campaign) => {
    const voucher = campaign.voucherId;
    const restaurant = campaign.restaurantId;
    return isVoucherCurrentlyValid(voucher, now)
      && String(voucher.restaurantId) === String(restaurant?._id)
      && restaurant?.approvalStatus === 'approved'
      && restaurant?.active === true
      && !restaurant?.deletedAt;
  });
};

const getActiveCampaignMapByRestaurant = async (restaurantIds, placement, now = new Date()) => {
  const ids = [...new Set((restaurantIds || [])
    .map(String)
    .filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (!ids.length) return new Map();
  const campaigns = await getActiveCampaigns({ restaurantIds: ids, placement, now });
  const map = new Map();
  campaigns.forEach((campaign) => {
    const key = String(toId(campaign.restaurantId));
    const current = map.get(key);
    if (!current || (campaign.priorityWeight || 0) > (current.priorityWeight || 0)) {
      map.set(key, campaign);
    }
  });
  return map;
};

const getRestaurantCampaignSummary = async (restaurantId, now = new Date()) => {
  const campaigns = await getActiveCampaigns({ restaurantIds: [restaurantId], now });
  return campaigns.map((campaign) => ({
    _id: campaign._id,
    placement: campaign.placement,
    packageCode: campaign.packageCode,
    priorityWeight: campaign.priorityWeight,
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    voucher: serializeVoucher(campaign.voucherId),
    sponsoredLabel: 'Duoc tai tro',
  }));
};

const getHomepageVoucherCampaigns = async ({ limit = 6 } = {}) => {
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 6));
  const campaigns = await getActiveCampaigns({ placement: 'homepage' });
  return campaigns.slice(0, safeLimit).map((campaign) => ({
    _id: campaign._id,
    placement: campaign.placement,
    packageCode: campaign.packageCode,
    priorityWeight: campaign.priorityWeight,
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    sponsoredLabel: 'Duoc tai tro',
    voucher: serializeVoucher(campaign.voucherId),
    restaurant: {
      id: campaign.restaurantId._id,
      name: campaign.restaurantId.name,
      logo: campaign.restaurantId.logo || null,
      images: campaign.restaurantId.images || [],
      address: campaign.restaurantId.address || null,
      cuisineTypes: campaign.restaurantId.cuisineTypes || [],
    },
  }));
};

module.exports = {
  CAMPAIGN_PLACEMENTS,
  VOUCHER_CAMPAIGN_TARGET_TYPE,
  activateVoucherCampaignFromPayment,
  cancelVoucherCampaignForPayment,
  createVoucherCampaignCheckout,
  expireVoucherCampaigns,
  getActiveCampaignMapByRestaurant,
  getActiveCampaigns,
  getHomepageVoucherCampaigns,
  getOwnerVoucherCampaignSummary,
  getRestaurantCampaignSummary,
  isVoucherCurrentlyValid,
  listVoucherCampaignPackages,
  serializeCampaign,
  serializePackage,
  serializePayment,
  serializeVoucher,
};
