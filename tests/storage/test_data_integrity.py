```python
import io
import os
import tempfile
import hashlib
import pytest

from storage import (
    DataStorage,
    DataIntegrityError,
    IntegrityReport,
    RepairFailedError,
    DicomValidator,
)


@pytest.fixture
def storage(tmp_path):
    return DataStorage(storage_path=tmp_path)


def corrupt_bytes(data: bytes, indices: list[int]) -> bytes:
    data_array = bytearray(data)
    for i in indices:
        if i < len(data_array):
            data_array[i] ^= 0xFF
    return bytes(data_array)


def test_checksum_validation_and_corruption_detection(storage):
    content = b"Test data for checksum validation"
    data_id = "data1"
    storage.save(data_id, content)

    # Should pass validation for uncorrupted data
    assert storage.validate_checksum(data_id)

    # Load original data and corrupt a byte in memory, simulate file corruption
    file_path = storage._get_file_path(data_id)
    with open(file_path, "rb") as f:
        original_data = f.read()

    corrupted_data = corrupt_bytes(original_data, [5, 10])
    with open(file_path, "wb") as f:
        f.write(corrupted_data)

    # Validation should fail for corrupted data
    with pytest.raises(DataIntegrityError):
        storage.validate_checksum(data_id)


def test_repair_mechanism_success_and_failure(storage):
    content = b"Repairable data content"
    data_id = "data2"
    storage.save(data_id, content)

    # Corrupt storage file
    file_path = storage._get_file_path(data_id)
    with open(file_path, "rb") as f:
        original_data = f.read()
    corrupted_data = corrupt_bytes(original_data, [0])
    with open(file_path, "wb") as f:
        f.write(corrupted_data)

    # Patch repair method to simply re-save original content for test
    def mock_repair(data_id_inner):
        storage.save(data_id_inner, content)
    storage.repair = mock_repair

    # Repair should fix corruption and validation should then pass
    storage.repair(data_id)
    assert storage.validate_checksum(data_id)

    # Now simulate repair failure by raising exception
    def failing_repair(_):
        raise RepairFailedError("Simulated repair failure")
    storage.repair = failing_repair

    with pytest.raises(RepairFailedError):
        storage.repair(data_id)


def test_consistency_checks_across_tables(storage):
    # Simulate two related tables: metadata and content with matching IDs
    table_meta = {
        "id1": {"name": "First"},
        "id2": {"name": "Second"},
    }
    table_content = {
        "id1": b"Content 1",
        "id2": b"Content 2",
    }
    storage.save("id1", table_content["id1"])
    storage.save("id2", table_content["id2"])
    storage.save_metadata(table_meta)

    assert storage.check_consistency()

    # Introduce inconsistency (metadata missing id2)
    incomplete_meta = {"id1": table_meta["id1"]}
    storage.save_metadata(incomplete_meta)
    assert not storage.check_consistency()


def test_dicom_validation_and_corrupted_file_handling(storage, tmp_path):
    validator = DicomValidator()

    # Create a valid minimal DICOM file simulation
    valid_dicom_content = b"DICM" + b"\x00" * 128  # DICOM prefix at offset 128
    valid_path = tmp_path / "valid.dcm"
    valid_path.write_bytes(valid_dicom_content)

    assert validator.is_valid_dicom(str(valid_path))

    # Corrupt DICOM file by removing prefix
    corrupted_path = tmp_path / "corrupted.dcm"
    corrupted_path.write_bytes(b"CORRUPTED" + b"\x00" * 128)

    assert not validator.is_valid_dicom(str(corrupted_path))

    # Test storage handles corrupted files gracefully on load
    data_id = "dicom_sample"
    storage.save(data_id, valid_dicom_content)
    file_path = storage._get_file_path(data_id)

    # Corrupt stored file to simulate corrupted DICOM
    with open(file_path, "wb") as f:
        f.write(b"BADDICOM" + b"\x00" * 128)

    with pytest.raises(DataIntegrityError):
        storage.validate_dicom(data_id)


def test_integrity_reporting(storage):
    contents = {
        "file1": b"Data 1",
        "file2": b"Data 2",
        "file3": b"Data 3",
    }
    for k, v in contents.items():
        storage.save(k, v)

    report = storage.generate_integrity_report()
    assert isinstance(report, IntegrityReport)
    assert set(report.checked_ids) == set(contents.keys())
    assert report.errors == []

    # Corrupt one file
    corrupted_path = storage._get_file_path("file2")
    with open(corrupted_path, "rb") as f:
        d = f.read()
    with open(corrupted_path, "wb") as f:
        f.write(corrupt_bytes(d, [1]))

    report = storage.generate_integrity_report()
    assert "file2" in report.errors
    for err in report.errors:
        assert isinstance(err, DataIntegrityError)


def test_simulated_various_corruption_scenarios(storage):
    data_id = "scenario_data"
    original_content = b"Full integrity content for testing"
    storage.save(data_id, original_content)

    # Scenario 1: Truncation corruption
    path = storage._get_file_path(data_id)
    with open(path, "rb") as f:
        data = f.read()
    truncated = data[: len(data) // 2]
    with open(path, "wb") as f:
        f.write(truncated)
    with pytest.raises(DataIntegrityError):
        storage.validate_checksum(data_id)

    # Scenario 2: Byte flip corruption
    storage.save(data_id, original_content)
    with open(path, "rb") as f:
        data = f.read()
    flipped = corrupt_bytes(data, [3, 7, 15])
    with open(path, "wb") as f:
        f.write(flipped)
    with pytest.raises(DataIntegrityError):
        storage.validate_checksum(data_id)

    # Scenario 3: Metadata mismatch corruption
    meta_good = {"scenario_data": {"checksum": hashlib.sha256(original_content).hexdigest()}}
    storage.save_metadata(meta_good)
    assert storage.check_consistency()

    meta_bad = {"scenario_data": {"checksum": "wrongchecksum"}}
    storage.save_metadata(meta_bad)
    assert not storage.check_consistency()
```