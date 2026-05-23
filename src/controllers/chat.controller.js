'use strict';

const multer = require('multer');
const chatService = require('../services/chat.service');
const { getConversationRooms, getMessageRooms } = require('../socket/chat.rooms');
const {
  MAX_CHAT_IMAGE_SIZE,
  uploadBufferToCloudinary,
  validateChatImageFile,
} = require('../utils/chat-upload');

const chatImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_IMAGE_SIZE },
  fileFilter: (req, file, callback) => {
    try {
      validateChatImageFile(file);
      callback(null, true);
    } catch (error) {
      callback(error, false);
    }
  },
});

const emitToRooms = (io, rooms, eventName, payload) => {
  if (rooms.length > 0) {
    io.to(rooms).emit(eventName, payload);
  }
};

const sendError = (res, error) => {
  console.error('Chat error:', error);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Loi he thong chat',
  });
};

exports.uploadChatImageMiddleware = (req, res, next) => {
  chatImageUpload.single('image')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.status || 400);
    res.status(status).json({
      success: false,
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Anh upload toi da 5MB' : error.message,
    });
  });
};

exports.uploadChatImage = async (req, res) => {
  try {
    const metadata = await uploadBufferToCloudinary(req.file);
    return res.status(201).json({ success: true, data: metadata });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getConversations = async (req, res) => {
  try {
    const data = await chatService.listConversations(req.user, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getRestaurantConversations = async (req, res) => {
  try {
    const data = await chatService.listConversations(req.user, {
      ...req.query,
      restaurantId: req.params.restaurantId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createConversation = async (req, res) => {
  try {
    const conversation = await chatService.createOrOpenConversation(req.user, req.body);
    return res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getMessages = async (req, res) => {
  try {
    const messages = await chatService.getMessages(req.user, req.params.conversationId, req.query);
    return res.json({ success: true, data: { messages } });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.searchMessages = async (req, res) => {
  try {
    const data = await chatService.searchMessages(req.user, req.params.conversationId, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const result = await chatService.sendMessage(req.user, req.body);
    const io = req.app.get('io');

    if (io) {
      emitToRooms(io, getMessageRooms(result), 'receive_message', result.message);
      emitToRooms(io, getConversationRooms(result.conversation), 'conversation_updated', result.conversation);
      io.to(`user:${req.user._id.toString()}`).emit('message_read', {
        conversationId: result.message.conversationId,
        messageId: result.message.id,
        readBy: req.user._id.toString(),
      });
    }

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.toggleMessageReaction = async (req, res) => {
  try {
    const data = await chatService.toggleMessageReaction(req.user, req.params.messageId, req.body.emoji);
    const io = req.app.get('io');

    if (io) {
      io.to(`conversation:${data.conversationId}`).emit('message_reaction_updated', data);
    }

    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markMessageRead = async (req, res) => {
  try {
    const message = await chatService.markMessageRead(req.user, req.params.messageId);
    const io = req.app.get('io');

    if (io) {
      io.to(`conversation:${message.conversationId}`).emit('message_read', {
        conversationId: message.conversationId,
        messageId: message.id,
        readBy: req.user._id.toString(),
        readAt: new Date().toISOString(),
      });
    }

    return res.json({ success: true, data: message });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.markConversationRead = async (req, res) => {
  try {
    const data = await chatService.markConversationRead(req.user, req.params.conversationId);
    const io = req.app.get('io');

    if (io) {
      io.to(`conversation:${data.conversationId}`).emit('message_read', data);
    }

    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const data = await chatService.getUnreadCount(req.user, req.query.restaurantId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};
