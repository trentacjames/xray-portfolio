// Access code for the upload feature. The code lives only in the
// XRAY_UPLOAD_CODE environment variable on the server, never in the repo.

const crypto = require('crypto');

const MAX_FAILS = 5;
const LOCK_MS   = 15 * 60 * 1000;
const fails     = new Map(); // ip -> { count, until } (best effort: per server instance)

const digest = s => crypto.createHash('sha256').update(String(s)).digest();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

// Returns null when allowed, otherwise { status, error }.
function checkAccess(req, { code = process.env.XRAY_UPLOAD_CODE || process.env.xray_upload_code, now = Date.now() } = {}) {
  if (!code) return { status: 503, error: 'Statement upload is not enabled on this server.' };

  const ip = clientIp(req);
  const entry = fails.get(ip);
  if (entry && entry.until > now) {
    return { status: 429, error: 'Too many wrong codes. Try again in 15 minutes.' };
  }

  const given = req.headers['x-access-code'] || '';
  const ok = crypto.timingSafeEqual(digest(given), digest(code));
  if (ok) { fails.delete(ip); return null; }

  const lockExpired = entry && entry.until && entry.until <= now;
  const count = (entry && !lockExpired ? entry.count : 0) + 1;
  fails.set(ip, { count, until: count >= MAX_FAILS ? now + LOCK_MS : 0 });
  return { status: 401, error: 'Wrong access code.' };
}

function _resetForTests() { fails.clear(); }

module.exports = { checkAccess, _resetForTests };
