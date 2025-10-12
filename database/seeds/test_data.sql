```sql
-- Seed data for testing and development
-- PostgreSQL
-- Synthetic, anonymized data for patients, glucose readings, insulin doses, app usage logs
-- Includes edge cases and varied time ranges

-- Patients Table
INSERT INTO patients (patient_id, first_name, last_name, date_of_birth, gender, created_at)
VALUES
  ('p001', 'Alice', 'Smith', '1980-04-15', 'F', NOW() - INTERVAL '365 days'),
  ('p002', 'Bob', 'Johnson', '1975-11-22', 'M', NOW() - INTERVAL '400 days'),
  ('p003', 'Charlie', 'Lee', '1990-06-30', 'M', NOW() - INTERVAL '200 days'),
  ('p004', 'Dana', 'Martinez', '1965-01-05', 'F', NOW() - INTERVAL '500 days'),
  ('p005', 'Eve', 'Williams', '2000-12-12', 'F', NOW() - INTERVAL '100 days'),
  
  -- Edge case patient: newborn (age < 1 year)
  ('p006', 'Newborn', 'Test', CURRENT_DATE - INTERVAL '6 months', 'F', NOW() - INTERVAL '180 days'),

  -- Edge case patient: missing middle-age (simulate no insulin usage)
  ('p007', 'Edge', 'Case', '1985-05-20', 'M', NOW() - INTERVAL '250 days');

-- Glucose Readings Table (glucose_readings)
-- Columns: reading_id SERIAL primary key, patient_id, reading_time, glucose_mg_dl, source, created_at

-- Normal readings for patient p001 spanning last 90 days
INSERT INTO glucose_readings (patient_id, reading_time, glucose_mg_dl, source, created_at)
SELECT 'p001',
       NOW() - (INTERVAL '90 days' - SEQUENCE.day * INTERVAL '6 hours'),
       CASE
         WHEN (SEQUENCE.day % 5) = 0 THEN 140 + (SEQUENCE.day % 20) -- occasional elevated
         ELSE 90 + (RANDOM() * 40)::INT
       END,
       'CGM',
       NOW() - (INTERVAL '90 days' - SEQUENCE.day * INTERVAL '6 hours')
FROM generate_series(0, 360) AS SEQUENCE(day);

-- Normal readings for patient p002 spanning 30 days
INSERT INTO glucose_readings (patient_id, reading_time, glucose_mg_dl, source, created_at)
SELECT 'p002',
       NOW() - (INTERVAL '30 days' - SEQUENCE.hour * INTERVAL '1 hour'),
       80 + (RANDOM() * 60)::INT,
       CASE WHEN SEQUENCE.hour % 4 = 0 THEN 'Fingerstick' ELSE 'CGM' END,
       NOW() - (INTERVAL '30 days' - SEQUENCE.hour * INTERVAL '1 hour')
FROM generate_series(0, 720) AS SEQUENCE(hour);

-- Patient p006 (newborn) with very low glucose edge cases
INSERT INTO glucose_readings (patient_id, reading_time, glucose_mg_dl, source, created_at)
VALUES
  ('p006', NOW() - INTERVAL '1 day 2 hours', 45, 'Fingerstick', NOW() - INTERVAL '1 day 2 hours'),
  ('p006', NOW() - INTERVAL '12 hours', 38, 'CGM', NOW() - INTERVAL '12 hours'),
  ('p006', NOW() - INTERVAL '6 hours', 50, 'CGM', NOW() - INTERVAL '6 hours'),
  ('p006', NOW() - INTERVAL '1 hour', 55, 'Fingerstick', NOW() - INTERVAL '1 hour');

-- Patient p007 with missing and outlier values
INSERT INTO glucose_readings (patient_id, reading_time, glucose_mg_dl, source, created_at)
VALUES
  ('p007', NOW() - INTERVAL '48 hours', NULL, 'CGM', NOW() - INTERVAL '48 hours'),   -- missing reading
  ('p007', NOW() - INTERVAL '24 hours', 250, 'CGM', NOW() - INTERVAL '24 hours'),   -- very high reading
  ('p007', NOW() - INTERVAL '12 hours', -10, 'Fingerstick', NOW() - INTERVAL '12 hours'), -- invalid negative reading
  ('p007', NOW() - INTERVAL '6 hours', 100, 'Fingerstick', NOW() - INTERVAL '6 hours');

-- Insulin Dose History Table (insulin_doses)
-- Columns: dose_id SERIAL primary key, patient_id, dose_time, insulin_type, units, created_at

INSERT INTO insulin_doses (patient_id, dose_time, insulin_type, units, created_at)
VALUES
  -- p001 basal and bolus doses over last 2 weeks
  ('p001', NOW() - INTERVAL '14 days' + INTERVAL '8 hours', 'Basal', 15, NOW() - INTERVAL '14 days' + INTERVAL '8 hours'),
  ('p001', NOW() - INTERVAL '14 days' + INTERVAL '12 hours', 'Bolus', 8, NOW() - INTERVAL '14 days' + INTERVAL '12 hours'),
  ('p001', NOW() - INTERVAL '7 days' + INTERVAL '7 hours', 'Basal', 15, NOW() - INTERVAL '7 days' + INTERVAL '7 hours'),
  ('p001', NOW() - INTERVAL '7 days' + INTERVAL '13 hours', 'Bolus', 10, NOW() - INTERVAL '7 days' + INTERVAL '13 hours'),
  ('p001', NOW() - INTERVAL '1 days' + INTERVAL '8 hours', 'Basal', 15, NOW() - INTERVAL '1 days' + INTERVAL '8 hours'),
  ('p001', NOW() - INTERVAL '1 days' + INTERVAL '12 hours', 'Bolus', 12, NOW() - INTERVAL '1 days' + INTERVAL '12 hours'),

  -- p002 only basal doses, irregular
  ('p002', NOW() - INTERVAL '30 days' + INTERVAL '9 hours', 'Basal', 20, NOW() - INTERVAL '30 days' + INTERVAL '9 hours'),
  ('p002', NOW() - INTERVAL '20 days' + INTERVAL '8 hours', 'Basal', 18, NOW() - INTERVAL '20 days' + INTERVAL '8 hours'),
  ('p002', NOW() - INTERVAL '5 days' + INTERVAL '7 hours', 'Basal', 22, NOW() - INTERVAL '5 days' + INTERVAL '7 hours'),

  -- p006 newborn, very low doses
  ('p006', NOW() - INTERVAL '2 days' + INTERVAL '8 hours', 'Basal', 2, NOW() - INTERVAL '2 days' + INTERVAL '8 hours'),
  ('p006', NOW() - INTERVAL '1 days' + INTERVAL '12 hours', 'Bolus', 1, NOW() - INTERVAL '1 days' + INTERVAL '12 hours'),

  -- p007 edge with zero and negative dose (invalid data)
  ('p007', NOW() - INTERVAL '10 days' + INTERVAL '8 hours', 'Basal', 0, NOW() - INTERVAL '10 days' + INTERVAL '8 hours'),
  ('p007', NOW() - INTERVAL '9 days' + INTERVAL '10 hours', 'Bolus', -5, NOW() - INTERVAL '9 days' + INTERVAL '10 hours');

-- App Usage Logs Table (app_usage_logs)
-- Columns: log_id SERIAL primary key, patient_id, event_time, event_type, device_os, app_version, created_at

INSERT INTO app_usage_logs (patient_id, event_time, event_type, device_os, app_version, created_at)
VALUES
  -- p001 frequent daily logins and glucose sync events over past week
  ('p001', NOW() - INTERVAL '7 days' + INTERVAL '9 hours', 'login', 'iOS', '2.3.1', NOW() - INTERVAL '7 days' + INTERVAL '9 hours'),
  ('p001', NOW() - INTERVAL '7 days' + INTERVAL '9 hours 15 minutes', 'sync_glucose', 'iOS', '2.3.1', NOW() - INTERVAL '7 days' + INTERVAL '9 hours 15 minutes'),
  ('p001', NOW() - INTERVAL '1 days' + INTERVAL '20 hours', 'login', 'iOS', '2.3.1', NOW() - INTERVAL '1 days' + INTERVAL '20 hours'),
  ('p001', NOW() - INTERVAL '1 days' + INTERVAL '20 hours 10 minutes', 'sync_glucose', 'iOS', '2.3.1', NOW() - INTERVAL '1 days' + INTERVAL '20 hours 10 minutes'),

  -- p002 usage with some crashes and updates
  ('p002', NOW() - INTERVAL '15 days' + INTERVAL '13 hours', 'login', 'Android', '2.2.0', NOW() - INTERVAL '15 days' + INTERVAL '13 hours'),
  ('p002', NOW() - INTERVAL '14 days' + INTERVAL '14 hours', 'app_crash', 'Android', '2.2.0', NOW() - INTERVAL '14 days' + INTERVAL '14 hours'),
  ('p002', NOW() - INTERVAL '10 days' + INTERVAL '9 hours', 'update', 'Android', '2.3.0', NOW() - INTERVAL '10 days' + INTERVAL '9 hours'),
  ('p002', NOW() - INTERVAL '5 days' + INTERVAL '11 hours', 'login', 'Android', '2.3.0', NOW() - INTERVAL '5 days' + INTERVAL '11 hours'),

  -- p006 minimal usage (newborn caregiver)
  ('p006', NOW() - INTERVAL '3 days' + INTERVAL '16 hours', 'login', 'iOS', '2.3.1', NOW() - INTERVAL '3 days' + INTERVAL '16 hours'),

  -- p007 edge case: abnormal timestamps (future date and very old)
  ('p007', NOW() + INTERVAL '10 days', 'login', 'Android', '2.3.1', NOW() + INTERVAL '10 days'),
  ('p007', NOW() - INTERVAL '3650 days', 'login', 'Android', '1.0.0', NOW() - INTERVAL '3650 days');

-- End of test_data.sql
```