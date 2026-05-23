'use strict';

const express = require('express');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const tableController = require('../controllers/owner.table.controller');

const router = express.Router();

// Tất cả routes cần đăng nhập + role restaurant_owner
router.use(protect);
router.use(restrictTo('restaurant_owner'));

// ─── Tables ───
router.get('/restaurants/:restaurantId/tables', tableController.getTables);
router.post('/restaurants/:restaurantId/tables', tableController.createTable);
router.put('/tables/:id', tableController.updateTable);
router.delete('/tables/:id', tableController.deleteTable);
router.patch('/tables/:id/status', tableController.updateTableStatus);

module.exports = router;
