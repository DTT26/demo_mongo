'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const RestaurantTable = require('../models/RestaurantTable');
const RestaurantService = require('../models/RestaurantService');
const Waitlist = require('../models/Waitlist');
const WaitlistDish = require('../models/WaitlistDish');
const WaitlistService = require('../models/WaitlistService');
const WaitlistTable = require('../models/WaitlistTable');
const bookingService = require('./booking.service');
const { assertOwnerCanAccessRestaurant, isRestaurantOwnedBy } = require('../utils/restaurant-permission');

const WAITLIST_CONSTANTS = {
  DEFAULT_MAX_WAIT_MINUTES: 45,
  MIN_WAIT_MINUTES: 5,
  MAX_WAIT_MINUTES: 240,
  DUPLICATE_WINDOW_HOURS: 2,
  EXPIRING_SOON_MINUTES: 10,
};

const createError = (message, status = 400, errors = null) => {
  const error = new Error(message);
  error.status = status;
  if (errors) error.errors = errors;
  return error;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const getEntryId = (entry, ...keys) => {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  for (const key of keys) {
    if (entry[key]) return entry[key];
  }
  return entry.id || null;
};

const getQuantity = (entry) => {
  const quantity = Number(entry?.quantity || 1);
  return Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 99) : 1;
};

const normalizeDate = (dateInput) => bookingService.normalizeDate(dateInput);

const combineDateAndTime = (dateInput, timeString) => bookingService.combineDateAndTime(dateInput, timeString);

const clampWaitMinutes = (value) => {
  const minutes = Number(value || WAITLIST_CONSTANTS.DEFAULT_MAX_WAIT_MINUTES);
  if (!Number.isFinite(minutes)) return WAITLIST_CONSTANTS.DEFAULT_MAX_WAIT_MINUTES;
  return Math.min(
    WAITLIST_CONSTANTS.MAX_WAIT_MINUTES,
    Math.max(WAITLIST_CONSTANTS.MIN_WAIT_MINUTES, minutes)
  );
};

const calculateMaxWaitUntil = (createdAt, maxWaitMinutes) => (
  new Date(new Date(createdAt).getTime() + clampWaitMinutes(maxWaitMinutes) * 60 * 1000)
);

const calculateEstimatedWaitMinutes = async (restaurantId, numberOfGuests) => {
  const pendingCount = await Waitlist.countDocuments({ restaurantId, status: 'pending' });
  const guestPenalty = Math.max(0, Number(numberOfGuests || 0) - 4) * 3;
  return Math.min(120, 10 + pendingCount * 5 + guestPenalty);
};

const calculateQueuePosition = async (restaurantId, waitlistId) => {
  const ordered = await Waitlist.find({ restaurantId, status: 'pending' })
    .select('_id')
    .sort({ priorityNumber: -1, createdAt: 1 })
    .lean();
  const index = ordered.findIndex((item) => item._id.toString() === waitlistId.toString());
  return index >= 0 ? index + 1 : null;
};

const addStatusHistory = (waitlist, status, changedBy, note = null) => {
  waitlist.statusHistory.push({
    status,
    changedBy: changedBy || null,
    note,
    changedAt: new Date(),
  });
};

const getWaitlistChildren = async (waitlistId) => {
  const [tables, dishes, services] = await Promise.all([
    WaitlistTable.find({ waitlistId }).lean(),
    WaitlistDish.find({ waitlistId }).lean(),
    WaitlistService.find({ waitlistId }).lean(),
  ]);

  return {
    tables: tables.map((item) => ({
      id: item._id.toString(),
      tableId: item.tableId,
      tableNumber: item.tableNumberSnapshot,
      capacity: item.capacitySnapshot,
      zone: item.zoneSnapshot,
      tableFee: item.tableFee,
      selectionType: item.selectionType,
      assignedAt: item.assignedAt,
    })),
    dishes: dishes.map((item) => ({
      id: item._id.toString(),
      menuItemId: item.menuItemId,
      name: item.nameSnapshot,
      price: item.priceSnapshot,
      quantity: item.quantity,
      note: item.note,
    })),
    services: services.map((item) => ({
      id: item._id.toString(),
      serviceId: item.serviceId,
      name: item.nameSnapshot,
      price: item.priceSnapshot,
      quantity: item.quantity,
      note: item.note,
    })),
  };
};

const compactRestaurant = (restaurant) => {
  if (!restaurant) return null;
  const doc = restaurant.toObject ? restaurant.toObject() : restaurant;
  return {
    id: doc._id?.toString?.() || doc.id,
    name: doc.name,
    address: doc.address,
    phoneNumber: doc.phoneNumber,
    logo: doc.logo,
    primaryImage: doc.images?.find?.((img) => img.isPrimary)?.url || doc.images?.[0]?.url || null,
  };
};

const compactCustomer = (customer) => {
  if (!customer) return null;
  const doc = customer.toObject ? customer.toObject() : customer;
  return {
    id: doc._id?.toString?.() || doc.id,
    fullName: doc.fullName,
    email: doc.email,
    phoneNumber: doc.phoneNumber,
    avatarUrl: doc.avatarUrl,
  };
};

const isPopulatedRef = (value) => (
  value
  && typeof value === 'object'
  && (typeof value.toObject === 'function' || value.name || value.fullName || value.email || value.address)
);

const serializeWaitlist = async (waitlist, { role = 'customer', includeChildren = true } = {}) => {
  const base = role === 'admin'
    ? waitlist.toAdminJSON()
    : role === 'owner'
      ? waitlist.toOwnerJSON()
      : waitlist.toPublicJSON();

  if (isPopulatedRef(waitlist.restaurantId)) {
    base.restaurant = compactRestaurant(waitlist.restaurantId);
    base.restaurantId = waitlist.restaurantId._id || waitlist.restaurantId.id;
  }

  if (isPopulatedRef(waitlist.customerId)) {
    base.customer = compactCustomer(waitlist.customerId);
    base.customerId = waitlist.customerId._id || waitlist.customerId.id;
  }

  if (includeChildren) {
    Object.assign(base, await getWaitlistChildren(waitlist._id));
  }

  return base;
};

const validateRestaurantForWaitlist = async (restaurantId) => {
  if (!restaurantId || !isValidObjectId(restaurantId)) {
    throw createError('Restaurant ID không hợp lệ', 400);
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) {
    throw createError('Nhà hàng không tồn tại', 404);
  }

  if (restaurant.approvalStatus !== 'approved' || !restaurant.active) {
    throw createError('Nhà hàng hiện chưa hoạt động hoặc chưa được duyệt', 400);
  }

  return restaurant;
};

const validateWaitlistTime = async (preferredDate, preferredTime, restaurant) => {
  const timeValidation = await bookingService.validateBookingTime(preferredDate, preferredTime, restaurant);
  if (!timeValidation.valid) {
    throw createError('Thời gian chờ bàn không hợp lệ', 400, timeValidation.errors);
  }
};

const validateDuplicateActiveWaitlist = async (customerId, restaurantId, preferredDateTime) => {
  const windowMs = WAITLIST_CONSTANTS.DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000;
  const from = new Date(preferredDateTime.getTime() - windowMs);
  const to = new Date(preferredDateTime.getTime() + windowMs);

  const existing = await Waitlist.findOne({
    customerId,
    restaurantId,
    status: 'pending',
    preferredDateTime: { $gte: from, $lte: to },
  }).lean();

  if (existing) {
    throw createError('Bạn đã có một yêu cầu danh sách chờ đang hoạt động cho nhà hàng này.', 409);
  }
};

const validateWaitlistTables = async (restaurantId, tableEntries, numberOfGuests, { requireCapacity = true } = {}) => {
  const tableIds = normalizeArray(tableEntries)
    .map((entry) => getEntryId(entry, 'tableId'))
    .filter(Boolean);

  if (tableIds.length === 0) return [];

  if (tableIds.some((id) => !isValidObjectId(id))) {
    throw createError('Danh sách bàn có ID không hợp lệ', 400);
  }

  const tables = await RestaurantTable.find({
    _id: { $in: tableIds },
    restaurantId,
  });

  if (tables.length !== tableIds.length) {
    throw createError('Một hoặc nhiều bàn không tồn tại trong nhà hàng này', 400);
  }

  const errors = [];
  let totalCapacity = 0;
  for (const table of tables) {
    if (!table.isActive || ['inactive', 'maintenance'].includes(table.status)) {
      errors.push(`Bàn ${table.tableNumber} hiện không khả dụng`);
    }
    totalCapacity += table.capacity;
  }

  if (requireCapacity && totalCapacity < Number(numberOfGuests)) {
    errors.push(`Tổng sức chứa bàn đã chọn (${totalCapacity}) không đủ cho ${numberOfGuests} khách`);
  }

  if (errors.length > 0) {
    throw createError('Lựa chọn bàn không hợp lệ', 400, errors);
  }

  return tables;
};

const validateWaitlistDishes = async (restaurantId, dishEntries) => {
  const normalized = normalizeArray(dishEntries)
    .map((entry) => ({
      menuItemId: getEntryId(entry, 'menuItemId', 'dishId'),
      quantity: getQuantity(entry),
      note: entry?.note || null,
    }))
    .filter((entry) => entry.menuItemId);

  if (normalized.length === 0) return [];

  if (normalized.some((entry) => !isValidObjectId(entry.menuItemId))) {
    throw createError('Danh sách món có ID không hợp lệ', 400);
  }

  const items = await MenuItem.find({
    _id: { $in: normalized.map((entry) => entry.menuItemId) },
    restaurantId,
  });

  if (items.length !== normalized.length) {
    throw createError('Một hoặc nhiều món không thuộc nhà hàng này', 400);
  }

  const itemMap = new Map(items.map((item) => [item._id.toString(), item]));
  const snapshots = [];
  const errors = [];

  for (const entry of normalized) {
    const item = itemMap.get(entry.menuItemId.toString());
    if (!item.isAvailable || item.status !== 'available') {
      errors.push(`Món ${item.name} hiện không khả dụng`);
    }
    snapshots.push({
      menuItemId: item._id,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      quantity: entry.quantity,
      note: entry.note,
    });
  }

  if (errors.length > 0) {
    throw createError('Món chọn trước không hợp lệ', 400, errors);
  }

  return snapshots;
};

const validateWaitlistServices = async (restaurantId, serviceEntries) => {
  const normalized = normalizeArray(serviceEntries)
    .map((entry) => ({
      serviceId: getEntryId(entry, 'serviceId'),
      quantity: getQuantity(entry),
      note: entry?.note || null,
    }))
    .filter((entry) => entry.serviceId);

  if (normalized.length === 0) return [];

  if (normalized.some((entry) => !isValidObjectId(entry.serviceId))) {
    throw createError('Danh sách dịch vụ có ID không hợp lệ', 400);
  }

  const services = await RestaurantService.find({
    _id: { $in: normalized.map((entry) => entry.serviceId) },
    restaurantId,
  });

  if (services.length !== normalized.length) {
    throw createError('Một hoặc nhiều dịch vụ không thuộc nhà hàng này', 400);
  }

  const serviceMap = new Map(services.map((service) => [service._id.toString(), service]));
  const snapshots = [];
  const errors = [];

  for (const entry of normalized) {
    const service = serviceMap.get(entry.serviceId.toString());
    if (!service.isAvailable || service.status !== 'available') {
      errors.push(`Dịch vụ ${service.name} hiện không khả dụng`);
    }
    snapshots.push({
      serviceId: service._id,
      nameSnapshot: service.name,
      priceSnapshot: service.price,
      quantity: entry.quantity,
      note: entry.note,
    });
  }

  if (errors.length > 0) {
    throw createError('Dịch vụ chọn trước không hợp lệ', 400, errors);
  }

  return snapshots;
};

const createWaitlist = async (customerId, payload) => {
  const restaurant = await validateRestaurantForWaitlist(payload.restaurantId);
  await validateWaitlistTime(payload.preferredDate, payload.preferredTime, restaurant);

  const preferredDate = normalizeDate(payload.preferredDate);
  const preferredDateTime = combineDateAndTime(preferredDate, payload.preferredTime);
  const numberOfGuests = Number(payload.numberOfGuests);
  await validateDuplicateActiveWaitlist(customerId, restaurant._id, preferredDateTime);

  const tables = await validateWaitlistTables(restaurant._id, payload.tables || payload.tableIds, numberOfGuests, {
    requireCapacity: normalizeArray(payload.tables || payload.tableIds).length > 0,
  });
  const dishSnapshots = await validateWaitlistDishes(restaurant._id, payload.dishes);
  const serviceSnapshots = await validateWaitlistServices(restaurant._id, payload.services);

  const now = new Date();
  const maxWaitMinutes = clampWaitMinutes(payload.maxWaitMinutes);
  const estimatedWaitMinutes = await calculateEstimatedWaitMinutes(restaurant._id, numberOfGuests);

  const waitlist = await Waitlist.create({
    customerId,
    restaurantId: restaurant._id,
    preferredDate,
    preferredTime: payload.preferredTime,
    preferredDateTime,
    numberOfGuests,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    customerEmail: payload.customerEmail,
    note: payload.note || null,
    maxWaitMinutes,
    maxWaitUntil: calculateMaxWaitUntil(now, maxWaitMinutes),
    estimatedWaitMinutes,
    status: 'pending',
    statusHistory: [{
      status: 'pending',
      changedBy: customerId,
      note: 'Khách hàng tham gia danh sách chờ',
      changedAt: now,
    }],
  });

  await Promise.all([
    tables.length > 0
      ? WaitlistTable.insertMany(tables.map((table) => ({
        waitlistId: waitlist._id,
        restaurantId: restaurant._id,
        tableId: table._id,
        tableNumberSnapshot: table.tableNumber,
        capacitySnapshot: table.capacity,
        zoneSnapshot: table.zone,
        tableFee: table.depositAmount || 0,
        selectionType: 'preferred',
      })))
      : Promise.resolve(),
    dishSnapshots.length > 0
      ? WaitlistDish.insertMany(dishSnapshots.map((item) => ({
        waitlistId: waitlist._id,
        restaurantId: restaurant._id,
        ...item,
      })))
      : Promise.resolve(),
    serviceSnapshots.length > 0
      ? WaitlistService.insertMany(serviceSnapshots.map((item) => ({
        waitlistId: waitlist._id,
        restaurantId: restaurant._id,
        ...item,
      })))
      : Promise.resolve(),
  ]);

  waitlist.queuePositionSnapshot = await calculateQueuePosition(restaurant._id, waitlist._id);
  await waitlist.save();

  await waitlist.populate('restaurantId', 'name address images logo phoneNumber');
  return serializeWaitlist(waitlist, { role: 'customer' });
};

const buildWaitlistQuery = (filters = {}) => {
  const query = {};

  if (filters.restaurantId) query.restaurantId = filters.restaurantId;
  if (filters.status) query.status = filters.status;
  if (filters.preferredDate) query.preferredDate = normalizeDate(filters.preferredDate);

  if (filters.fromDate || filters.toDate) {
    query.preferredDate = {};
    if (filters.fromDate) query.preferredDate.$gte = normalizeDate(filters.fromDate);
    if (filters.toDate) query.preferredDate.$lte = normalizeDate(filters.toDate);
  }

  if (filters.search) {
    query.$or = [
      { customerName: { $regex: filters.search, $options: 'i' } },
      { customerPhone: { $regex: filters.search, $options: 'i' } },
      { customerEmail: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return query;
};

const paginateWaitlists = async (query, { page = 1, limit = 10, role = 'customer', populate = true } = {}) => {
  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 10));
  const skip = (safePage - 1) * safeLimit;

  let findQuery = Waitlist.find(query)
    .sort({ priorityNumber: -1, createdAt: 1 })
    .skip(skip)
    .limit(safeLimit);

  if (populate) {
    findQuery = findQuery
      .populate('restaurantId', 'name address images logo phoneNumber')
      .populate('customerId', 'fullName email phoneNumber avatarUrl');
  }

  const [waitlists, total] = await Promise.all([
    findQuery,
    Waitlist.countDocuments(query),
  ]);

  const items = await Promise.all(waitlists.map((waitlist) => serializeWaitlist(waitlist, {
    role,
    includeChildren: true,
  })));

  return {
    waitlists: items,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};

const getMyWaitlists = async (customerId, filters = {}) => {
  const query = buildWaitlistQuery(filters);
  query.customerId = customerId;
  return paginateWaitlists(query, { page: filters.page, limit: filters.limit, role: 'customer' });
};

const getWaitlistForCustomer = async (waitlistId, customerId) => {
  const waitlist = await Waitlist.findOne({ _id: waitlistId, customerId })
    .populate('restaurantId', 'name address images logo phoneNumber operatingHours')
    .populate('customerId', 'fullName email phoneNumber avatarUrl');
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);
  return serializeWaitlist(waitlist, { role: 'customer' });
};

const updateCustomerWaitlist = async (waitlistId, customerId, data) => {
  const waitlist = await Waitlist.findOne({ _id: waitlistId, customerId });
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);
  if (waitlist.status !== 'pending') {
    throw createError('Chỉ có thể cập nhật yêu cầu đang chờ', 400);
  }

  if (data.note !== undefined) waitlist.note = data.note || null;
  if (data.maxWaitMinutes !== undefined) {
    waitlist.maxWaitMinutes = clampWaitMinutes(data.maxWaitMinutes);
    waitlist.maxWaitUntil = calculateMaxWaitUntil(waitlist.createdAt, waitlist.maxWaitMinutes);
  }
  addStatusHistory(waitlist, waitlist.status, customerId, 'Khách hàng cập nhật danh sách chờ');
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'customer' });
};

const cancelCustomerWaitlist = async (waitlistId, customerId, reason = null) => {
  const waitlist = await Waitlist.findOne({ _id: waitlistId, customerId });
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);
  if (!waitlist.canCancel()) throw createError('Chỉ có thể hủy yêu cầu đang chờ', 400);

  waitlist.status = 'cancelled';
  waitlist.cancelledBy = 'customer';
  waitlist.cancelledAt = new Date();
  waitlist.cancellationReason = reason || 'Khách hàng hủy danh sách chờ';
  addStatusHistory(waitlist, 'cancelled', customerId, waitlist.cancellationReason);
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'customer' });
};

const assertOwnerCanAccessWaitlist = async (ownerId, waitlistId) => {
  const waitlist = await Waitlist.findById(waitlistId);
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);

  const restaurant = await Restaurant.findById(waitlist.restaurantId);
  if (!restaurant) throw createError('Không tìm thấy nhà hàng', 404);
  if (!isRestaurantOwnedBy(restaurant, ownerId)) {
    throw createError('Bạn không có quyền truy cập danh sách chờ của nhà hàng này', 403);
  }

  return { waitlist, restaurant };
};

const getOwnerWaitlists = async (ownerId, filters = {}) => {
  let restaurantIds = [];
  if (filters.restaurantId) {
    const restaurant = await assertOwnerCanAccessRestaurant(ownerId, filters.restaurantId);
    restaurantIds = [restaurant._id];
  } else {
    const restaurants = await Restaurant.find({ ownerId }).select('_id').lean();
    restaurantIds = restaurants.map((restaurant) => restaurant._id);
  }

  const query = buildWaitlistQuery(filters);
  query.restaurantId = { $in: restaurantIds };
  return paginateWaitlists(query, { page: filters.page, limit: filters.limit, role: 'owner' });
};

const getOwnerWaitlistDetail = async (ownerId, waitlistId) => {
  await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  const waitlist = await Waitlist.findById(waitlistId)
    .populate('restaurantId', 'name address images logo phoneNumber operatingHours')
    .populate('customerId', 'fullName email phoneNumber avatarUrl');
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const getWaitlistStats = async ({ restaurantIds, restaurantId } = {}) => {
  const match = {};
  if (restaurantId) match.restaurantId = new mongoose.Types.ObjectId(restaurantId.toString());
  if (restaurantIds?.length) {
    match.restaurantId = { $in: restaurantIds.map((id) => new mongoose.Types.ObjectId(id.toString())) };
  }

  const counts = await Waitlist.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const expiringSoonBefore = new Date(Date.now() + WAITLIST_CONSTANTS.EXPIRING_SOON_MINUTES * 60 * 1000);
  const expiringSoon = await Waitlist.countDocuments({
    ...match,
    status: 'pending',
    maxWaitUntil: { $lte: expiringSoonBefore, $gt: new Date() },
  });

  const stats = {
    total: 0,
    pending: 0,
    confirmed: 0,
    cancelled: 0,
    expired: 0,
    expiringSoon,
  };

  counts.forEach((item) => {
    if (stats[item._id] !== undefined) stats[item._id] = item.count;
    stats.total += item.count;
  });
  stats.conversionRate = stats.total > 0 ? Number(((stats.confirmed / stats.total) * 100).toFixed(1)) : 0;
  return stats;
};

const getOwnerStats = async (ownerId, filters = {}) => {
  if (filters.restaurantId) {
    const restaurant = await assertOwnerCanAccessRestaurant(ownerId, filters.restaurantId);
    return getWaitlistStats({ restaurantId: restaurant._id });
  }
  const restaurants = await Restaurant.find({ ownerId }).select('_id').lean();
  return getWaitlistStats({ restaurantIds: restaurants.map((restaurant) => restaurant._id) });
};

const getAvailableTablesForWaitlist = async (ownerId, waitlistId) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  const tables = await bookingService.getAvailableTables(
    waitlist.restaurantId,
    waitlist.preferredDate,
    waitlist.preferredTime
  );
  return tables
    .filter((table) => table.capacity >= waitlist.numberOfGuests || waitlist.numberOfGuests > 4)
    .map((table) => ({
      id: table._id.toString(),
      tableNumber: table.tableNumber,
      capacity: table.capacity,
      zone: table.zone,
      status: table.status,
      depositAmount: table.depositAmount,
    }));
};

const validateAssignTablesForConfirm = async (waitlist, tableIds) => {
  const tables = await validateWaitlistTables(waitlist.restaurantId, tableIds, waitlist.numberOfGuests, {
    requireCapacity: true,
  });

  for (const table of tables) {
    const { hasConflict } = await bookingService.checkTimeConflict(
      waitlist.restaurantId,
      table.tableNumber,
      waitlist.preferredDate,
      waitlist.preferredTime
    );
    if (hasConflict) {
      throw createError(`Bàn ${table.tableNumber} vừa bị trùng giờ, vui lòng chọn bàn khác`, 409);
    }
  }

  return tables;
};

const upsertAssignedTables = async (waitlist, tables, userId) => {
  await WaitlistTable.deleteMany({ waitlistId: waitlist._id, selectionType: 'assigned' });
  if (tables.length === 0) return;
  await WaitlistTable.insertMany(tables.map((table) => ({
    waitlistId: waitlist._id,
    restaurantId: waitlist.restaurantId,
    tableId: table._id,
    tableNumberSnapshot: table.tableNumber,
    capacitySnapshot: table.capacity,
    zoneSnapshot: table.zone,
    tableFee: table.depositAmount || 0,
    selectionType: 'assigned',
    assignedAt: new Date(),
    assignedBy: userId,
  })));
};

const assignTables = async (ownerId, waitlistId, tableIds) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  if (waitlist.status !== 'pending') throw createError('Chỉ có thể gán bàn cho yêu cầu đang chờ', 400);
  const tables = await validateAssignTablesForConfirm(waitlist, tableIds);
  await upsertAssignedTables(waitlist, tables, ownerId);
  addStatusHistory(waitlist, 'pending', ownerId, `Nhà hàng gán bàn: ${tables.map((t) => t.tableNumber).join(', ')}`);
  await waitlist.save();
  return getOwnerWaitlistDetail(ownerId, waitlistId);
};

const confirmWaitlist = async (ownerId, waitlistId, tableIds, ownerNote = null) => {
  const { waitlist, restaurant } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  if (!waitlist.canConfirm()) {
    throw createError('Yêu cầu này không còn đủ điều kiện xác nhận', 400);
  }

  const tables = await validateAssignTablesForConfirm(waitlist, tableIds);
  const tableNumbers = tables.map((table) => table.tableNumber);

  const booking = await Booking.create({
    customerId: waitlist.customerId,
    restaurantId: waitlist.restaurantId,
    bookingDate: waitlist.preferredDate,
    bookingTime: waitlist.preferredTime,
    numberOfGuests: waitlist.numberOfGuests,
    customerName: waitlist.customerName,
    customerPhone: waitlist.customerPhone,
    customerEmail: waitlist.customerEmail,
    specialRequests: waitlist.note,
    status: 'confirmed',
    confirmedAt: new Date(),
    confirmedBy: ownerId,
    sourceWaitlistId: waitlist._id,
    tableNumbers,
    statusHistory: [{
      status: 'confirmed',
      changedBy: ownerId,
      note: ownerNote || 'Booking được tạo từ danh sách chờ',
      changedAt: new Date(),
    }],
  });

  waitlist.status = 'confirmed';
  waitlist.confirmedAt = new Date();
  waitlist.confirmedBy = ownerId;
  waitlist.convertedBookingId = booking._id;
  addStatusHistory(waitlist, 'confirmed', ownerId, ownerNote || `Đã xếp bàn ${tableNumbers.join(', ')}`);
  await waitlist.save();
  await upsertAssignedTables(waitlist, tables, ownerId);

  restaurant.stats.totalBookings += 1;
  await restaurant.save();

  return {
    waitlist: await serializeWaitlist(waitlist, { role: 'owner' }),
    booking: booking.toAdminJSON(),
  };
};

const cancelOwnerWaitlist = async (ownerId, waitlistId, reason) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  if (!reason || !reason.trim()) throw createError('Vui lòng nhập lý do hủy danh sách chờ', 400);
  if (waitlist.status !== 'pending') throw createError('Chỉ có thể hủy yêu cầu đang chờ', 400);

  waitlist.status = 'cancelled';
  waitlist.cancelledBy = 'restaurant';
  waitlist.cancelledAt = new Date();
  waitlist.cancellationReason = reason.trim();
  addStatusHistory(waitlist, 'cancelled', ownerId, `Nhà hàng hủy: ${reason.trim()}`);
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const expireOwnerWaitlist = async (ownerId, waitlistId, reason = 'Nhà hàng đánh dấu hết hạn') => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  if (waitlist.status !== 'pending') throw createError('Chỉ có thể hết hạn yêu cầu đang chờ', 400);

  waitlist.status = 'expired';
  waitlist.expiredAt = new Date();
  waitlist.expireReason = reason;
  addStatusHistory(waitlist, 'expired', ownerId, reason);
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const updatePriority = async (ownerId, waitlistId, priorityNumber, reason = null) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  waitlist.priorityNumber = Number(priorityNumber || 0);
  addStatusHistory(waitlist, waitlist.status, ownerId, reason || `Cập nhật ưu tiên thành ${waitlist.priorityNumber}`);
  await waitlist.save();
  waitlist.queuePositionSnapshot = await calculateQueuePosition(waitlist.restaurantId, waitlist._id);
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const addInternalNote = async (ownerId, waitlistId, content) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  if (!content || !content.trim()) throw createError('Nội dung ghi chú là bắt buộc', 400);
  waitlist.internalNotes.push({
    content: content.trim(),
    createdBy: ownerId,
    createdAt: new Date(),
  });
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const deleteInternalNote = async (ownerId, waitlistId, noteId) => {
  const { waitlist } = await assertOwnerCanAccessWaitlist(ownerId, waitlistId);
  waitlist.internalNotes = waitlist.internalNotes.filter((note) => note._id.toString() !== noteId.toString());
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'owner' });
};

const getAdminWaitlists = async (filters = {}) => (
  paginateWaitlists(buildWaitlistQuery(filters), {
    page: filters.page,
    limit: filters.limit,
    role: 'admin',
  })
);

const getAdminWaitlistDetail = async (waitlistId) => {
  const waitlist = await Waitlist.findById(waitlistId)
    .populate('restaurantId', 'name address images logo phoneNumber ownerId')
    .populate('customerId', 'fullName email phoneNumber avatarUrl');
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);
  return serializeWaitlist(waitlist, { role: 'admin' });
};

const updateAdminWaitlistStatus = async (adminId, waitlistId, status, note = null) => {
  const waitlist = await Waitlist.findById(waitlistId);
  if (!waitlist) throw createError('Không tìm thấy yêu cầu danh sách chờ', 404);
  if (!['cancelled', 'expired'].includes(status)) {
    throw createError('Admin chỉ được hủy hoặc đánh dấu hết hạn từ màn hình này', 400);
  }
  if (waitlist.status !== 'pending') {
    throw createError('Chỉ có thể cập nhật yêu cầu đang chờ', 400);
  }

  waitlist.status = status;
  if (status === 'cancelled') {
    waitlist.cancelledBy = 'admin';
    waitlist.cancelledAt = new Date();
    waitlist.cancellationReason = note || 'Admin hủy danh sách chờ';
  } else {
    waitlist.expiredAt = new Date();
    waitlist.expireReason = note || 'Admin đánh dấu hết hạn';
  }
  addStatusHistory(waitlist, status, adminId, note || `Admin cập nhật ${status}`);
  await waitlist.save();
  return serializeWaitlist(waitlist, { role: 'admin' });
};

const expireOverdueWaitlists = async () => {
  const overdue = await Waitlist.find({
    status: 'pending',
    maxWaitUntil: { $lte: new Date() },
  }).limit(100);

  const expired = [];
  for (const waitlist of overdue) {
    waitlist.status = 'expired';
    waitlist.expiredAt = new Date();
    waitlist.expireReason = 'Quá thời gian chờ tối đa';
    addStatusHistory(waitlist, 'expired', null, waitlist.expireReason);
    await waitlist.save();
    expired.push(waitlist);
  }

  return expired;
};

module.exports = {
  WAITLIST_CONSTANTS,
  normalizeDate,
  combineDateAndTime,
  calculateMaxWaitUntil,
  calculateEstimatedWaitMinutes,
  calculateQueuePosition,
  serializeWaitlist,
  validateWaitlistTime,
  validateDuplicateActiveWaitlist,
  validateWaitlistTables,
  validateWaitlistDishes,
  validateWaitlistServices,
  createWaitlist,
  getMyWaitlists,
  getWaitlistForCustomer,
  updateCustomerWaitlist,
  cancelCustomerWaitlist,
  getOwnerWaitlists,
  getOwnerWaitlistDetail,
  getOwnerStats,
  getAvailableTablesForWaitlist,
  assignTables,
  confirmWaitlist,
  cancelOwnerWaitlist,
  expireOwnerWaitlist,
  updatePriority,
  addInternalNote,
  deleteInternalNote,
  getAdminWaitlists,
  getAdminWaitlistDetail,
  getAdminStats: () => getWaitlistStats(),
  updateAdminWaitlistStatus,
  expireOverdueWaitlists,
};
