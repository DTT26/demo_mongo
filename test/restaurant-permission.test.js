const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  isRestaurantOwnedBy,
  createForbiddenError,
} = require('../src/utils/restaurant-permission');

test('isRestaurantOwnedBy accepts matching ObjectId values', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const restaurant = { ownerId };

  assert.equal(isRestaurantOwnedBy(restaurant, ownerId.toString()), true);
});

test('isRestaurantOwnedBy rejects different owner values', () => {
  const restaurant = { ownerId: new mongoose.Types.ObjectId() };
  const otherOwner = new mongoose.Types.ObjectId();

  assert.equal(isRestaurantOwnedBy(restaurant, otherOwner), false);
});

test('createForbiddenError returns a 403 error for unauthorized restaurant access', () => {
  const error = createForbiddenError();

  assert.equal(error.status, 403);
  assert.match(error.message, /khong co quyen|không có quyền/i);
});
