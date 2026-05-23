const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMessageRooms,
  getConversationRooms,
} = require('../src/socket/chat.rooms');

test('getMessageRooms targets conversation, restaurant, admin, and customer rooms', () => {
  const rooms = getMessageRooms({
    message: {
      conversationId: 'conv-1',
      restaurantId: 'rest-1',
    },
    conversation: {
      customer: { id: 'user-1' },
    },
  });

  assert.deepEqual(rooms, [
    'conversation:conv-1',
    'restaurant:rest-1',
    'admin',
    'user:user-1',
  ]);
});

test('getConversationRooms skips missing customer room for admin-restaurant conversations', () => {
  const rooms = getConversationRooms({
    id: 'conv-2',
    restaurant: { id: 'rest-2' },
    customer: null,
  });

  assert.deepEqual(rooms, [
    'conversation:conv-2',
    'restaurant:rest-2',
    'admin',
  ]);
});
