'use strict';

const restaurantService = require('../services/restaurant-service.service');

const handleError = (res, error, fallbackMessage) => {
  console.error(`[RestaurantService] ${error.message}`);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || fallbackMessage,
  });
};

const validateServicePayload = (body, { partial = false } = {}) => {
  const errors = [];

  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) errors.push('Ten dich vu la bat buoc');
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push('Gia dich vu phai la so khong am');
  }

  if (body.status !== undefined && !['available', 'unavailable', 'hidden'].includes(body.status)) {
    errors.push('Trang thai dich vu khong hop le');
  }

  return errors;
};

const getServices = async (req, res) => {
  try {
    const services = await restaurantService.getOwnerServices(req.user._id, req.params.restaurantId, req.query);
    return res.json({ success: true, data: { services } });
  } catch (error) {
    return handleError(res, error, 'Khong the tai dich vu');
  }
};

const createService = async (req, res) => {
  try {
    const errors = validateServicePayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const service = await restaurantService.createService(req.user._id, req.params.restaurantId, req.body);
    return res.status(201).json({
      success: true,
      message: 'Tao dich vu thanh cong',
      data: { service },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the tao dich vu');
  }
};

const updateService = async (req, res) => {
  try {
    const errors = validateServicePayload(req.body, { partial: true });
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const service = await restaurantService.updateService(req.user._id, req.params.id, req.body);
    return res.json({
      success: true,
      message: 'Cap nhat dich vu thanh cong',
      data: { service },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the cap nhat dich vu');
  }
};

const deleteService = async (req, res) => {
  try {
    const service = await restaurantService.deleteService(req.user._id, req.params.id);
    return res.json({
      success: true,
      message: 'Xoa dich vu thanh cong',
      data: { service },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the xoa dich vu');
  }
};

const toggleAvailability = async (req, res) => {
  try {
    if (req.body.isAvailable === undefined) {
      return res.status(400).json({ success: false, message: 'isAvailable la bat buoc' });
    }

    const service = await restaurantService.toggleAvailability(
      req.user._id,
      req.params.id,
      req.body.isAvailable
    );

    return res.json({
      success: true,
      message: service.isAvailable ? 'Da bat dich vu' : 'Da tat dich vu',
      data: { service },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the cap nhat trang thai dich vu');
  }
};

module.exports = {
  getServices,
  createService,
  updateService,
  deleteService,
  toggleAvailability,
};
