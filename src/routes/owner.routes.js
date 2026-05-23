'use strict';

const express = require('express');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const ownerRestaurantController = require('../controllers/owner.restaurant.controller');

const router = express.Router();

// ─── Tất cả routes cần đăng nhập + role restaurant_owner ───
router.use(protect);
router.use(restrictTo('restaurant_owner'));

// ─── Restaurants ───
router.post('/restaurants', ownerRestaurantController.createRestaurant);
router.get('/restaurants',  ownerRestaurantController.getMyRestaurants);
router.get('/restaurants/:restaurantId', ownerRestaurantController.getMyRestaurantById);
router.put('/restaurants/:restaurantId', ownerRestaurantController.updateRestaurant);
router.get('/restaurants/:restaurantId/dashboard', ownerRestaurantController.getRestaurantDashboard);

module.exports = router;
