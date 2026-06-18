'use strict';

const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const favoriteCtrl = require('../controllers/customer.favorite.controller');

// Tất cả các routes yêu thích đều cần đăng nhập và chỉ cho vai trò khách hàng (customer) sử dụng
router.use(protect);
router.use(restrictTo('customer'));

router.post('/', favoriteCtrl.addFavorite);
router.delete('/:restaurantId', favoriteCtrl.removeFavorite);
router.get('/', favoriteCtrl.getMyFavorites);
router.get('/ids', favoriteCtrl.getFavoriteIds);

module.exports = router;
