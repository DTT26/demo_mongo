'use strict';

const { ALLOWED_CHAT_IMAGE_MIMES } = require('./chat-upload');

const IMAGE_PREVIEW = '[Hinh anh]';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const createChatPayloadError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const isDataUrl = (value) => typeof value === 'string' && value.trim().toLowerCase().startsWith('data:');

const requireString = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw createChatPayloadError(400, `${label} khong hop le`);
  }
  return value.trim();
};

const sanitizeImageAttachment = (attachment = {}) => {
  const secureUrl = requireString(attachment.secureUrl || attachment.url, 'secureUrl');
  const url = requireString(attachment.url || attachment.secureUrl, 'url');

  if (isDataUrl(secureUrl) || isDataUrl(url)) {
    throw createChatPayloadError(400, 'Khong duoc gui anh base64 qua chat');
  }

  if (!secureUrl.startsWith('https://') || !url.startsWith('https://')) {
    throw createChatPayloadError(400, 'Anh chat phai la URL HTTPS tu Cloudinary');
  }

  try {
    const parsedUrl = new URL(secureUrl);
    if (!parsedUrl.hostname.endsWith('cloudinary.com') || !parsedUrl.pathname.includes('/image/upload/')) {
      throw new Error('invalid cloudinary url');
    }
  } catch {
    throw createChatPayloadError(400, 'Anh chat phai la URL Cloudinary hop le');
  }

  const mimetype = requireString(attachment.mimetype, 'mimetype');
  if (!ALLOWED_CHAT_IMAGE_MIMES.has(mimetype)) {
    throw createChatPayloadError(400, 'Dinh dang anh khong duoc ho tro');
  }

  const publicId = requireString(attachment.publicId, 'publicId');
  const resourceType = attachment.resourceType || 'image';
  if (resourceType !== 'image') {
    throw createChatPayloadError(400, 'Attachment chat chi ho tro anh');
  }

  return {
    type: 'image',
    url,
    secureUrl,
    publicId,
    originalName: typeof attachment.originalName === 'string' ? attachment.originalName.trim() : '',
    mimetype,
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
    width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : null,
    height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : null,
    format: typeof attachment.format === 'string' ? attachment.format.trim() : '',
    resourceType,
  };
};

const normalizeChatMessagePayload = (data = {}) => {
  const content = typeof data.content === 'string' ? data.content.trim() : '';
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map(sanitizeImageAttachment)
    : [];

  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw createChatPayloadError(400, `Moi tin nhan chi duoc gui toi da ${MAX_ATTACHMENTS_PER_MESSAGE} anh`);
  }

  if (!content && attachments.length === 0) {
    throw createChatPayloadError(400, 'Khong duoc gui tin nhan rong');
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    throw createChatPayloadError(400, 'Tin nhan khong duoc vuot qua 2000 ky tu');
  }

  const requestedType = typeof data.messageType === 'string' ? data.messageType.toUpperCase() : '';
  let messageType = 'TEXT';
  if (attachments.length > 0 && content) messageType = 'MIXED';
  else if (attachments.length > 0) messageType = 'IMAGE';
  else if (requestedType === 'SYSTEM') messageType = 'SYSTEM';

  const lastMessagePreview = content ? content.slice(0, 240) : IMAGE_PREVIEW;

  return {
    content,
    attachments,
    messageType,
    lastMessagePreview,
  };
};

module.exports = {
  IMAGE_PREVIEW,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  createChatPayloadError,
  normalizeChatMessagePayload,
  sanitizeImageAttachment,
};
