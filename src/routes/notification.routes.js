'use strict';

const express = require('express');
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protect);

router.post('/', notificationController.createNotification);
router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
