'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRestaurantImages,
  sanitizeRestaurantImagePayload,
  validateRestaurantImagePayload,
} = require('../src/utils/restaurant-images');

test('restaurant image normalizer maps legacy images into logo cover and gallery fallbacks', () => {
  const legacyUrl = 'https://example.com/legacy.jpg';
  const result = normalizeRestaurantImages({
    logo: null,
    coverImage: null,
    galleryImages: [],
    images: [{ url: legacyUrl, isPrimary: true }],
  });

  assert.equal(result.logo, legacyUrl);
  assert.equal(result.coverImage, legacyUrl);
  assert.equal(result.coverImageUrl, legacyUrl);
  assert.deepEqual(result.galleryImages, [legacyUrl]);
  assert.equal(result.primaryImage, legacyUrl);
});

test('restaurant image normalizer prefers explicit cover and gallery fields', () => {
  const result = normalizeRestaurantImages({
    logo: 'https://example.com/logo.jpg',
    coverImage: 'https://example.com/cover.jpg',
    galleryImages: ['https://example.com/space.jpg'],
    images: [{ url: 'https://example.com/legacy.jpg', isPrimary: true }],
  });

  assert.equal(result.logo, 'https://example.com/logo.jpg');
  assert.equal(result.coverImage, 'https://example.com/cover.jpg');
  assert.deepEqual(result.galleryImages, ['https://example.com/space.jpg']);
  assert.equal(result.primaryImage, 'https://example.com/cover.jpg');
});

test('restaurant image payload validation rejects invalid image fields', () => {
  assert.deepEqual(validateRestaurantImagePayload({
    logo: 'notaurl',
    coverImage: 'ftp://example.com/cover.jpg',
    galleryImages: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.jpg`),
  }), [
    'Logo nha hang phai la URL anh hop le',
    'Anh bia nha hang phai la URL anh hop le',
    'Thu vien anh nha hang toi da 10 anh',
  ]);
});

test('restaurant image payload sanitizer keeps only clean gallery URLs and cover alias', () => {
  const payload = {
    logo: ' https://example.com/logo.jpg ',
    coverImageUrl: 'https://example.com/cover.jpg',
    galleryImages: [
      'https://example.com/space.jpg',
      { url: 'https://example.com/space.jpg' },
      { secureUrl: 'https://example.com/front.jpg' },
      '',
    ],
  };

  sanitizeRestaurantImagePayload(payload);

  assert.equal(payload.logo, 'https://example.com/logo.jpg');
  assert.equal(payload.coverImage, 'https://example.com/cover.jpg');
  assert.equal(Object.hasOwn(payload, 'coverImageUrl'), false);
  assert.deepEqual(payload.galleryImages, [
    'https://example.com/space.jpg',
    'https://example.com/front.jpg',
  ]);
});
