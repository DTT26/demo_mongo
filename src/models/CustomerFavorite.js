const mongoose = require('mongoose');

const customerFavoriteSchema = new mongoose.Schema(
  {
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
  },
  {
    timestamps: true,
  }
);

// Tránh lưu trùng lặp một nhà hàng yêu thích nhiều lần đối với một khách hàng
customerFavoriteSchema.index({ customerId: 1, restaurantId: 1 }, { unique: true });

module.exports = mongoose.model('CustomerFavorite', customerFavoriteSchema);
