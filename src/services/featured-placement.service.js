const Payment = require('../models/Payment');
const Restaurant = require('../models/Restaurant');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const payosService = require('./payos.service');
const { assertOwnerRestaurant, canUseFeature } = require('./plan-gating.service');
const { expirePendingPayments } = require('./payment-lifecycle.service');
const {
  payosConfig,
  FEATURED_PACKAGES,
  getFeaturedPackage,
} = require('../config/payos.config');

const FEATURED_TARGET_TYPE = 'featured_restaurant';
const DAY_MS = 24 * 60 * 60 * 1000;

const serializePackage = (pkg) => ({
  code: pkg.code,
  name: pkg.name,
  amount: pkg.amount,
  currency: pkg.currency || 'VND',
  durationDays: pkg.durationDays,
  priorityWeight: pkg.priorityWeight,
  isActive: pkg.isActive !== false,
  benefits: pkg.benefits || [],
});

const serializePlacement = (placement) => {
  if (!placement) return null;
  const raw = typeof placement.toObject === 'function' ? placement.toObject() : placement;
  return {
    _id: raw._id,
    ownerId: raw.ownerId,
    restaurantId: raw.restaurantId,
    paymentId: raw.paymentId,
    orderCode: raw.orderCode,
    packageCode: raw.packageCode,
    status: raw.status,
    startAt: raw.startAt,
    endAt: raw.endAt,
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

const serializePayment = (payment) => {
  if (!payment) return null;
  const raw = typeof payment.toObject === 'function' ? payment.toObject() : payment;
  return {
    _id: raw._id,
    userId: raw.userId,
    targetType: raw.targetType,
    targetId: raw.targetId,
    restaurantId: raw.restaurantId,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    gateway: raw.gateway,
    orderCode: raw.orderCode,
    paymentLinkId: raw.paymentLinkId,
    checkoutUrl: raw.checkoutUrl,
    qrCode: raw.qrCode,
    description: raw.description,
    metadata: raw.metadata,
    paidAt: raw.paidAt,
    expiredAt: raw.expiredAt,
    cancelledAt: raw.cancelledAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const listFeaturedPackages = () => Object.values(FEATURED_PACKAGES)
  .filter((pkg) => pkg.isActive !== false)
  .map(serializePackage);

const generateOrderCode = async () => {
  let orderCode;
  let exists = true;
  while (exists) {
    orderCode = Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
    if (orderCode > 9007199254740991) {
      orderCode = Math.floor(Math.random() * 9007199254740991) + 1;
    }
    const found = await Payment.findOne({ orderCode });
    exists = Boolean(found);
  }
  return orderCode;
};

const getActivePlacementFilter = (now = new Date()) => ({
  status: 'active',
  startAt: { $lte: now },
  endAt: { $gt: now },
});

const syncRestaurantFeaturedFlag = async (restaurantId, now = new Date()) => {
  const active = await FeaturedPlacement.exists({
    restaurantId,
    ...getActivePlacementFilter(now),
  });

  await Restaurant.updateOne(
    { _id: restaurantId },
    { featured: Boolean(active) }
  );

  return Boolean(active);
};

const expireFeaturedPlacements = async (now = new Date(), restaurantIds = null) => {
  const filter = {
    status: 'active',
    endAt: { $lte: now },
  };
  if (restaurantIds?.length) {
    filter.restaurantId = { $in: restaurantIds };
  }

  const expired = await FeaturedPlacement.find(filter).select('_id restaurantId');
  if (!expired.length) return 0;

  const ids = expired.map((item) => item._id);
  await FeaturedPlacement.updateMany(
    { _id: { $in: ids } },
    { status: 'expired' }
  );

  const affectedRestaurantIds = [...new Set(expired.map((item) => String(item.restaurantId)))];
  await Promise.all(affectedRestaurantIds.map((restaurantId) => syncRestaurantFeaturedFlag(restaurantId, now)));

  return expired.length;
};

const getActivePlacementForRestaurant = async (restaurantId, now = new Date()) => {
  await expireFeaturedPlacements(now, [restaurantId]);
  return FeaturedPlacement.findOne({
    restaurantId,
    ...getActivePlacementFilter(now),
  }).sort({ priorityWeight: -1, endAt: -1, createdAt: -1 }).lean();
};

const getActivePlacementMap = async (restaurantIds, now = new Date()) => {
  const ids = [...new Set((restaurantIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return new Map();

  await expireFeaturedPlacements(now, ids);

  const placements = await FeaturedPlacement.find({
    restaurantId: { $in: ids },
    ...getActivePlacementFilter(now),
  })
    .sort({ priorityWeight: -1, endAt: -1, createdAt: -1 })
    .lean();

  const map = new Map();
  placements.forEach((placement) => {
    const key = String(placement.restaurantId);
    const current = map.get(key);
    if (!current || (placement.priorityWeight || 0) > (current.priorityWeight || 0)) {
      map.set(key, placement);
    }
  });
  return map;
};

const getLatestPaidPlacementForRestaurant = (restaurantId, now = new Date()) => FeaturedPlacement.findOne({
  restaurantId,
  status: 'active',
  endAt: { $gt: now },
}).sort({ endAt: -1, priorityWeight: -1, createdAt: -1 });

const cancelPendingFeaturedForRestaurant = async (ownerId, restaurantId) => {
  const payments = await Payment.find({
    userId: ownerId,
    restaurantId,
    targetType: FEATURED_TARGET_TYPE,
    status: 'pending',
  }).sort({ createdAt: -1 }).limit(10);

  await Promise.all(payments.map(async (payment) => {
    try {
      await payosService.cancelPaymentLink(payment.orderCode);
    } catch (error) {
      console.warn(`[FeaturedPlacement] PayOS cancel pending failed: ${error.message}`);
    }

    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    await payment.save();

    await FeaturedPlacement.updateMany(
      { paymentId: payment._id, status: 'pending' },
      { status: 'cancelled', cancelledAt: payment.cancelledAt }
    );
  }));
};

const createFeaturedCheckout = async ({ ownerId, restaurantId, packageCode }) => {
  const restaurant = await assertOwnerRestaurant(ownerId, restaurantId);
  const pkg = getFeaturedPackage(packageCode);
  if (!pkg || pkg.isActive === false) {
    const error = new Error('Invalid featured package.');
    error.statusCode = 400;
    error.code = 'FEATURED_PACKAGE_INVALID';
    throw error;
  }

  const gate = await canUseFeature(ownerId, 'featured.purchase', restaurantId);
  if (!gate.allowed) {
    const error = new Error('Current subscription plan cannot purchase featured placement.');
    error.statusCode = 403;
    error.code = gate.reason || 'FEATURED_PURCHASE_NOT_ALLOWED';
    error.details = gate;
    throw error;
  }

  await cancelPendingFeaturedForRestaurant(ownerId, restaurantId);

  const orderCode = await generateOrderCode();
  const description = `Noi bat ${restaurant.name || 'nha hang'}`.substring(0, 25);
  const metadata = {
    packageCode: pkg.code,
    restaurantId: String(restaurant._id),
    ownerId: String(ownerId),
    durationDays: pkg.durationDays,
    priorityWeight: pkg.priorityWeight,
    targetType: FEATURED_TARGET_TYPE,
  };

  const payment = await Payment.create({
    userId: ownerId,
    targetType: FEATURED_TARGET_TYPE,
    targetId: restaurant._id,
    restaurantId: restaurant._id,
    amount: pkg.amount,
    currency: pkg.currency || 'VND',
    orderCode,
    description,
    metadata,
    status: 'pending',
  });

  const placement = await FeaturedPlacement.create({
    ownerId,
    restaurantId: restaurant._id,
    paymentId: payment._id,
    orderCode,
    packageCode: pkg.code,
    status: 'pending',
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
      FEATURED_TARGET_TYPE
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
    placement.status = 'cancelled';
    placement.cancelledAt = new Date();
    await placement.save();
    throw error;
  }

  return {
    package: serializePackage(pkg),
    payment: serializePayment(payment),
    placement: serializePlacement(placement),
  };
};

const activateFeaturedPlacementFromPayment = async (payment) => {
  if (!payment || payment.targetType !== FEATURED_TARGET_TYPE) return null;
  if (payment.status !== 'paid') return null;

  const existingActive = await FeaturedPlacement.findOne({
    paymentId: payment._id,
    status: 'active',
  });
  if (existingActive) return existingActive;

  const pkg = getFeaturedPackage(payment.metadata?.packageCode);
  if (!pkg) return null;

  const now = new Date();
  const currentPlacement = await getLatestPaidPlacementForRestaurant(payment.restaurantId || payment.targetId, now);
  const baseDate = currentPlacement?.endAt && currentPlacement.endAt > now
    ? currentPlacement.endAt
    : now;
  const startAt = new Date(baseDate);
  const endAt = new Date(startAt.getTime() + pkg.durationDays * DAY_MS);

  let placement = await FeaturedPlacement.findOne({ paymentId: payment._id });
  if (!placement) {
    placement = new FeaturedPlacement({
      ownerId: payment.userId,
      restaurantId: payment.restaurantId || payment.targetId,
      paymentId: payment._id,
      orderCode: payment.orderCode,
      packageCode: pkg.code,
      amount: payment.amount,
      currency: payment.currency || 'VND',
      priorityWeight: pkg.priorityWeight,
      metadata: payment.metadata || {},
    });
  }

  if (placement.status === 'active') return placement;
  if (placement.isNew) await placement.save();

  const activatedPlacement = await FeaturedPlacement.findOneAndUpdate(
    { paymentId: payment._id, status: 'pending' },
    {
      $set: {
        status: 'active',
        startAt,
        endAt,
        priorityWeight: pkg.priorityWeight,
        amount: payment.amount,
        currency: payment.currency || 'VND',
        activatedAt: placement.activatedAt || now,
        metadata: {
          ...(placement.metadata || {}),
          packageCode: pkg.code,
          durationDays: pkg.durationDays,
          priorityWeight: pkg.priorityWeight,
          stackedFromPlacementId: currentPlacement?._id || null,
        },
      },
    },
    { new: true }
  );

  const result = activatedPlacement || await FeaturedPlacement.findOne({
    paymentId: payment._id,
    status: 'active',
  });
  if (!result) return null;
  await syncRestaurantFeaturedFlag(result.restaurantId, now);
  return result;
};

const cancelFeaturedPlacementForPayment = async (payment, cancelledAt = new Date()) => {
  if (!payment || payment.targetType !== FEATURED_TARGET_TYPE) return 0;
  const result = await FeaturedPlacement.updateMany(
    { paymentId: payment._id, status: 'pending' },
    { status: 'cancelled', cancelledAt }
  );
  return result.modifiedCount || result.nModified || 0;
};

const getOwnerFeaturedSummary = async ({ ownerId, restaurantId }) => {
  const filter = { ownerId };
  let restaurant = null;
  if (restaurantId) {
    restaurant = await assertOwnerRestaurant(ownerId, restaurantId);
    filter.restaurantId = restaurant._id;
  }

  await expirePendingPayments({
    userId: ownerId,
    restaurantId,
    targetType: FEATURED_TARGET_TYPE,
  });

  await expireFeaturedPlacements(new Date(), restaurantId ? [restaurantId] : null);

  const [placements, pendingPayment, activePlacement] = await Promise.all([
    FeaturedPlacement.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .populate('restaurantId', 'name')
      .populate('paymentId', 'status amount orderCode checkoutUrl qrCode expiredAt')
      .lean(),
    restaurantId
      ? Payment.findOne({
        userId: ownerId,
        restaurantId,
        targetType: FEATURED_TARGET_TYPE,
        status: 'pending',
        $or: [
          { expiredAt: null },
          { expiredAt: { $gt: new Date() } },
        ],
      }).sort({ createdAt: -1 }).lean()
      : null,
    restaurantId ? getActivePlacementForRestaurant(restaurantId) : null,
  ]);

  return {
    restaurant: restaurant ? { id: restaurant._id, name: restaurant.name } : null,
    packages: listFeaturedPackages(),
    activePlacement: serializePlacement(activePlacement),
    pendingPayment: serializePayment(pendingPayment),
    placements: placements.map(serializePlacement),
  };
};

module.exports = {
  FEATURED_TARGET_TYPE,
  activateFeaturedPlacementFromPayment,
  cancelFeaturedPlacementForPayment,
  createFeaturedCheckout,
  expireFeaturedPlacements,
  getActivePlacementForRestaurant,
  getActivePlacementMap,
  getOwnerFeaturedSummary,
  listFeaturedPackages,
  serializePackage,
  serializePayment,
  serializePlacement,
};
