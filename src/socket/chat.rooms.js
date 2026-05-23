'use strict';

const normalizeRoomId = (value) => {
  if (!value) return null;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return value.toString();
};

const uniqueRooms = (rooms) => [...new Set(rooms.filter(Boolean))];

const getConversationRooms = (conversation) => {
  const conversationId = normalizeRoomId(conversation?.id || conversation?._id);
  const restaurantId = normalizeRoomId(conversation?.restaurant || conversation?.restaurantId);
  const customerId = normalizeRoomId(conversation?.customer || conversation?.customerId);

  return uniqueRooms([
    conversationId && `conversation:${conversationId}`,
    restaurantId && `restaurant:${restaurantId}`,
    'admin',
    customerId && `user:${customerId}`,
  ]);
};

const getMessageRooms = ({ message, conversation }) => {
  const conversationId = normalizeRoomId(message?.conversationId || conversation?.id || conversation?._id);
  const restaurantId = normalizeRoomId(message?.restaurantId || conversation?.restaurant || conversation?.restaurantId);
  const customerId = normalizeRoomId(conversation?.customer || conversation?.customerId);

  return uniqueRooms([
    conversationId && `conversation:${conversationId}`,
    restaurantId && `restaurant:${restaurantId}`,
    'admin',
    customerId && `user:${customerId}`,
  ]);
};

module.exports = {
  getConversationRooms,
  getMessageRooms,
};
