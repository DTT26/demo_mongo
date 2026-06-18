const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    // ─── References ───
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking ID là bắt buộc'],
      unique: true, // 1 review per booking
    },

    // ─── Review Content ───
    rating: {
      type: Number,
      required: [true, 'Điểm đánh giá là bắt buộc'],
      min: [1, 'Điểm đánh giá tối thiểu là 1'],
      max: [5, 'Điểm đánh giá tối đa là 5'],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [200, 'Tiêu đề không được vượt quá 200 ký tự'],
      default: null,
    },
    comment: {
      type: String,
      required: [true, 'Nội dung đánh giá là bắt buộc'],
      trim: true,
      minlength: [10, 'Nội dung đánh giá phải có ít nhất 10 ký tự'],
      maxlength: [2000, 'Nội dung đánh giá không được vượt quá 2000 ký tự'],
    },

    // ─── Media ───
    mediaUrls: [{
      type: String,
      trim: true,
    }],

    // ─── Helpful ───
    helpfulUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    helpfulCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Report ───
    reportedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    reportCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Owner Reply ───
    ownerReply: {
      content: { type: String, trim: true, default: null },
      repliedAt: { type: Date, default: null },
      repliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },

    // ─── Moderation ───
    status: {
      type: String,
      enum: ['visible', 'hidden'],
      default: 'visible',
      index: true,
    },
    hiddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    hiddenAt: {
      type: Date,
      default: null,
    },
    hideReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
reviewSchema.index({ restaurantId: 1, createdAt: -1 });
reviewSchema.index({ customerId: 1, createdAt: -1 });
reviewSchema.index({ restaurantId: 1, status: 1 });
reviewSchema.index({ reportCount: -1 });

// ─── Method: Public JSON ───
reviewSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    customerId: this.customerId,
    restaurantId: this.restaurantId,
    bookingId: this.bookingId,
    rating: this.rating,
    title: this.title,
    comment: this.comment,
    mediaUrls: this.mediaUrls,
    helpfulCount: this.helpfulCount,
    ownerReply: this.ownerReply?.content ? {
      content: this.ownerReply.content,
      repliedAt: this.ownerReply.repliedAt,
    } : null,
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ─── Method: Admin JSON ───
reviewSchema.methods.toAdminJSON = function () {
  return {
    id: this._id.toString(),
    customerId: this.customerId,
    restaurantId: this.restaurantId,
    bookingId: this.bookingId,
    rating: this.rating,
    title: this.title,
    comment: this.comment,
    mediaUrls: this.mediaUrls,
    helpfulUsers: this.helpfulUsers,
    helpfulCount: this.helpfulCount,
    reportedBy: this.reportedBy,
    reportCount: this.reportCount,
    ownerReply: this.ownerReply,
    status: this.status,
    hiddenBy: this.hiddenBy,
    hiddenAt: this.hiddenAt,
    hideReason: this.hideReason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Review', reviewSchema);
