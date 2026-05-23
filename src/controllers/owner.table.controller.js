'use strict';

const tableService = require('../services/table.service');
const { assertOwnerCanAccessRestaurant } = require('../utils/restaurant-permission');
const RestaurantTable = require('../models/RestaurantTable');

// GET /api/v1/owner/restaurants/:restaurantId/tables
exports.getTables = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);
    const result = await tableService.getTables(req.params.restaurantId, req.query);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('❌ Error fetching tables:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// POST /api/v1/owner/restaurants/:restaurantId/tables
exports.createTable = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);

    const { tableNumber, capacity } = req.body;
    const errors = [];
    if (!tableNumber || !tableNumber.trim()) errors.push('Số/tên bàn là bắt buộc');
    if (capacity === undefined || capacity === null || capacity === '') errors.push('Sức chứa là bắt buộc');
    else if (isNaN(capacity) || Number(capacity) < 1) errors.push('Sức chứa phải ít nhất 1 người');

    if (req.body.status && !['available', 'occupied', 'reserved', 'inactive', 'maintenance'].includes(req.body.status)) {
      errors.push('Trạng thái không hợp lệ');
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const table = await tableService.createTable(req.params.restaurantId, {
      ...req.body,
      tableNumber: tableNumber.trim(),
      capacity: Number(capacity),
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo bàn thành công',
      data: { table },
    });
  } catch (error) {
    console.error('❌ Error creating table:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// PUT /api/v1/owner/tables/:id
exports.updateTable = async (req, res) => {
  try {
    const existing = await RestaurantTable.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Bàn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    if (req.body.capacity !== undefined) {
      if (isNaN(req.body.capacity) || Number(req.body.capacity) < 1) {
        return res.status(400).json({ success: false, message: 'Sức chứa phải ít nhất 1 người' });
      }
      req.body.capacity = Number(req.body.capacity);
    }

    const table = await tableService.updateTable(req.params.id, req.body);

    return res.status(200).json({
      success: true,
      message: 'Cập nhật bàn thành công',
      data: { table },
    });
  } catch (error) {
    console.error('❌ Error updating table:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// DELETE /api/v1/owner/tables/:id
exports.deleteTable = async (req, res) => {
  try {
    const existing = await RestaurantTable.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Bàn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    await tableService.deleteTable(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Xóa bàn thành công',
    });
  } catch (error) {
    console.error('❌ Error deleting table:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// PATCH /api/v1/owner/tables/:id/status
exports.updateTableStatus = async (req, res) => {
  try {
    const existing = await RestaurantTable.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Bàn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    const { status } = req.body;
    if (!status || !['available', 'occupied', 'reserved', 'inactive', 'maintenance'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const table = await tableService.updateTableStatus(req.params.id, status);

    return res.status(200).json({
      success: true,
      message: 'Cập nhật trạng thái bàn thành công',
      data: { table },
    });
  } catch (error) {
    console.error('❌ Error updating table status:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};
