'use strict';

const menuService = require('../../menu.service');
const restaurantQueryService = require('../../restaurant-query.service');
const aiKnowledgeService = require('../ai-knowledge.service');
const { getGlobalBookingPolicy } = require('../../../data/ai-public-booking-policy');

const makeToolError = (code, message, status = 'failed') => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const asStringOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const asNumberOrNull = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const clampInteger = (value, fallback, min, max) => {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const formatAddressText = (address) => {
  if (!address) return null;
  if (typeof address === 'string') return address;
  return address.fullAddress
    || [address.street, address.ward, address.district, address.city].filter(Boolean).join(', ')
    || null;
};

const compactText = (value, maxLength = 260) => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
};

const toRestaurantCard = (restaurant) => ({
  id: restaurant.id,
  name: restaurant.name,
  description: compactText(restaurant.description),
  address: formatAddressText(restaurant.address),
  cuisineType: restaurant.cuisineType || restaurant.cuisineTypes?.[0] || null,
  cuisineTypes: restaurant.cuisineTypes || [],
  averageRating: restaurant.averageRating || restaurant.stats?.averageRating || 0,
  reviewCount: restaurant.reviewCount || restaurant.stats?.totalReviews || 0,
  averagePrice: restaurant.averagePrice ?? null,
  priceRange: restaurant.priceRange || null,
  coverImageUrl: restaurant.coverImageUrl || null,
  logo: restaurant.logo || null,
  featured: Boolean(restaurant.featured),
  sponsoredVoucher: restaurant.voucherCampaign?.voucher ? {
    code: restaurant.voucherCampaign.voucher.code,
    description: compactText(restaurant.voucherCampaign.voucher.description, 160),
    discountType: restaurant.voucherCampaign.voucher.discountType,
    discountValue: restaurant.voucherCampaign.voucher.discountValue,
    maxDiscountAmount: restaurant.voucherCampaign.voucher.maxDiscountAmount,
    minOrderAmount: restaurant.voucherCampaign.voucher.minOrderAmount,
    validUntil: restaurant.voucherCampaign.voucher.endDate,
    campaignEndAt: restaurant.voucherCampaign.endAt,
    sponsoredLabel: restaurant.voucherCampaign.sponsoredLabel,
    placement: restaurant.voucherCampaign.placement,
  } : null,
  detailUrl: `/restaurants/${restaurant.id}`,
});

const toRestaurantDetail = (restaurant) => ({
  ...toRestaurantCard(restaurant),
  description: restaurant.description || null,
  address: formatAddressText(restaurant.address),
  operatingHours: restaurant.operatingHours || null,
  statusMessage: restaurant.statusMessage || null,
  bookingNotes: restaurant.bookingNotes || null,
  summaryHighlights: restaurant.summaryHighlights || null,
  suitableFor: restaurant.suitableFor || [],
  signatureDishes: restaurant.signatureDishes || [],
  amenities: restaurant.amenities || [],
  policyRules: restaurant.policyRules || [],
  menuUrl: `/restaurants/${restaurant.id}#menu`,
});

const toMenuItemCard = (item) => ({
  id: item.id,
  categoryId: item.categoryId || null,
  categoryName: item.categoryName || null,
  name: item.name,
  description: compactText(item.description, 180),
  price: item.price,
  image: item.image || null,
  isAvailable: item.isAvailable !== false,
  tags: item.tags || [],
});

const TOPIC_KNOWLEDGE_QUERY = Object.freeze({
  booking: 'Chính sách đặt bàn BookEat',
  cancellation: 'Chính sách hủy bàn BookEat',
  deposit: 'Chính sách đặt cọc khi đặt bàn',
  general: 'Chính sách đặt bàn và hỗ trợ BookEat',
});

const toPolicyAnswerFromKnowledge = (topic, knowledgeResult) => {
  const payload = knowledgeResult?.payload;
  if (!payload?.found) return null;

  return {
    type: 'policy_answer',
    version: 1,
    payload: {
      topic,
      answer: payload.answer,
      bullets: [],
      restaurant: null,
      sourceLabel: payload.matchedSources?.[0]?.title || payload.sourceLabel || 'BookEat Knowledge Base',
      matchedSources: payload.matchedSources || [],
      category: payload.category || 'policy',
      updatedAt: payload.updatedAt || null,
      disclaimer: payload.disclaimer || null,
    },
  };
};

const createPublicCustomerTools = ({
  restaurantService = restaurantQueryService,
  menu = menuService,
  policyProvider = getGlobalBookingPolicy,
  knowledgeService = aiKnowledgeService,
} = {}) => ({
  async search_restaurants(args = {}) {
    const query = asStringOrNull(args.query);
    const cuisineType = asStringOrNull(args.cuisineType);
    const city = asStringOrNull(args.city);
    const priceRange = asStringOrNull(args.priceRange);
    const limit = clampInteger(args.limit, 5, 1, 5);

    const data = await restaurantService.searchPublicRestaurants({
      search: query || '',
      cuisineType: cuisineType || '',
      city: city || '',
      priceRange: priceRange || '',
      limit,
      page: 1,
      boostPlacement: 'ai_suggestion',
      sortBy: 'averageRating',
      sortDir: 'desc',
    });

    return {
      type: 'restaurant_list',
      version: 1,
      payload: {
        query,
        filters: { cuisineType, city, priceRange },
        total: data.total || 0,
        returned: data.restaurants?.length || 0,
        restaurants: (data.restaurants || []).slice(0, limit).map(toRestaurantCard),
        sourceLabel: 'BookEat public restaurants',
      },
    };
  },

  async get_restaurant_detail(args = {}) {
    const restaurant = await restaurantService.getPublicRestaurantDetail(args.restaurantId);
    if (!restaurant) {
      throw makeToolError('RESTAURANT_NOT_FOUND', 'Restaurant was not found or is not public.');
    }

    return {
      type: 'restaurant_detail',
      version: 1,
      payload: {
        restaurant: toRestaurantDetail(restaurant),
        sourceLabel: 'BookEat public restaurant detail',
      },
    };
  },

  async get_restaurant_menu(args = {}) {
    const restaurant = await restaurantService.getPublicRestaurantDetail(args.restaurantId);
    if (!restaurant) {
      throw makeToolError('RESTAURANT_NOT_FOUND', 'Restaurant was not found or is not public.');
    }

    const query = asStringOrNull(args.query);
    const categoryId = asStringOrNull(args.categoryId);
    const maxPrice = asNumberOrNull(args.maxPrice);
    const limit = clampInteger(args.limit, 10, 1, 10);
    const menuResult = await menu.getPublicMenu(args.restaurantId, {
      ...(query ? { search: query } : {}),
      ...(categoryId ? { categoryId } : {}),
    });

    const allItems = menuResult.items || [];
    const filteredItems = maxPrice === null
      ? allItems
      : allItems.filter((item) => Number(item.price) <= maxPrice);

    return {
      type: 'menu_list',
      version: 1,
      payload: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          detailUrl: `/restaurants/${restaurant.id}`,
          menuUrl: `/restaurants/${restaurant.id}#menu`,
        },
        filters: { query, categoryId, maxPrice },
        total: filteredItems.length,
        returned: Math.min(filteredItems.length, limit),
        items: filteredItems.slice(0, limit).map(toMenuItemCard),
        categories: (menuResult.categories || []).map((category) => ({
          id: category.id,
          name: category.name,
          description: compactText(category.description, 140),
        })),
        sourceLabel: 'BookEat public menu',
      },
    };
  },

  async get_booking_policy(args = {}, context = {}) {
    const restaurantId = asStringOrNull(args.restaurantId);
    const topic = asStringOrNull(args.topic) || 'general';

    if (restaurantId) {
      const restaurantPolicy = await restaurantService.getPublicRestaurantPolicyRules(restaurantId);
      if (!restaurantPolicy) {
        throw makeToolError('RESTAURANT_NOT_FOUND', 'Restaurant was not found or is not public.');
      }

      const bullets = [
        restaurantPolicy.bookingInformation,
        restaurantPolicy.bookingNotes,
        ...(restaurantPolicy.policyRules || []),
      ].map((item) => compactText(item, 220)).filter(Boolean);

      if (bullets.length > 0) {
        return {
          type: 'policy_answer',
          version: 1,
          payload: {
            topic,
            answer: 'Nhà hàng có chính sách công khai trong hồ sơ BookEat.',
            bullets,
            restaurant: restaurantPolicy.restaurant,
            sourceLabel: `Chính sách công khai của ${restaurantPolicy.restaurant.name}`,
          },
        };
      }
    }

    try {
      const knowledgeResult = await knowledgeService.searchKnowledge({
        query: TOPIC_KNOWLEDGE_QUERY[topic] || TOPIC_KNOWLEDGE_QUERY.general,
        category: 'policy',
        limit: 2,
        actorRole: context.actor?.role || context.user?.role || 'guest',
      });
      const policyAnswer = toPolicyAnswerFromKnowledge(topic, knowledgeResult);
      if (policyAnswer) return policyAnswer;
    } catch (error) {
      console.warn(`[AI Knowledge] policy fallback topic=${topic} code=${error.code || error.message}`);
    }

    const policy = policyProvider(topic);
    if (!policy) {
      throw makeToolError('POLICY_NOT_FOUND', 'No public policy source was found.');
    }

    return {
      type: 'policy_answer',
      version: 1,
      payload: {
        topic: policy.topic,
        answer: policy.answer,
        bullets: policy.bullets || [],
        restaurant: null,
        sourceLabel: policy.sourceLabel,
      },
    };
  },
});

module.exports = {
  createPublicCustomerTools,
  makeToolError,
};
