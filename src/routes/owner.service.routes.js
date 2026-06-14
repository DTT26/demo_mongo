'use strict';

const express = require('express');
const serviceController = require('../controllers/owner.service.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protect);
router.use(restrictTo('restaurant_owner'));

router.get('/restaurants/:restaurantId/services', serviceController.getServices);
router.post('/restaurants/:restaurantId/services', serviceController.createService);
router.put('/services/:id', serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);
router.patch('/services/:id/availability', serviceController.toggleAvailability);

module.exports = router;
