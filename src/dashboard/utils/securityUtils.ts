```typescript
import jwt, { JwtPayload, VerifyErrors } from 'jsonwebtoken';
import crypto from 'crypto';
import { promisify } from 'util';

const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret';
const JWT_EXPIRATION = '15m';
const JWT_REFRESH_EXPIRATION = '7d';

const ENCRYPTION_KEY = process.env.SEC_ENCRYPTION_KEY || '32_byte_encryption_key_1234567890abcd'; // Must be 32 bytes for AES-256
const IV_LENGTH = 16; // For AES, this is always 16

type Role = 'clinician' | 'admin' | 'patient' | 'guest';

interface JwtUserPayload extends JwtPayload {
  userId: string;
  roles: Role[];
  permissions: string[];
}

interface AuditLog {
  timestamp: string;
  userId: string;
  action: string;
  resource: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Validate JWT token and return decoded payload if valid, else null.
 */
export async function validateJwtToken(
  token: string,
  refresh = false
): Promise<JwtUserPayload | null> {
  const secret = refresh ? JWT_REFRESH_SECRET : JWT_SECRET;
  const verifyAsync = promisify<string, jwt.Secret, jwt.VerifyOptions, JwtUserPayload | string>(jwt.verify);

  try {
    const decoded = (await verifyAsync(token, secret)) as JwtUserPayload;
    if (!decoded.userId || !decoded.roles) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate new JWT token (and refresh token optionally).
 */
export function generateJwtTokens(payload: {
  userId: string;
  roles: Role[];
  permissions: string[];
}): { accessToken: string; refreshToken: string } {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRATION });
  return { accessToken, refreshToken };
}

/**
 * Check if user has required role(s).
 */
export function hasRequiredRole(userRoles: Role[], requiredRoles: Role | Role[]): boolean {
  if (typeof requiredRoles === 'string') requiredRoles = [requiredRoles];
  return requiredRoles.some((role) => userRoles.includes(role));
}

/**
 * Check if clinician has permission for a specified operation.
 */
export function clinicianHasPermission(
  userRoles: Role[],
  userPermissions: string[],
  requiredPermissions: string[]
): boolean {
  if (!hasRequiredRole(userRoles, 'clinician')) return false;
  return requiredPermissions.every((rp) => userPermissions.includes(rp));
}

/**
 * Encrypt sensitive data for storage/transmission using AES-256-CBC.
 */
export function encryptSensitiveData(plainText: string): string {
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits) length');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypt sensitive data encrypted with encryptSensitiveData.
 */
export function decryptSensitiveData(encryptedText: string): string {
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits) length');
  }
  const [ivBase64, encryptedData] = encryptedText.split(':');
  if (!ivBase64 || !encryptedData) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = Buffer.from(ivBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Audit log of data access event.
 */
export async function logAuditEvent(event: AuditLog): Promise<void> {
  // Replace with actual logger or DB insertion logic per environment or ORM
  const logEntry = JSON.stringify(event);
  // Example: append audit logs to a protected file or send to logging service
  process.stdout.write(`[AUDIT LOG] ${logEntry}\n`);
}

/**
 * Session timeout management: returns timestamp of expiry given inactivity timeout in minutes.
 */
export function getSessionExpiryTimestamp(inactivityTimeoutMins: number): number {
  const now = Date.now();
  return now + inactivityTimeoutMins * 60 * 1000;
}

/**
 * Verify session is still valid based on expiry timestamp.
 */
export function isSessionExpired(expiryTimestamp: number): boolean {
  return Date.now() > expiryTimestamp;
}

/**
 * Secure data transmission helper - sets HTTP headers for security.
 */
export function getSecureHeaders(): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
}

/**
 * Input sanitization to prevent injection attacks, strips disallowed characters and trims string.
 */
export function sanitizeInput(input: string, options?: { allowHtml?: boolean }): string {
  let sanitized = input.trim();

  if (!options?.allowHtml) {
    // Remove all HTML tags
    sanitized = sanitized.replace(/<[^>]*>/g, '');
  }

  // Escape &, <, >, ", ', / for additional security
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return sanitized;
}
```