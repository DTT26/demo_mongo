'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Restaurant = require('../models/Restaurant');
const { assertOwnerCanAccessRestaurant, isRestaurantOwnedBy } = require('../utils/restaurant-permission');
const { normalizeChatMessagePayload } = require('../utils/chat-attachments');
const { buildReactionPayload, toggleReaction } = require('../utils/chat-reactions');
const {
  buildMessageSearchRegex,
  createSearchSnippet,
  normalizeSearchKeyword,
} = require('../utils/chat-search');

const normalizeId = (value) => {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
};

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const ensureObjectId = (value, label = 'id') => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(400, `${label} khong hop le`);
  }
  return value;
};

const populateConversation = (query) => query
  .populate('restaurantId', 'name logo images approvalStatus active ownerId')
  .populate('customerId', 'fullName username email avatarUrl role')
  .populate('adminId', 'fullName username email avatarUrl role');

const populateMessage = (query) => query
  .populate('senderId', 'fullName username email avatarUrl role');

const toConversationSummary = async (conversation, user) => {
  const unreadCount = await Message.countDocuments({
    conversationId: conversation._id,
    senderId: { $ne: user._id },
    'readBy.userId': { $ne: user._id },
  });

  return {
    ...conversation.toClientJSON(),
    unreadCount,
  };
};

const getOwnedRestaurantIds = async (ownerId) => {
  const restaurants = await Restaurant.find({ ownerId }).select('_id').lean();
  return restaurants.map((restaurant) => restaurant._id);
};

const ensureRestaurantAccess = async (user, restaurantId) => {
  ensureObjectId(restaurantId, 'restaurantId');

  if (user.role === 'admin') {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) throw createHttpError(404, 'Khong tim thay nha hang');
    return restaurant;
  }

  if (user.role === 'restaurant_owner') {
    return assertOwnerCanAccessRestaurant(user._id, restaurantId);
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw createHttpError(404, 'Khong tim thay nha hang');
  return restaurant;
};

const assertConversationAccess = async (user, conversation) => {
  if (!conversation) {
    throw createHttpError(404, 'Khong tim thay conversation');
  }

  if (user.role === 'admin') {
    return conversation;
  }

  if (user.role === 'restaurant_owner') {
    const restaurant = conversation.restaurantId && conversation.restaurantId.ownerId
      ? conversation.restaurantId
      : await Restaurant.findById(conversation.restaurantId);

    if (!isRestaurantOwnedBy(restaurant, user._id)) {
      throw createHttpError(403, 'Ban khong co quyen truy cap conversation nay');
    }
    return conversation;
  }

  if (conversation.type === 'CUSTOMER_RESTAURANT' && normalizeId(conversation.customerId) === normalizeId(user._id)) {
    return conversation;
  }

  throw createHttpError(403, 'Ban khong co quyen truy cap conversation nay');
};

const findConversationForUser = async (user, conversationId) => {
  ensureObjectId(conversationId, 'conversationId');
  const conversation = await populateConversation(Conversation.findById(conversationId));
  return assertConversationAccess(user, conversation);
};

const listConversations = async (user, options = {}) => {
  const {
    restaurantId,
    type,
    status = 'ACTIVE',
    search = '',
    page = 1,
    limit = 30,
  } = options;

  const filter = {};
  if (status) filter.status = status;
  if (type && ['ADMIN_RESTAURANT', 'CUSTOMER_RESTAURANT'].includes(type)) filter.type = type;

  if (user.role === 'admin') {
    if (restaurantId) filter.restaurantId = ensureObjectId(restaurantId, 'restaurantId');
  } else if (user.role === 'restaurant_owner') {
    if (restaurantId) {
      await assertOwnerCanAccessRestaurant(user._id, restaurantId);
      filter.restaurantId = ensureObjectId(restaurantId, 'restaurantId');
    } else {
      filter.restaurantId = { $in: await getOwnedRestaurantIds(user._id) };
    }
  } else {
    filter.customerId = user._id;
    if (restaurantId) filter.restaurantId = ensureObjectId(restaurantId, 'restaurantId');
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const skip = (safePage - 1) * safeLimit;

  let conversations = await populateConversation(
    Conversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
  );

  if (search.trim()) {
    const keyword = search.trim().toLowerCase();
    conversations = conversations.filter((conversation) => {
      const data = conversation.toClientJSON();
      return [
        data.restaurant?.name,
        data.customer?.fullName,
        data.customer?.email,
        data.admin?.fullName,
        data.lastMessagePreview,
      ].filter(Boolean).some((value) => value.toLowerCase().includes(keyword));
    });
  }

  const total = await Conversation.countDocuments(filter);
  const items = await Promise.all(conversations.map((conversation) => toConversationSummary(conversation, user)));

  return {
    conversations: items,
    page: safePage,
    total,
    totalPages: Math.ceil(total / safeLimit),
  };
};

const createOrOpenConversation = async (user, data = {}) => {
  const restaurantId = ensureObjectId(data.restaurantId, 'restaurantId');
  await ensureRestaurantAccess(user, restaurantId);

  let type = data.type;
  if (!type) {
    type = user.role === 'customer' ? 'CUSTOMER_RESTAURANT' : 'ADMIN_RESTAURANT';
  }

  if (!['ADMIN_RESTAURANT', 'CUSTOMER_RESTAURANT'].includes(type)) {
    throw createHttpError(400, 'Loai conversation khong hop le');
  }

  if (user.role === 'customer' && type !== 'CUSTOMER_RESTAURANT') {
    throw createHttpError(403, 'User khong the tao conversation Admin-Restaurant');
  }

  if (user.role === 'restaurant_owner' && type !== 'ADMIN_RESTAURANT') {
    throw createHttpError(403, 'Owner chi co the tao conversation voi Admin cho nha hang minh quan ly');
  }

  const query = type === 'CUSTOMER_RESTAURANT'
    ? { type, restaurantId, customerId: user._id }
    : { type, restaurantId };

  const defaults = {
    type,
    restaurantId,
    createdBy: user._id,
  };

  if (type === 'CUSTOMER_RESTAURANT') {
    defaults.customerId = user._id;
  }

  if (type === 'ADMIN_RESTAURANT' && user.role === 'admin') {
    defaults.adminId = user._id;
  }

  let conversation = await Conversation.findOne(query);
  if (!conversation) {
    conversation = await Conversation.create(defaults);
  } else if (type === 'ADMIN_RESTAURANT' && user.role === 'admin' && !conversation.adminId) {
    conversation.adminId = user._id;
    await conversation.save();
  }

  const populated = await populateConversation(Conversation.findById(conversation._id));
  return toConversationSummary(populated, user);
};

const getMessages = async (user, conversationId, options = {}) => {
  const conversation = await findConversationForUser(user, conversationId);
  const safeLimit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const filter = { conversationId: conversation._id };

  if (options.beforeMessageId) {
    ensureObjectId(options.beforeMessageId, 'beforeMessageId');
    const beforeMessage = await Message.findById(options.beforeMessageId).select('sentAt').lean();
    if (beforeMessage) filter.sentAt = { $lt: beforeMessage.sentAt };
  }

  const messages = await populateMessage(
    Message.find(filter)
      .sort({ sentAt: -1 })
      .limit(safeLimit)
  );

  return messages.reverse().map((message) => message.toClientJSON());
};

const sendMessage = async (user, data = {}) => {
  const normalized = normalizeChatMessagePayload(data);
  const conversation = await findConversationForUser(user, data.conversationId);
  const senderRestaurantId = user.role === 'restaurant_owner' ? conversation.restaurantId._id || conversation.restaurantId : null;

  const message = await Message.create({
    conversationId: conversation._id,
    restaurantId: conversation.restaurantId._id || conversation.restaurantId,
    senderId: user._id,
    senderRole: user.role,
    senderRestaurantId,
    content: normalized.content,
    messageType: normalized.messageType,
    fileUrl: data.fileUrl || null,
    attachments: normalized.attachments,
    readBy: [{ userId: user._id, readAt: new Date() }],
    sentAt: new Date(),
  });

  conversation.lastMessageId = message._id;
  conversation.lastMessagePreview = normalized.lastMessagePreview;
  conversation.lastMessageAt = message.sentAt;
  if (conversation.type === 'ADMIN_RESTAURANT' && user.role === 'admin' && !conversation.adminId) {
    conversation.adminId = user._id;
  }
  await conversation.save();

  const populatedMessage = await populateMessage(Message.findById(message._id));
  const populatedConversation = await populateConversation(Conversation.findById(conversation._id));

  return {
    message: populatedMessage.toClientJSON(),
    conversation: await toConversationSummary(populatedConversation, user),
  };
};

const markMessageRead = async (user, messageId) => {
  ensureObjectId(messageId, 'messageId');
  const message = await Message.findById(messageId);
  if (!message) throw createHttpError(404, 'Khong tim thay tin nhan');

  await findConversationForUser(user, message.conversationId);

  if (!message.readBy.some((receipt) => normalizeId(receipt.userId) === normalizeId(user._id))) {
    message.readBy.push({ userId: user._id, readAt: new Date() });
    await message.save();
  }

  const populated = await populateMessage(Message.findById(message._id));
  return populated.toClientJSON();
};

const toggleMessageReaction = async (user, messageId, emoji, expectedConversationId = null) => {
  ensureObjectId(messageId, 'messageId');
  const message = await Message.findById(messageId);
  if (!message) throw createHttpError(404, 'Khong tim thay tin nhan');

  if (expectedConversationId && normalizeId(message.conversationId) !== normalizeId(expectedConversationId)) {
    throw createHttpError(400, 'Conversation cua reaction khong khop');
  }

  await findConversationForUser(user, message.conversationId);

  message.reactions = toggleReaction(message.reactions, user, emoji);
  await message.save();

  return buildReactionPayload(message, user._id, user._id);
};

const searchMessages = async (user, conversationId, options = {}) => {
  const conversation = await findConversationForUser(user, conversationId);
  const keyword = normalizeSearchKeyword(options.q);
  const regex = buildMessageSearchRegex(keyword);
  const safePage = Math.max(1, parseInt(options.page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;
  const filter = {
    conversationId: conversation._id,
    content: regex,
  };

  const [messages, total] = await Promise.all([
    populateMessage(
      Message.find(filter)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
    ),
    Message.countDocuments(filter),
  ]);

  return {
    results: messages.map((message) => {
      const sender = message.senderId;
      const senderId = sender && typeof sender === 'object' && sender._id
        ? sender._id.toString()
        : normalizeId(sender);

      return {
        messageId: message._id.toString(),
        conversationId: message.conversationId.toString(),
        content: message.content,
        snippet: createSearchSnippet(message.content, keyword, 40),
        createdAt: message.createdAt,
        sentAt: message.sentAt,
        senderId,
        senderRole: message.senderRole,
        sender: sender && typeof sender === 'object' && sender._id
          ? {
              id: sender._id.toString(),
              fullName: sender.fullName,
              username: sender.username,
              role: sender.role,
              avatarUrl: sender.avatarUrl || null,
            }
          : null,
      };
    }),
    total,
    page: safePage,
    limit: safeLimit,
  };
};

const markConversationRead = async (user, conversationId) => {
  const conversation = await findConversationForUser(user, conversationId);
  const readAt = new Date();

  await Message.updateMany(
    {
      conversationId: conversation._id,
      senderId: { $ne: user._id },
      'readBy.userId': { $ne: user._id },
    },
    {
      $push: { readBy: { userId: user._id, readAt } },
    }
  );

  return {
    conversationId: conversation._id.toString(),
    readBy: user._id.toString(),
    readAt,
  };
};

const getUnreadCount = async (user, restaurantId) => {
  const { conversations } = await listConversations(user, { restaurantId, limit: 100 });
  const byConversation = conversations.reduce((acc, conversation) => {
    acc[conversation.id] = conversation.unreadCount;
    return acc;
  }, {});
  const total = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  return { total, byConversation };
};

module.exports = {
  createHttpError,
  ensureRestaurantAccess,
  assertConversationAccess,
  findConversationForUser,
  listConversations,
  createOrOpenConversation,
  getMessages,
  sendMessage,
  markMessageRead,
  toggleMessageReaction,
  searchMessages,
  markConversationRead,
  getUnreadCount,
};
