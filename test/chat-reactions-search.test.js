const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_REACTION_EMOJIS,
  buildReactionPayload,
  getReactionSummary,
  toggleReaction,
  validateReactionEmoji,
} = require('../src/utils/chat-reactions');
const {
  buildMessageSearchRegex,
  createSearchSnippet,
} = require('../src/utils/chat-search');

test('toggleReaction adds, replaces, and removes a user reaction', () => {
  const user = { _id: 'user-1', role: 'customer' };

  const added = toggleReaction([], user, '❤️');
  assert.equal(added.length, 1);
  assert.equal(added[0].emoji, '❤️');
  assert.equal(added[0].userId, 'user-1');

  const replaced = toggleReaction(added, user, '👍');
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].emoji, '👍');

  const removed = toggleReaction(replaced, user, '👍');
  assert.deepEqual(removed, []);
});

test('toggleReaction keeps reactions from other users and summarizes by emoji', () => {
  const reactions = [
    { userId: 'user-1', userRole: 'customer', emoji: '❤️', createdAt: new Date('2026-01-01') },
    { userId: 'user-2', userRole: 'admin', emoji: '❤️', createdAt: new Date('2026-01-02') },
    { userId: 'user-3', userRole: 'restaurant_owner', emoji: '😂', createdAt: new Date('2026-01-03') },
  ];

  assert.deepEqual(getReactionSummary(reactions), {
    '❤️': 2,
    '😂': 1,
  });
});

test('validateReactionEmoji rejects emoji outside allowlist', () => {
  assert.deepEqual(ALLOWED_REACTION_EMOJIS, ['👍', '❤️', '😂', '😮', '😢', '😡']);
  assert.equal(validateReactionEmoji('😂'), '😂');
  assert.throws(() => validateReactionEmoji('🔥'), /emoji reaction khong hop le/i);
});

test('buildReactionPayload returns reaction summary and current user reaction', () => {
  const payload = buildReactionPayload({
    id: 'message-1',
    conversationId: 'conversation-1',
    reactions: [
      { userId: 'user-1', userRole: 'customer', emoji: '❤️', createdAt: new Date('2026-01-01') },
      { userId: 'user-2', userRole: 'admin', emoji: '👍', createdAt: new Date('2026-01-02') },
    ],
  }, 'user-1');

  assert.equal(payload.messageId, 'message-1');
  assert.equal(payload.conversationId, 'conversation-1');
  assert.deepEqual(payload.reactionSummary, { '❤️': 1, '👍': 1 });
  assert.equal(payload.myReaction, '❤️');
});

test('buildMessageSearchRegex escapes regex characters and remains case-insensitive', () => {
  const regex = buildMessageSearchRegex('C++ món');

  assert.equal(regex.test('toi muon tim C++ món này'), true);
  assert.equal(regex.test('toi muon tim c++ MÓN này'), true);
  assert.equal(regex.test('toi muon tim C-- mon nay'), false);
});

test('createSearchSnippet returns a compact snippet around the matched keyword', () => {
  const snippet = createSearchSnippet(
    'Xin chao, toi muon dat ban luc 19h va goi mon lau Thai cho 4 nguoi',
    'dat ban',
    16
  );

  assert.equal(snippet, '...toi muon dat ban luc 19h...');
});
