const mongoose = require('mongoose');
const { getReactionSummary } = require('../utils/chat-reactions');

const readReceiptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['image'],
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    secureUrl: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      default: '',
    },
    mimetype: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      default: 0,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    format: {
      type: String,
      default: '',
    },
    resourceType: {
      type: String,
      default: 'image',
    },
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userRole: {
      type: String,
      enum: ['admin', 'restaurant_owner', 'customer'],
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ['admin', 'restaurant_owner', 'customer'],
      required: true,
    },
    senderRestaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    messageType: {
      type: String,
      enum: ['TEXT', 'IMAGE', 'MIXED', 'FILE', 'SYSTEM'],
      default: 'TEXT',
    },
    fileUrl: {
      type: String,
      default: null,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    reactions: {
      type: [reactionSchema],
      default: [],
    },
    readBy: {
      type: [readReceiptSchema],
      default: [],
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ conversationId: 1, sentAt: 1 });
messageSchema.index({ conversationId: 1, content: 'text' });

messageSchema.methods.toClientJSON = function () {
  const sender = this.senderId;

  const reactions = (this.reactions || []).map((reaction) => ({
    userId: reaction.userId.toString(),
    userRole: reaction.userRole,
    emoji: reaction.emoji,
    createdAt: reaction.createdAt,
  }));

  return {
    id: this._id.toString(),
    conversationId: this.conversationId.toString(),
    restaurantId: this.restaurantId.toString(),
    sender: sender && typeof sender === 'object' && sender._id
      ? {
          id: sender._id.toString(),
          fullName: sender.fullName,
          username: sender.username,
          role: sender.role,
          avatarUrl: sender.avatarUrl || null,
        }
      : sender,
    senderRole: this.senderRole,
    senderRestaurantId: this.senderRestaurantId ? this.senderRestaurantId.toString() : null,
    content: this.content,
    messageType: this.messageType,
    fileUrl: this.fileUrl,
    attachments: (this.attachments || []).map((attachment) => ({
      type: attachment.type,
      url: attachment.url,
      secureUrl: attachment.secureUrl,
      publicId: attachment.publicId,
      originalName: attachment.originalName,
      mimetype: attachment.mimetype,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      format: attachment.format,
      resourceType: attachment.resourceType,
    })),
    reactions,
    reactionSummary: getReactionSummary(reactions),
    readBy: this.readBy.map((receipt) => ({
      userId: receipt.userId.toString(),
      readAt: receipt.readAt,
    })),
    sentAt: this.sentAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Message', messageSchema);
