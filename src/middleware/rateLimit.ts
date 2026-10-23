import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const PUBLIC_FORM_MAX = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function hitLimit(
  key: string,
  max: number,
  message: string,
  res: Response,
  next: NextFunction
) {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  current.count += 1;
  if (current.count > max) {
    return res.status(429).json({ error: message });
  }
  next();
}

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const identity = `${req.ip}:${req.body?.email || req.body?.phone || 'anon'}`;
  hitLimit(identity, MAX_ATTEMPTS, 'Too many login attempts. Try again later.', res, next);
}

/** Stricter limit for public wholesaler application submissions. */
export function publicFormRateLimit(req: Request, res: Response, next: NextFunction) {
  const identity = `form:${req.ip}:${String(req.body?.email || 'anon').toLowerCase()}`;
  hitLimit(identity, PUBLIC_FORM_MAX, 'Too many applications from this address. Try again later.', res, next);
}
