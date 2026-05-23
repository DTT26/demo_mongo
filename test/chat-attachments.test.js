const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CHAT_IMAGE_SIZE,
  validateChatImageFile,
} = require('../src/utils/chat-upload');
const {
  normalizeChatMessagePayload,
} = require('../src/utils/chat-attachments');

const cloudinaryImage = {
  type: 'image',
  url: 'https://res.cloudinary.com/demo/image/upload/v1/bookeat/chat/photo.jpg',
  secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/bookeat/chat/photo.jpg',
  publicId: 'bookeat/chat/photo',
  originalName: 'photo.jpg',
  mimetype: 'image/jpeg',
  size: 12345,
  width: 800,
  height: 600,
  format: 'jpg',
  resourceType: 'image',
};

test('validateChatImageFile accepts supported images under 5MB', () => {
  const file = {
    originalname: 'food.webp',
    mimetype: 'image/webp',
    size: MAX_CHAT_IMAGE_SIZE - 1,
  };

  assert.equal(validateChatImageFile(file), true);
});

test('validateChatImageFile rejects svg, non-image, and files over 5MB', () => {
  assert.throws(() => validateChatImageFile({
    originalname: 'unsafe.svg',
    mimetype: 'image/svg+xml',
    size: 1000,
  }), /dinh dang anh khong duoc ho tro/i);

  assert.throws(() => validateChatImageFile({
    originalname: 'note.txt',
    mimetype: 'text/plain',
    size: 1000,
  }), /chi chap nhan file anh/i);

  assert.throws(() => validateChatImageFile({
    originalname: 'large.png',
    mimetype: 'image/png',
    size: MAX_CHAT_IMAGE_SIZE + 1,
  }), /toi da 5mb/i);
});

test('normalizeChatMessagePayload allows image-only messages and builds image preview', () => {
  const payload = normalizeChatMessagePayload({
    content: '',
    attachments: [cloudinaryImage],
  });

  assert.equal(payload.content, '');
  assert.equal(payload.messageType, 'IMAGE');
  assert.equal(payload.lastMessagePreview, '[Hinh anh]');
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].secureUrl, cloudinaryImage.secureUrl);
});

test('normalizeChatMessagePayload supports mixed caption plus image', () => {
  const payload = normalizeChatMessagePayload({
    content: 'Ban xem mon nay nhe',
    attachments: [cloudinaryImage],
  });

  assert.equal(payload.messageType, 'MIXED');
  assert.equal(payload.lastMessagePreview, 'Ban xem mon nay nhe');
});

test('normalizeChatMessagePayload rejects empty and raw/base64 attachment messages', () => {
  assert.throws(() => normalizeChatMessagePayload({
    content: '   ',
    attachments: [],
  }), /khong duoc gui tin nhan rong/i);

  assert.throws(() => normalizeChatMessagePayload({
    content: '',
    attachments: [{
      ...cloudinaryImage,
      secureUrl: 'data:image/png;base64,abc',
      url: 'data:image/png;base64,abc',
    }],
  }), /khong duoc gui anh base64/i);
});
