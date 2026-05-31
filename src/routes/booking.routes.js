'use strict';

const express = require('express');
const bookingController = require('../controllers/booking.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { validateBookingInput, verifyCustomerBookingAccess } = require('../middleware/booking.middleware');

const router = express.Router();

// ─── Public Routes ───
router.post('/availability-check', bookingController.checkAvailability);

// ─── Protected Customer Routes ───
router.use(protect);

router.post('/', restrictTo('customer'), validateBookingInput, bookingController.createBooking);
router.get('/my', restrictTo('customer'), bookingController.getMyBookings);
router.get('/:id', verifyCustomerBookingAccess, bookingController.getBookingById);
router.put('/:id', verifyCustomerBookingAccess, validateBookingInput, bookingController.updateBooking);
router.delete('/:id/cancel', verifyCustomerBookingAccess, bookingController.cancelBooking);

module.exports = router;
