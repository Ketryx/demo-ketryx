"""Unit tests for Blockage Detection Module.

Compliance: IEC 62304 - Software Unit Verification
"""

import pytest
import numpy as np
from .module import BlockageDetectionModule


class TestBlockageDetectionModule:
    """Test suite for BlockageDetectionModule."""

    def test_initialization_valid(self):
        """Test module initialization with valid parameters."""
        module = BlockageDetectionModule(confidence_threshold=0.80)
        assert module.confidence_threshold == 0.80
        assert module.device_id == "BDM-001"

    def test_initialization_invalid_threshold(self):
        """Test module initialization with invalid threshold."""
        with pytest.raises(ValueError, match="Threshold must be 0.0-1.0"):
            BlockageDetectionModule(confidence_threshold=1.5)

    def test_detect_blockages(self):
        """Test blockage detection on single image."""
        module = BlockageDetectionModule()
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        
        result = module.detect_blockages(
            image,
            vessel_name="LAD",
            patient_id="TEST_001"
        )
        
        # Verify result structure
        assert "blockages_detected" in result
        assert "num_blockages" in result
        assert "blockages" in result
        assert "vessel_name" in result
        assert "timestamp" in result
        assert "device_id" in result
        
        assert result["vessel_name"] == "LAD"
        assert isinstance(result["blockages"], list)

    def test_classify_severity(self):
        """Test stenosis severity classification."""
        module = BlockageDetectionModule()
        
        assert module._classify_severity(15.0) == "NONE"
        assert module._classify_severity(35.0) == "MILD"
        assert module._classify_severity(60.0) == "MODERATE"
        assert module._classify_severity(80.0) == "SEVERE"
        assert module._classify_severity(99.5) == "TOTAL_OCCLUSION"

    def test_analyze_vessel(self):
        """Test complete vessel analysis across multiple slices."""
        module = BlockageDetectionModule()
        images = [np.random.randint(0, 255, (512, 512), dtype=np.uint8) for _ in range(10)]
        
        analysis = module.analyze_vessel(
            images,
            vessel_name="RCA",
            patient_id="TEST_002"
        )
        
        # Verify analysis structure
        assert "vessel_name" in analysis
        assert "total_blockages" in analysis
        assert "max_stenosis_percentage" in analysis
        assert "max_stenosis_severity" in analysis
        assert "blockages" in analysis
        assert "num_slices_analyzed" in analysis
        
        assert analysis["vessel_name"] == "RCA"
        assert analysis["num_slices_analyzed"] == 10
        assert isinstance(analysis["blockages"], list)

    def test_generate_report(self):
        """Test comprehensive report generation."""
        module = BlockageDetectionModule()
        
        # Create mock vessel analyses
        vessel_analyses = [
            {
                "vessel_name": "LAD",
                "total_blockages": 2,
                "max_stenosis_percentage": 75.0,
                "blockages": []
            },
            {
                "vessel_name": "RCA",
                "total_blockages": 1,
                "max_stenosis_percentage": 45.0,
                "blockages": []
            }
        ]
        
        report = module.generate_report(vessel_analyses)
        
        # Verify report structure
        assert "summary" in report
        assert "vessel_analyses" in report
        assert "recommendations" in report
        assert "timestamp" in report
        
        summary = report["summary"]
        assert summary["total_blockages_detected"] == 3
        assert summary["vessels_analyzed"] == 2
        assert summary["max_stenosis_percentage"] == 75.0
        assert summary["urgency"] in ["LOW", "MODERATE", "HIGH"]

    def test_report_urgency_classification(self):
        """Test that report urgency is correctly classified."""
        module = BlockageDetectionModule()
        
        # Severe stenosis - HIGH urgency
        severe_analysis = [{
            "vessel_name": "LAD",
            "total_blockages": 1,
            "max_stenosis_percentage": 85.0,
            "blockages": []
        }]
        severe_report = module.generate_report(severe_analysis)
        assert severe_report["summary"]["urgency"] == "HIGH"
        
        # Moderate stenosis - MODERATE urgency
        moderate_analysis = [{
            "vessel_name": "RCA",
            "total_blockages": 1,
            "max_stenosis_percentage": 55.0,
            "blockages": []
        }]
        moderate_report = module.generate_report(moderate_analysis)
        assert moderate_report["summary"]["urgency"] == "MODERATE"
        
        # Mild stenosis - LOW urgency
        mild_analysis = [{
            "vessel_name": "LCX",
            "total_blockages": 1,
            "max_stenosis_percentage": 30.0,
            "blockages": []
        }]
        mild_report = module.generate_report(mild_analysis)
        assert mild_report["summary"]["urgency"] == "LOW"

    def test_patient_id_privacy(self):
        """Test that patient IDs are not exposed in results."""
        module = BlockageDetectionModule()
        image = np.random.randint(0, 255, (512, 512), dtype=np.uint8)
        
        result = module.detect_blockages(
            image,
            vessel_name="LAD",
            patient_id="SENSITIVE_PATIENT_ID_123"
        )
        
        result_str = str(result)
        assert "SENSITIVE_PATIENT_ID_123" not in result_str

    def test_stenosis_severity_constants(self):
        """Test that stenosis severity constants are properly defined."""
        assert "NONE" in BlockageDetectionModule.STENOSIS_SEVERITY
        assert "MILD" in BlockageDetectionModule.STENOSIS_SEVERITY
        assert "MODERATE" in BlockageDetectionModule.STENOSIS_SEVERITY
        assert "SEVERE" in BlockageDetectionModule.STENOSIS_SEVERITY
        assert "TOTAL_OCCLUSION" in BlockageDetectionModule.STENOSIS_SEVERITY
