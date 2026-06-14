'use strict';

const express = require('express');
const router = express.Router();
const restaurantController = require('../controllers/restaurant.controller');
const menuService = require('../services/menu.service');
const tableService = require('../services/table.service');
const restaurantService = require('../services/restaurant-service.service');
const Restaurant = require('../models/Restaurant');

// Public route to get cuisine types
router.get('/cuisine-types', restaurantController.getCuisineTypes);

// Public route to search & filter restaurants
router.get('/', restaurantController.getRestaurants);

// ─── Public Menu ───
router.get('/:restaurantId/menu', async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    if (!restaurant || restaurant.approvalStatus !== 'approved' || !restaurant.active) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại' });
    }

    const result = await menuService.getPublicMenu(req.params.restaurantId, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error fetching public menu:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
});

// ─── Public Menu Categories ───
router.get('/:restaurantId/menu-categories', async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    if (!restaurant || restaurant.approvalStatus !== 'approved' || !restaurant.active) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại' });
    }

    const categories = await menuService.getCategories(req.params.restaurantId, { activeOnly: true });
    return res.status(200).json({ success: true, data: { categories } });
  } catch (error) {
    console.error('❌ Error fetching public categories:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
});

// ─── Public Tables ───
router.get('/:restaurantId/tables', async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    if (!restaurant || restaurant.approvalStatus !== 'approved' || !restaurant.active) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại' });
    }

    const tables = await tableService.getPublicTables(req.params.restaurantId, req.query);
    return res.status(200).json({ success: true, data: { tables } });
  } catch (error) {
    console.error('❌ Error fetching public tables:', error);
    return res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }
});

// Public Services
router.get('/:restaurantId/services', async (req, res) => {
  try {
    const services = await restaurantService.getPublicServices(req.params.restaurantId, req.query);
    return res.status(200).json({ success: true, data: { services } });
  } catch (error) {
    console.error('Error fetching public services:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Loi he thong.',
    });
  }
});

// Public route to view single restaurant detail
router.get('/:id', restaurantController.getRestaurantById);

module.exports = router;
