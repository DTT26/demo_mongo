'use strict';

const toId = (value) => {
  if (!value) return null;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return value.toString();
};

const pickWaitlistPayload = (waitlist, extra = {}) => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const customerId = toId(waitlist.customerId || waitlist.customer?.id);

  return {
    waitlistId: toId(waitlist._id || waitlist.id),
    restaurantId,
    customerId,
    status: waitlist.status,
    preferredDate: waitlist.preferredDate,
    preferredTime: waitlist.preferredTime,
    numberOfGuests: waitlist.numberOfGuests,
    customerName: waitlist.customerName || waitlist.customer?.fullName,
    queuePosition: waitlist.queuePositionSnapshot,
    estimatedWaitMinutes: waitlist.estimatedWaitMinutes,
    convertedBookingId: toId(waitlist.convertedBookingId),
    ...extra,
  };
};

const emitToRooms = (io, rooms, event, payload) => {
  if (!io) return;
  rooms.filter(Boolean).forEach((room) => {
    io.to(room).emit(event, payload);
  });
};

const emitWaitlistEvent = (io, event, waitlist, extra = {}) => {
  const payload = pickWaitlistPayload(waitlist, extra);
  emitToRooms(io, [
    payload.restaurantId ? `restaurant:${payload.restaurantId}` : null,
    payload.customerId ? `user:${payload.customerId}` : null,
    'admin',
  ], event, payload);
};

const notifyWaitlistCreated = (io, waitlist) => (
  emitWaitlistEvent(io, 'waitlist:created', waitlist, {
    message: 'Co yeu cau danh sach cho moi',
  })
);

const notifyWaitlistUpdated = (io, waitlist, action = 'updated') => (
  emitWaitlistEvent(io, 'waitlist:updated', waitlist, {
    action,
    message: 'Danh sach cho da duoc cap nhat',
  })
);

const notifyWaitlistConfirmed = (io, waitlist, booking = null) => (
  emitWaitlistEvent(io, 'waitlist:confirmed', waitlist, {
    convertedBookingId: toId(booking?._id || booking?.id || waitlist.convertedBookingId),
    message: 'Yeu cau danh sach cho da duoc xac nhan',
  })
);

const notifyWaitlistCancelled = (io, waitlist) => (
  emitWaitlistEvent(io, 'waitlist:cancelled', waitlist, {
    message: 'Yeu cau danh sach cho da bi huy',
  })
);

const notifyWaitlistExpired = (io, waitlist) => (
  emitWaitlistEvent(io, 'waitlist:expired', waitlist, {
    message: 'Yeu cau danh sach cho da het han',
  })
);

module.exports = {
  emitWaitlistEvent,
  notifyWaitlistCreated,
  notifyWaitlistUpdated,
  notifyWaitlistConfirmed,
  notifyWaitlistCancelled,
  notifyWaitlistExpired,
};
