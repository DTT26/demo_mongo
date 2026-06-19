'use strict';

const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const { normalizeRestaurantImages } = require('../utils/restaurant-images');

const PUBLIC_RESTAURANT_FILTER = Object.freeze({
  approvalStatus: 'approved',
  active: true,
  deletedAt: null,
  hasMenu: true,
  hasTableLayout: true,
});

const PUBLIC_ACTIVE_RESTAURANT_FILTER = Object.freeze({
  approvalStatus: 'approved',
  active: true,
  deletedAt: null,
});

const SORT_FIELD_MAP = Object.freeze({
  restaurantName: 'name',
  name: 'name',
  averageRating: 'stats.averageRating',
  averagePrice: 'averagePrice',
  totalBookings: 'stats.totalBookings',
  createdAt: 'createdAt',
});

const VIETNAMESE_CHAR_CLASSES = Object.freeze({
  a: 'aàáảãạăằắẳẵặâầấẩẫậ',
  d: 'dđ',
  e: 'eèéẻẽẹêềếểễệ',
  i: 'iìíỉĩị',
  o: 'oòóỏõọôồốổỗộơờớởỡợ',
  u: 'uùúủũụưừứửữự',
  y: 'yỳýỷỹỵ',
});

const RESTAURANT_SEARCH_STOPWORDS = new Set([
  'am',
  'an',
  'ban',
  'can',
  'cho',
  'co',
  'con',
  'dat',
  'di',
  'duoc',
  'dung',
  'giup',
  'gio',
  'hang',
  'khoang',
  'khong',
  'mai',
  'minh',
  'mon',
  'muon',
  'nao',
  'neu',
  'nha',
  'nguoi',
  'o',
  'quan',
  'restaurant',
  'tao',
  'thi',
  'tim',
  'toi',
  'truoc',
  'tui',
  'voucher',
  'xem',
]);

const toPositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const formatAddressText = (address) => {
  if (!address) return null;
  if (typeof address === 'string') return address;
  return address.fullAddress
    || [address.street, address.ward, address.district, address.city].filter(Boolean).join(', ')
    || null;
};

const normalizeVietnameseSearchText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase();

const escapeRegexChar = (char) => char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

const makeVietnameseInsensitivePattern = (value = '') => normalizeVietnameseSearchText(value)
  .replace(/\s+/g, ' ')
  .trim()
  .split('')
  .map((char) => {
    if (/\s/.test(char)) return '\\s+';
    const charClass = VIETNAMESE_CHAR_CLASSES[char];
    return charClass ? `[${charClass}]` : escapeRegexChar(char);
  })
  .join('');

const buildVietnameseInsensitiveRegex = (value) => ({
  $regex: makeVietnameseInsensitivePattern(value),
  $options: 'i',
});

const tokenizeRestaurantSearch = (value = '') => normalizeVietnameseSearchText(value)
  .split(/[^a-z0-9]+/i)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2 && !RESTAURANT_SEARCH_STOPWORDS.has(token))
  .slice(0, 6);

const buildSearchClause = (token) => {
  const regex = buildVietnameseInsensitiveRegex(token);
  return {
    $or: [
      { name: regex },
      { description: regex },
      { cuisineTypes: regex },
      { 'address.fullAddress': regex },
      { 'address.city': regex },
      { 'address.district': regex },
    ],
  };
};

const normalizeRestaurantQuery = (query = {}) => ({
  page: toPositiveInt(query.page, 1, 10000),
  limit: toPositiveInt(query.limit, 20, 100),
  search: String(query.search || query.query || '').trim(),
  cuisineType: String(query.cuisineType || '').trim(),
  priceRange: String(query.priceRange || '').trim(),
  city: String(query.city || '').trim(),
  featured: query.featured,
  sortBy: String(query.sortBy || 'name').trim(),
  sortDir: query.sortDir === 'desc' ? 'desc' : 'asc',
});

const buildPublicRestaurantFilter = (query = {}) => {
  const normalized = normalizeRestaurantQuery(query);
  const filter = { ...PUBLIC_RESTAURANT_FILTER };
  const andClauses = [];

  if (normalized.cuisineType) {
    andClauses.push(buildSearchClause(normalized.cuisineType));
  }

  if (normalized.city) {
    const cityRegex = buildVietnameseInsensitiveRegex(normalized.city);
    andClauses.push({
      $or: [
        { 'address.city': cityRegex },
        { 'address.fullAddress': cityRegex },
      ],
    });
  }

  if (normalized.featured !== undefined) {
    filter.featured = normalized.featured === true || normalized.featured === 'true';
  }

  if (normalized.priceRange === 'low') {
    filter.averagePrice = { $lt: 200000 };
  } else if (normalized.priceRange === 'medium') {
    filter.averagePrice = { $gte: 200000, $lte: 500000 };
  } else if (normalized.priceRange === 'high') {
    filter.averagePrice = { $gt: 500000 };
  }

  if (normalized.search) {
    const tokens = tokenizeRestaurantSearch(normalized.search);
    const searchClauses = tokens.length
      ? tokens.map(buildSearchClause)
      : [buildSearchClause(normalized.search)];

    andClauses.push(...searchClauses);
  }

  if (andClauses.length) {
    filter.$and = andClauses;
  }

  return filter;
};

const getSortObject = (query = {}) => {
  const normalized = normalizeRestaurantQuery(query);
  const sortField = SORT_FIELD_MAP[normalized.sortBy] || 'name';
  const sortDir = normalized.sortDir === 'desc' ? -1 : 1;
  return { [sortField]: sortDir };
};

const formatPublicRestaurantSummary = (restaurant) => {
  const imageData = normalizeRestaurantImages(restaurant);
  return {
  id: restaurant._id.toString(),
  name: restaurant.name,
  description: restaurant.description,
  phoneNumber: restaurant.phoneNumber,
  email: restaurant.email,
  address: formatAddressText(restaurant.address),
  logo: imageData.logo,
  coverImage: imageData.coverImage,
  coverImageUrl: imageData.coverImageUrl,
  galleryImages: imageData.galleryImages,
  primaryImage: imageData.primaryImage,
  averagePrice: restaurant.averagePrice,
  priceRangeMin: restaurant.priceRangeMin,
  priceRangeMax: restaurant.priceRangeMax,
  priceRange: restaurant.priceRange,
  cuisineType: restaurant.cuisineTypes?.[0] || 'Đang cập nhật',
  cuisineTypes: restaurant.cuisineTypes || [],
  averageRating: restaurant.stats?.averageRating || 0,
  reviewCount: restaurant.stats?.totalReviews || 0,
  stats: restaurant.stats,
  featured: restaurant.featured,
  createdAt: restaurant.createdAt,
  };
};

const formatPublicRestaurantDetail = (restaurant) => {
  const imageData = normalizeRestaurantImages(restaurant);
  return {
  id: restaurant._id.toString(),
  name: restaurant.name,
  description: restaurant.description,
  phoneNumber: restaurant.phoneNumber,
  email: restaurant.email,
  websiteUrl: restaurant.websiteUrl,
  contactHotline: restaurant.contactHotline,
  address: restaurant.address,
  coordinates: restaurant.coordinates,
  cuisineTypes: restaurant.cuisineTypes,
  cuisineType: restaurant.cuisineTypes?.[0] || null,
  priceRange: restaurant.priceRange,
  capacity: restaurant.capacity,
  operatingHours: restaurant.operatingHours,
  logo: imageData.logo,
  coverImage: imageData.coverImage,
  coverImageUrl: imageData.coverImageUrl,
  galleryImages: imageData.galleryImages,
  primaryImage: imageData.primaryImage,
  images: restaurant.images,
  averagePrice: restaurant.averagePrice,
  priceRangeMin: restaurant.priceRangeMin,
  priceRangeMax: restaurant.priceRangeMax,
  statusMessage: restaurant.statusMessage,
  bookingNotes: restaurant.bookingNotes,
  bookingInformation: restaurant.bookingInformation,
  summaryHighlights: restaurant.summaryHighlights,
  suitableFor: restaurant.suitableFor,
  signatureDishes: restaurant.signatureDishes,
  amenities: restaurant.amenities,
  policyRules: restaurant.policyRules,
  stats: restaurant.stats,
  averageRating: restaurant.stats?.averageRating || 0,
  reviewCount: restaurant.stats?.totalReviews || 0,
  featured: restaurant.featured,
  createdAt: restaurant.createdAt,
  };
};

const searchPublicRestaurants = async (query = {}) => {
  const normalized = normalizeRestaurantQuery(query);
  const skip = (normalized.page - 1) * normalized.limit;
  const filter = buildPublicRestaurantFilter(normalized);
  const sort = getSortObject(normalized);

  const [restaurants, total] = await Promise.all([
    Restaurant.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(normalized.limit)
      .lean(),
    Restaurant.countDocuments(filter),
  ]);

  return {
    restaurants: restaurants.map(formatPublicRestaurantSummary),
    total,
    page: normalized.page,
    totalPages: Math.ceil(total / normalized.limit),
  };
};

const getPublicRestaurantDetail = async (restaurantId) => {
  if (!isValidObjectId(restaurantId)) return null;

  const restaurant = await Restaurant.findOne({
    _id: restaurantId,
    ...PUBLIC_RESTAURANT_FILTER,
  }).lean();

  return restaurant ? formatPublicRestaurantDetail(restaurant) : null;
};

const getPublicRestaurantPolicyRules = async (restaurantId) => {
  const restaurant = await getPublicRestaurantDetail(restaurantId);
  if (!restaurant) return null;

  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
    },
    bookingNotes: restaurant.bookingNotes || null,
    bookingInformation: restaurant.bookingInformation || null,
    policyRules: Array.isArray(restaurant.policyRules) ? restaurant.policyRules.filter(Boolean) : [],
  };
};

const getPublicRestaurantOperationalProfile = async (restaurantId) => {
  if (!isValidObjectId(restaurantId)) return null;

  const restaurant = await Restaurant.findOne({
    _id: restaurantId,
    ...PUBLIC_ACTIVE_RESTAURANT_FILTER,
  })
    .select('name address operatingHours hasTableLayout active approvalStatus deletedAt')
    .lean();

  if (!restaurant) return null;

  return {
    id: restaurant._id.toString(),
    name: restaurant.name,
    address: formatAddressText(restaurant.address),
    operatingHours: restaurant.operatingHours || null,
    hasTableLayout: Boolean(restaurant.hasTableLayout),
  };
};

const getPublicCuisineTypes = async () => {
  const cuisineTypes = await Restaurant.distinct('cuisineTypes', PUBLIC_RESTAURANT_FILTER);
  return cuisineTypes.filter(Boolean);
};

module.exports = {
  PUBLIC_RESTAURANT_FILTER,
  PUBLIC_ACTIVE_RESTAURANT_FILTER,
  buildPublicRestaurantFilter,
  buildVietnameseInsensitiveRegex,
  formatPublicRestaurantDetail,
  formatPublicRestaurantSummary,
  getPublicCuisineTypes,
  getPublicRestaurantDetail,
  getPublicRestaurantOperationalProfile,
  getPublicRestaurantPolicyRules,
  isValidObjectId,
  makeVietnameseInsensitivePattern,
  normalizeRestaurantQuery,
  searchPublicRestaurants,
  tokenizeRestaurantSearch,
};
