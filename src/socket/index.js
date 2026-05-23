'use strict';

const { Server } = require('socket.io');
const { registerChatSocket } = require('./chat.socket');

const createSocketServer = (httpServer, allowedOrigins) => {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  registerChatSocket(io);
  return io;
};

module.exports = { createSocketServer };
