'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPublicRestaurantFilter,
  makeVietnameseInsensitivePattern,
  tokenizeRestaurantSearch,
} = require('../src/services/restaurant-query.service');

const getRegexFromClause = (clause, field) => clause.$or
  .find((item) => Object.hasOwn(item, field))?.[field]?.$regex;

test('restaurant search tokenizes generic Vietnamese restaurant phrases', () => {
  assert.deepEqual(tokenizeRestaurantSearch('tìm nhà hàng phở'), ['pho']);
  assert.deepEqual(tokenizeRestaurantSearch('món hải sản ở Đà Nẵng'), ['hai', 'san', 'da', 'nang']);
});

test('Vietnamese-insensitive regex matches accented and unaccented restaurant text', () => {
  assert.match('Phở Thìn', new RegExp(makeVietnameseInsensitivePattern('pho'), 'i'));
  assert.match('Đà Nẵng', new RegExp(makeVietnameseInsensitivePattern('Da Nang'), 'i'));
  assert.match('Hải sản ven biển', new RegExp(makeVietnameseInsensitivePattern('hai san'), 'i'));
});

test('restaurant search ignores booking and voucher words in a complex customer request', () => {
  const prompt = 'Toi muon an pho o Da Nang toi mai khoang 7 gio, di 4 nguoi, co voucher nao dung duoc khong, neu con ban thi tao giup toi ban xem truoc dat ban.';
  assert.deepEqual(tokenizeRestaurantSearch(prompt), ['pho', 'da', 'nang']);

  const filter = buildPublicRestaurantFilter({ search: prompt });
  assert.equal(filter.$and.length, 3);

  const [phoClause, daClause, nangClause] = filter.$and;
  assert.match('Pho Thin', new RegExp(getRegexFromClause(phoClause, 'name'), 'i'));
  assert.match('Da Nang', new RegExp(getRegexFromClause(daClause, 'address.city'), 'i'));
  assert.match('Da Nang', new RegExp(getRegexFromClause(nangClause, 'address.city'), 'i'));
});

test('restaurant search treats dish-like cuisineType as a searchable keyword', () => {
  const filter = buildPublicRestaurantFilter({
    cuisineType: 'pho',
    city: 'Da Nang',
  });

  assert.equal(filter.cuisineTypes, undefined);
  assert.ok(Array.isArray(filter.$and));

  const [dishClause, cityClause] = filter.$and;
  assert.match('Pho Thin', new RegExp(getRegexFromClause(dishClause, 'name'), 'i'));
  assert.match('Da Nang', new RegExp(getRegexFromClause(cityClause, 'address.city'), 'i'));
});

test('public restaurant filter can find pho restaurants in Da Nang from natural-language query', () => {
  const filter = buildPublicRestaurantFilter({
    search: 'nhà hàng phở',
    city: 'Da Nang',
  });

  assert.ok(Array.isArray(filter.$and));
  const [cityClause, searchClause] = filter.$and;
  const cityPattern = getRegexFromClause(cityClause, 'address.city');
  const namePattern = getRegexFromClause(searchClause, 'name');
  const descriptionPattern = getRegexFromClause(searchClause, 'description');

  assert.match('Đà Nẵng', new RegExp(cityPattern, 'i'));
  assert.match('Phở Thìn', new RegExp(namePattern, 'i'));
  assert.match('Nhà hàng chuyên phục vụ phở bò Hà Nội', new RegExp(descriptionPattern, 'i'));
});
