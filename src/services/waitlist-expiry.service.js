'use strict';

const waitlistService = require('./waitlist.service');
const notificationService = require('./waitlist-notification.service');

let waitlistExpiryTimer = null;

const runWaitlistExpirySweep = async (io = null) => {
  const expired = await waitlistService.expireOverdueWaitlists();
  expired.forEach((waitlist) => {
    notificationService.notifyWaitlistExpired(io, waitlist);
  });
  return expired.length;
};

const startWaitlistExpiryJob = (io = null) => {
  if (waitlistExpiryTimer) return waitlistExpiryTimer;

  const intervalMs = Math.max(
    30000,
    Number(process.env.WAITLIST_EXPIRY_INTERVAL_MS || 60000)
  );

  waitlistExpiryTimer = setInterval(() => {
    runWaitlistExpirySweep(io).catch((error) => {
      console.warn(`[WaitlistExpiry] ${error.message}`);
    });
  }, intervalMs);

  waitlistExpiryTimer.unref?.();
  return waitlistExpiryTimer;
};

const stopWaitlistExpiryJob = () => {
  if (waitlistExpiryTimer) clearInterval(waitlistExpiryTimer);
  waitlistExpiryTimer = null;
};

module.exports = {
  runWaitlistExpirySweep,
  startWaitlistExpiryJob,
  stopWaitlistExpiryJob,
};
