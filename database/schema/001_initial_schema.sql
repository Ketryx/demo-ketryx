```sql
-- 001_initial_schema.sql
-- PostgreSQL 14+ schema for patient data management with HIPAA-compliant encryption

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Patients table: demographics and metadata
CREATE TABLE patients (
    patient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other', 'Unknown')) NOT NULL,
    phone BYTEA NOT NULL,    -- Encrypted
    email BYTEA NOT NULL,    -- Encrypted
    address BYTEA NOT NULL,  -- Encrypted
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Glucose readings with timestamps and values
CREATE TABLE glucose_readings (
    reading_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    reading_timestamp TIMESTAMPTZ NOT NULL,
    glucose_mg_dl INT NOT NULL CHECK (glucose_mg_dl >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_glucose_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

-- Insulin doses: administration records
CREATE TABLE insulin_doses (
    dose_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    dose_timestamp TIMESTAMPTZ NOT NULL,
    insulin_type TEXT NOT NULL,
    units NUMERIC(5,2) NOT NULL CHECK (units > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_insulin_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

-- Client usage logs: app activity tracking
CREATE TABLE client_usage_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL,
    activity_type TEXT NOT NULL,
    activity_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB,
    CONSTRAINT fk_usage_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

-- Audit log: security compliance (KXREC32DGQNY4Z88C9B64B8BVSKA5D7)
CREATE TABLE audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID,
    patient_id UUID,
    event_type TEXT NOT NULL,
    event_details JSONB NOT NULL,
    CONSTRAINT fk_audit_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE SET NULL
);

-- Indexes for query performance (KXREC7WQFWPNZQB8KPTJ9RHCFTHYQZ3)

CREATE INDEX idx_glucose_patient_ts ON glucose_readings (patient_id, reading_timestamp DESC);
CREATE INDEX idx_insulin_patient_ts ON insulin_doses (patient_id, dose_timestamp DESC);
CREATE INDEX idx_usage_patient_ts ON client_usage_logs (patient_id, activity_timestamp DESC);
CREATE INDEX idx_audit_user_ts ON audit_log (user_id, event_timestamp DESC);

-- Trigger to update updated_at on patients
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_patients_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW
EXECUTE FUNCTION trigger_set_updated_at();
```