```ts
export enum StatusCode {
  SUCCESS = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_ERROR = 500,
}

export enum DataCategory {
  VITAL_SIGNS = 'vital_signs',
  LAB_RESULTS = 'lab_results',
  MEDICATIONS = 'medications',
  DIAGNOSES = 'diagnoses',
  IMAGING = 'imaging',
  OTHER = 'other',
}

export interface PatientMetadata {
  id: string
  name: string
  dob: string // ISO 8601 date string
  sex: 'male' | 'female' | 'other' | 'unknown'
  ethnicity?: string
  admissionDate?: string // ISO 8601
  dischargeDate?: string // ISO 8601 | null if still admitted
}

export interface ClinicalMeasurement {
  category: DataCategory
  measurementId: string
  displayName: string
  value: number | string | null
  unit?: string
  recordedAt: string // ISO 8601 timestamp
  normalRange?: [number, number]
  notes?: string
}

export interface PatientData {
  metadata: PatientMetadata
  clinicalMeasurements: ClinicalMeasurement[]
}

export interface TimeSeriesPoint {
  timestamp: string // ISO 8601
  value: number | null
}

export interface TrendAnalysis {
  measurementId: string
  category: DataCategory
  dataPoints: TimeSeriesPoint[]
  trendSummary?: {
    slope?: number
    direction: 'increasing' | 'decreasing' | 'stable' | 'variable'
    significanceLevel?: number // p-value or confidence metric
  }
}

export interface DashboardConfig {
  theme: 'light' | 'dark'
  defaultDateRange: '7d' | '14d' | '30d' | '90d' | 'custom'
  showCriticalAlertsOnly: boolean
  preferredUnits: Record<DataCategory, string>
  refreshIntervalSecs: number
  chartSettings: {
    showTrendLines: boolean
    showDataPoints: boolean
    aggregation: 'none' | 'daily' | 'weekly' | 'monthly'
  }
  language: string // IETF language tag e.g. 'en-US'
}

export interface ApiError {
  code: StatusCode
  message: string
  details?: unknown
}

export interface ApiResponseSuccess<T> {
  status: StatusCode.SUCCESS | StatusCode.CREATED
  data: T
}

export interface ApiResponseError {
  status: Exclude<StatusCode, StatusCode.SUCCESS | StatusCode.CREATED>
  error: ApiError
}

export type ApiResponse<T> = ApiResponseSuccess<T> | ApiResponseError

export interface ChartDataPoint {
  x: string | number | Date
  y: number | null
  label?: string
  meta?: Record<string, unknown>
}

export interface ChartData {
  seriesName: string
  category: DataCategory
  dataPoints: ChartDataPoint[]
  color?: string
  unit?: string
}

export enum Permission {
  VIEW_PATIENT_DATA = 'view_patient_data',
  EDIT_PATIENT_DATA = 'edit_patient_data',
  VIEW_DASHBOARD = 'view_dashboard',
  MANAGE_USERS = 'manage_users',
  EXPORT_DATA = 'export_data',
  RECEIVE_REALTIME_UPDATES = 'receive_realtime_updates',
}

export interface UserPermissions {
  userId: string
  permissions: Permission[]
}

export enum RealTimeEventType {
  PATIENT_DATA_UPDATED = 'patient_data_updated',
  ALERT_TRIGGERED = 'alert_triggered',
  DASHBOARD_CONFIG_CHANGED = 'dashboard_config_changed',
  USER_PERMISSION_CHANGED = 'user_permission_changed',
}

export interface RealTimeUpdateBase {
  eventType: RealTimeEventType
  timestamp: string // ISO 8601
}

export interface PatientDataUpdatedEvent extends RealTimeUpdateBase {
  eventType: RealTimeEventType.PATIENT_DATA_UPDATED
  patientId: string
  updatedMeasurements: ClinicalMeasurement[]
}

export interface AlertTriggeredEvent extends RealTimeUpdateBase {
  eventType: RealTimeEventType.ALERT_TRIGGERED
  alertId: string
  patientId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  relatedMeasurementId?: string
}

export interface DashboardConfigChangedEvent extends RealTimeUpdateBase {
  eventType: RealTimeEventType.DASHBOARD_CONFIG_CHANGED
  userId: string
  newConfig: DashboardConfig
}

export interface UserPermissionChangedEvent extends RealTimeUpdateBase {
  eventType: RealTimeEventType.USER_PERMISSION_CHANGED
  userId: string
  updatedPermissions: Permission[]
}

export type RealTimeUpdateEvent =
  | PatientDataUpdatedEvent
  | AlertTriggeredEvent
  | DashboardConfigChangedEvent
  | UserPermissionChangedEvent
```