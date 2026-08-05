// ─── IN-MEMORY RATE LIMITER ─────────────────────────────────────────────────
// Zero-dependency sliding-window limiter, keyed per client IP.
// Tune via env: RATE_LIMIT_MAX (requests per window) and RATE_LIMIT_WINDOW_MS.
// Works on any host; fine for a single-instance deployment. If you scale to
// multiple instances, swap this for a Redis-backed limiter.

const MAX = Number(process.env.RATE_LIMIT_MAX) || 30;
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;

function createRateLimiter({ max = MAX, windowMs = WINDOW_MS, keyFn = (req) => req.ip }) {
    const hits = new Map();

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [k, entries] of hits) {
            const alive = entries.filter((t) => now - t < windowMs);
            if (alive.length === 0) hits.delete(k);
            else hits.set(k, alive);
        }
    }, Math.max(windowMs * 10, 10000));
    if (typeof sweep.unref === 'function') sweep.unref();

    return function rateLimit(req, res, next) {
        const key = String(keyFn(req) || 'unknown');
        const now = Date.now();
        const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
        if (recent.length >= max) {
            return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
        }
        recent.push(now);
        hits.set(key, recent);
        next();
    };
}

module.exports = { createRateLimiter };
