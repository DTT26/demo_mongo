const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['ADMIN_RESTAURANT', 'CUSTOMER_RESTAURANT'],
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'CLOSED', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessagePreview: {
      type: String,
      default: '',
      maxlength: 240,
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

conversationSchema.index(
  { type: 1, restaurantId: 1, customerId: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'CUSTOMER_RESTAURANT', customerId: { $type: 'objectId' } },
  }
);

conversationSchema.index(
  { type: 1, restaurantId: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'ADMIN_RESTAURANT' },
  }
);

conversationSchema.methods.toClientJSON = function () {
  const restaurant = this.restaurantId;
  const customer = this.customerId;
  const admin = this.adminId;

  return {
    id: this._id.toString(),
    type: this.type,
    restaurant: restaurant && typeof restaurant === 'object' && restaurant._id
      ? {
          id: restaurant._id.toString(),
          name: restaurant.name,
          logo: restaurant.logo || null,
          primaryImage: restaurant.primaryImage || restaurant.images?.find((img) => img.isPrimary)?.url || restaurant.images?.[0]?.url || null,
        }
      : restaurant,
    customer: customer && typeof customer === 'object' && customer._id
      ? {
          id: customer._id.toString(),
          fullName: customer.fullName,
          username: customer.username,
          email: customer.email,
          avatarUrl: customer.avatarUrl || null,
        }
      : customer,
    admin: admin && typeof admin === 'object' && admin._id
      ? {
          id: admin._id.toString(),
          fullName: admin.fullName,
          username: admin.username,
          email: admin.email,
        }
      : admin,
    status: this.status,
    lastMessageId: this.lastMessageId ? this.lastMessageId.toString() : null,
    lastMessagePreview: this.lastMessagePreview,
    lastMessageAt: this.lastMessageAt,
    createdBy: this.createdBy ? this.createdBy.toString() : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Conversation', conversationSchema);
