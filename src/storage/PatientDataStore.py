```python
import os
import logging
import datetime
import base64
import hashlib
import hmac
import json
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

from sqlalchemy import (create_engine, Column, Integer, String, LargeBinary, 
                        DateTime, ForeignKey, Boolean, JSON, event)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.sql import func

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

Base = declarative_base()

# Ensure environment variables for encryption key and DB connection are set securely
DB_URL = os.environ.get('PATIENT_DATASTORE_DB_URL')
ENCRYPTION_KEY = os.environ.get('PATIENT_DATASTORE_ENC_KEY')  # base64 encoded 32 bytes key

if not DB_URL or not ENCRYPTION_KEY:
    raise RuntimeError("Environment variables PATIENT_DATASTORE_DB_URL and PATIENT_DATASTORE_ENC_KEY must be set")

encryption_key = base64.b64decode(ENCRYPTION_KEY)

engine = create_engine(DB_URL, connect_args={"sslmode": "require"})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

logger = logging.getLogger("PatientDataStore")
logger.setLevel(logging.INFO)
handler = logging.FileHandler("patient_data_access.log")
formatter = logging.Formatter('%(asctime)s %(levelname)s %(user)s %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)


def audit_log(user: str, action: str, resource: str, details: Optional[dict] = None):
    log_msg = f"Action={action} Resource={resource}"
    if details:
        log_msg += " Details=" + json.dumps(details, default=str)
    logger.info(log_msg, extra={'user': user})


def _derive_nonce(record_id: int, purpose: str) -> bytes:
    # Deterministic nonce derivation (12 bytes) from record id and purpose string
    h = hmac.new(encryption_key, f"{purpose}:{record_id}".encode(), hashlib.sha256).digest()
    return h[:12]


def encrypt_data(plaintext: bytes, record_id: int, purpose: str) -> bytes:
    nonce = _derive_nonce(record_id, purpose)
    aesgcm = AESGCM(encryption_key)
    return aesgcm.encrypt(nonce, plaintext, None)


def decrypt_data(ciphertext: bytes, record_id: int, purpose: str) -> bytes:
    nonce = _derive_nonce(record_id, purpose)
    aesgcm = AESGCM(encryption_key)
    return aesgcm.decrypt(nonce, ciphertext, None)


class Patient(Base):
    __tablename__ = 'patients'

    id = Column(Integer, primary_key=True)
    first_name_enc = Column(LargeBinary, nullable=False)
    last_name_enc = Column(LargeBinary, nullable=False)
    dob_enc = Column(LargeBinary, nullable=False)
    gender_enc = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    imaging_data = relationship("ImagingData", back_populates="patient", cascade="all, delete-orphan")
    models_3d = relationship("Model3D", back_populates="patient", cascade="all, delete-orphan")
    analyses = relationship("AnalysisResult", back_populates="patient", cascade="all, delete-orphan")


class ImagingData(Base):
    __tablename__ = 'imaging_data'

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey('patients.id', ondelete='CASCADE'), nullable=False)
    dicom_enc = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    description_enc = Column(LargeBinary, nullable=True)

    patient = relationship("Patient", back_populates="imaging_data")


class Model3D(Base):
    __tablename__ = 'models_3d'

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey('patients.id', ondelete='CASCADE'), nullable=False)
    version = Column(Integer, nullable=False)
    model_enc = Column(LargeBinary, nullable=False)
    metadata_enc = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    patient = relationship("Patient", back_populates="models_3d")


class AnalysisResult(Base):
    __tablename__ = 'analysis_results'

    id = Column(Integer, primary_key=True)
    patient_id = Column(Integer, ForeignKey('patients.id', ondelete='CASCADE'), nullable=False)
    result_enc = Column(LargeBinary, nullable=False)
    archived_at = Column(DateTime(timezone=True), server_default=func.now())

    patient = relationship("Patient", back_populates="analyses")


class DataRetentionPolicy(Base):
    __tablename__ = 'data_retention_policies'

    id = Column(Integer, primary_key=True)
    retention_days = Column(Integer, nullable=False)
    active = Column(Boolean, default=True)
    applied_at = Column(DateTime(timezone=True), server_default=func.now())


Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except:
        session.rollback()
        raise
    finally:
        session.close()


class PatientDataStore:

    def __init__(self, user: str):
        self._user = user

    # --- Patient CRUD ---

    def create_patient(self, first_name: str, last_name: str, dob: str, gender: str) -> int:
        with session_scope() as session:
            # Temporarily create patient to get ID for encryption
            patient = Patient(
                first_name_enc=b'',
                last_name_enc=b'',
                dob_enc=b'',
                gender_enc=b'',
            )
            session.add(patient)
            session.flush()

            patient.first_name_enc = encrypt_data(first_name.encode('utf-8'), patient.id, 'first_name')
            patient.last_name_enc = encrypt_data(last_name.encode('utf-8'), patient.id, 'last_name')
            patient.dob_enc = encrypt_data(dob.encode('utf-8'), patient.id, 'dob')
            patient.gender_enc = encrypt_data(gender.encode('utf-8'), patient.id, 'gender')
            session.add(patient)

            audit_log(self._user, "CREATE_PATIENT", f"patient_id={patient.id}",
                      {"first_name": first_name, "last_name": last_name, "dob": dob, "gender": gender})

            return patient.id

    def get_patient(self, patient_id: int) -> Optional[Dict[str, Any]]:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                return None
            data = {
                "id": patient.id,
                "first_name": decrypt_data(patient.first_name_enc, patient.id, 'first_name').decode('utf-8'),
                "last_name": decrypt_data(patient.last_name_enc, patient.id, 'last_name').decode('utf-8'),
                "dob": decrypt_data(patient.dob_enc, patient.id, 'dob').decode('utf-8'),
                "gender": decrypt_data(patient.gender_enc, patient.id, 'gender').decode('utf-8'),
                "created_at": patient.created_at,
                "updated_at": patient.updated_at,
            }
            audit_log(self._user, "READ_PATIENT", f"patient_id={patient.id}")
            return data

    def update_patient(self, patient_id: int, first_name: Optional[str] = None,
                       last_name: Optional[str] = None, dob: Optional[str] = None,
                       gender: Optional[str] = None) -> bool:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                return False
            if first_name is not None:
                patient.first_name_enc = encrypt_data(first_name.encode('utf-8'), patient.id, 'first_name')
            if last_name is not None:
                patient.last_name_enc = encrypt_data(last_name.encode('utf-8'), patient.id, 'last_name')
            if dob is not None:
                patient.dob_enc = encrypt_data(dob.encode('utf-8'), patient.id, 'dob')
            if gender is not None:
                patient.gender_enc = encrypt_data(gender.encode('utf-8'), patient.id, 'gender')
            audit_log(self._user, "UPDATE_PATIENT", f"patient_id={patient.id}", {
                "first_name": first_name, "last_name": last_name, "dob": dob, "gender": gender})
            return True

    def delete_patient(self, patient_id: int) -> bool:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                return False
            session.delete(patient)
            audit_log(self._user, "DELETE_PATIENT", f"patient_id={patient_id}")
            return True

    # --- Imaging Data Management ---

    def add_imaging_data(self, patient_id: int, dicom_data: bytes, description: Optional[str] = None) -> int:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                raise ValueError("Patient not found")

            dicom_enc = encrypt_data(dicom_data, patient_id, 'dicom')
            description_enc = encrypt_data(description.encode('utf-8'), patient_id, 'description') if description else None

            imaging = ImagingData(patient_id=patient_id, dicom_enc=dicom_enc, description_enc=description_enc)
            session.add(imaging)
            session.flush()
            audit_log(self._user, "ADD_IMAGING", f"patient_id={patient_id} imaging_id={imaging.id}",
                      {"description": description})
            return imaging.id

    def get_imaging_data(self, imaging_id: int) -> Optional[Dict[str, Any]]:
        with session_scope() as session:
            imaging = session.get(ImagingData, imaging_id)
            if not imaging:
                return None
            dicom_data = decrypt_data(imaging.dicom_enc, imaging.patient_id, 'dicom')
            description = None
            if imaging.description_enc:
                description = decrypt_data(imaging.description_enc, imaging.patient_id, 'description').decode('utf-8')

            audit_log(self._user, "READ_IMAGING", f"imaging_id={imaging_id} patient_id={imaging.patient_id}")
            return {
                "id": imaging.id,
                "patient_id": imaging.patient_id,
                "dicom_data": dicom_data,
                "description": description,
                "created_at": imaging.created_at,
            }

    def delete_imaging_data(self, imaging_id: int) -> bool:
        with session_scope() as session:
            imaging = session.get(ImagingData, imaging_id)
            if not imaging:
                return False
            session.delete(imaging)
            audit_log(self._user, "DELETE_IMAGING", f"imaging_id={imaging_id} patient_id={imaging.patient_id}")
            return True

    # --- 3D Model Management with Versioning ---

    def add_3d_model(self, patient_id: int, model_data: bytes, metadata: Optional[dict] = None) -> int:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                raise ValueError("Patient not found")
            # Determine next version
            last_version = session.query(func.max(Model3D.version)).filter_by(patient_id=patient_id).scalar() or 0
            next_version = last_version + 1

            model_enc = encrypt_data(model_data, patient_id, f'model_v{next_version}')
            metadata_json = json.dumps(metadata).encode('utf-8') if metadata else None
            metadata_enc = encrypt_data(metadata_json, patient_id, f'modelmeta_v{next_version}') if metadata else None

            model = Model3D(patient_id=patient_id, version=next_version,
                            model_enc=model_enc, metadata_enc=metadata_enc)
            session.add(model)
            session.flush()
            audit_log(self._user, "ADD_3D_MODEL", f"patient_id={patient_id} model_id={model.id}",
                      {"version": next_version, "metadata": metadata})
            return model.id

    def get_3d_model(self, model_id: int) -> Optional[Dict[str, Any]]:
        with session_scope() as session:
            model = session.get(Model3D, model_id)
            if not model:
                return None
            model_data = decrypt_data(model.model_enc, model.patient_id, f'model_v{model.version}')
            metadata = None
            if model.metadata_enc:
                metadata_json = decrypt_data(model.metadata_enc, model.patient_id, f'modelmeta_v{model.version}')
                metadata = json.loads(metadata_json.decode('utf-8'))
            audit_log(self._user, "READ_3D_MODEL", f"model_id={model_id} patient_id={model.patient_id}")
            return {
                "id": model.id,
                "patient_id": model.patient_id,
                "version": model.version,
                "model_data": model_data,
                "metadata": metadata,
                "created_at": model.created_at,
            }

    def delete_3d_model(self, model_id: int) -> bool:
        with session_scope() as session:
            model = session.get(Model3D, model_id)
            if not model:
                return False
            session.delete(model)
            audit_log(self._user, "DELETE_3D_MODEL", f"model_id={model_id} patient_id={model.patient_id}")
            return True

    # --- Analysis Result Archival ---

    def archive_analysis_result(self, patient_id: int, analysis_data: bytes) -> int:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                raise ValueError("Patient not found")
            result_enc = encrypt_data(analysis_data, patient_id, "analysis_result")
            analysis = AnalysisResult(patient_id=patient_id, result_enc=result_enc)
            session.add(analysis)
            session.flush()
            audit_log(self._user, "ARCHIVE_ANALYSIS", f"patient_id={patient_id} analysis_id={analysis.id}")
            return analysis.id

    def get_analysis_result(self, analysis_id: int) -> Optional[Dict[str, Any]]:
        with session_scope() as session:
            analysis = session.get(AnalysisResult, analysis_id)
            if not analysis:
                return None
            data = decrypt_data(analysis.result_enc, analysis.patient_id, "analysis_result")
            audit_log(self._user, "READ_ANALYSIS", f"analysis_id={analysis_id} patient_id={analysis.patient_id}")
            return {
                "id": analysis.id,
                "patient_id": analysis.patient_id,
                "analysis_data": data,
                "archived_at": analysis.archived_at,
            }

    # --- Data Retention and Cleanup ---

    def enforce_retention_policy(self):
        with session_scope() as session:
            policy = session.query(DataRetentionPolicy).filter_by(active=True).order_by(DataRetentionPolicy.applied_at.desc()).first()
            if not policy:
                return
            cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=policy.retention_days)

            # Patients deletion is cascaded, so delete patients created before cutoff
            patients_to_delete = session.query(Patient).filter(Patient.created_at < cutoff).all()
            deleted_patient_ids = [p.id for p in patients_to_delete]
            for p in patients_to_delete:
                session.delete(p)

            if deleted_patient_ids:
                audit_log(self._user, "DATA_RETENTION_DELETE", "patients", {"deleted_patient_ids": deleted_patient_ids})

    def set_retention_policy(self, days: int, active: bool = True) -> int:
        with session_scope() as session:
            policy = DataRetentionPolicy(retention_days=days, active=active)
            session.add(policy)
            session.flush()
            audit_log(self._user, "SET_RETENTION_POLICY", f"policy_id={policy.id}",
                      {"retention_days": days, "active": active})
            return policy.id

    def get_active_retention_policy(self) -> Optional[Dict[str, Any]]:
        with session_scope() as session:
            policy = session.query(DataRetentionPolicy).filter_by(active=True).order_by(DataRetentionPolicy.applied_at.desc()).first()
            if not policy:
                return None
            return {
                "id": policy.id,
                "retention_days": policy.retention_days,
                "active": policy.active,
                "applied_at": policy.applied_at,
            }

    # --- Backup and Recovery (Example: Export and Import) ---

    def export_patient_data(self, patient_id: int) -> Optional[dict]:
        with session_scope() as session:
            patient = session.get(Patient, patient_id)
            if not patient:
                return None
            def decrypt_field(enc_field, purpose): return decrypt_data(enc_field, patient.id, purpose).decode('utf-8')

            imaging_list = []
            for img in patient.imaging_data:
                imaging_list.append({
                    "id": img.id,
                    "dicom_data": base64.b64encode(decrypt_data(img.dicom_enc, patient.id, 'dicom')).decode('utf-8'),
                    "description": decrypt_data(img.description_enc, patient.id, 'description').decode('utf-8') if img.description_enc else None,
                    "created_at": img.created_at.isoformat(),
                })

            models_list = []
            for model in patient.models_3d:
                model_data_b64 = base64.b64encode(decrypt_data(model.model_enc, patient.id, f'model_v{model.version}')).decode('utf-8')
                metadata = None
                if model.metadata_enc:
                    metadata_json = decrypt_data(model.metadata_enc, patient.id, f'modelmeta_v{model.version}')
                    metadata = json.loads(metadata_json.decode('utf-8'))
                models_list.append({
                    "id": model.id,
                    "version": model.version,
                    "model_data": model_data_b64,
                    "metadata": metadata,
                    "created_at": model.created_at.isoformat(),
                })

            analyses_list = []
            for analysis in patient.analyses:
                analysis_data_b64 = base64.b64encode(decrypt_data(analysis.result_enc, patient.id, "analysis_result")).decode('utf-8')
                analyses_list.append({
                    "id":