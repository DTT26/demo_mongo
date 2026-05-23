'use strict';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchKeyword = (keyword) => (typeof keyword === 'string' ? keyword.trim() : '');

const buildMessageSearchRegex = (keyword) => {
  const normalized = normalizeSearchKeyword(keyword);
  if (!normalized) {
    const error = new Error('Tu khoa tim kiem khong duoc rong');
    error.status = 400;
    throw error;
  }
  return new RegExp(escapeRegex(normalized), 'i');
};

const createSearchSnippet = (content = '', keyword = '', radius = 32) => {
  const text = typeof content === 'string' ? content : '';
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!text || !normalizedKeyword) return '';

  const index = text.toLocaleLowerCase('vi-VN').indexOf(normalizedKeyword.toLocaleLowerCase('vi-VN'));
  if (index === -1) return text.slice(0, radius * 2);

  const sideRadius = Math.max(4, Math.floor(radius / 2));
  let start = Math.max(0, index - sideRadius);
  let end = Math.min(text.length, index + normalizedKeyword.length + sideRadius);

  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/.test(text[end])) end += 1;

  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
};

module.exports = {
  buildMessageSearchRegex,
  createSearchSnippet,
  escapeRegex,
  normalizeSearchKeyword,
};
