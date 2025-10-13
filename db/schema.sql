-- Patient Data Storage System Schema
-- 
-- HIPAA-compliant PostgreSQL database schema for Cardiac Imaging Analysis AI
-- 
-- Compliance: HIPAA Security Rule, IEC 62304 Class C, FDA 21 CFR Part 11
-- Software Item: KD-33 Patient Data Storage System
-- 
-- @version 1.0.0

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- PATIENTS TABLE
-- ============================================================================
-- Stores patient demographic and clinical information with encryption

CREATE TABLE patients (
    patient_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Encrypted PHI (Protected Health Information)
    mrn_encrypted BYTEA NOT NULL, -- Medical Record Number (encrypted)
    first_name_encrypted BYTEA NOT NULL,
    last_name_encrypted BYTEA NOT NULL,
    date_of_birth_encrypted BYTEA NOT NULL,
    ssn_encrypted BYTEA, -- Social Security Number (optional, encrypted)
    
    -- Patient demographics
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('M', 'F', 'O', 'UNKNOWN')),
    
    -- Contact information (encrypted)
    phone_encrypted BYTEA,
    email_encrypted BYTEA,
    address_encrypted BYTEA,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    updated_by VARCHAR(100) NOT NULL,
    
    -- Soft delete flag
    deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Data retention
    retention_date DATE -- Date when record can be purged
);

-- Indexes for performance (excluding encrypted fields)
CREATE INDEX idx_patients_sex ON patients(sex);
CREATE INDEX idx_patients_created_at ON patients(created_at);
CREATE INDEX idx_patients_deleted ON patients(deleted);

COMMENT ON TABLE patients IS 'HIPAA-compliant patient demographic data with encryption at rest';

-- ============================================================================
-- CT_SCANS TABLE
-- ============================================================================
-- Stores CT scan metadata and results

CREATE TABLE ct_scans (
    scan_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE RESTRICT,
    
    -- Scan metadata
    scan_date TIMESTAMP WITH TIME ZONE NOT NULL,
    scan_type VARCHAR(50) NOT NULL, -- 'CT_ANGIOGRAPHY', 'CALCIUM_SCORE', etc.
    study_instance_uid VARCHAR(255) UNIQUE NOT NULL, -- DICOM UID
    
    -- DICOM data location (encrypted path)
    dicom_storage_path_encrypted BYTEA NOT NULL,
    
    -- Scan parameters
    slice_thickness_mm NUMERIC(5,2),
    num_slices INTEGER,
    kv_peak NUMERIC(6,2),
    exposure_mas NUMERIC(8,2),
    
    -- Quality metrics
    image_quality_score NUMERIC(4,2) CHECK (image_quality_score BETWEEN 0 AND 10),
    
    -- Processing status
    processing_status VARCHAR(50) DEFAULT 'PENDING' CHECK (
        processing_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')
    ),
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    
    -- Soft delete
    deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_ct_scans_patient_id ON ct_scans(patient_id);
CREATE INDEX idx_ct_scans_scan_date ON ct_scans(scan_date);
CREATE INDEX idx_ct_scans_processing_status ON ct_scans(processing_status);
CREATE INDEX idx_ct_scans_deleted ON ct_scans(deleted);

COMMENT ON TABLE ct_scans IS 'CT scan metadata and processing status';

-- ============================================================================
-- ANOMALY_DETECTIONS TABLE
-- ============================================================================
-- Stores anomaly detection results

CREATE TABLE anomaly_detections (
    detection_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id UUID NOT NULL REFERENCES ct_scans(scan_id) ON DELETE CASCADE,
    
    -- Detection results
    anomaly_detected BOOLEAN NOT NULL,
    anomaly_type VARCHAR(100), -- 'CALCIFICATION', 'STENOSIS', etc.
    confidence_score NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
    
    -- Location data (JSON for bounding boxes/regions)
    regions JSONB,
    
    -- Model information
    model_version VARCHAR(50) NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    
    -- Image hash for integrity
    image_hash VARCHAR(64) NOT NULL,
    
    -- Audit fields
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_anomaly_detections_scan_id ON anomaly_detections(scan_id);
CREATE INDEX idx_anomaly_detections_anomaly_detected ON anomaly_detections(anomaly_detected);
CREATE INDEX idx_anomaly_detections_detected_at ON anomaly_detections(detected_at);

COMMENT ON TABLE anomaly_detections IS 'AI-detected anomalies in cardiac CT scans';

-- ============================================================================
-- BLOCKAGE_DETECTIONS TABLE
-- ============================================================================
-- Stores blockage detection results

CREATE TABLE blockage_detections (
    blockage_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_id UUID NOT NULL REFERENCES ct_scans(scan_id) ON DELETE CASCADE,
    
    -- Vessel information
    vessel_name VARCHAR(50) NOT NULL, -- 'LAD', 'RCA', 'LCX', etc.
    location VARCHAR(100) NOT NULL, -- 'proximal', 'mid', 'distal'
    
    -- Stenosis metrics
    stenosis_percentage NUMERIC(5,2) NOT NULL CHECK (stenosis_percentage BETWEEN 0 AND 100),
    severity VARCHAR(50) NOT NULL CHECK (
        severity IN ('NONE', 'MILD', 'MODERATE', 'SEVERE', 'TOTAL_OCCLUSION')
    ),
    
    -- Additional metrics
    length_mm NUMERIC(6,2),
    cross_sectional_area_reduction_pct NUMERIC(5,2),
    
    -- 3D coordinates
    coordinates JSONB, -- {x, y, z}
    
    -- Detection confidence
    confidence_score NUMERIC(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
    
    -- Model information
    model_version VARCHAR(50) NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    
    -- Audit fields
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_blockage_detections_scan_id ON blockage_detections(scan_id);
CREATE INDEX idx_blockage_detections_vessel_name ON blockage_detections(vessel_name);
CREATE INDEX idx_blockage_detections_severity ON blockage_detections(severity);
CREATE INDEX idx_blockage_detections_detected_at ON blockage_detections(detected_at);

COMMENT ON TABLE blockage_detections IS 'AI-detected coronary artery blockages';

-- ============================================================================
-- RISK_ASSESSMENTS TABLE
-- ============================================================================
-- Stores comprehensive risk assessment results

CREATE TABLE risk_assessments (
    assessment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE RESTRICT,
    scan_id UUID REFERENCES ct_scans(scan_id) ON DELETE SET NULL,
    
    -- Risk scores
    framingham_risk_score NUMERIC(5,2) CHECK (framingham_risk_score BETWEEN 0 AND 100),
    imaging_risk_score NUMERIC(5,2) CHECK (imaging_risk_score BETWEEN 0 AND 100),
    composite_risk_score NUMERIC(5,2) NOT NULL CHECK (composite_risk_score BETWEEN 0 AND 100),
    
    -- Risk classification
    risk_level VARCHAR(50) NOT NULL CHECK (
        risk_level IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')
    ),
    
    -- Clinical parameters used (stored as JSONB for flexibility)
    clinical_data JSONB NOT NULL,
    imaging_data JSONB,
    
    -- Recommendations
    recommendations JSONB NOT NULL,
    
    -- Algorithm information
    algorithm_version VARCHAR(50) NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    
    -- Review status
    reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    assessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_risk_assessments_patient_id ON risk_assessments(patient_id);
CREATE INDEX idx_risk_assessments_risk_level ON risk_assessments(risk_level);
CREATE INDEX idx_risk_assessments_assessed_at ON risk_assessments(assessed_at);
CREATE INDEX idx_risk_assessments_reviewed ON risk_assessments(reviewed);

COMMENT ON TABLE risk_assessments IS 'Comprehensive cardiac risk assessment results';

-- ============================================================================
-- AUDIT_LOG TABLE
-- ============================================================================
-- HIPAA-compliant audit trail for all data access and modifications

CREATE TABLE audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    
    -- User and session information
    user_id VARCHAR(100) NOT NULL,
    session_id VARCHAR(255),
    ip_address INET,
    
    -- Action details
    action_type VARCHAR(50) NOT NULL, -- 'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', etc.
    table_name VARCHAR(100),
    record_id UUID,
    
    -- Patient reference (for PHI access tracking)
    patient_id UUID REFERENCES patients(patient_id) ON DELETE SET NULL,
    
    -- Action description
    action_description TEXT,
    
    -- Before/after data (for modifications)
    old_values JSONB,
    new_values JSONB,
    
    -- Success/failure
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    
    -- Timestamp
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_patient_id ON audit_log(patient_id);
CREATE INDEX idx_audit_log_action_type ON audit_log(action_type);
CREATE INDEX idx_audit_log_logged_at ON audit_log(logged_at);
CREATE INDEX idx_audit_log_table_name ON audit_log(table_name);

COMMENT ON TABLE audit_log IS 'HIPAA-compliant audit trail for all system access and modifications';

-- ============================================================================
-- USER_ROLES TABLE
-- ============================================================================
-- Role-based access control

CREATE TABLE user_roles (
    user_id VARCHAR(100) PRIMARY KEY,
    role VARCHAR(50) NOT NULL CHECK (
        role IN ('ADMIN', 'PHYSICIAN', 'TECHNICIAN', 'RESEARCHER', 'AUDITOR', 'READ_ONLY')
    ),
    permissions JSONB NOT NULL,
    
    active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_user_roles_role ON user_roles(role);
CREATE INDEX idx_user_roles_active ON user_roles(active);

COMMENT ON TABLE user_roles IS 'Role-based access control for system users';

-- ============================================================================
-- TRIGGERS FOR AUDIT LOGGING
-- ============================================================================

-- Function to log data changes
CREATE OR REPLACE FUNCTION log_data_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_log (user_id, action_type, table_name, record_id, new_values)
        VALUES (current_user, 'CREATE', TG_TABLE_NAME, NEW.patient_id, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_log (user_id, action_type, table_name, record_id, old_values, new_values)
        VALUES (current_user, 'UPDATE', TG_TABLE_NAME, NEW.patient_id, 
                row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_log (user_id, action_type, table_name, record_id, old_values)
        VALUES (current_user, 'DELETE', TG_TABLE_NAME, OLD.patient_id, row_to_json(OLD)::jsonb);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to sensitive tables
CREATE TRIGGER audit_patients_changes
    AFTER INSERT OR UPDATE OR DELETE ON patients
    FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_ct_scans_changes
    AFTER INSERT OR UPDATE OR DELETE ON ct_scans
    FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_risk_assessments_changes
    AFTER INSERT OR UPDATE OR DELETE ON risk_assessments
    FOR EACH ROW EXECUTE FUNCTION log_data_change();

-- ============================================================================
-- FUNCTIONS FOR ENCRYPTION
-- ============================================================================

-- Note: In production, use a secure key management system (KMS)
-- This is a simplified example for demonstration

COMMENT ON SCHEMA public IS 'Cardiac Imaging Analysis AI - Patient Data Storage System v1.0.0 - HIPAA Compliant';
