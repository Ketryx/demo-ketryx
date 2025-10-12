```python
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Query,
    Request,
    Response,
)
from fastapi.security import OAuth2PasswordBearer
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Union
from uuid import UUID, uuid4
from datetime import datetime
import asyncio

router = APIRouter(prefix="/storage", tags=["StorageAPI"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")


# Dummy in-memory DB for demonstration purposes
_DB = {
    "patients": {},
    "imaging": {},
    "models3d": {},
    "analysis": {},
    "audit_log": [],
    "users": {
        # username -> dict
        "doctor1": {"scopes": ["read:patient", "write:patient", "read:imaging", "export:data"]},
        "researcher1": {"scopes": ["read:patient", "read:imaging", "read:analysis"]},
        "admin1": {"scopes": ["*"]},
    },
}


class PatientData(BaseModel):
    patient_id: UUID = Field(default_factory=uuid4)
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    date_of_birth: datetime
    gender: str = Field(..., regex="^(male|female|other|unknown)$")
    medical_history: Optional[List[str]] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @validator("date_of_birth")
    def check_dob(cls, v):
        if v > datetime.utcnow():
            raise ValueError("date_of_birth cannot be in the future")
        return v


class ImagingData(BaseModel):
    imaging_id: UUID = Field(default_factory=uuid4)
    patient_id: UUID
    modality: str = Field(..., regex="^(CT|MRI|XRay|Ultrasound)$")
    description: Optional[str]
    date_taken: datetime
    image_url: str
    tags: Optional[List[str]] = []


class Model3D(BaseModel):
    model_id: UUID = Field(default_factory=uuid4)
    patient_id: UUID
    model_type: str = Field(..., regex="^(CT_3D|MRI_3D|PET_3D)$")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    model_url: str


class AnalysisResult(BaseModel):
    analysis_id: UUID = Field(default_factory=uuid4)
    patient_id: UUID
    analysis_type: str = Field(..., min_length=1)
    result_data: dict
    analyzed_at: datetime = Field(default_factory=datetime.utcnow)


class AuditLogEntry(BaseModel):
    log_id: UUID = Field(default_factory=uuid4)
    user: str
    action: str
    resource: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    detail: Optional[str]


def log_action(user: str, action: str, resource: str, detail: Optional[str] = None):
    entry = AuditLogEntry(
        user=user,
        action=action,
        resource=resource,
        detail=detail,
    )
    _DB["audit_log"].append(entry)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    # Simplified auth for demonstration: token is username
    user = _DB["users"].get(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication credentials")
    return {"username": token, "scopes": user["scopes"]}


def authorize_user(user: dict, required_scope: str):
    scopes = user.get("scopes", [])
    if "*" not in scopes and required_scope not in scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges")


@router.post(
    "/patients",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RateLimiter(times=20, seconds=60))],
    response_model=PatientData,
)
async def store_patient_data(
    patient: PatientData,
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "write:patient")
    if patient.patient_id in _DB["patients"]:
        raise HTTPException(status_code=409, detail="Patient data already exists")
    _DB["patients"][patient.patient_id] = patient
    log_action(current_user["username"], "create", f"patient:{patient.patient_id}")
    return patient


@router.get(
    "/patients/{patient_id}",
    response_model=PatientData,
    dependencies=[Depends(RateLimiter(times=40, seconds=60))],
)
async def get_patient_data(
    patient_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "read:patient")
    patient = _DB["patients"].get(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient data not found")
    log_action(current_user["username"], "read", f"patient:{patient_id}")
    return patient


@router.get(
    "/imaging",
    response_model=List[ImagingData],
    dependencies=[Depends(RateLimiter(times=30, seconds=60))],
)
async def query_imaging_data(
    patient_id: Optional[UUID] = Query(None),
    modality: Optional[str] = Query(None, regex="^(CT|MRI|XRay|Ultrasound)$"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "read:imaging")
    results = []
    for img in _DB["imaging"].values():
        if patient_id and img.patient_id != patient_id:
            continue
        if modality and img.modality != modality:
            continue
        if date_from and img.date_taken < date_from:
            continue
        if date_to and img.date_taken > date_to:
            continue
        results.append(img)
    log_action(current_user["username"], "query", "imaging")
    return results


@router.post(
    "/models3d",
    status_code=status.HTTP_201_CREATED,
    response_model=Model3D,
    dependencies=[Depends(RateLimiter(times=10, seconds=60))],
)
async def add_3d_model(
    model: Model3D,
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "write:patient")
    if model.model_id in _DB["models3d"]:
        raise HTTPException(status_code=409, detail="3D model already exists")
    _DB["models3d"][model.model_id] = model
    log_action(current_user["username"], "create", f"model3d:{model.model_id}")
    return model


@router.get(
    "/models3d/{model_id}",
    response_model=Model3D,
    dependencies=[Depends(RateLimiter(times=20, seconds=60))],
)
async def get_3d_model(
    model_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "read:patient")
    model = _DB["models3d"].get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="3D model not found")
    log_action(current_user["username"], "read", f"model3d:{model_id}")
    return model


@router.get(
    "/analysis",
    response_model=List[AnalysisResult],
    dependencies=[Depends(RateLimiter(times=25, seconds=60))],
)
async def get_analysis_results(
    patient_id: Optional[UUID] = Query(None),
    analysis_type: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "read:analysis")
    results = []
    for analysis in _DB["analysis"].values():
        if patient_id and analysis.patient_id != patient_id:
            continue
        if analysis_type and analysis.analysis_type != analysis_type:
            continue
        results.append(analysis)
    log_action(current_user["username"], "query", "analysis")
    return results


@router.get(
    "/audit_log",
    dependencies=[Depends(RateLimiter(times=5, seconds=60))],
    response_model=List[AuditLogEntry],
)
async def get_audit_log(
    user_filter: Optional[str] = Query(None),
    action_filter: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "read:audit")
    filtered_logs = []
    for entry in _DB["audit_log"]:
        if user_filter and entry.user != user_filter:
            continue
        if action_filter and entry.action != action_filter:
            continue
        if date_from and entry.timestamp < date_from:
            continue
        if date_to and entry.timestamp > date_to:
            continue
        filtered_logs.append(entry)
    log_action(current_user["username"], "query", "audit_log")
    return filtered_logs


@router.get(
    "/export",
    dependencies=[Depends(RateLimiter(times=2, seconds=60))],
    response_class=Response,
    responses={200: {"content": {"application/json": {}}}},
)
async def export_data(
    patient_id: Optional[UUID] = Query(None),
    data_type: Union[str, None] = Query(
        None, regex="^(patient|imaging|model3d|analysis|all)$", description="Type of data to export"
    ),
    current_user: dict = Depends(get_current_user),
):
    authorize_user(current_user, "export:data")

    export_content = {}

    if data_type in ("patient", "all", None):
        if patient_id:
            patient = _DB["patients"].get(patient_id)
            if patient:
                export_content["patient"] = patient.dict()
            else:
                raise HTTPException(status_code=404, detail="Patient not found for export")
        else:
            export_content["patient"] = [p.dict() for p in _DB["patients"].values()]

    if data_type in ("imaging", "all", None):
        if patient_id:
            export_content["imaging"] = [
                img.dict() for img in _DB["imaging"].values() if img.patient_id == patient_id
            ]
        else:
            export_content["imaging"] = [img.dict() for img in _DB["imaging"].values()]

    if data_type in ("model3d", "all", None):
        if patient_id:
            export_content["models3d"] = [
                m.dict() for m in _DB["models3d"].values() if m.patient_id == patient_id
            ]
        else:
            export_content["models3d"] = [m.dict() for m in _DB["models3d"].values()]

    if data_type in ("analysis", "all", None):
        if patient_id:
            export_content["analysis"] = [
                a.dict() for a in _DB["analysis"].values() if a.patient_id == patient_id
            ]
        else:
            export_content["analysis"] = [a.dict() for a in _DB["analysis"].values()]

    log_action(current_user["username"], "export", f"data_type:{data_type} patient_id:{patient_id}")
    return export_content


# Initialize FastAPILimiter in the main FastAPI app before including this router:
# e.g.,
#   import redis.asyncio as redis
#   app = FastAPI()
#   r = redis.from_url("redis://localhost")
#   await FastAPILimiter.init(r)
```