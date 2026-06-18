'use strict';

const openSseStream = (res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
};

const writeSseEvent = (res, event, data) => {
  if (res.destroyed || res.writableEnded) return false;
  return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

module.exports = {
  openSseStream,
  writeSseEvent,
};
