```python
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column,
    Integer,
    String,
    Date,
    DateTime,
    ForeignKey,
    JSON,
    Enum,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship, declarative_base, validates
import enum

Base = declarative_base()


class ScanModality(enum.Enum):
    CT = "CT"
    MRI = "MRI"
    XRAY = "XRay"
    PET = "PET"
    ULTRASOUND = "Ultrasound"
    OTHER = "Other"


class PatientDemographics(Base):
    __tablename__ = "patient_demographics"

    # HIPAA compliance: no direct PII stored; use de-identified patient_code as primary key
    patient_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_code = Column(String(64), unique=True, nullable=False, index=True)  # anonymized ID

    sex = Column(Enum("M", "F", "O", name="sex_enum"), nullable=True)
    birth_year = Column(Integer, nullable=True, index=True)
    race_ethnicity = Column(String(128), nullable=True)
    other_anon_data = Column(JSON, nullable=True)  # Any other de-id info, e.g. zip3 truncated

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    imaging_metadata = relationship(
        "ImagingMetadata", back_populates="patient", cascade="all, delete-orphan"
    )
    models_3d = relationship(
        "Model3DReference", back_populates="patient", cascade="all, delete-orphan"
    )
    analysis_results = relationship(
        "AnalysisResult", back_populates="patient", cascade="all, delete-orphan"
    )
    audit_trails = relationship(
        "AuditTrailEntry", back_populates="patient", cascade="all, delete-orphan"
    )
    data_lineage = relationship(
        "DataLineage", back_populates="patient", cascade="all, delete-orphan"
    )

    @validates("birth_year")
    def validate_birth_year(self, key, value):
        if value is not None:
            year_now = datetime.utcnow().year
            if value < 1900 or value > year_now:
                raise ValueError(f"birth_year must be between 1900 and {year_now}")
        return value

    @validates("patient_code")
    def validate_patient_code(self, key, value):
        if not value or len(value.strip()) == 0:
            raise ValueError("patient_code must be a non-empty anonymized string")
        return value


class ImagingMetadata(Base):
    __tablename__ = "imaging_metadata"

    imaging_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patient_demographics.patient_id"), nullable=False)

    scan_date = Column(Date, nullable=False, index=True)
    modality = Column(Enum(ScanModality), nullable=False)
    parameters = Column(JSON, nullable=True)  # e.g. scan parameters, exposure, slice thickness

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    patient = relationship("PatientDemographics", back_populates="imaging_metadata")

    __table_args__ = (
        UniqueConstraint("patient_id", "scan_date", "modality", name="uix_patient_scanmod"),
    )


class Model3DReference(Base):
    __tablename__ = "model_3d_reference"

    model_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patient_demographics.patient_id"), nullable=False)

    model_name = Column(String(128), nullable=False)  # descriptive label
    version = Column(String(32), nullable=False)

    storage_uri = Column(String(512), nullable=False)  # location of the 3D model file (S3/bucket/...)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("PatientDemographics", back_populates="models_3d")

    __table_args__ = (
        UniqueConstraint("patient_id", "model_name", "version", name="uix_patient_model_version"),
    )

    @validates("storage_uri")
    def validate_storage_uri(self, key, value):
        if not value or len(value.strip()) == 0:
            raise ValueError("storage_uri must be a non-empty string")
        return value


class AnalysisResult(Base):
    __tablename__ = "analysis_result"

    result_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patient_demographics.patient_id"), nullable=False)

    analysis_name = Column(String(128), nullable=False)
    analysis_version = Column(String(32), nullable=True)

    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    result_data = Column(JSON, nullable=False)  # e.g. metrics, annotations, classifications

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patient = relationship("PatientDemographics", back_populates="analysis_results")

    __table_args__ = (
        UniqueConstraint(
            "patient_id",
            "analysis_name",
            "analysis_version",
            "timestamp",
            name="uix_patient_analysis_timestamp",
        ),
    )


class AuditTrailEntry(Base):
    __tablename__ = "audit_trail_entry"

    audit_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patient_demographics.patient_id"), nullable=False)

    actor_id = Column(String(128), nullable=False)  # anonymized user or system id
    action = Column(String(256), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    description = Column(String(1024), nullable=True)

    patient = relationship("PatientDemographics", back_populates="audit_trails")

    @validates("actor_id", "action")
    def validate_non_empty(self, key, value):
        if not value or len(value.strip()) == 0:
            raise ValueError(f"{key} must be a non-empty string")
        return value


class DataLineage(Base):
    __tablename__ = "data_lineage"

    lineage_id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(Integer, ForeignKey("patient_demographics.patient_id"), nullable=False)

    source_type = Column(String(128), nullable=False)  # e.g. 'Imaging', 'Model3D', 'Analysis'
    source_id = Column(String(128), nullable=False)  # identifier for source record
    derived_type = Column(String(128), nullable=False)  # e.g. "AnalysisResult"
    derived_id = Column(String(128), nullable=False)  # identifier for derived record

    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    details = Column(JSON, nullable=True)  # Additional lineage metadata

    patient = relationship("PatientDemographics", back_populates="data_lineage")

    __table_args__ = (
        UniqueConstraint(
            "patient_id",
            "source_type",
            "source_id",
            "derived_type",
            "derived_id",
            name="uix_patient_data_lineage",
        ),
    )

    @validates("source_type", "source_id", "derived_type", "derived_id")
    def validate_non_empty(self, key, value):
        if not value or len(value.strip()) == 0:
            raise ValueError(f"{key} must be a non-empty string")
        return value
```