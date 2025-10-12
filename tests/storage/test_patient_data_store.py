```python
import pytest
import threading
import time
import tempfile
import os
from unittest import mock
from datetime import datetime
from collections import deque

from storage.patient_data_store import PatientDataStore, EncryptionError, AccessDeniedError, AuditLogEntry

@pytest.fixture(scope="function")
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)

@pytest.fixture
def store(temp_db):
    store = PatientDataStore(db_path=temp_db, encryption_key=b'secretkey1234567')
    yield store
    store.close()

@pytest.fixture
def sample_patient():
    return {
        "patient_id": "patient123",
        "name": "John Doe",
        "dob": "1980-01-01",
        "medical_history": ["diabetes", "hypertension"],
        "last_visit": "2023-04-01T10:00:00Z"
    }

# ---------- CRUD Operations Tests ----------

def test_create_and_read_patient(store, sample_patient):
    store.create_patient(sample_patient)
    retrieved = store.read_patient(sample_patient["patient_id"])
    assert retrieved["patient_id"] == sample_patient["patient_id"]
    assert retrieved["name"] == sample_patient["name"]
    assert retrieved["dob"] == sample_patient["dob"]
    assert retrieved["medical_history"] == sample_patient["medical_history"]

def test_update_patient(store, sample_patient):
    store.create_patient(sample_patient)
    updated_data = sample_patient.copy()
    updated_data["name"] = "Jane Smith"
    updated_data["medical_history"].append("asthma")
    store.update_patient(sample_patient["patient_id"], updated_data)
    retrieved = store.read_patient(sample_patient["patient_id"])
    assert retrieved["name"] == "Jane Smith"
    assert "asthma" in retrieved["medical_history"]

def test_delete_patient(store, sample_patient):
    store.create_patient(sample_patient)
    store.delete_patient(sample_patient["patient_id"])
    with pytest.raises(KeyError):
        store.read_patient(sample_patient["patient_id"])

# ---------- Encryption/Decryption Tests ----------

def test_encryption_decryption_roundtrip(store, sample_patient):
    # Store patient data and verify DB content is encrypted
    store.create_patient(sample_patient)
    raw_content = store._get_raw_db_content(sample_patient["patient_id"])
    assert raw_content != str(sample_patient).encode(), "Data in DB should be encrypted and not plain text"
    # Reading decrypts correctly
    decrypted = store.read_patient(sample_patient["patient_id"])
    assert decrypted == sample_patient

def test_encryption_with_wrong_key_fails(temp_db, sample_patient):
    store1 = PatientDataStore(db_path=temp_db, encryption_key=b'correctkey123456')
    store1.create_patient(sample_patient)
    store1.close()
    # Using wrong key should cause decryption failure
    store2 = PatientDataStore(db_path=temp_db, encryption_key=b'wrongkey12345678')
    with pytest.raises(EncryptionError):
        store2.read_patient(sample_patient["patient_id"])
    store2.close()

# ---------- Data Integrity Verification ----------

def test_data_integrity(store, sample_patient):
    store.create_patient(sample_patient)
    assert store.verify_data_integrity(sample_patient["patient_id"]) is True
    # Simulate tampering by changing raw db content
    store._corrupt_patient_data(sample_patient["patient_id"])
    assert store.verify_data_integrity(sample_patient["patient_id"]) is False

# ---------- Concurrent Access Handling ----------

def worker_create_read(store, patient_id_base, counter, results):
    pid = f"{patient_id_base}_{counter}"
    patient_data = {
        "patient_id": pid,
        "name": f"Person {counter}",
        "dob": "1970-01-01",
        "medical_history": [],
        "last_visit": datetime.utcnow().isoformat() + "Z"
    }
    try:
        store.create_patient(patient_data)
        retrieved = store.read_patient(pid)
        results.append((pid, retrieved["name"]))
    except Exception:
        results.append((pid, None))

def test_concurrent_creates_and_reads(store):
    threads = []
    results = deque()
    for i in range(30):
        t = threading.Thread(target=worker_create_read, args=(store, "concurrent", i, results))
        threads.append(t)
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 30
    for pid, name in results:
        assert name is not None
        assert pid.startswith("concurrent_")

# ---------- Backup and Recovery Procedures ----------

def test_backup_and_recovery(store, sample_patient, tmp_path):
    store.create_patient(sample_patient)
    backup_path = tmp_path / "backup.db"
    store.backup(str(backup_path))
    # Create new store from backup file
    recovered_store = PatientDataStore(db_path=str(backup_path), encryption_key=store.encryption_key)
    recovered_patient = recovered_store.read_patient(sample_patient["patient_id"])
    assert recovered_patient == sample_patient
    recovered_store.close()

# ---------- Access Control Enforcement ----------

def test_access_denied_without_permission(store, sample_patient):
    store.create_patient(sample_patient)
    with pytest.raises(AccessDeniedError):
        store.read_patient(sample_patient["patient_id"], user_role="guest")
    with pytest.raises(AccessDeniedError):
        store.update_patient(sample_patient["patient_id"], sample_patient, user_role="guest")
    with pytest.raises(AccessDeniedError):
        store.delete_patient(sample_patient["patient_id"], user_role="guest")

def test_access_allowed_for_doctor(store, sample_patient):
    store.create_patient(sample_patient, user_role="doctor")
    data = store.read_patient(sample_patient["patient_id"], user_role="doctor")
    assert data["patient_id"] == sample_patient["patient_id"]
    # Update should work
    sample_patient_updated = sample_patient.copy()
    sample_patient_updated["name"] = "Dr. Updated"
    store.update_patient(sample_patient["patient_id"], sample_patient_updated, user_role="doctor")
    updated = store.read_patient(sample_patient["patient_id"], user_role="doctor")
    assert updated["name"] == "Dr. Updated"

# ---------- Audit Logging Accuracy ----------

def test_audit_log_records(store, sample_patient):
    store.create_patient(sample_patient, user_role="doctor")
    store.read_patient(sample_patient["patient_id"], user_role="doctor")
    store.update_patient(sample_patient["patient_id"], sample_patient, user_role="doctor")
    logs = store.get_audit_logs(patient_id=sample_patient["patient_id"])
    actions = [log.action for log in logs]
    assert "create" in actions
    assert "read" in actions
    assert "update" in actions
    for log in logs:
        assert log.user_role == "doctor"
        assert isinstance(log.timestamp, datetime)

# ---------- Performance Under Load ----------

@pytest.mark.timeout(10)
def test_performance_under_load(store):
    # Insert 500 patients and measure time for bulk reads
    for i in range(500):
        pid = f"load_{i}"
        pdata = {
            "patient_id": pid,
            "name": f"Load Test {i}",
            "dob": "1975-05-15",
            "medical_history": [],
            "last_visit": datetime.utcnow().isoformat() + "Z"
        }
        store.create_patient(pdata)
    start = time.time()
    for i in range(500):
        pid = f"load_{i}"
        data = store.read_patient(pid)
        assert data["patient_id"] == pid
    end = time.time()
    elapsed = end - start
    assert elapsed < 5  # Must complete read of 500 patients in under 5 seconds (example limit)

# ---------- MDDS Compliance ----------

def test_mdds_schema_compliance(store, sample_patient):
    store.create_patient(sample_patient)
    patient_record = store.read_patient(sample_patient["patient_id"])
    # MDDS required keys exist
    required_keys = {"patient_id", "name", "dob", "medical_history", "last_visit"}
    assert required_keys <= patient_record.keys()
    # Date of birth is in YYYY-MM-DD format
    assert isinstance(patient_record["dob"], str) and len(patient_record["dob"]) == 10
    # Medical history is a list
    assert isinstance(patient_record["medical_history"], list)
    # last_visit is ISO8601 format string ending with Z
    assert patient_record["last_visit"].endswith("Z")

# ---------- Additional Helpers and Mocking ----------

@pytest.fixture(autouse=True)
def patch_time(monkeypatch):
    # Patch datetime.utcnow to fixed time for deterministic tests
    class FixedDatetime(datetime):
        @classmethod
        def utcnow(cls):
            return datetime(2023, 4, 1, 12, 0, 0)
    monkeypatch.setattr("storage.patient_data_store.datetime", FixedDatetime)

@pytest.fixture(autouse=True)
def patch_encryption(monkeypatch):
    # Patch actual encryption/decryption to simulate behavior and speed up tests
    def fake_encrypt(data, key):
        return b"encrypted:" + data
    def fake_decrypt(data, key):
        if not data.startswith(b"encrypted:"):
            raise EncryptionError("Invalid data")
        return data[len(b"encrypted:") :]
    monkeypatch.setattr("storage.patient_data_store.encrypt", fake_encrypt)
    monkeypatch.setattr("storage.patient_data_store.decrypt", fake_decrypt)
```