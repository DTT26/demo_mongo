const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');
const reviewController = require('../controllers/review.controller');

// ─────────────────────────────────────────────
// Customer Review Routes (protected)
// ─────────────────────────────────────────────
router.get('/my', protect, reviewController.getMyReviews);
router.post('/', protect, restrictTo('customer'), reviewController.createReview);
router.put('/:id', protect, restrictTo('customer'), reviewController.updateReview);
router.delete('/:id', protect, restrictTo('customer'), reviewController.deleteReview);
router.post('/:id/helpful', protect, reviewController.toggleHelpful);
router.post('/:id/report', protect, reviewController.reportReview);

module.exports = router;
