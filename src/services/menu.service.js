'use strict';

const MenuItem = require('../models/MenuItem');
const MenuCategory = require('../models/MenuCategory');
const Restaurant = require('../models/Restaurant');

// ═══════════════════════════════════════════════
// CATEGORY SERVICES
// ═══════════════════════════════════════════════

exports.getCategories = async (restaurantId, { activeOnly = false } = {}) => {
  const filter = { restaurantId };
  if (activeOnly) filter.isActive = true;

  const categories = await MenuCategory.find(filter)
    .sort({ displayOrder: 1, createdAt: 1 })
    .lean();

  // Đếm số món trong mỗi category
  const counts = await MenuItem.aggregate([
    { $match: { restaurantId: require('mongoose').Types.ObjectId.createFromHexString(restaurantId.toString()) } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);

  const countMap = {};
  counts.forEach((c) => { countMap[c._id?.toString() || 'uncategorized'] = c.count; });

  return categories.map((cat) => ({
    id: cat._id.toString(),
    restaurantId: cat.restaurantId,
    name: cat.name,
    description: cat.description,
    displayOrder: cat.displayOrder,
    isActive: cat.isActive,
    itemCount: countMap[cat._id.toString()] || 0,
    createdAt: cat.createdAt,
    updatedAt: cat.updatedAt,
  }));
};

exports.createCategory = async (restaurantId, data) => {
  const category = await MenuCategory.create({
    restaurantId,
    name: data.name,
    description: data.description || null,
    displayOrder: data.displayOrder || 0,
    isActive: data.isActive !== false,
  });

  return {
    id: category._id.toString(),
    restaurantId: category.restaurantId,
    name: category.name,
    description: category.description,
    displayOrder: category.displayOrder,
    isActive: category.isActive,
    itemCount: 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
};

exports.updateCategory = async (categoryId, data) => {
  const category = await MenuCategory.findById(categoryId);
  if (!category) {
    const err = new Error('Danh mục không tồn tại');
    err.status = 404;
    throw err;
  }

  if (data.name !== undefined) category.name = data.name;
  if (data.description !== undefined) category.description = data.description;
  if (data.displayOrder !== undefined) category.displayOrder = data.displayOrder;
  if (data.isActive !== undefined) category.isActive = data.isActive;

  await category.save();
  return category;
};

exports.deleteCategory = async (categoryId) => {
  const category = await MenuCategory.findById(categoryId);
  if (!category) {
    const err = new Error('Danh mục không tồn tại');
    err.status = 404;
    throw err;
  }

  // Kiểm tra xem category còn món không
  const itemCount = await MenuItem.countDocuments({ categoryId });
  if (itemCount > 0) {
    const err = new Error(`Không thể xóa danh mục đang có ${itemCount} món ăn. Vui lòng chuyển món sang danh mục khác trước.`);
    err.status = 400;
    throw err;
  }

  await MenuCategory.findByIdAndDelete(categoryId);
  return category;
};

// ═══════════════════════════════════════════════
// MENU ITEM SERVICES
// ═══════════════════════════════════════════════

exports.getMenuItems = async (restaurantId, query = {}) => {
  const filter = { restaurantId };

  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.status) filter.status = query.status;
  if (query.isAvailable !== undefined) filter.isAvailable = query.isAvailable === 'true';
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 50));
  const skip = (page - 1) * limit;

  const sortField = query.sortBy || 'displayOrder';
  const sortDir = query.sortDir === 'desc' ? -1 : 1;

  const [items, total] = await Promise.all([
    MenuItem.find(filter)
      .populate('categoryId', 'name')
      .sort({ [sortField]: sortDir, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MenuItem.countDocuments(filter),
  ]);

  const formatted = items.map((item) => ({
    id: item._id.toString(),
    restaurantId: item.restaurantId,
    categoryId: item.categoryId?._id?.toString() || item.categoryId?.toString() || null,
    categoryName: item.categoryId?.name || null,
    name: item.name,
    description: item.description,
    price: item.price,
    image: item.image,
    isAvailable: item.isAvailable,
    status: item.status,
    preparationTime: item.preparationTime,
    tags: item.tags,
    displayOrder: item.displayOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  return { items: formatted, total, page, totalPages: Math.ceil(total / limit) };
};

exports.createMenuItem = async (restaurantId, data) => {
  // Validate categoryId nếu có
  if (data.categoryId) {
    const category = await MenuCategory.findById(data.categoryId);
    if (!category || category.restaurantId.toString() !== restaurantId.toString()) {
      const err = new Error('Danh mục không tồn tại hoặc không thuộc nhà hàng này');
      err.status = 400;
      throw err;
    }
  }

  const item = await MenuItem.create({
    restaurantId,
    categoryId: data.categoryId || null,
    name: data.name,
    description: data.description || null,
    price: data.price,
    image: data.image || null,
    isAvailable: data.isAvailable !== false,
    status: data.status || 'available',
    preparationTime: data.preparationTime || null,
    tags: data.tags || [],
    displayOrder: data.displayOrder || 0,
  });

  // Cập nhật hasMenu cho restaurant
  await Restaurant.findByIdAndUpdate(restaurantId, { hasMenu: true });

  return item;
};

exports.updateMenuItem = async (itemId, data) => {
  const item = await MenuItem.findById(itemId);
  if (!item) {
    const err = new Error('Món ăn không tồn tại');
    err.status = 404;
    throw err;
  }

  // Validate categoryId nếu thay đổi
  if (data.categoryId !== undefined && data.categoryId) {
    const category = await MenuCategory.findById(data.categoryId);
    if (!category || category.restaurantId.toString() !== item.restaurantId.toString()) {
      const err = new Error('Danh mục không tồn tại hoặc không thuộc nhà hàng này');
      err.status = 400;
      throw err;
    }
  }

  const fields = ['name', 'description', 'price', 'image', 'isAvailable', 'status',
    'preparationTime', 'tags', 'displayOrder', 'categoryId'];
  fields.forEach((f) => {
    if (data[f] !== undefined) item[f] = data[f];
  });

  await item.save();
  return item;
};

exports.deleteMenuItem = async (itemId) => {
  const item = await MenuItem.findById(itemId);
  if (!item) {
    const err = new Error('Món ăn không tồn tại');
    err.status = 404;
    throw err;
  }

  const restaurantId = item.restaurantId;
  await MenuItem.findByIdAndDelete(itemId);

  // Kiểm tra nếu không còn món nào thì tắt hasMenu
  const remaining = await MenuItem.countDocuments({ restaurantId });
  if (remaining === 0) {
    await Restaurant.findByIdAndUpdate(restaurantId, { hasMenu: false });
  }

  return item;
};

exports.toggleAvailability = async (itemId, isAvailable) => {
  const item = await MenuItem.findById(itemId);
  if (!item) {
    const err = new Error('Món ăn không tồn tại');
    err.status = 404;
    throw err;
  }

  item.isAvailable = isAvailable;
  item.status = isAvailable ? 'available' : 'unavailable';
  await item.save();
  return item;
};

// ═══════════════════════════════════════════════
// PUBLIC SERVICES
// ═══════════════════════════════════════════════

exports.getPublicMenu = async (restaurantId, query = {}) => {
  // Chỉ lấy món available, không hidden
  const filter = {
    restaurantId,
    status: { $ne: 'hidden' },
  };

  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const items = await MenuItem.find(filter)
    .populate('categoryId', 'name')
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  const categories = await MenuCategory.find({ restaurantId, isActive: true })
    .sort({ displayOrder: 1 })
    .lean();

  return {
    items: items.map((item) => ({
      id: item._id.toString(),
      categoryId: item.categoryId?._id?.toString() || null,
      categoryName: item.categoryId?.name || null,
      name: item.name,
      description: item.description,
      price: item.price,
      image: item.image,
      isAvailable: item.isAvailable,
      tags: item.tags,
    })),
    categories: categories.map((cat) => ({
      id: cat._id.toString(),
      name: cat.name,
      description: cat.description,
    })),
  };
};
