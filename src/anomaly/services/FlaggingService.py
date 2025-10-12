```python
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, Text, JSON, ForeignKey, create_engine, and_
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session

# Setup logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

Base = declarative_base()

# Database models

class Anomaly(Base):
    __tablename__ = 'anomalies'

    id = Column(Integer, primary_key=True, autoincrement=True)
    detection_id = Column(String(64), unique=True, nullable=False)  # unique id from detection system
    description = Column(Text, nullable=False)
    severity = Column(String(16), nullable=False)  # e.g. low, medium, high, critical
    clinical_significance = Column(Boolean, default=False, nullable=False)
    priority = Column(Integer, nullable=False)
    status = Column(String(32), default='flagged', nullable=False)  # flagged, reviewed, resolved, dismissed
    detected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    history = relationship("AnomalyHistory", back_populates="anomaly", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="anomaly", cascade="all, delete-orphan")
    audit_trails = relationship("AuditTrail", back_populates="anomaly", cascade="all, delete-orphan")

class AnomalyHistory(Base):
    __tablename__ = 'anomaly_histories'

    id = Column(Integer, primary_key=True, autoincrement=True)
    anomaly_id = Column(Integer, ForeignKey('anomalies.id'), nullable=False)
    compared_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    changes = Column(JSON, nullable=False)
    anomaly = relationship("Anomaly", back_populates="history")

class Alert(Base):
    __tablename__ = 'alerts'

    id = Column(Integer, primary_key=True, autoincrement=True)
    anomaly_id = Column(Integer, ForeignKey('anomalies.id'), nullable=False)
    clinician_id = Column(String(64), nullable=False)
    message = Column(Text, nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    anomaly = relationship("Anomaly", back_populates="alerts")

class AuditTrail(Base):
    __tablename__ = 'audit_trails'

    id = Column(Integer, primary_key=True, autoincrement=True)
    anomaly_id = Column(Integer, ForeignKey('anomalies.id'), nullable=False)
    action = Column(String(64), nullable=False)
    performed_by = Column(String(64), nullable=False)  # system or user id
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    details = Column(JSON, nullable=True)
    anomaly = relationship("Anomaly", back_populates="audit_trails")

# Priority mapping
SEVERITY_PRIORITY_MAPPING = {
    "low": 1,
    "medium": 2,
    "high": 4,
    "critical": 5,
}

# Assume clinician notification system interface
class ClinicianNotificationSystem:
    def notify(self, clinician_id: str, message: str) -> None:
        # Placeholder for actual notification logic (email, SMS, app notification)
        logger.info(f"Notification sent to clinician {clinician_id}: {message}")

# FlaggingService

class FlaggingService:
    def __init__(self, db_session: Session, notifier: ClinicianNotificationSystem):
        self.db_session = db_session
        self.notifier = notifier

    def _assign_priority(self, severity: str, clinical_significance: bool) -> int:
        base_priority = SEVERITY_PRIORITY_MAPPING.get(severity.lower(), 1)
        if clinical_significance:
            base_priority += 1
        priority = min(base_priority, max(SEVERITY_PRIORITY_MAPPING.values()) + 1)
        return priority

    def flag_anomaly(
        self,
        detection_id: str,
        description: str,
        severity: str,
        clinical_significance: bool,
        clinician_ids_to_notify: List[str],
        performed_by: str = "system"
    ) -> Anomaly:
        anomaly = self.db_session.query(Anomaly).filter_by(detection_id=detection_id).one_or_none()

        priority = self._assign_priority(severity, clinical_significance)

        if anomaly is None:
            anomaly = Anomaly(
                detection_id=detection_id,
                description=description,
                severity=severity,
                clinical_significance=clinical_significance,
                priority=priority,
                status='flagged',
            )
            self.db_session.add(anomaly)
            self.db_session.flush()  # to get anomaly.id for relationships

            self._record_audit_trail(
                anomaly,
                action="flagged",
                performed_by=performed_by,
                details={"description": description, "severity": severity, "clinical_significance": clinical_significance, "priority": priority}
            )
        else:
            changes = {}
            if anomaly.description != description:
                changes['description'] = {"old": anomaly.description, "new": description}
                anomaly.description = description
            if anomaly.severity != severity:
                changes['severity'] = {"old": anomaly.severity, "new": severity}
                anomaly.severity = severity
            if anomaly.clinical_significance != clinical_significance:
                changes['clinical_significance'] = {"old": anomaly.clinical_significance, "new": clinical_significance}
                anomaly.clinical_significance = clinical_significance
            new_priority = self._assign_priority(severity, clinical_significance)
            if anomaly.priority != new_priority:
                changes['priority'] = {"old": anomaly.priority, "new": new_priority}
                anomaly.priority = new_priority

            if changes:
                self._record_history(anomaly, changes)
                self._record_audit_trail(
                    anomaly,
                    action="updated",
                    performed_by=performed_by,
                    details=changes
                )
            if anomaly.status != 'flagged':
                anomaly.status = 'flagged'
                self._record_audit_trail(
                    anomaly,
                    action="status_changed",
                    performed_by=performed_by,
                    details={"old_status": anomaly.status, "new_status": "flagged"}
                )

        self.db_session.commit()

        for clinician_id in clinician_ids_to_notify:
            message = f"Anomaly detected: {description} (Severity: {severity}, Priority: {priority})"
            try:
                self.notifier.notify(clinician_id, message)
                alert = Alert(anomaly_id=anomaly.id, clinician_id=clinician_id, message=message)
                self.db_session.add(alert)
            except Exception as e:
                logger.error(f"Failed to notify clinician {clinician_id}: {e}")

        self.db_session.commit()
        logger.info(f"Anomaly flagged: {detection_id} with priority {priority}")

        return anomaly

    def update_status(self, detection_id: str, new_status: str, performed_by: str = "system") -> Optional[Anomaly]:
        anomaly = self.db_session.query(Anomaly).filter_by(detection_id=detection_id).one_or_none()
        if anomaly is None:
            logger.warning(f"Attempted to update status on non-existing anomaly {detection_id}")
            return None
        old_status = anomaly.status
        if old_status != new_status:
            anomaly.status = new_status
            self._record_audit_trail(
                anomaly,
                action="status_changed",
                performed_by=performed_by,
                details={"old_status": old_status, "new_status": new_status}
            )
            self.db_session.commit()
            logger.info(f"Anomaly {detection_id} status updated from {old_status} to {new_status}")
        return anomaly

    def _record_history(self, anomaly: Anomaly, changes: Dict[str, Any]) -> None:
        history = AnomalyHistory(anomaly_id=anomaly.id, changes=changes)
        self.db_session.add(history)

    def _record_audit_trail(self, anomaly: Anomaly, action: str, performed_by: str, details: Optional[Dict[str, Any]]) -> None:
        audit = AuditTrail(
            anomaly_id=anomaly.id,
            action=action,
            performed_by=performed_by,
            details=details or {}
        )
        self.db_session.add(audit)

    def get_anomaly(self, detection_id: str) -> Optional[Anomaly]:
        return self.db_session.query(Anomaly).filter_by(detection_id=detection_id).one_or_none()

    def list_anomalies(
        self,
        status: Optional[str] = None,
        min_priority: Optional[int] = None,
        max_priority: Optional[int] = None,
        clinical_significance: Optional[bool] = None
    ) -> List[Anomaly]:
        query = self.db_session.query(Anomaly)
        if status:
            query = query.filter(Anomaly.status == status)
        if min_priority is not None:
            query = query.filter(Anomaly.priority >= min_priority)
        if max_priority is not None:
            query = query.filter(Anomaly.priority <= max_priority)
        if clinical_significance is not None:
            query = query.filter(Anomaly.clinical_significance == clinical_significance)
        return query.order_by(Anomaly.priority.desc(), Anomaly.detected_at.desc()).all()

    def generate_report(self, status_filter: Optional[str] = None) -> Dict[str, Any]:
        query = self.db_session.query(Anomaly)
        if status_filter:
            query = query.filter(Anomaly.status == status_filter)

        total = query.count()
        by_severity = {}
        for sev in SEVERITY_PRIORITY_MAPPING.keys():
            count = query.filter(Anomaly.severity == sev).count()
            by_severity[sev] = count

        by_status = {}
        status_counts = (
            self.db_session.query(Anomaly.status, func.count(Anomaly.id))
            .group_by(Anomaly.status)
            .all()
        )
        for status, count in status_counts:
            by_status[status] = count

        report = {
            "total_anomalies": total,
            "by_severity": by_severity,
            "by_status": by_status,
            "generated_at": datetime.utcnow().isoformat() + "Z"
        }
        return report


# Database setup utility for example usage:

def init_db(db_url: str = "sqlite:///./flagging_service.db"):
    engine = create_engine(db_url, echo=False, future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)

# Import func for aggregate in report
from sqlalchemy import func
```