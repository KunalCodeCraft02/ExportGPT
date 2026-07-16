/**
 * Simple in-memory rate limiter for WhatsApp webhook.
 * Limits requests per phone number to prevent abuse.
 */

const requestCounts = new Map();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up every 5 minutes
const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 30; // Max 30 requests per minute per phone

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > WINDOW_MS * 2) {
      requestCounts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Check if a request should be allowed.
 * @param {string} phone - The phone number
 * @returns {boolean} true if allowed, false if rate limited
 */
export function isAllowed(phone) {
  const now = Date.now();
  const key = String(phone || "").trim();

  if (!key) return true;

  const data = requestCounts.get(key);

  if (!data || now - data.windowStart > WINDOW_MS) {
    // New window
    requestCounts.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (data.count >= MAX_REQUESTS) {
    return false;
  }

  data.count++;
  return true;
}

/**
 * Get remaining requests for a phone number.
 */
export function getRemainingRequests(phone) {
  const key = String(phone || "").trim();
  const data = requestCounts.get(key);
  if (!data || Date.now() - data.windowStart > WINDOW_MS) {
    return MAX_REQUESTS;
  }
  return Math.max(0, MAX_REQUESTS - data.count);
}

export default { isAllowed, getRemainingRequests };
