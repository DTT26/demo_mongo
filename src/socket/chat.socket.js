'use strict';

const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { verifyJwtToken } = require('../utils/jwt');
const chatService = require('../services/chat.service');
const notificationService = require('../services/notification.service');
const { getConversationRooms, getMessageRooms } = require('./chat.rooms');

const normalizeToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  return token.startsWith('Bearer ') ? token.slice(7) : token;
};

const emitConversationUpdated = (io, conversation) => {
  if (!conversation) return;

  const rooms = getConversationRooms(conversation);
  if (rooms.length > 0) {
    io.to(rooms).emit('conversation_updated', conversation);
  }
};

const registerChatSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = normalizeToken(socket.handshake.auth?.token || socket.handshake.headers?.authorization);
      if (!token) return next(new Error('Socket token is required'));

      const decoded = verifyJwtToken(token);
      const user = await User.findById(decoded.id || decoded.sub).select('-password');
      if (!user || !user.active) return next(new Error('Socket user is invalid'));

      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error('Socket authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user._id.toString()}`);

    if (user.role === 'admin') {
      socket.join('admin');
    }

    if (user.role === 'restaurant_owner') {
      const restaurants = await Restaurant.find({ ownerId: user._id }).select('_id').lean();
      restaurants.forEach((restaurant) => socket.join(`restaurant:${restaurant._id.toString()}`));
    }

    socket.emit('connection_ready', {
      userId: user._id.toString(),
      role: user.role,
    });

    socket.on('join_restaurant', async (payload = {}, callback) => {
      try {
        const restaurant = await chatService.ensureRestaurantAccess(user, payload.restaurantId);
        const restaurantId = restaurant._id.toString();
        socket.join(`restaurant:${restaurantId}`);
        callback?.({ success: true, restaurantId });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('join_conversation', async (payload = {}, callback) => {
      try {
        const conversation = await chatService.findConversationForUser(user, payload.conversationId);
        const conversationId = conversation._id.toString();
        const restaurantId = conversation.restaurantId?._id?.toString() || conversation.restaurantId?.toString();
        socket.join(`conversation:${conversationId}`);
        if (restaurantId) socket.join(`restaurant:${restaurantId}`);
        callback?.({ success: true, conversationId, restaurantId });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('leave_conversation', (payload = {}, callback) => {
      if (payload.conversationId) {
        socket.leave(`conversation:${payload.conversationId}`);
      }
      callback?.({ success: true });
    });

    socket.on('send_message', async (payload = {}, callback) => {
      try {
        const result = await chatService.sendMessage(user, payload);
        const messageRooms = getMessageRooms(result);
        if (messageRooms.length > 0) {
          io.to(messageRooms).emit('receive_message', result.message);
        }
        emitConversationUpdated(io, result.conversation);
        notificationService.notifyChatMessage(io, { result, sender: user })
          .catch((error) => console.warn(`[SocketChatNotification/message] ${error.message}`));
        callback?.({ success: true, data: result });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('typing_start', async (payload = {}) => {
      try {
        await chatService.findConversationForUser(user, payload.conversationId);
        socket.to(`conversation:${payload.conversationId}`).emit('typing_start', {
          conversationId: payload.conversationId,
          userId: user._id.toString(),
          role: user.role,
        });
      } catch {
        // Ignore unauthorized typing broadcasts.
      }
    });

    socket.on('typing_stop', async (payload = {}) => {
      try {
        await chatService.findConversationForUser(user, payload.conversationId);
        socket.to(`conversation:${payload.conversationId}`).emit('typing_stop', {
          conversationId: payload.conversationId,
          userId: user._id.toString(),
          role: user.role,
        });
      } catch {
        // Ignore unauthorized typing broadcasts.
      }
    });

    socket.on('message_read', async (payload = {}, callback) => {
      try {
        const data = payload.messageId
          ? await chatService.markMessageRead(user, payload.messageId)
          : await chatService.markConversationRead(user, payload.conversationId);

        const conversationId = data.conversationId || payload.conversationId;
        io.to(`conversation:${conversationId}`).emit('message_read', {
          conversationId,
          messageId: data.id || payload.messageId,
          readBy: user._id.toString(),
          readAt: new Date().toISOString(),
        });
        callback?.({ success: true, data });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });

    socket.on('message_reaction_toggle', async (payload = {}, callback) => {
      try {
        const data = await chatService.toggleMessageReaction(
          user,
          payload.messageId,
          payload.emoji,
          payload.conversationId
        );
        io.to(`conversation:${data.conversationId}`).emit('message_reaction_updated', data);
        callback?.({ success: true, data });
      } catch (error) {
        callback?.({ success: false, message: error.message });
      }
    });
  });
};

module.exports = { registerChatSocket };
