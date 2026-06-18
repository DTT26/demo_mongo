'use strict';

const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');

/**
 * Tính toán rating summary cho nhà hàng
 * Trả về: averageRating, totalReviews, distribution (1-5★)
 */
const calculateRatingSummary = async (restaurantId) => {
  const pipeline = [
    { $match: { restaurantId: restaurantId, status: 'visible' } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        star1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
        star2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
        star3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
        star4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
        star5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
      },
    },
  ];

  const results = await Review.aggregate(pipeline);

  if (!results.length) {
    return {
      averageRating: 0,
      totalReviews: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const data = results[0];
  return {
    averageRating: Math.round(data.averageRating * 10) / 10,
    totalReviews: data.totalReviews,
    distribution: {
      1: data.star1,
      2: data.star2,
      3: data.star3,
      4: data.star4,
      5: data.star5,
    },
  };
};

/**
 * Cập nhật averageRating + totalReviews trên Restaurant.stats
 */
const updateRestaurantRating = async (restaurantId) => {
  const summary = await calculateRatingSummary(restaurantId);

  await Restaurant.findByIdAndUpdate(restaurantId, {
    'stats.averageRating': summary.averageRating,
    'stats.totalReviews': summary.totalReviews,
  });

  return summary;
};

module.exports = {
  calculateRatingSummary,
  updateRestaurantRating,
};
