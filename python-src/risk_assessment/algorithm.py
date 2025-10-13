"""Risk Assessment Algorithm for Coronary Events.

Calculates cardiac risk scores based on clinical parameters and imaging findings.

Compliance: IEC 62304 Class C, FDA 21 CFR Part 820
Software Item: KD-95 Risk Assessment Algorithm
"""

import logging
import hashlib
from typing import Dict, Optional
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class RiskLevel(Enum):"""Risk level classification."""
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class RiskAssessmentAlgorithm:
    """Calculates cardiac risk assessment based on clinical data.
    
    Implements modified Framingham risk score with imaging findings
    integration for comprehensive coronary event risk prediction.
    
    Attributes:
        device_id: Unique identifier for audit trail
    """

    def __init__(self, device_id: str = "RAA-001"):
        """Initialize Risk Assessment Algorithm.
        
        Args:
            device_id: Device identifier for audit logging
        """
        self.device_id = device_id
        logger.info(f"Risk Assessment Algorithm initialized",
                   extra={"device_id": device_id})

    def calculate_framingham_score(self, age: int, sex: str,
                                   total_cholesterol: float,
                                   hdl_cholesterol: float,
                                   systolic_bp: float,
                                   is_smoker: bool,
                                   has_diabetes: bool) -> float:
        """Calculate Framingham risk score.
        
        Args:
            age: Patient age in years (30-74)
            sex: 'M' or 'F'
            total_cholesterol: mg/dL
            hdl_cholesterol: mg/dL
            systolic_bp: mmHg
            is_smoker: Smoking status
            has_diabetes: Diabetes status
            
        Returns:
            10-year CVD risk as percentage (0-100)
            
        Raises:
            ValueError: If parameters are out of valid range
        """
        if not 30 <= age <= 74:
            raise ValueError(f"Age must be 30-74, got {age}")
        
        if sex not in ['M', 'F']:
            raise ValueError(f"Sex must be 'M' or 'F', got {sex}")
        
        # Simplified Framingham calculation (production would use full algorithm)
        points = 0
        
        # Age points
        if age >= 70:
            points += 12 if sex == 'M' else 14
        elif age >= 60:
            points += 9 if sex == 'M' else 11
        elif age >= 50:
            points += 6 if sex == 'M' else 8
        else:
            points += 3 if sex == 'M' else 4
        
        # Cholesterol points
        if total_cholesterol >= 280:
            points += 4
        elif total_cholesterol >= 240:
            points += 3
        elif total_cholesterol >= 200:
            points += 2
        
        # HDL points (protective)
        if hdl_cholesterol >= 60:
            points -= 1
        elif hdl_cholesterol < 35:
            points += 2
        
        # Blood pressure points
        if systolic_bp >= 160:
            points += 3
        elif systolic_bp >= 140:
            points += 2
        elif systolic_bp >= 130:
            points += 1
        
        # Risk factors
        if is_smoker:
            points += 2
        if has_diabetes:
            points += 2
        
        # Convert points to risk percentage (simplified)
        risk_percentage = min(max(points * 3.5, 1.0), 95.0)
        
        return risk_percentage

    def assess_imaging_risk(self, calcification_score: Optional[float] = None,
                           stenosis_severity: Optional[float] = None,
                           num_vessels_affected: Optional[int] = None) -> float:
        """Assess risk based on imaging findings.
        
        Args:
            calcification_score: Agatston calcium score (0-3000+)
            stenosis_severity: Max stenosis percentage (0-100)
            num_vessels_affected: Number of major vessels with disease (0-3)
            
        Returns:
            Imaging risk score (0-100)
        """
        imaging_risk = 0.0
        
        # Calcium score contribution
        if calcification_score is not None:
            if calcification_score >= 400:
                imaging_risk += 30
            elif calcification_score >= 100:
                imaging_risk += 20
            elif calcification_score >= 10:
                imaging_risk += 10
        
        # Stenosis contribution
        if stenosis_severity is not None:
            if stenosis_severity >= 70:
                imaging_risk += 35
            elif stenosis_severity >= 50:
                imaging_risk += 25
            elif stenosis_severity >= 25:
                imaging_risk += 15
        
        # Multi-vessel disease
        if num_vessels_affected is not None:
            imaging_risk += num_vessels_affected * 10
        
        return min(imaging_risk, 100.0)

    def calculate_composite_risk(self, clinical_data: Dict[str, any],
                                imaging_data: Optional[Dict[str, any]] = None,
                                patient_id: str = "") -> Dict[str, any]:
        """Calculate comprehensive risk assessment.
        
        Args:
            clinical_data: Dictionary with clinical parameters
            imaging_data: Optional dictionary with imaging findings
            patient_id: Patient identifier (hashed for privacy)
            
        Returns:
            Comprehensive risk assessment including:
                - framingham_risk: Clinical risk score
                - imaging_risk: Imaging-based risk score
                - composite_risk: Combined risk score
                - risk_level: Classification (LOW/MODERATE/HIGH/CRITICAL)
                - recommendations: Clinical recommendations
        """
        patient_hash = hashlib.sha256(patient_id.encode()).hexdigest()[:16]
        
        logger.info(f"Calculating risk assessment",
                   extra={
                       "device_id": self.device_id,
                       "patient_hash": patient_hash,
                       "event": "risk_calculation_start"
                   })
        
        try:
            # Calculate Framingham risk
            framingham_risk = self.calculate_framingham_score(
                age=clinical_data["age"],
                sex=clinical_data["sex"],
                total_cholesterol=clinical_data["total_cholesterol"],
                hdl_cholesterol=clinical_data["hdl_cholesterol"],
                systolic_bp=clinical_data["systolic_bp"],
                is_smoker=clinical_data.get("is_smoker", False),
                has_diabetes=clinical_data.get("has_diabetes", False)
            )
            
            # Calculate imaging risk if available
            imaging_risk = 0.0
            if imaging_data:
                imaging_risk = self.assess_imaging_risk(
                    calcification_score=imaging_data.get("calcification_score"),
                    stenosis_severity=imaging_data.get("stenosis_severity"),
                    num_vessels_affected=imaging_data.get("num_vessels_affected")
                )
            
            # Composite risk (weighted average)
            if imaging_data:
                composite_risk = (framingham_risk * 0.6 + imaging_risk * 0.4)
            else:
                composite_risk = framingham_risk
            
            # Classify risk level
            if composite_risk >= 30:
                risk_level = RiskLevel.CRITICAL
                recommendations = [
                    "Immediate cardiology consultation required",
                    "Consider urgent coronary angiography",
                    "Aggressive risk factor modification"
                ]
            elif composite_risk >= 20:
                risk_level = RiskLevel.HIGH
                recommendations = [
                    "Cardiology consultation within 1 week",
                    "Stress test or advanced imaging recommended",
                    "Intensive statin therapy"
                ]
            elif composite_risk >= 10:
                risk_level = RiskLevel.MODERATE
                recommendations = [
                    "Follow-up within 1 month",
                    "Consider stress test",
                    "Lifestyle modifications and statin therapy"
                ]
            else:
                risk_level = RiskLevel.LOW
                recommendations = [
                    "Routine follow-up in 6-12 months",
                    "Continue lifestyle modifications",
                    "Monitor risk factors"
                ]
            
            result = {
                "framingham_risk": round(framingham_risk, 2),
                "imaging_risk": round(imaging_risk, 2),
                "composite_risk": round(composite_risk, 2),
                "risk_level": risk_level.value,
                "recommendations": recommendations,
                "timestamp": datetime.utcnow().isoformat(),
                "device_id": self.device_id,
                "patient_hash": patient_hash
            }
            
            logger.info(f"Risk assessment completed",
                       extra={
                           "device_id": self.device_id,
                           "patient_hash": patient_hash,
                           "risk_level": risk_level.value,
                           "composite_risk": composite_risk,
                           "event": "risk_calculation_complete"
                       })
            
            return result
            
        except Exception as e:
            logger.error(f"Risk assessment failed: {str(e)}",
                        extra={
                            "device_id": self.device_id,
                            "patient_hash": patient_hash,
                            "event": "risk_calculation_error"
                        })
            raise
