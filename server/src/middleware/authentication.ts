```typescript
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { v4 as uuidv4 } from 'uuid';

interface AuthTokenPayload extends JwtPayload {
  userId: string;
  roles: string[];
  sessionId: string;
  refreshTokenId?: string;
}

interface Session {
  sessionId: string;
  userId: string;
  valid: boolean;
  createdAt: Date;
  lastAccessedAt: Date;
  refreshTokenId: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

// In-memory session store (replace with DB in production)
const sessions = new Map<string, Session>();

// Rate limiter: 100 requests per 15 minutes per user
const rateLimiter = new RateLimiterMemory({
  points: 100,
  duration: 900,
  keyPrefix: 'auth_middleware'
});

function auditLog(userId: string | null, action: string, info: Record<string, any> = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, userId, action, ...info }));
}

async function rateLimit(userId: string) {
  try {
    await rateLimiter.consume(userId);
  } catch {
    throw new AuthError('Too many requests, please try again later', 429);
  }
}

class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function verifyToken(token: string, secret: string): Promise<AuthTokenPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, secret, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded as AuthTokenPayload);
    });
  });
}

// Middleware for authenticating and authorizing user
export function authenticate(requiredRoles: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sentToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const sentRefreshToken = req.headers['x-refresh-token'] as string | undefined;

    if (!sentToken) {
      auditLog(null, 'AUTH_FAILURE', { reason: 'Missing Access Token', ip: req.ip });
      return res.status(401).json({ error: 'Authentication token required' });
    }

    try {
      // Parse and verify access token
      let payload = await verifyToken(sentToken, JWT_SECRET);
      const session = sessions.get(payload.sessionId);

      if (!session || !session.valid || session.userId !== payload.userId) {
        auditLog(payload.userId, 'AUTH_FAILURE', { reason: 'Invalid Session', ip: req.ip });
        throw new AuthError('Invalid session, please login again');
      }

      await rateLimit(payload.userId);

      // Update session last accessed
      session.lastAccessedAt = new Date();

      // Role check
      if (requiredRoles.length && !requiredRoles.some(r => payload.roles.includes(r))) {
        auditLog(payload.userId, 'AUTH_FAILURE', { reason: 'Access Denied (Role)', ip: req.ip });
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }

      // Attach user data to request
      (req as any).auth = {
        userId: payload.userId,
        roles: payload.roles,
        sessionId: payload.sessionId
      };

      auditLog(payload.userId, 'AUTH_SUCCESS', { ip: req.ip });

      return next();
    } catch (accessErr) {
      // Token might be expired, try refresh token flow if provided
      if (!sentRefreshToken) {
        auditLog(null, 'AUTH_FAILURE', { reason: 'Missing Refresh Token', ip: req.ip });
        return res.status(401).json({ error: 'Authentication required and refresh token missing' });
      }

      let refreshPayload: AuthTokenPayload;
      try {
        refreshPayload = await verifyToken(sentRefreshToken, JWT_REFRESH_SECRET);
      } catch {
        auditLog(null, 'AUTH_FAILURE', { reason: 'Invalid Refresh Token', ip: req.ip });
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const session = sessions.get(refreshPayload.sessionId);
      if (
        !session ||
        !session.valid ||
        session.userId !== refreshPayload.userId ||
        session.refreshTokenId !== refreshPayload.refreshTokenId
      ) {
        auditLog(refreshPayload.userId, 'AUTH_FAILURE', { reason: 'Invalid Refresh Session', ip: req.ip });
        return res.status(401).json({ error: 'Invalid refresh session, please login again' });
      }

      // Issue new access token and refresh token
      const newAccessToken = jwt.sign(
        {
          userId: refreshPayload.userId,
          roles: refreshPayload.roles,
          sessionId: refreshPayload.sessionId
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      const newRefreshTokenId = uuidv4();
      const newRefreshToken = jwt.sign(
        {
          userId: refreshPayload.userId,
          roles: refreshPayload.roles,
          sessionId: refreshPayload.sessionId,
          refreshTokenId: newRefreshTokenId
        },
        JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRY }
      );

      // Rotate refresh tokenId in session
      session.refreshTokenId = newRefreshTokenId;
      session.lastAccessedAt = new Date();

      auditLog(refreshPayload.userId, 'TOKEN_REFRESH', { ip: req.ip });

      // Set new tokens in headers
      res.setHeader('x-access-token', newAccessToken);
      res.setHeader('x-refresh-token', newRefreshToken);

      // Attach user data to request
      (req as any).auth = {
        userId: refreshPayload.userId,
        roles: refreshPayload.roles,
        sessionId: refreshPayload.sessionId
      };

      await rateLimit(refreshPayload.userId);

      if (requiredRoles.length && !requiredRoles.some(r => refreshPayload.roles.includes(r))) {
        auditLog(refreshPayload.userId, 'AUTH_FAILURE', { reason: 'Access Denied (Role)', ip: req.ip });
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }

      return next();
    }
  };
}

// Utility to create a new session and tokens on login
export function createSession(userId: string, roles: string[]): { accessToken: string; refreshToken: string; sessionId: string } {
  const sessionId = uuidv4();
  const refreshTokenId = uuidv4();

  const session: Session = {
    sessionId,
    userId,
    valid: true,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    refreshTokenId
  };
  sessions.set(sessionId, session);

  const accessToken = jwt.sign({ userId, roles, sessionId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign({ userId, roles, sessionId, refreshTokenId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });

  auditLog(userId, 'SESSION_CREATE', { sessionId });

  return { accessToken, refreshToken, sessionId };
}

// Utility to invalidate session (logout)
export function invalidateSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.valid = false;
    auditLog(session.userId, 'SESSION_INVALIDATE', { sessionId });
  }
}
```