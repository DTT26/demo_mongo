'use strict';

const jwt = require('jsonwebtoken');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return 'bookeat_dev_secret_change_me';
};

const verifyJwtToken = (token) => jwt.verify(token, getJwtSecret());

module.exports = {
  getJwtSecret,
  verifyJwtToken,
};
