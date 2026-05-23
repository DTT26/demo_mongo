'use strict';

const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];

const normalizeId = (value) => {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
};

const createReactionError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const validateReactionEmoji = (emoji) => {
  if (!ALLOWED_REACTION_EMOJIS.includes(emoji)) {
    throw createReactionError(400, 'Emoji reaction khong hop le');
  }
  return emoji;
};

const toReactionJSON = (reaction) => ({
  userId: normalizeId(reaction.userId),
  userRole: reaction.userRole,
  emoji: reaction.emoji,
  createdAt: reaction.createdAt,
});

const toggleReaction = (reactions = [], user, emoji) => {
  validateReactionEmoji(emoji);

  const userId = normalizeId(user._id || user.id);
  const existing = reactions.find((reaction) => normalizeId(reaction.userId) === userId);
  const others = reactions.filter((reaction) => normalizeId(reaction.userId) !== userId);

  if (existing?.emoji === emoji) {
    return others.map(toReactionJSON);
  }

  return [
    ...others.map(toReactionJSON),
    {
      userId,
      userRole: user.role,
      emoji,
      createdAt: new Date(),
    },
  ];
};

const getReactionSummary = (reactions = []) => reactions.reduce((summary, reaction) => {
  if (!reaction?.emoji) return summary;
  summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1;
  return summary;
}, {});

const getMyReaction = (reactions = [], userId) => {
  const normalizedUserId = normalizeId(userId);
  return reactions.find((reaction) => normalizeId(reaction.userId) === normalizedUserId)?.emoji || null;
};

const buildReactionPayload = (message, currentUserId, updatedBy) => {
  const messageId = normalizeId(message._id || message.id);
  const conversationId = normalizeId(message.conversationId);
  const reactions = (message.reactions || []).map(toReactionJSON);

  return {
    messageId,
    conversationId,
    reactions,
    reactionSummary: getReactionSummary(reactions),
    myReaction: getMyReaction(reactions, currentUserId),
    updatedBy: normalizeId(updatedBy || currentUserId),
  };
};

module.exports = {
  ALLOWED_REACTION_EMOJIS,
  buildReactionPayload,
  createReactionError,
  getMyReaction,
  getReactionSummary,
  toggleReaction,
  validateReactionEmoji,
};
