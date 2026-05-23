'use strict';

const RestaurantTable = require('../models/RestaurantTable');
const Restaurant = require('../models/Restaurant');

exports.getTables = async (restaurantId, query = {}) => {
  const filter = { restaurantId };

  if (query.status) filter.status = query.status;
  if (query.zone) filter.zone = { $regex: query.zone, $options: 'i' };
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
  const skip = (page - 1) * limit;

  const [tables, total] = await Promise.all([
    RestaurantTable.find(filter)
      .sort({ tableNumber: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RestaurantTable.countDocuments(filter),
  ]);

  const formatted = tables.map((t) => ({
    id: t._id.toString(),
    restaurantId: t.restaurantId,
    tableNumber: t.tableNumber,
    capacity: t.capacity,
    zone: t.zone,
    status: t.status,
    depositAmount: t.depositAmount,
    note: t.note,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  return { tables: formatted, total, page, totalPages: Math.ceil(total / limit) };
};

exports.createTable = async (restaurantId, data) => {
  // Check trùng tableNumber
  const existing = await RestaurantTable.findOne({
    restaurantId,
    tableNumber: data.tableNumber,
  });
  if (existing) {
    const err = new Error('Số bàn đã tồn tại trong nhà hàng này');
    err.status = 409;
    throw err;
  }

  const table = await RestaurantTable.create({
    restaurantId,
    tableNumber: data.tableNumber,
    capacity: data.capacity,
    zone: data.zone || null,
    status: data.status || 'available',
    depositAmount: data.depositAmount || 0,
    note: data.note || null,
    isActive: data.isActive !== false,
  });

  // Cập nhật hasTableLayout
  await Restaurant.findByIdAndUpdate(restaurantId, { hasTableLayout: true });

  return table;
};

exports.updateTable = async (tableId, data) => {
  const table = await RestaurantTable.findById(tableId);
  if (!table) {
    const err = new Error('Bàn không tồn tại');
    err.status = 404;
    throw err;
  }

  // Check trùng tableNumber nếu đổi
  if (data.tableNumber && data.tableNumber !== table.tableNumber) {
    const existing = await RestaurantTable.findOne({
      restaurantId: table.restaurantId,
      tableNumber: data.tableNumber,
      _id: { $ne: tableId },
    });
    if (existing) {
      const err = new Error('Số bàn đã tồn tại trong nhà hàng này');
      err.status = 409;
      throw err;
    }
  }

  const fields = ['tableNumber', 'capacity', 'zone', 'status', 'depositAmount', 'note', 'isActive'];
  fields.forEach((f) => {
    if (data[f] !== undefined) table[f] = data[f];
  });

  await table.save();
  return table;
};

exports.deleteTable = async (tableId) => {
  const table = await RestaurantTable.findById(tableId);
  if (!table) {
    const err = new Error('Bàn không tồn tại');
    err.status = 404;
    throw err;
  }

  const restaurantId = table.restaurantId;
  await RestaurantTable.findByIdAndDelete(tableId);

  // Kiểm tra nếu không còn bàn nào
  const remaining = await RestaurantTable.countDocuments({ restaurantId });
  if (remaining === 0) {
    await Restaurant.findByIdAndUpdate(restaurantId, { hasTableLayout: false });
  }

  return table;
};

exports.updateTableStatus = async (tableId, status) => {
  const table = await RestaurantTable.findById(tableId);
  if (!table) {
    const err = new Error('Bàn không tồn tại');
    err.status = 404;
    throw err;
  }

  table.status = status;
  await table.save();
  return table;
};

exports.getPublicTables = async (restaurantId, query = {}) => {
  const filter = {
    restaurantId,
    isActive: true,
  };

  if (query.status) filter.status = query.status;
  if (query.zone) filter.zone = { $regex: query.zone, $options: 'i' };

  const tables = await RestaurantTable.find(filter)
    .sort({ tableNumber: 1 })
    .lean();

  return tables.map((t) => ({
    id: t._id.toString(),
    tableNumber: t.tableNumber,
    capacity: t.capacity,
    zone: t.zone,
    status: t.status,
    depositAmount: t.depositAmount,
  }));
};
