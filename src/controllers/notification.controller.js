'use strict';

const notificationService = require('../services/notification.service');

const sendError = (res, error) => res.status(error.status || 500).json({
  success: false,
  message: error.message || 'Notification error',
});

exports.createNotification = async (req, res) => {
  try {
    const payload = { ...req.body, createdBy: req.user._id };

    if (req.user.role !== 'admin') {
      payload.recipientId = req.user._id;
      payload.recipientRole = req.user.role;
    }

    const notification = await notificationService.createNotification(payload, {
      io: req.app.get('io'),
    });

    return res.status(201).json({
      success: true,
      data: notificationService.toClient(notification),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const data = await notificationService.listNotifications(req.user, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user);
    return res.json({ success: true, data: { count } });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const notification = await notificationService.markAsRead(
      req.user,
      req.params.id,
      req.app.get('io')
    );
    return res.json({ success: true, data: notification });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const data = await notificationService.markAllAsRead(req.user, req.app.get('io'));
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const data = await notificationService.deleteNotification(
      req.user,
      req.params.id,
      req.app.get('io')
    );
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};
