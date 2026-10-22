import type { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../auth/tokens';
import { hasRole } from '../auth/rbac';
import type { Role } from '../auth/types';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = verifyAuthToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    return next();
  }
  try {
    req.user = verifyAuthToken(token);
  } catch {
    req.user = undefined;
  }
  next();
}

export function authorize(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasRole(req.user, roles)) {
      return res.status(req.user ? 403 : 401).json({ error: req.user ? 'Forbidden' : 'Unauthorized' });
    }
    next();
  };
}
