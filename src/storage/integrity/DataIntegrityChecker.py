```python
import hashlib
import zlib
import logging
from typing import Optional, Dict, Any, Tuple, List
from pydicom import dcmread
from pydicom.errors import InvalidDicomError
from pydicom.tag import Tag

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class DataIntegrityChecker:
    def __init__(self, storage_api):
        """
        :param storage_api: An abstraction over data storage interface that supports:
            - read_data(record_id) -> bytes
            - write_data(record_id, data_bytes)
            - list_related_records(record_id) -> List[record_id]
            - read_metadata(record_id) -> Dict[str, Any]
            - update_metadata(record_id, metadata: Dict[str, Any])
            - mark_corruption(record_id)
        """
        self.storage = storage_api

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        sha256 = hashlib.sha256()
        sha256.update(data)
        return sha256.hexdigest()

    @staticmethod
    def compute_crc32(data: bytes) -> int:
        return zlib.crc32(data) & 0xFFFFFFFF

    def store_checksums(self, record_id: str, data: bytes) -> None:
        sha256 = self.compute_sha256(data)
        crc32 = self.compute_crc32(data)
        metadata = self.storage.read_metadata(record_id) or {}
        metadata.update({
            'checksum_sha256': sha256,
            'checksum_crc32': crc32
        })
        self.storage.update_metadata(record_id, metadata)
        logger.debug(f"Checksums stored for record {record_id}: SHA256={sha256}, CRC32={crc32:#010x}")

    def verify_integrity(self, record_id: str) -> Tuple[bool, Optional[str]]:
        """
        Verify stored data integrity comparing stored checksums with recalculated ones.

        :return: (is_intact, error_message or None)
        """
        try:
            data = self.storage.read_data(record_id)
            if data is None:
                return False, "Data not found"

            metadata = self.storage.read_metadata(record_id) or {}
            stored_sha256 = metadata.get('checksum_sha256')
            stored_crc32 = metadata.get('checksum_crc32')

            if not stored_sha256 or stored_crc32 is None:
                return False, "Missing stored checksums"

            actual_sha256 = self.compute_sha256(data)
            actual_crc32 = self.compute_crc32(data)

            if stored_sha256 != actual_sha256:
                return False, "SHA256 checksum mismatch"
            if stored_crc32 != actual_crc32:
                return False, "CRC32 checksum mismatch"

            # Validate DICOM tags sanity if data is DICOM
            if self.is_dicom_data(data):
                err = self.validate_dicom_tags(data)
                if err is not None:
                    return False, f"DICOM tag validation failed: {err}"

            return True, None

        except Exception as e:
            logger.exception(f"Integrity verification failed for record {record_id}")
            return False, f"Verification exception: {str(e)}"

    def is_dicom_data(self, data: bytes) -> bool:
        try:
            dcmread(data, stop_before_pixels=True)
            return True
        except (InvalidDicomError, Exception):
            return False

    def validate_dicom_tags(self, data: bytes) -> Optional[str]:
        """
        Validate critical DICOM tags for conformity and presence.

        Returns None if no error, else error message string.
        """
        try:
            ds = dcmread(data, stop_before_pixels=True)
            required_tags = [
                Tag(0x0008, 0x0016),  # SOPClassUID
                Tag(0x0008, 0x0018),  # SOPInstanceUID
                Tag(0x0010, 0x0010),  # PatientName
                Tag(0x0010, 0x0020),  # PatientID
                Tag(0x0008, 0x0020),  # StudyDate
                Tag(0x0008, 0x0030),  # StudyTime
            ]
            for tag in required_tags:
                if tag not in ds:
                    return f"Missing required DICOM tag {tag}"
                if ds.get(tag).value in [None, '']:
                    return f"Empty required DICOM tag {tag}"

            # Validate UID formats
            for uid_tag in [Tag(0x0008, 0x0016), Tag(0x0008, 0x0018)]:
                uid_val = ds.get(uid_tag).value
                if not self.is_valid_uid(uid_val):
                    return f"Invalid UID format in tag {uid_tag}: {uid_val}"

            return None

        except Exception as e:
            logger.debug(f"DICOM tag validation exception: {e}")
            return f"Exception during DICOM validation: {str(e)}"

    @staticmethod
    def is_valid_uid(uid: str) -> bool:
        # UID must be numeric tokens separated by '.' and cannot be empty
        if not isinstance(uid, str) or len(uid) == 0:
            return False
        for part in uid.split('.'):
            if not part.isdigit():
                return False
        return True

    def detect_and_repair_corruption(self, record_id: str) -> bool:
        """
        Detect corruption and attempt repair.

        Return True if data was repaired successfully, else False.
        """
        intact, error = self.verify_integrity(record_id)
        if intact:
            return True

        logger.warning(f"Corruption detected for {record_id}: {error}")
        self.storage.mark_corruption(record_id)

        # Attempt automated repair fetching from related records (redundant copies)
        related_records = self.storage.list_related_records(record_id)
        for related_id in related_records:
            try:
                related_data = self.storage.read_data(related_id)
                if related_data is None:
                    continue
                self.store_checksums(related_id, related_data)
                intact_rel, err_rel = self.verify_integrity(related_id)
                if intact_rel:
                    # Repair the corrupted record by restoring data from this related intact record
                    self.storage.write_data(record_id, related_data)
                    self.store_checksums(record_id, related_data)
                    logger.info(f"Repaired record {record_id} from related record {related_id}")
                    return True
            except Exception:
                continue

        logger.error(f"Automated repair failed for record {record_id}")
        return False

    def check_consistency_across_related(self, record_id: str) -> Dict[str, Any]:
        """
        Check consistency among related records.

        :return: dict of inconsistencies found with related record IDs as keys
        """
        inconsistencies = {}
        base_metadata = self.storage.read_metadata(record_id) or {}

        related_records = self.storage.list_related_records(record_id)
        for related_id in related_records:
            meta = self.storage.read_metadata(related_id) or {}
            diff_keys = []
            for key in base_metadata:
                if key.startswith("checksum_"):
                    continue
                if base_metadata.get(key) != meta.get(key):
                    diff_keys.append(key)
            if diff_keys:
                inconsistencies[related_id] = diff_keys

        return inconsistencies

    def integrity_report(self, record_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Generate integrity report for a list of record IDs.

        Report contains:
          - 'intact': bool
          - 'error': Optional[str]
          - 'consistency_issues': Dict of related record ids with differing metadata keys
          - 'dicom_validation_error': Optional[str]

        :param record_ids: List of record IDs to verify
        :return: dict keyed by record_id with integrity info
        """
        report = {}
        for rec_id in record_ids:
            intact, error = self.verify_integrity(rec_id)
            dicom_val_err = None

            if intact:
                data = self.storage.read_data(rec_id)
                if data and self.is_dicom_data(data):
                    dicom_val_err = self.validate_dicom_tags(data)
                    if dicom_val_err is not None:
                        intact = False
                        error = dicom_val_err

            consistency_issues = self.check_consistency_across_related(rec_id) if intact else {}

            report[rec_id] = {
                'intact': intact,
                'error': error,
                'consistency_issues': consistency_issues,
                'dicom_validation_error': dicom_val_err,
            }

        return report
```