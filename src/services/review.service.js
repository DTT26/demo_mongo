const mongoose = require('mongoose');
const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');

/**
 * Cập nhật điểm đánh giá trung bình và tổng số đánh giá của một nhà hàng
 * Chỉ tính toán dựa trên các đánh giá có trạng thái 'approved'
 * @param {string} restaurantId - ID của nhà hàng cần cập nhật
 */
async function updateRestaurantRating(restaurantId) {
  try {
    const stats = await Review.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          status: 'approved',
        },
      },
      {
        $group: {
          _id: '$restaurantId',
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    let averageRating = 0;
    let totalReviews = 0;

    if (stats.length > 0) {
      // Làm tròn 1 chữ số thập phân (ví dụ: 4.67 -> 4.7)
      averageRating = Math.round(stats[0].averageRating * 10) / 10;
      totalReviews = stats[0].totalReviews;
    }

    await Restaurant.findByIdAndUpdate(restaurantId, {
      'stats.averageRating': averageRating,
      'stats.totalReviews': totalReviews,
    });

    console.log(`✅ Cập nhật stats nhà hàng ${restaurantId}: ${averageRating}★, ${totalReviews} đánh giá.`);
    return { averageRating, totalReviews };
  } catch (error) {
    console.error(`❌ Lỗi cập nhật stats nhà hàng ${restaurantId}:`, error.message);
    throw error;
  }
}

module.exports = {
  updateRestaurantRating,
};
