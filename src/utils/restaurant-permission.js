'use strict';

const Restaurant = require('../models/Restaurant');

const normalizeId = (value) => {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
};

const isRestaurantOwnedBy = (restaurant, ownerId) => {
  if (!restaurant || !restaurant.ownerId || !ownerId) return false;
  return normalizeId(restaurant.ownerId) === normalizeId(ownerId);
};

const createForbiddenError = (message = 'Ban khong co quyen truy cap nha hang nay') => {
  const error = new Error(message);
  error.status = 403;
  return error;
};

const assertOwnerCanAccessRestaurant = async (ownerId, restaurantId) => {
  const restaurant = await Restaurant.findById(restaurantId);

  if (!restaurant) {
    const error = new Error('Khong tim thay nha hang');
    error.status = 404;
    throw error;
  }

  if (!isRestaurantOwnedBy(restaurant, ownerId)) {
    throw createForbiddenError();
  }

  return restaurant;
};

module.exports = {
  normalizeId,
  isRestaurantOwnedBy,
  createForbiddenError,
  assertOwnerCanAccessRestaurant,
};
