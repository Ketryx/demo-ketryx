"""Blockage Detection Module for Coronary Arteries.

ML-based detection and quantification of coronary artery blockages.

Compliance: IEC 62304 Class C, FDA 510(k)
Software Item: KD-61 Blockage Detection Module
"""

import logging
import hashlib
from typing import Dict, List, Optional
from datetime import datetime
import numpy as np

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class BlockageDetectionModule:
    """ML-based blockage detection in coronary arteries.
    
    Uses convolutional neural networks to identify and quantify
    stenosis in coronary arteries from CT angiography images.
    
    Attributes:
        model: Trained detection model
        confidence_threshold: Minimum confidence for detection
        device_id: Unique identifier for audit trail
    """

    STENOSIS_SEVERITY = {
        "NONE": (0, 25),
        "MILD": (25, 50),
        "MODERATE": (50, 70),
        "SEVERE": (70, 99),
        "TOTAL_OCCLUSION": (99, 100)
    }

    def __init__(self, confidence_threshold: float = 0.80,
                 device_id: str = "BDM-001"):
        """Initialize Blockage Detection Module.
        
        Args:
            confidence_threshold: Minimum confidence for positive detection
            device_id: Device identifier for audit logging
            
        Raises:
            ValueError: If threshold is not between 0.0 and 1.0
        """
        if not 0.0 <= confidence_threshold <= 1.0:
            raise ValueError(f"Threshold must be 0.0-1.0, got {confidence_threshold}")
        
        self.confidence_threshold = confidence_threshold
        self.device_id = device_id
        self.model = None  # In production, load actual model
        
        logger.info(f"Blockage Detection Module initialized",
                   extra={
                       "device_id": device_id,
                       "confidence_threshold": confidence_threshold
                   })

    def detect_blockages(self, image_data: np.ndarray,
                        vessel_name: str,
                        patient_id: str) -> Dict[str, any]:
        """Detect blockages in coronary artery image.
        
        Args:
            image_data: CT angiography image array
            vessel_name: Name of vessel (LAD, LCX, RCA, etc.)
            patient_id: Patient identifier (hashed for privacy)
            
        Returns:
            Dictionary containing:
                - blockages_detected: Boolean
                - num_blockages: Number of blockages found
                - blockages: List of blockage details
                - vessel_name: Vessel analyzed
                - timestamp: Detection timestamp
        """
        patient_hash = hashlib.sha256(patient_id.encode()).hexdigest()[:16]
        image_hash = hashlib.sha256(image_data.tobytes()).hexdigest()[:16]
        
        logger.info(f"Starting blockage detection",
                   extra={
                       "device_id": self.device_id,
                       "patient_hash": patient_hash,
                       "vessel_name": vessel_name,
                       "event": "detection_start"
                   })
        
        try:
            # In production, run actual ML inference
            # Mock detection results for demonstration
            blockages = self._mock_detection(image_data)
            
            result = {
                "blockages_detected": len(blockages) > 0,
                "num_blockages": len(blockages),
                "blockages": blockages,
                "vessel_name": vessel_name,
                "image_hash": image_hash,
                "timestamp": datetime.utcnow().isoformat(),
                "device_id": self.device_id
            }
            
            logger.info(f"Blockage detection completed",
                       extra={
                           "device_id": self.device_id,
                           "patient_hash": patient_hash,
                           "vessel_name": vessel_name,
                           "num_blockages": len(blockages),
                           "event": "detection_complete"
                       })
            
            return result
            
        except Exception as e:
            logger.error(f"Blockage detection failed: {str(e)}",
                        extra={
                            "device_id": self.device_id,
                            "patient_hash": patient_hash,
                            "event": "detection_error"
                        })
            raise

    def _mock_detection(self, image_data: np.ndarray) -> List[Dict[str, any]]:
        """Mock blockage detection for demonstration.
        
        In production, this would be replaced with actual ML inference.
        """
        # Simulate detection of 1-2 blockages
        blockages = []
        
        # Mock blockage 1
        blockages.append({
            "location": "proximal",
            "stenosis_percentage": 65.0,
            "severity": self._classify_severity(65.0),
            "confidence": 0.88,
            "coordinates": {"x": 120, "y": 180, "z": 15},
            "length_mm": 8.5,
            "cross_sectional_area_reduction": 70.0
        })
        
        return blockages

    def _classify_severity(self, stenosis_percentage: float) -> str:
        """Classify stenosis severity based on percentage.
        
        Args:
            stenosis_percentage: Stenosis as percentage (0-100)
            
        Returns:
            Severity classification string
        """
        for severity, (min_val, max_val) in self.STENOSIS_SEVERITY.items():
            if min_val <= stenosis_percentage < max_val:
                return severity
        return "UNKNOWN"

    def analyze_vessel(self, images: List[np.ndarray],
                      vessel_name: str,
                      patient_id: str) -> Dict[str, any]:
        """Analyze entire vessel across multiple image slices.
        
        Args:
            images: List of CT image slices
            vessel_name: Vessel identifier
            patient_id: Patient identifier
            
        Returns:
            Comprehensive vessel analysis with all detected blockages
        """
        patient_hash = hashlib.sha256(patient_id.encode()).hexdigest()[:16]
        
        logger.info(f"Starting vessel analysis",
                   extra={
                       "device_id": self.device_id,
                       "patient_hash": patient_hash,
                       "vessel_name": vessel_name,
                       "num_slices": len(images)
                   })
        
        all_blockages = []
        
        for idx, image in enumerate(images):
            result = self.detect_blockages(image, vessel_name, patient_id)
            for blockage in result["blockages"]:
                blockage["slice_index"] = idx
                all_blockages.append(blockage)
        
        # Calculate aggregate metrics
        max_stenosis = max([b["stenosis_percentage"] for b in all_blockages]) if all_blockages else 0
        
        analysis = {
            "vessel_name": vessel_name,
            "total_blockages": len(all_blockages),
            "max_stenosis_percentage": max_stenosis,
            "max_stenosis_severity": self._classify_severity(max_stenosis),
            "blockages": all_blockages,
            "num_slices_analyzed": len(images),
            "timestamp": datetime.utcnow().isoformat(),
            "device_id": self.device_id
        }
        
        logger.info(f"Vessel analysis completed",
                   extra={
                       "device_id": self.device_id,
                       "patient_hash": patient_hash,
                       "vessel_name": vessel_name,
                       "total_blockages": len(all_blockages)
                   })
        
        return analysis

    def generate_report(self, vessel_analyses: List[Dict[str, any]]) -> Dict[str, any]:
        """Generate comprehensive blockage detection report.
        
        Args:
            vessel_analyses: List of vessel analysis results
            
        Returns:
            Comprehensive report with summary and recommendations
        """
        total_blockages = sum(v["total_blockages"] for v in vessel_analyses)
        max_stenosis = max([v["max_stenosis_percentage"] for v in vessel_analyses])
        
        # Generate clinical recommendations
        if max_stenosis >= 70:
            recommendations = [
                "Immediate cardiology consultation recommended",
                "Consider coronary angiography",
                "Revascularization may be indicated"
            ]
            urgency = "HIGH"
        elif max_stenosis >= 50:
            recommendations = [
                "Cardiology follow-up recommended",
                "Consider stress testing",
                "Optimize medical therapy"
            ]
            urgency = "MODERATE"
        else:
            recommendations = [
                "Routine cardiology follow-up",
                "Continue risk factor modification"
            ]
            urgency = "LOW"
        
        report = {
            "summary": {
                "total_blockages_detected": total_blockages,
                "vessels_analyzed": len(vessel_analyses),
                "max_stenosis_percentage": max_stenosis,
                "max_stenosis_severity": self._classify_severity(max_stenosis),
                "urgency": urgency
            },
            "vessel_analyses": vessel_analyses,
            "recommendations": recommendations,
            "timestamp": datetime.utcnow().isoformat(),
            "device_id": self.device_id
        }
        
        return report
