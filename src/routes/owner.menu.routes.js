'use strict';

const express = require('express');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const menuController = require('../controllers/owner.menu.controller');

const router = express.Router();

// Tất cả routes cần đăng nhập + role restaurant_owner
router.use(protect);
router.use(restrictTo('restaurant_owner'));

// ─── Menu Categories ───
router.get('/restaurants/:restaurantId/menu-categories', menuController.getCategories);
router.post('/restaurants/:restaurantId/menu-categories', menuController.createCategory);
router.put('/menu-categories/:id', menuController.updateCategory);
router.delete('/menu-categories/:id', menuController.deleteCategory);

// ─── Menu Items ───
router.get('/restaurants/:restaurantId/menu-items', menuController.getMenuItems);
router.post('/restaurants/:restaurantId/menu-items', menuController.createMenuItem);
router.put('/menu-items/:id', menuController.updateMenuItem);
router.delete('/menu-items/:id', menuController.deleteMenuItem);
router.patch('/menu-items/:id/availability', menuController.toggleAvailability);

module.exports = router;
