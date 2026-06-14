'use strict';

const express = require('express');
const waitlistController = require('../controllers/waitlist.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const {
  validateWaitlistInput,
  validateWaitlistPatch,
} = require('../middleware/waitlist.middleware');

const router = express.Router();

router.use(protect);
router.use(restrictTo('customer'));

router.post('/', validateWaitlistInput, waitlistController.createWaitlist);
router.get('/my', waitlistController.getMyWaitlists);
router.get('/:id', waitlistController.getWaitlistById);
router.patch('/:id', validateWaitlistPatch, waitlistController.updateWaitlist);
router.delete('/:id/cancel', waitlistController.cancelWaitlist);

module.exports = router;
