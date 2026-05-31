'use strict';

const Booking = require('../models/Booking');
const RestaurantTable = require('../models/RestaurantTable');
const Restaurant = require('../models/Restaurant');

const BOOKING_CONSTANTS = {
  MIN_BOOKING_ADVANCE_MINUTES: 30,
  MAX_BOOKING_ADVANCE_DAYS: 30,
  BOOKING_DURATION_HOURS: 2,
  BUFFER_BEFORE_MINUTES: 90,
  BUFFER_AFTER_MINUTES: 120,
  DEFAULT_OPEN_TIME: '10:00',
  DEFAULT_CLOSE_TIME: '22:00',
};

const BOOKING_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const canTransitionBookingStatus = (currentStatus, nextStatus) => {
  const allowedStatuses = BOOKING_STATUS_TRANSITIONS[currentStatus] || [];
  return allowedStatuses.includes(nextStatus);
};

/**
 * Normalizes a date to UTC midnight.
 */
const normalizeDate = (dateInput) => {
  const d = new Date(dateInput);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Combines a date object/string and a HH:mm time string into a single JS Date.
 */
const combineDateAndTime = (date, timeString) => {
  const d = new Date(date);
  const [hours, minutes] = timeString.split(':').map(Number);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
};

/**
 * Checks if a proposed booking time overlaps with an existing booking.
 */
const checkTimeConflict = async (restaurantId, tableNumber, bookingDate, bookingTime, excludeBookingId = null) => {
  const normalizedDate = normalizeDate(bookingDate);
  
  // Find all active bookings for this restaurant, table, and date
  const bookings = await Booking.find({
    restaurantId,
    bookingDate: normalizedDate,
    tableNumbers: tableNumber,
    status: { $in: ['pending', 'confirmed'] },
    _id: { $ne: excludeBookingId },
  });

  const newStart = combineDateAndTime(normalizedDate, bookingTime);
  const newEnd = new Date(newStart.getTime() + BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 * 60 * 1000);

  const conflictingBookings = [];

  for (const b of bookings) {
    const existingStart = combineDateAndTime(b.bookingDate, b.bookingTime);
    
    // Existing occupied interval: [existingStart - BUFFER_BEFORE, existingStart + DURATION + BUFFER_AFTER]
    const occupiedStart = new Date(existingStart.getTime() - BOOKING_CONSTANTS.BUFFER_BEFORE_MINUTES * 60 * 1000);
    const occupiedEnd = new Date(existingStart.getTime() + (BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 + BOOKING_CONSTANTS.BUFFER_AFTER_MINUTES) * 60 * 1000);

    // Overlap condition
    if (newStart < occupiedEnd && newEnd > occupiedStart) {
      conflictingBookings.push(b);
    }
  }

  return {
    hasConflict: conflictingBookings.length > 0,
    conflictingBookings,
  };
};

/**
 * Validates whether the booking time is within operating hours and advanced time limits.
 */
const validateBookingTime = async (bookingDate, bookingTime, restaurant) => {
  const errors = [];
  const now = new Date();
  
  const proposedDateTime = combineDateAndTime(bookingDate, bookingTime);
  
  // 1. Check if booking is in the past
  if (proposedDateTime <= now) {
    errors.push('Thời gian đặt bàn phải ở tương lai');
    return { valid: false, errors };
  }

  // 2. Check advance booking constraints (min 30 mins)
  const minAdvanceTime = new Date(now.getTime() + BOOKING_CONSTANTS.MIN_BOOKING_ADVANCE_MINUTES * 60 * 1000);
  if (proposedDateTime < minAdvanceTime) {
    errors.push(`Phải đặt bàn trước ít nhất ${BOOKING_CONSTANTS.MIN_BOOKING_ADVANCE_MINUTES} phút`);
  }

  // 3. Check advance booking constraints (max 30 days)
  const maxAdvanceTime = new Date(now.getTime() + BOOKING_CONSTANTS.MAX_BOOKING_ADVANCE_DAYS * 24 * 60 * 60 * 1000);
  if (proposedDateTime > maxAdvanceTime) {
    errors.push(`Không thể đặt trước quá ${BOOKING_CONSTANTS.MAX_BOOKING_ADVANCE_DAYS} ngày`);
  }

  // 4. Validate against operating hours
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = daysOfWeek[new Date(bookingDate).getUTCDay()];
  
  const hours = restaurant.operatingHours?.[dayName] || {
    open: BOOKING_CONSTANTS.DEFAULT_OPEN_TIME,
    close: BOOKING_CONSTANTS.DEFAULT_CLOSE_TIME,
    closed: false,
  };

  if (hours.closed) {
    errors.push('Nhà hàng đóng cửa vào ngày này');
    return { valid: errors.length === 0, errors };
  }

  const [openH, openM] = hours.open.split(':').map(Number);
  const [closeH, closeM] = hours.close.split(':').map(Number);

  const openTime = combineDateAndTime(bookingDate, hours.open);
  let closeTime = combineDateAndTime(bookingDate, hours.close);

  // If closing time is early morning the next day (e.g. close is 02:00, open is 10:00)
  if (closeTime <= openTime) {
    closeTime = new Date(closeTime.getTime() + 24 * 60 * 60 * 1000);
  }

  if (proposedDateTime < openTime || proposedDateTime > closeTime) {
    errors.push(`Giờ đặt bàn nằm ngoài thời gian hoạt động của nhà hàng (${hours.open} - ${hours.close})`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Checks table capacities and active status.
 */
const validateTableCapacity = async (tableNumbers, numberOfGuests, restaurantId) => {
  const errors = [];
  
  if (!tableNumbers || tableNumbers.length === 0) {
    return { valid: true, errors, tables: [] };
  }

  const tables = await RestaurantTable.find({
    restaurantId,
    tableNumber: { $in: tableNumbers },
  });

  if (tables.length !== tableNumbers.length) {
    errors.push('Một hoặc nhiều bàn được chọn không tồn tại');
    return { valid: false, errors, tables };
  }

  let totalCapacity = 0;
  for (const table of tables) {
    if (!table.isActive) {
      errors.push(`Bàn ${table.tableNumber} hiện không hoạt động`);
    }
    if (['inactive', 'maintenance'].includes(table.status)) {
      errors.push(`Bàn ${table.tableNumber} đang bảo trì hoặc ngưng hoạt động`);
    }
    totalCapacity += table.capacity;
  }

  if (totalCapacity < numberOfGuests) {
    errors.push(`Tổng sức chứa của các bàn được chọn (${totalCapacity} chỗ) không đủ cho số khách (${numberOfGuests} người)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    tables,
  };
};

/**
 * Gets all active tables that are not occupied during the proposed time window.
 */
const getAvailableTables = async (restaurantId, bookingDate, bookingTime) => {
  // Find all active tables for the restaurant
  const allTables = await RestaurantTable.find({
    restaurantId,
    isActive: true,
    status: { $in: ['available', 'reserved'] },
  });

  const availableTables = [];

  for (const table of allTables) {
    const { hasConflict } = await checkTimeConflict(restaurantId, table.tableNumber, bookingDate, bookingTime);
    if (!hasConflict) {
      availableTables.push(table);
    }
  }

  return availableTables;
};

/**
 * Suggests best fitting table(s) based on capacity and zone.
 */
const suggestTables = (availableTables, numberOfGuests) => {
  // Sort available tables by capacity in ascending order
  const sortedTables = [...availableTables].sort((a, b) => a.capacity - b.capacity);

  // 1. Try to find a single table that fits the guest count with minimal waste
  const singleTable = sortedTables.find(t => t.capacity >= numberOfGuests);
  if (singleTable) {
    return [singleTable];
  }

  // 2. If no single table is big enough, try to suggest a combination of tables
  // For simplicity, we can sort by capacity descending and keep picking until capacity met
  const combo = [];
  let currentCapacity = 0;
  
  const descTables = [...sortedTables].reverse();
  for (const table of descTables) {
    combo.push(table);
    currentCapacity += table.capacity;
    if (currentCapacity >= numberOfGuests) {
      return combo;
    }
  }

  return []; // Return empty if even all tables combined cannot host the guests
};

/**
 * Wrapper to check overall availability for a restaurant at a certain date and time.
 */
const checkAvailability = async (restaurantId, bookingDate, bookingTime, numberOfGuests) => {
  const availableTables = await getAvailableTables(restaurantId, bookingDate, bookingTime);
  const suggestedTables = suggestTables(availableTables, numberOfGuests);
  
  const totalAvailableCapacity = availableTables.reduce((sum, t) => sum + t.capacity, 0);
  const isAvailable = totalAvailableCapacity >= numberOfGuests && suggestedTables.length > 0;

  return {
    available: isAvailable,
    availableTables,
    suggestedTables,
    conflicts: !isAvailable ? ['Không đủ bàn trống phù hợp cho số khách được yêu cầu'] : [],
  };
};

/**
 * Helper to add status change history to a booking.
 */
const addStatusHistory = async (booking, newStatus, changedBy, note = null) => {
  booking.status = newStatus;
  booking.statusHistory.push({
    status: newStatus,
    changedBy,
    note,
    changedAt: new Date(),
  });
  
  return booking.save();
};

module.exports = {
  BOOKING_CONSTANTS,
  BOOKING_STATUS_TRANSITIONS,
  canTransitionBookingStatus,
  normalizeDate,
  combineDateAndTime,
  checkTimeConflict,
  validateBookingTime,
  validateTableCapacity,
  getAvailableTables,
  suggestTables,
  checkAvailability,
  addStatusHistory,
};
