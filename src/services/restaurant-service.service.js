'use strict';

const Restaurant = require('../models/Restaurant');
const RestaurantService = require('../models/RestaurantService');
const { assertOwnerCanAccessRestaurant } = require('../utils/restaurant-permission');

const createError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const formatService = (service, { admin = false } = {}) => {
  if (!service) return null;
  if (service.toPublicJSON) {
    return admin ? service.toAdminJSON() : service.toPublicJSON();
  }
  return {
    id: service._id.toString(),
    restaurantId: service.restaurantId,
    name: service.name,
    category: service.category,
    description: service.description,
    price: service.price,
    status: service.status,
    isAvailable: service.isAvailable,
    displayOrder: service.displayOrder,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
};

const getPublicServices = async (restaurantId, query = {}) => {
  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant || restaurant.approvalStatus !== 'approved' || !restaurant.active) {
    throw createError('Nhà hàng không tồn tại', 404);
  }

  const filter = {
    restaurantId,
    status: { $ne: 'hidden' },
  };

  if (query.availableOnly === 'true') {
    filter.status = 'available';
    filter.isAvailable = true;
  }

  if (query.category) filter.category = query.category;
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const services = await RestaurantService.find(filter).sort({ displayOrder: 1, createdAt: -1 });
  return services.map((service) => formatService(service));
};

const getOwnerServices = async (ownerId, restaurantId, query = {}) => {
  await assertOwnerCanAccessRestaurant(ownerId, restaurantId);
  const filter = { restaurantId };
  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const services = await RestaurantService.find(filter).sort({ displayOrder: 1, createdAt: -1 });
  return services.map((service) => formatService(service, { admin: true }));
};

const createService = async (ownerId, restaurantId, data) => {
  await assertOwnerCanAccessRestaurant(ownerId, restaurantId);
  const service = await RestaurantService.create({
    restaurantId,
    name: data.name,
    category: data.category || null,
    description: data.description || null,
    price: Number(data.price || 0),
    status: data.status || 'available',
    isAvailable: data.isAvailable !== false,
    displayOrder: Number(data.displayOrder || 0),
  });
  return formatService(service, { admin: true });
};

const updateService = async (ownerId, serviceId, data) => {
  const service = await RestaurantService.findById(serviceId);
  if (!service) throw createError('Dịch vụ không tồn tại', 404);
  await assertOwnerCanAccessRestaurant(ownerId, service.restaurantId);

  ['name', 'category', 'description', 'price', 'status', 'isAvailable', 'displayOrder'].forEach((field) => {
    if (data[field] !== undefined) service[field] = data[field];
  });
  await service.save();
  return formatService(service, { admin: true });
};

const deleteService = async (ownerId, serviceId) => {
  const service = await RestaurantService.findById(serviceId);
  if (!service) throw createError('Dịch vụ không tồn tại', 404);
  await assertOwnerCanAccessRestaurant(ownerId, service.restaurantId);
  service.status = 'hidden';
  service.isAvailable = false;
  await service.save();
  return formatService(service, { admin: true });
};

const toggleAvailability = async (ownerId, serviceId, isAvailable) => {
  const service = await RestaurantService.findById(serviceId);
  if (!service) throw createError('Dịch vụ không tồn tại', 404);
  await assertOwnerCanAccessRestaurant(ownerId, service.restaurantId);
  service.isAvailable = Boolean(isAvailable);
  service.status = service.isAvailable ? 'available' : 'unavailable';
  await service.save();
  return formatService(service, { admin: true });
};

module.exports = {
  getPublicServices,
  getOwnerServices,
  createService,
  updateService,
  deleteService,
  toggleAvailability,
};
