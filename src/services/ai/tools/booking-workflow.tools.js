'use strict';

const { createAiBookingWorkflowService } = require('../ai-booking-workflow.service');
const { createAiBookingConfirmationService } = require('../ai-booking-confirmation.service');

const createBookingWorkflowTools = ({
  workflow = createAiBookingWorkflowService(),
  confirmation = createAiBookingConfirmationService(),
} = {}) => ({
  async prepare_booking(args = {}, context = {}) {
    return workflow.prepareBooking(args, context);
  },
  async confirm_booking(args = {}, context = {}) {
    return confirmation.confirmPendingBooking({
      pendingActionId: args.pendingActionId,
      confirmation: args.confirmation,
      idempotencyKey: context.idempotencyKey,
      requestId: context.requestId,
      user: context.user,
      io: context.io,
    });
  },
});

module.exports = {
  createBookingWorkflowTools,
};
