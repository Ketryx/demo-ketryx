```sql
-- PostgreSQL audit triggers for HIPAA compliance
-- Auditing INSERT, UPDATE, DELETE on sensitive tables
-- Tracking user info, timestamps, before/after values
-- Logging failed access attempts and data exports

-- ===============================
-- 1. Audit log tables
-- ===============================

-- Main audit log table for data changes
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id SERIAL PRIMARY KEY,
    event_timestamp TIMESTAMPTZ DEFAULT current_timestamp,
    username TEXT,
    user_role TEXT,
    client_ip INET,
    operation_type TEXT CHECK (operation_type IN ('INSERT', 'UPDATE', 'DELETE')),
    table_name TEXT,
    record_id TEXT,
    changed_data JSONB,
    old_data JSONB
);

-- Table for logging failed access attempts
CREATE TABLE IF NOT EXISTS failed_access_log (
    failed_access_id SERIAL PRIMARY KEY,
    attempt_timestamp TIMESTAMPTZ DEFAULT current_timestamp,
    username TEXT,
    client_ip INET,
    attempted_action TEXT,
    reason TEXT
);

-- Table for data export tracking
CREATE TABLE IF NOT EXISTS data_export_log (
    export_id SERIAL PRIMARY KEY,
    export_timestamp TIMESTAMPTZ DEFAULT current_timestamp,
    username TEXT,
    user_role TEXT,
    client_ip INET,
    export_details JSONB
);

-- ===============================
-- 2. Audit function for INSERT/UPDATE/DELETE
-- ===============================

CREATE OR REPLACE FUNCTION audit_trigger_func() RETURNS TRIGGER AS $$
DECLARE
    current_user_name TEXT := current_user;
    current_user_role TEXT;
    client_address INET;
    primary_key_value TEXT;
BEGIN
    -- Attempt to get user role and client IP address from session variables or context
    BEGIN
        SELECT session_user INTO current_user_name;
        SELECT inet_client_addr() INTO client_address;
    EXCEPTION WHEN OTHERS THEN
        client_address := NULL;
    END;

    BEGIN
        -- Example: you can adapt this to your role system. Here, fetching roles from current_setting or session variable if set.
        current_user_role := current_setting('app.current_user_role', true);
    EXCEPTION WHEN OTHERS THEN
        current_user_role := NULL;
    END;

    -- Determine primary key value(s) as text for identification; assumes a single column PK named 'id'
    IF TG_OP = 'INSERT' THEN
        primary_key_value := NEW.id::TEXT;
    ELSIF TG_OP = 'UPDATE' THEN
        primary_key_value := NEW.id::TEXT;
    ELSIF TG_OP = 'DELETE' THEN
        primary_key_value := OLD.id::TEXT;
    ELSE
        primary_key_value := NULL;
    END IF;

    -- Insert into audit_log capturing before and after data as JSONB
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (
            username, user_role, client_ip, operation_type, table_name, record_id, changed_data, old_data
        ) VALUES (
            current_user_name,
            current_user_role,
            client_address,
            TG_OP,
            TG_TABLE_NAME,
            primary_key_value,
            row_to_json(NEW)::jsonb,
            NULL
        );
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (
            username, user_role, client_ip, operation_type, table_name, record_id, changed_data, old_data
        ) VALUES (
            current_user_name,
            current_user_role,
            client_address,
            TG_OP,
            TG_TABLE_NAME,
            primary_key_value,
            row_to_json(NEW)::jsonb,
            row_to_json(OLD)::jsonb
        );
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (
            username, user_role, client_ip, operation_type, table_name, record_id, changed_data, old_data
        ) VALUES (
            current_user_name,
            current_user_role,
            client_address,
            TG_OP,
            TG_TABLE_NAME,
            primary_key_value,
            NULL,
            row_to_json(OLD)::jsonb
        );
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ===============================
-- 3. Audit triggers on sensitive tables
-- ===============================
-- List your sensitive tables here, e.g., patients, medical_records, prescriptions, users

-- Example sensitive tables with single-column primary key named 'id'

-- Patients table
DROP TRIGGER IF EXISTS audit_patients_trg ON patients;
CREATE TRIGGER audit_patients_trg
AFTER INSERT OR UPDATE OR DELETE ON patients
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Medical records table
DROP TRIGGER IF EXISTS audit_medical_records_trg ON medical_records;
CREATE TRIGGER audit_medical_records_trg
AFTER INSERT OR UPDATE OR DELETE ON medical_records
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Prescriptions table
DROP TRIGGER IF EXISTS audit_prescriptions_trg ON prescriptions;
CREATE TRIGGER audit_prescriptions_trg
AFTER INSERT OR UPDATE OR DELETE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Users table (sensitive info update tracking)
DROP TRIGGER IF EXISTS audit_users_trg ON users;
CREATE TRIGGER audit_users_trg
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ===============================
-- 4. Failed access attempt logging function
-- ===============================

CREATE OR REPLACE FUNCTION log_failed_access(
    p_username TEXT,
    p_client_ip INET,
    p_attempted_action TEXT,
    p_reason TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO failed_access_log (
        username, client_ip, attempted_action, reason
    ) VALUES (
        p_username,
        p_client_ip,
        p_attempted_action,
        p_reason
    );
END;
$$ LANGUAGE plpgsql;

-- ===============================
-- 5. Data export tracking function
-- Example usage: call this function from application or export procedures
-- ===============================

CREATE OR REPLACE FUNCTION log_data_export(
    p_username TEXT,
    p_user_role TEXT,
    p_client_ip INET,
    p_export_details JSONB
) RETURNS VOID AS $$
BEGIN
    INSERT INTO data_export_log (
        username, user_role, client_ip, export_details
    ) VALUES (
        p_username,
        p_user_role,
        p_client_ip,
        p_export_details
    );
END;
$$ LANGUAGE plpgsql;

-- ===============================
-- 6. Notes:
-- - Application must set 'app.current_user_role' session variable accordingly for accurate role logging.
-- - Failed access logging function should be called by application or security procedures when access denied.
-- - Data export logging function should be called at each export event with JSON details describing export criteria.
-- - Assumes all sensitive tables have 'id' primary key column; adapt if different.

```