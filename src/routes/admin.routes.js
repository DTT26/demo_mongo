'use strict';

const express          = require('express');
const adminController  = require('../controllers/admin.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const adminRestaurantController = require('../controllers/admin.restaurant.controller');

const router = express.Router();

// ─── Public: Setup admin ban đầu (chỉ dùng 1 lần) ───
router.post('/setup', adminController.setupAdmin);

// ─── Tất cả routes bên dưới cần đăng nhập + role admin ───
router.use(protect);
router.use(restrictTo('admin'));

// ─── Dashboard ───
router.get('/dashboard', adminController.getDashboard);

// ─── Users CRUD ───
router.get(   '/users',              adminController.getUsers);
router.get(   '/users/:id',          adminController.getUserById);
router.post(  '/users',              adminController.createUser);
router.put(   '/users/:id',          adminController.updateUser);
router.patch( '/users/:id/status',   adminController.toggleUserStatus);
router.delete('/users/:id',          adminController.deleteUser);
router.patch( '/users/:id/password', adminController.resetUserPassword);

// ─── Restaurants Management ───
router.get( '/restaurants',               adminRestaurantController.getRestaurants);
router.get( '/restaurants/:id',           adminRestaurantController.getRestaurantById);
router.put( '/restaurants/:id/approve',   adminRestaurantController.approveRestaurant);
router.put( '/restaurants/:id/reject',    adminRestaurantController.rejectRestaurant);
router.put( '/restaurants/:id/suspend',   adminRestaurantController.suspendRestaurant);

// ─── Bookings Management ───
const adminBookingController = require('../controllers/admin.booking.controller');
router.get(   '/bookings',            adminBookingController.getBookings);
router.get(   '/bookings/:id',        adminBookingController.getBookingById);
router.patch( '/bookings/:id/status', adminBookingController.updateBookingStatus);

module.exports = router;
