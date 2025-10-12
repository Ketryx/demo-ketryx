```python
import os
import shutil
import hashlib
import json
import threading
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Optional, Dict, Callable
from abc import ABC, abstractmethod
from cryptography.fernet import Fernet
import logging


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BackupManager")


class BackupType(Enum):
    FULL = "full"
    INCREMENTAL = "incremental"


class BackupVerificationError(Exception):
    pass


class BackupDestination(ABC):
    @abstractmethod
    def store_backup(self, backup_path: str, backup_name: str) -> None:
        pass

    @abstractmethod
    def retrieve_backup(self, backup_name: str, destination_path: str) -> None:
        pass

    @abstractmethod
    def list_backups(self) -> List[str]:
        pass


class LocalBackupDestination(BackupDestination):
    def __init__(self, base_path: str):
        self.base_path = base_path
        os.makedirs(self.base_path, exist_ok=True)

    def store_backup(self, backup_path: str, backup_name: str) -> None:
        dest_path = os.path.join(self.base_path, backup_name)
        if os.path.isdir(backup_path):
            if os.path.exists(dest_path):
                shutil.rmtree(dest_path)
            shutil.copytree(backup_path, dest_path)
        else:
            shutil.copy2(backup_path, dest_path)

    def retrieve_backup(self, backup_name: str, destination_path: str) -> None:
        source_path = os.path.join(self.base_path, backup_name)
        if os.path.isdir(source_path):
            if os.path.exists(destination_path):
                shutil.rmtree(destination_path)
            shutil.copytree(source_path, destination_path)
        else:
            shutil.copy2(source_path, destination_path)

    def list_backups(self) -> List[str]:
        return sorted(os.listdir(self.base_path))


class GeoRedundantBackupDestination(BackupDestination):
    def __init__(self, destinations: List[BackupDestination]):
        self.destinations = destinations

    def store_backup(self, backup_path: str, backup_name: str) -> None:
        exceptions = []
        for dest in self.destinations:
            try:
                dest.store_backup(backup_path, backup_name)
            except Exception as e:
                logger.error(f"Failed to store backup on destination {dest}: {e}")
                exceptions.append(e)
        if len(exceptions) == len(self.destinations):
            raise Exception("All geo-redundant destinations failed to store backup")

    def retrieve_backup(self, backup_name: str, destination_path: str) -> None:
        for dest in self.destinations:
            try:
                dest.retrieve_backup(backup_name, destination_path)
                return
            except Exception as e:
                logger.warning(f"Failed to retrieve backup from destination {dest}: {e}")
        raise Exception("Failed to retrieve backup from all geo-redundant destinations")

    def list_backups(self) -> List[str]:
        backups_sets = [set(dest.list_backups()) for dest in self.destinations]
        if backups_sets:
            # Return common backups available on all destinations
            return sorted(list(set.intersection(*backups_sets)))
        return []


class BackupManager:
    def __init__(
        self,
        backup_sources: List[str],
        backup_destinations: List[BackupDestination],
        encryption_key: Optional[bytes] = None,
        backup_storage_path: str = "/tmp/backup_manager",
        rto_threshold_sec: int = 300,
    ):
        self.backup_sources = backup_sources
        self.backup_destinations = backup_destinations
        self.backup_storage_path = backup_storage_path
        os.makedirs(self.backup_storage_path, exist_ok=True)
        self.encryption_key = encryption_key or Fernet.generate_key()
        self.cipher = Fernet(self.encryption_key)
        self.rto_threshold_sec = rto_threshold_sec

        self.last_full_backup_time: Optional[datetime] = None
        self.last_backup_manifest: Optional[Dict[str, str]] = None

        self._lock = threading.Lock()

    def _hash_file(self, file_path: str) -> str:
        hasher = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _scan_source_files(self) -> Dict[str, str]:
        file_hashes = {}
        for source in self.backup_sources:
            if not os.path.exists(source):
                logger.warning(f"Backup source does not exist: {source}")
                continue
            if os.path.isfile(source):
                file_hashes[source] = self._hash_file(source)
            else:
                for root, _, files in os.walk(source):
                    for file in files:
                        path = os.path.join(root, file)
                        file_hashes[path] = self._hash_file(path)
        return file_hashes

    def _create_backup_name(self, backup_type: BackupType) -> str:
        timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        return f"{backup_type.value}_backup_{timestamp}"

    def _prepare_backup_folder(self, backup_name: str) -> str:
        path = os.path.join(self.backup_storage_path, backup_name)
        if os.path.exists(path):
            shutil.rmtree(path)
        os.makedirs(path, exist_ok=True)
        return path

    def _copy_files(self, files: List[str], dest_folder: str) -> None:
        for f in files:
            if not os.path.exists(f):
                continue
            relative_path = os.path.relpath(f, start=os.path.commonpath(self.backup_sources))
            full_dest_path = os.path.join(dest_folder, relative_path)
            os.makedirs(os.path.dirname(full_dest_path), exist_ok=True)
            shutil.copy2(f, full_dest_path)

    def _encrypt_backup(self, backup_folder: str) -> str:
        archive_path = f"{backup_folder}.tar"
        shutil.make_archive(archive_path[:-4], 'tar', backup_folder)
        encrypted_path = f"{archive_path}.enc"
        with open(archive_path, "rb") as f_in:
            data = f_in.read()
        encrypted_data = self.cipher.encrypt(data)
        with open(encrypted_path, "wb") as f_out:
            f_out.write(encrypted_data)
        os.remove(archive_path)
        shutil.rmtree(backup_folder)
        return encrypted_path

    def _verify_backup(self, backup_path: str) -> bool:
        try:
            if backup_path.endswith(".enc"):
                with open(backup_path, "rb") as f:
                    encrypted_data = f.read()
                decrypted_data = self.cipher.decrypt(encrypted_data)
            else:
                with open(backup_path, "rb") as f:
                    decrypted_data = f.read()
            # Check tar integrity
            import tarfile
            from io import BytesIO
            with tarfile.open(fileobj=BytesIO(decrypted_data)) as archive:
                # Just iterating to confirm no errors
                for _ in archive:
                    pass
            return True
        except Exception as exc:
            logger.error(f"Backup verification failed: {exc}")
            return False

    def _save_backup_manifest(self, manifest: Dict[str, str], folder: str) -> None:
        manifest_path = os.path.join(folder, "manifest.json")
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

    def _load_backup_manifest(self, folder: str) -> Dict[str, str]:
        manifest_path = os.path.join(folder, "manifest.json")
        if not os.path.exists(manifest_path):
            return {}
        with open(manifest_path, "r") as f:
            return json.load(f)

    def _get_backup_manifest_from_archive(self, archive_path: str) -> Dict[str, str]:
        import tarfile
        from io import BytesIO

        data = None
        if archive_path.endswith(".enc"):
            with open(archive_path, "rb") as f:
                encrypted_data = f.read()
            data = self.cipher.decrypt(encrypted_data)
        else:
            with open(archive_path, "rb") as f:
                data = f.read()

        with tarfile.open(fileobj=BytesIO(data)) as archive:
            member = archive.getmember("manifest.json")
            manifest_file = archive.extractfile(member)
            manifest_json = manifest_file.read()
            return json.loads(manifest_json)

    def _determine_files_to_backup(self, prev_manifest: Optional[Dict[str, str]]) -> List[str]:
        current_hashes = self._scan_source_files()
        if not prev_manifest:
            return list(current_hashes.keys())
        changed_files = [
            file for file, hsh in current_hashes.items()
            if file not in prev_manifest or prev_manifest[file] != hsh
        ]
        return changed_files

    def perform_backup(self, backup_type: BackupType) -> str:
        with self._lock:
            logger.info(f"Starting {backup_type.value} backup...")
            backup_name = self._create_backup_name(backup_type)
            backup_folder = self._prepare_backup_folder(backup_name)

            prev_manifest = self.last_backup_manifest if backup_type == BackupType.INCREMENTAL else None
            files_to_backup = []

            if backup_type == BackupType.FULL or not prev_manifest:
                files_to_backup = self._scan_source_files().keys()
            else:
                files_to_backup = self._determine_files_to_backup(prev_manifest)

            if not files_to_backup:
                logger.info("No changes detected, backup skipped.")
                shutil.rmtree(backup_folder)
                return ""

            self._copy_files(list(files_to_backup), backup_folder)
            manifest = {f: self._hash_file(os.path.join(backup_folder, os.path.relpath(f, os.path.commonpath(self.backup_sources)))) for f in files_to_backup}
            self._save_backup_manifest(manifest, backup_folder)

            encrypted_backup_path = self._encrypt_backup(backup_folder)

            # Send backup to all destinations
            for destination in self.backup_destinations:
                try:
                    destination.store_backup(encrypted_backup_path, backup_name + ".tar.enc")
                except Exception as e:
                    logger.error(f"Failed to store backup on destination {destination}: {e}")

            os.remove(encrypted_backup_path)

            # Update last backup state
            if backup_type == BackupType.FULL:
                self.last_full_backup_time = datetime.utcnow()
            self.last_backup_manifest = manifest

            if not self._verify_backup_from_destinations(backup_name + ".tar.enc"):
                raise BackupVerificationError("Backup verification failed on all destinations.")

            logger.info(f"{backup_type.value.capitalize()} backup '{backup_name}' completed successfully.")
            return backup_name

    def _verify_backup_from_destinations(self, backup_name: str) -> bool:
        verified = False
        for destination in self.backup_destinations:
            try:
                tmp_path = os.path.join(self.backup_storage_path, "verify_tmp")
                if os.path.exists(tmp_path):
                    shutil.rmtree(tmp_path)
                os.makedirs(tmp_path, exist_ok=True)
                destination.retrieve_backup(backup_name, tmp_path)
                backup_file_path = os.path.join(tmp_path, backup_name)
                if os.path.isdir(tmp_path):
                    # .tar.enc is a file, might be inside the folder or flatten?
                    files = os.listdir(tmp_path)
                    if len(files) == 1 and files[0].endswith(".tar.enc"):
                        backup_file_path = os.path.join(tmp_path, files[0])
                    else:
                        # fallback: attempt to find .tar.enc
                        found = False
                        for f in files:
                            if f.endswith(".tar.enc"):
                                backup_file_path = os.path.join(tmp_path, f)
                                found = True
                                break
                        if not found:
                            raise BackupVerificationError("No encrypted backup file found in retrieved data.")
                verified = self._verify_backup(backup_file_path)
                shutil.rmtree(tmp_path)
                if verified:
                    break
            except Exception as e:
                logger.warning(f"Verification failed for destination {destination}: {e}")
        return verified

    def schedule_periodic_backup(self, backup_type: BackupType, interval_sec: int, stop_event: threading.Event) -> None:
        def run():
            while not stop_event.is_set():
                try:
                    self.perform_backup(backup_type)
                except Exception as exc:
                    logger.error(f"Scheduled backup failed: {exc}")
                stop_event.wait(interval_sec)
        t = threading.Thread(target=run, daemon=True)
        t.start()

    def point_in_time_recovery(self, backup_name: str, recovery_path: str) -> None:
        with self._lock:
            logger.info(f"Starting point-in-time recovery from backup '{backup_name}'...")
            # Retrieve matching backup from destinations
            for destination in self.backup_destinations:
                try:
                    tmp_path = os.path.join(self.backup_storage_path, "recovery_tmp")
                    if os.path.exists(tmp_path):
                        shutil.rmtree(tmp_path)
                    os.makedirs(tmp_path, exist_ok=True)

                    destination.retrieve_backup(backup_name + ".tar.enc", tmp_path)
                    backup_file = os.path.join(tmp_path, backup_name + ".tar.enc")
                    if not os.path.exists(backup_file):
                        # If not found with extension appended, look inside tmp_path for .tar.enc file
                        files = os.listdir(tmp_path)
                        found_file = None
                        for f in files:
                            if f.endswith(".tar.enc"):
                                found_file = os.path.join(tmp_path, f)
                                break
                        if not found_file:
                            raise FileNotFoundError(f"Backup archive {backup_name}.tar.enc not found in retrieved data")
                        backup_file = found_file

                    # Decrypt archive
                    with open(backup_file, "rb") as f:
                        encrypted_data = f.read()
                    decrypted_data = self.cipher.decrypt(encrypted_data)

                    # Extract archive
                    import tarfile
                    from io import BytesIO
                    archive = tarfile.open(fileobj=BytesIO(decrypted_data))
                    if os.path.exists(recovery_path):
                        if os.path.isfile(recovery_path):
                            os.remove(recovery_path)
                        else:
                            shutil.rmtree(recovery_path)
                    os.makedirs(recovery_path, exist_ok=True)
                    archive.extractall(path=recovery_path)
                    archive.close()
                    shutil.rmtree(tmp_path)

                    logger.info(f"Recovery to '{recovery_path}' completed successfully.")
                    return
                except Exception as e:
                    logger.warning(f"Recovery failed from destination {destination}: {e}")
            raise Exception("Failed to recover backup from all destinations")

    def automated_failover_check(self, health_check_fn: Callable[[], bool], failover_action: Callable[[], None], check_interval_sec: int, stop_event: threading.Event) -> None:
        def run():
            while not stop_event.is_set():
                try:
                    healthy = health_check_fn()
                    if not healthy:
                        logger.warning("Health check failed, performing failover...")
                        failover_action()
                        logger.info("Failover completed")
                    else:
                        logger.debug("Health check passed")
                except Exception as err:
                    logger.error(f"Failover check experienced error: {err}")
                stop_event.wait(check_interval_sec)
        t = threading.Thread(target=run, daemon=True)
        t.start()

    def rto_monitoring(self, operation_start_time: datetime) -> bool:
        elapsed = (datetime.utcnow() - operation_start_time).total_seconds()
        if elapsed > self.rto_threshold_sec:
            logger.warning(f"Recovery time objective exceeded: elapsed {elapsed}s > threshold {self.rto_threshold_sec}s")
            return False
        logger.info(f"Recovery time objective met: elapsed {elapsed}s <= threshold {self.rto_threshold_sec}s")
        return True
```