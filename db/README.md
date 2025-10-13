# Patient Data Storage System

**Software Item:** KD-33 Patient Data Storage System  
**Version:** 1.0.0  
**Compliance:** HIPAA Security Rule, IEC 62304 Class C, FDA 21 CFR Part 11

## Overview

PostgreSQL database schema with HIPAA-compliant design for storing patient data, imaging results, and clinical assessments for the Cardiac Imaging Analysis AI system.

## Features

- **Encryption at Rest**: All PHI (Protected Health Information) fields are encrypted using PostgreSQL pgcrypto
- **Audit Logging**: Comprehensive audit trail for all data access and modifications
- **Role-Based Access Control**: Fine-grained permissions based on user roles
- **Data Integrity**: Foreign key constraints and check constraints ensure data validity
- **Soft Deletes**: Records are marked as deleted rather than physically removed
- **Retention Management**: Automatic data retention policy support

## Database Tables

### Core Tables

1. **patients** - Patient demographic and clinical information (encrypted PHI)
2. **ct_scans** - CT scan metadata and processing status
3. **anomaly_detections** - AI-detected anomalies from Anomaly Detection Engine
4. **blockage_detections** - AI-detected coronary artery blockages
5. **risk_assessments** - Comprehensive risk assessment results

### Security Tables

6. **audit_log** - HIPAA-compliant audit trail for all system activity
7. **user_roles** - Role-based access control configuration

## Installation

### Prerequisites

- PostgreSQL 13+ 
- pgcrypto extension
- uuid-ossp extension

### Setup

```bash
# Create database
createedb cardiac_imaging_db

# Connect to database
psql cardiac_imaging_db

# Run schema creation
\i schema.sql

# Verify installation
\dt
```

## Encryption

### Key Management

In production, integrate with a Key Management System (KMS) such as:

- AWS KMS
- Azure Key Vault
- HashiCorp Vault

### Encrypted Fields

The following fields are encrypted at rest:

- `patients.mrn_encrypted` - Medical Record Number
- `patients.first_name_encrypted` - Patient first name
- `patients.last_name_encrypted` - Patient last name
- `patients.date_of_birth_encrypted` - Date of birth
- `patients.ssn_encrypted` - Social Security Number
- `patients.phone_encrypted` - Phone number
- `patients.email_encrypted` - Email address
- `patients.address_encrypted` - Physical address
- `ct_scans.dicom_storage_path_encrypted` - DICOM file storage path

### Example Encryption/Decryption

```sql
-- Encrypt data (using pgcrypto)
INSERT INTO patients (mrn_encrypted, first_name_encrypted, ...)
VALUES (
    pgp_sym_encrypt('MRN12345', 'encryption_key'),
    pgp_sym_encrypt('John', 'encryption_key'),
    ...
);

-- Decrypt data
SELECT 
    pgp_sym_decrypt(mrn_encrypted::bytea, 'encryption_key') as mrn,
    pgp_sym_decrypt(first_name_encrypted::bytea, 'encryption_key') as first_name
FROM patients
WHERE patient_id = 'uuid';
```

## Audit Logging

### Automatic Triggers

Audit triggers are automatically applied to:

- `patients` table
- `ct_scans` table
- `risk_assessments` table

### Audit Log Query Examples

```sql
-- View all access to specific patient
SELECT * FROM audit_log 
WHERE patient_id = 'uuid'
ORDER BY logged_at DESC;

-- View all modifications by user
SELECT * FROM audit_log 
WHERE user_id = 'doctor@hospital.com'
  AND action_type IN ('CREATE', 'UPDATE', 'DELETE')
ORDER BY logged_at DESC;

-- Failed access attempts
SELECT * FROM audit_log 
WHERE success = FALSE
ORDER BY logged_at DESC;
```

## Access Control

### User Roles

- **ADMIN**: Full system access
- **PHYSICIAN**: Read/write access to patient data and assessments
- **TECHNICIAN**: Read/write access to scans and processing
- **RESEARCHER**: De-identified read-only access
- **AUDITOR**: Read-only access to audit logs
- **READ_ONLY**: Read-only access to non-PHI data

### Permission Examples

```sql
-- Grant physician role
INSERT INTO user_roles (user_id, role, permissions)
VALUES (
    'doctor@hospital.com',
    'PHYSICIAN',
    '{
        "patients": ["read", "write"],
        "ct_scans": ["read", "write"],
        "risk_assessments": ["read", "write"],
        "audit_log": ["read"]
    }'::jsonb
);
```

## Data Retention

Configure retention policies:

```sql
-- Set retention date (7 years per HIPAA)
UPDATE patients
SET retention_date = CURRENT_DATE + INTERVAL '7 years'
WHERE patient_id = 'uuid';

-- Purge expired records (run periodically)
DELETE FROM patients
WHERE retention_date < CURRENT_DATE
  AND deleted = TRUE;
```

## Backup and Recovery

### Backup Strategy

```bash
# Full database backup (encrypted)
pg_dump cardiac_imaging_db | 
    gpg --encrypt --recipient backup@hospital.com > 
    backup_$(date +%Y%m%d).sql.gpg

# Restore from backup
gpg --decrypt backup_20251013.sql.gpg | 
    psql cardiac_imaging_db
```

### Point-in-Time Recovery

Enable WAL archiving in `postgresql.conf`:

```
wal_level = replica
archive_mode = on
archive_command = 'cp %p /path/to/archive/%f'
```

## Compliance

### HIPAA Requirements Met

✓ Encryption of PHI at rest  
✓ Access controls and authentication  
✓ Audit logging of all PHI access  
✓ Data integrity controls  
✓ Backup and disaster recovery  
✓ Data retention and disposal policies

### IEC 62304 Requirements Met

✓ Data validation and integrity checks  
✓ Error handling and logging  
✓ Version control and change management  
✓ Security controls documentation

## Maintenance

### Regular Tasks

1. **Daily**: Monitor audit logs for suspicious activity
2. **Weekly**: Review and rotate encryption keys
3. **Monthly**: Analyze query performance and optimize indexes
4. **Quarterly**: Review and update access control policies
5. **Annually**: Audit HIPAA compliance

### Performance Monitoring

```sql
-- Identify slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Index usage statistics
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

## Support

For technical support or compliance questions:
- Email: support@cardiac-imaging.example.com
- Documentation: https://docs.cardiac-imaging.example.com

## Version History

- **1.0.0** (2025-10-13): Initial release with full HIPAA compliance
