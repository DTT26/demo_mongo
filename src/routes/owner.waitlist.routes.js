'use strict';

const express = require('express');
const ownerWaitlistController = require('../controllers/owner.waitlist.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protect);
router.use(restrictTo('restaurant_owner'));

router.get('/waitlists', ownerWaitlistController.getWaitlists);
router.get('/waitlists/stats', ownerWaitlistController.getStats);
router.get('/waitlists/:id', ownerWaitlistController.getWaitlistById);
router.get('/waitlists/:id/available-tables', ownerWaitlistController.getAvailableTables);
router.put('/waitlists/:id/assign-tables', ownerWaitlistController.assignTables);
router.put('/waitlists/:id/confirm', ownerWaitlistController.confirmWaitlist);
router.put('/waitlists/:id/cancel', ownerWaitlistController.cancelWaitlist);
router.put('/waitlists/:id/expire', ownerWaitlistController.expireWaitlist);
router.patch('/waitlists/:id/priority', ownerWaitlistController.updatePriority);
router.post('/waitlists/:id/internal-notes', ownerWaitlistController.addInternalNote);
router.delete('/waitlists/:id/internal-notes/:noteId', ownerWaitlistController.deleteInternalNote);

module.exports = router;
