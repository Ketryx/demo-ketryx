```typescript
import EventEmitter from 'events';

export type Role = 'admin' | 'clinician' | 'researcher';

export type Permission =
  | 'read:patient_data'
  | 'write:patient_data'
  | 'read:research_data'
  | 'write:research_data'
  | 'manage:users'
  | 'emergency:access';

export interface User {
  id: string;
  roles: Role[];
  permissions: Permission[];
}

export interface Session {
  userId: string;
  sessionId: string;
  lastAccess: number;
  createdAt: number;
  isActive: boolean;
  timeoutMs: number;
}

export interface PatientRecord {
  patientId: string;
  data: Record<string, any>;
  sensitiveFields: string[];
}

export interface AccessLogEntry {
  timestamp: number;
  userId: string;
  patientId?: string;
  sessionId?: string;
  action: string;
  details?: any;
  emergencyAccess?: boolean;
  breakGlassReason?: string;
}

interface AuthSystem {
  validateToken(token: string): Promise<User | null>;
  on(event: 'login' | 'logout', listener: (userId: string, sessionId: string) => void): this;
}

export class AccessControlService extends EventEmitter {
  private sessions = new Map<string, Session>();
  private logs: AccessLogEntry[] = [];

  constructor(private authSystem: AuthSystem, private sessionTimeoutMs = 30 * 60 * 1000) {
    super();
    this.authSystem.on('login', (userId, sessionId) => this.createSession(userId, sessionId));
    this.authSystem.on('logout', (userId, sessionId) => this.terminateSession(sessionId));
    setInterval(() => this.enforceSessionTimeouts(), 5 * 60 * 1000).unref();
  }

  private createSession(userId: string, sessionId: string) {
    const now = Date.now();
    this.sessions.set(sessionId, {
      userId,
      sessionId,
      createdAt: now,
      lastAccess: now,
      isActive: true,
      timeoutMs: this.sessionTimeoutMs,
    });
  }

  private terminateSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
    }
  }

  private enforceSessionTimeouts() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.isActive) {
        this.sessions.delete(sessionId);
        continue;
      }
      if (now - session.lastAccess > session.timeoutMs) {
        session.isActive = false;
        this.sessions.delete(sessionId);
        this.log({
          timestamp: now,
          userId: session.userId,
          sessionId,
          action: 'session_timeout',
        });
      }
    }
  }

  private updateSessionAccess(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.isActive) {
      session.lastAccess = Date.now();
    }
  }

  private log(entry: AccessLogEntry) {
    this.logs.push(entry);
  }

  getAuditLogs(): readonly AccessLogEntry[] {
    return this.logs.slice();
  }

  async validateAccess(
    user: User,
    sessionId: string,
    permission: Permission,
    patientRecord?: PatientRecord,
    emergencyBreakGlassReason?: string
  ): Promise<{ granted: boolean; anonymizedData?: Record<string, any> }> {
    if (!this.isSessionActive(sessionId, user.id)) {
      return { granted: false };
    }
    this.updateSessionAccess(sessionId);

    const isEmergencyAccess = !!emergencyBreakGlassReason;
    const hasPermission = this.checkUserPermission(user, permission);

    if (!hasPermission && !isEmergencyAccess) {
      this.log({
        timestamp: Date.now(),
        userId: user.id,
        sessionId,
        action: 'access_denied',
        details: { permission },
      });
      return { granted: false };
    }

    if (isEmergencyAccess && !user.permissions.includes('emergency:access')) {
      this.log({
        timestamp: Date.now(),
        userId: user.id,
        sessionId,
        action: 'emergency_access_denied',
        breakGlassReason: emergencyBreakGlassReason,
      });
      return { granted: false };
    }

    let responseData: Record<string, any> | undefined;

    if (patientRecord) {
      if (user.roles.includes('researcher')) {
        responseData = this.anonymize(patientRecord);
      } else {
        responseData = patientRecord.data;
      }
      this.log({
        timestamp: Date.now(),
        userId: user.id,
        patientId: patientRecord.patientId,
        sessionId,
        action: isEmergencyAccess ? 'emergency_access' : 'access_granted',
        emergencyAccess: isEmergencyAccess,
        breakGlassReason: emergencyBreakGlassReason,
      });
    } else {
      this.log({
        timestamp: Date.now(),
        userId: user.id,
        sessionId,
        action: isEmergencyAccess ? 'emergency_access' : 'access_granted',
        emergencyAccess: isEmergencyAccess,
        breakGlassReason: emergencyBreakGlassReason,
      });
    }

    return { granted: true, anonymizedData: responseData };
  }

  private isSessionActive(sessionId: string, userId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.isActive && session.userId === userId;
  }

  private checkUserPermission(user: User, permission: Permission): boolean {
    if (user.permissions.includes(permission)) return true;
    // Admins have all permissions implicitly
    if (user.roles.includes('admin')) return true;

    // Fine-grained RBAC: Clinician and Researcher default permissions
    if (user.roles.includes('clinician')) {
      if (permission.startsWith('read:patient_data') || permission.startsWith('write:patient_data')) {
        return user.permissions.includes(permission);
      }
    }
    if (user.roles.includes('researcher')) {
      if (permission.startsWith('read:research_data') || permission.startsWith('write:research_data')) {
        return user.permissions.includes(permission);
      }
    }
    return false;
  }

  private anonymize(record: PatientRecord): Record<string, any> {
    const clone = { ...record.data };
    for (const field of record.sensitiveFields) {
      if (clone.hasOwnProperty(field)) {
        clone[field] = null;
      }
    }
    return clone;
  }

  // Emergency access uses break-glass procedure
  async requestEmergencyAccess(
    user: User,
    sessionId: string,
    patientRecord: PatientRecord,
    reason: string
  ): Promise<{ granted: boolean; data?: Record<string, any> }> {
    if (!this.isSessionActive(sessionId, user.id)) {
      return { granted: false };
    }
    this.updateSessionAccess(sessionId);

    if (!user.permissions.includes('emergency:access')) {
      this.log({
        timestamp: Date.now(),
        userId: user.id,
        patientId: patientRecord.patientId,
        sessionId,
        action: 'emergency_access_denied',
        breakGlassReason: reason,
      });
      return { granted: false };
    }

    this.log({
      timestamp: Date.now(),
      userId: user.id,
      patientId: patientRecord.patientId,
      sessionId,
      action: 'emergency_access_granted',
      emergencyAccess: true,
      breakGlassReason: reason,
    });

    return { granted: true, data: patientRecord.data };
  }
}
```