const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const ownerReviewController = require('../controllers/owner.review.controller');

// ─────────────────────────────────────────────
// Owner Review Routes
// ─────────────────────────────────────────────
router.get(
  '/reviews',
  protect,
  restrictTo('restaurant_owner'),
  ownerReviewController.getRestaurantReviewsForOwner
);

router.post(
  '/reviews/:id/reply',
  protect,
  restrictTo('restaurant_owner'),
  ownerReviewController.replyToReview
);

module.exports = router;
