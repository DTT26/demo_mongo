'use strict';

const mongoose = require('mongoose');

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const validateWaitlistInput = (req, res, next) => {
  const {
    restaurantId,
    preferredDate,
    preferredTime,
    numberOfGuests,
    customerName,
    customerPhone,
    customerEmail,
    note,
    maxWaitMinutes,
    tables,
    tableIds,
    dishes,
    services,
  } = req.body;

  const errors = [];

  if (!restaurantId || !isObjectId(restaurantId)) {
    errors.push('Restaurant ID khong hop le hoac bi thieu');
  }

  if (!preferredDate || Number.isNaN(Date.parse(preferredDate))) {
    errors.push('Ngay mong muon khong hop le hoac bi thieu');
  }

  if (!preferredTime || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(preferredTime)) {
    errors.push('Gio mong muon phai dung dinh dang HH:mm');
  }

  const guests = Number(numberOfGuests);
  if (!Number.isFinite(guests) || guests < 1 || guests > 100) {
    errors.push('So luong khach phai tu 1 den 100');
  }

  if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
    errors.push('Ten khach hang la bat buoc');
  } else if (customerName.trim().length > 200) {
    errors.push('Ten khach hang khong duoc vuot qua 200 ky tu');
  }

  const phoneRegex = /^(0[35789][0-9]{8}|02[0-9]{9})$/;
  if (!customerPhone || !phoneRegex.test(customerPhone.trim())) {
    errors.push('So dien thoai khong hop le');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customerEmail || !emailRegex.test(customerEmail.trim())) {
    errors.push('Email khong hop le');
  }

  if (note && note.length > 500) {
    errors.push('Ghi chu khong duoc vuot qua 500 ky tu');
  }

  if (maxWaitMinutes !== undefined) {
    const wait = Number(maxWaitMinutes);
    if (!Number.isFinite(wait) || wait < 5 || wait > 240) {
      errors.push('Thoi gian cho toi da phai tu 5 den 240 phut');
    }
  }

  const arrayFields = { tables, tableIds, dishes, services };
  Object.entries(arrayFields).forEach(([field, value]) => {
    if (value !== undefined && !Array.isArray(value)) {
      errors.push(`${field} phai la mot mang`);
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Thong tin danh sach cho khong hop le',
      errors,
    });
  }

  next();
};

const validateWaitlistPatch = (req, res, next) => {
  const errors = [];

  if (req.body.note !== undefined && String(req.body.note).length > 500) {
    errors.push('Ghi chu khong duoc vuot qua 500 ky tu');
  }

  if (req.body.maxWaitMinutes !== undefined) {
    const wait = Number(req.body.maxWaitMinutes);
    if (!Number.isFinite(wait) || wait < 5 || wait > 240) {
      errors.push('Thoi gian cho toi da phai tu 5 den 240 phut');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Thong tin cap nhat khong hop le',
      errors,
    });
  }

  next();
};

module.exports = {
  validateWaitlistInput,
  validateWaitlistPatch,
};
