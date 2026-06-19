'use strict';

const MAX_GALLERY_IMAGES = 10;
const IMAGE_URL_REGEX = /^https?:\/\/\S+$/i;

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const getImageUrl = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = cleanString(value);
    return trimmed || null;
  }
  if (typeof value === 'object') {
    return getImageUrl(value.url || value.secureUrl || value.imageUrl);
  }
  return null;
};

const isValidImageUrl = (value) => {
  const url = getImageUrl(value);
  return !url || IMAGE_URL_REGEX.test(url);
};

const uniqueImageUrls = (values = []) => {
  const seen = new Set();
  return values
    .map(getImageUrl)
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
};

const getLegacyImageUrls = (restaurant = {}) => {
  if (!Array.isArray(restaurant.images)) return [];
  return uniqueImageUrls(restaurant.images);
};

const normalizeGalleryImages = (value) => {
  if (!Array.isArray(value)) return [];
  return uniqueImageUrls(value).slice(0, MAX_GALLERY_IMAGES);
};

const normalizeRestaurantImages = (restaurant = {}) => {
  const legacyImages = getLegacyImageUrls(restaurant);
  const explicitGallery = normalizeGalleryImages(restaurant.galleryImages);
  const galleryImages = explicitGallery.length ? explicitGallery : legacyImages;
  const explicitCover = getImageUrl(restaurant.coverImage || restaurant.coverImageUrl);
  const explicitLogo = getImageUrl(restaurant.logo);

  const logo = explicitLogo || legacyImages[0] || explicitCover || galleryImages[0] || null;
  const coverImage = explicitCover || galleryImages[0] || legacyImages[0] || explicitLogo || null;

  return {
    logo,
    coverImage,
    coverImageUrl: coverImage,
    galleryImages,
    primaryImage: coverImage || galleryImages[0] || logo || null,
  };
};

const validateRestaurantImagePayload = (payload = {}) => {
  const errors = [];

  if (Object.hasOwn(payload, 'logo') && !isValidImageUrl(payload.logo)) {
    errors.push('Logo nha hang phai la URL anh hop le');
  }

  if (Object.hasOwn(payload, 'coverImage') && !isValidImageUrl(payload.coverImage)) {
    errors.push('Anh bia nha hang phai la URL anh hop le');
  }

  if (Object.hasOwn(payload, 'coverImageUrl') && !isValidImageUrl(payload.coverImageUrl)) {
    errors.push('Anh bia nha hang phai la URL anh hop le');
  }

  if (Object.hasOwn(payload, 'galleryImages')) {
    if (!Array.isArray(payload.galleryImages)) {
      errors.push('Thu vien anh nha hang phai la danh sach anh');
    } else {
      if (payload.galleryImages.length > MAX_GALLERY_IMAGES) {
        errors.push(`Thu vien anh nha hang toi da ${MAX_GALLERY_IMAGES} anh`);
      }
      if (payload.galleryImages.some((image) => !isValidImageUrl(image))) {
        errors.push('Thu vien anh nha hang chi duoc chua URL anh hop le');
      }
    }
  }

  return errors;
};

const sanitizeRestaurantImagePayload = (payload = {}) => {
  if (Object.hasOwn(payload, 'logo')) {
    payload.logo = getImageUrl(payload.logo) || null;
  }

  if (Object.hasOwn(payload, 'coverImageUrl') && !Object.hasOwn(payload, 'coverImage')) {
    payload.coverImage = payload.coverImageUrl;
  }

  if (Object.hasOwn(payload, 'coverImage')) {
    payload.coverImage = getImageUrl(payload.coverImage) || null;
  }

  if (Object.hasOwn(payload, 'coverImageUrl')) {
    delete payload.coverImageUrl;
  }

  if (Object.hasOwn(payload, 'galleryImages')) {
    payload.galleryImages = normalizeGalleryImages(payload.galleryImages);
  }

  return payload;
};

module.exports = {
  MAX_GALLERY_IMAGES,
  getImageUrl,
  normalizeGalleryImages,
  normalizeRestaurantImages,
  sanitizeRestaurantImagePayload,
  validateRestaurantImagePayload,
};
