'use strict';

const express = require('express');
const { protect } = require('../middleware/auth.middleware');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

router.use(protect);

router.post('/upload-image', chatController.uploadChatImageMiddleware, chatController.uploadChatImage);
router.get('/conversations', chatController.getConversations);
router.post('/conversations', chatController.createConversation);
router.get('/conversations/:conversationId/messages/search', chatController.searchMessages);
router.get('/conversations/:conversationId/messages', chatController.getMessages);
router.patch('/conversations/:conversationId/read', chatController.markConversationRead);
router.post('/messages', chatController.sendMessage);
router.patch('/messages/:messageId/reaction', chatController.toggleMessageReaction);
router.patch('/messages/:messageId/read', chatController.markMessageRead);
router.get('/restaurants/:restaurantId/conversations', chatController.getRestaurantConversations);
router.get('/unread-count', chatController.getUnreadCount);

module.exports = router;
