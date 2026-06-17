const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Mã đặt bàn là bắt buộc'],
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Mã người dùng là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Mã nhà hàng là bắt buộc'],
      index: true,
    },
    rating: {
      type: Number,
      required: [true, 'Điểm đánh giá là bắt buộc'],
      min: [1, 'Điểm đánh giá tối thiểu là 1 sao'],
      max: [5, 'Điểm đánh giá tối đa là 5 sao'],
      validate: {
        validator: Number.isInteger,
        message: 'Điểm đánh giá phải là số nguyên',
      },
    },
    comment: {
      type: String,
      required: [true, 'Nội dung đánh giá là bắt buộc'],
      trim: true,
      minlength: [10, 'Nội dung đánh giá phải có ít nhất 10 ký tự'],
      maxlength: [1000, 'Nội dung đánh giá không được vượt quá 1000 ký tự'],
    },
    images: [{
      type: String,
      trim: true,
    }],
    status: {
      type: String,
      enum: ['approved', 'reported', 'hidden'],
      default: 'approved',
      index: true,
    },
    ownerReply: {
      comment: {
        type: String,
        trim: true,
        minlength: [5, 'Nội dung phản hồi phải có ít nhất 5 ký tự'],
        maxlength: [500, 'Nội dung phản hồi không được vượt quá 500 ký tự'],
        default: null,
      },
      repliedAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Review', reviewSchema);
