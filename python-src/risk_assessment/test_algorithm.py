"""Unit tests for Risk Assessment Algorithm.

Compliance: IEC 62304 - Software Unit Verification
"""

import pytest
from .algorithm import RiskAssessmentAlgorithm, RiskLevel


class TestRiskAssessmentAlgorithm:
    """Test suite for RiskAssessmentAlgorithm."""

    def test_initialization(self):
        """Test algorithm initialization."""
        algorithm = RiskAssessmentAlgorithm()
        assert algorithm.device_id == "RAA-001"

    def test_framingham_score_valid_male(self):
        """Test Framingham score calculation for male patient."""
        algorithm = RiskAssessmentAlgorithm()
        score = algorithm.calculate_framingham_score(
            age=55,
            sex='M',
            total_cholesterol=220,
            hdl_cholesterol=45,
            systolic_bp=140,
            is_smoker=True,
            has_diabetes=False
        )
        assert isinstance(score, float)
        assert 0 <= score <= 100

    def test_framingham_score_valid_female(self):
        """Test Framingham score calculation for female patient."""
        algorithm = RiskAssessmentAlgorithm()
        score = algorithm.calculate_framingham_score(
            age=60,
            sex='F',
            total_cholesterol=200,
            hdl_cholesterol=55,
            systolic_bp=130,
            is_smoker=False,
            has_diabetes=True
        )
        assert isinstance(score, float)
        assert 0 <= score <= 100

    def test_framingham_score_invalid_age(self):
        """Test Framingham score with invalid age."""
        algorithm = RiskAssessmentAlgorithm()
        with pytest.raises(ValueError, match="Age must be 30-74"):
            algorithm.calculate_framingham_score(
                age=25,
                sex='M',
                total_cholesterol=200,
                hdl_cholesterol=50,
                systolic_bp=120,
                is_smoker=False,
                has_diabetes=False
            )

    def test_framingham_score_invalid_sex(self):
        """Test Framingham score with invalid sex."""
        algorithm = RiskAssessmentAlgorithm()
        with pytest.raises(ValueError, match="Sex must be"):
            algorithm.calculate_framingham_score(
                age=55,
                sex='X',
                total_cholesterol=200,
                hdl_cholesterol=50,
                systolic_bp=120,
                is_smoker=False,
                has_diabetes=False
            )

    def test_imaging_risk_high_calcium(self):
        """Test imaging risk with high calcium score."""
        algorithm = RiskAssessmentAlgorithm()
        risk = algorithm.assess_imaging_risk(
            calcification_score=500,
            stenosis_severity=None,
            num_vessels_affected=None
        )
        assert risk > 0

    def test_imaging_risk_severe_stenosis(self):
        """Test imaging risk with severe stenosis."""
        algorithm = RiskAssessmentAlgorithm()
        risk = algorithm.assess_imaging_risk(
            calcification_score=None,
            stenosis_severity=80,
            num_vessels_affected=None
        )
        assert risk > 0

    def test_imaging_risk_multivessel_disease(self):
        """Test imaging risk with multi-vessel disease."""
        algorithm = RiskAssessmentAlgorithm()
        risk = algorithm.assess_imaging_risk(
            calcification_score=200,
            stenosis_severity=60,
            num_vessels_affected=3
        )
        assert risk > 0
        assert risk <= 100

    def test_composite_risk_clinical_only(self):
        """Test composite risk with clinical data only."""
        algorithm = RiskAssessmentAlgorithm()
        clinical_data = {
            "age": 55,
            "sex": "M",
            "total_cholesterol": 220,
            "hdl_cholesterol": 45,
            "systolic_bp": 140,
            "is_smoker": True,
            "has_diabetes": False
        }
        
        result = algorithm.calculate_composite_risk(clinical_data, patient_id="TEST_001")
        
        assert "framingham_risk" in result
        assert "imaging_risk" in result
        assert "composite_risk" in result
        assert "risk_level" in result
        assert "recommendations" in result
        assert result["imaging_risk"] == 0.0

    def test_composite_risk_with_imaging(self):
        """Test composite risk with both clinical and imaging data."""
        algorithm = RiskAssessmentAlgorithm()
        clinical_data = {
            "age": 65,
            "sex": "M",
            "total_cholesterol": 250,
            "hdl_cholesterol": 40,
            "systolic_bp": 160,
            "is_smoker": True,
            "has_diabetes": True
        }
        imaging_data = {
            "calcification_score": 500,
            "stenosis_severity": 75,
            "num_vessels_affected": 2
        }
        
        result = algorithm.calculate_composite_risk(
            clinical_data, 
            imaging_data=imaging_data,
            patient_id="TEST_002"
        )
        
        assert result["imaging_risk"] > 0
        assert result["composite_risk"] > result["framingham_risk"] * 0.5

    def test_risk_level_classification(self):
        """Test risk level classification boundaries."""
        algorithm = RiskAssessmentAlgorithm()
        
        # Low risk
        clinical_low = {
            "age": 35,
            "sex": "F",
            "total_cholesterol": 180,
            "hdl_cholesterol": 65,
            "systolic_bp": 110,
            "is_smoker": False,
            "has_diabetes": False
        }
        result_low = algorithm.calculate_composite_risk(clinical_low, patient_id="TEST_LOW")
        assert result_low["risk_level"] in [RiskLevel.LOW.value, RiskLevel.MODERATE.value]
        
        # High risk
        clinical_high = {
            "age": 70,
            "sex": "M",
            "total_cholesterol": 300,
            "hdl_cholesterol": 30,
            "systolic_bp": 170,
            "is_smoker": True,
            "has_diabetes": True
        }
        result_high = algorithm.calculate_composite_risk(clinical_high, patient_id="TEST_HIGH")
        assert result_high["risk_level"] in [RiskLevel.HIGH.value, RiskLevel.CRITICAL.value]

    def test_recommendations_provided(self):
        """Test that recommendations are provided for all risk levels."""
        algorithm = RiskAssessmentAlgorithm()
        clinical_data = {
            "age": 55,
            "sex": "M",
            "total_cholesterol": 220,
            "hdl_cholesterol": 45,
            "systolic_bp": 140,
            "is_smoker": False,
            "has_diabetes": False
        }
        
        result = algorithm.calculate_composite_risk(clinical_data, patient_id="TEST_003")
        
        assert isinstance(result["recommendations"], list)
        assert len(result["recommendations"]) > 0

    def test_patient_id_privacy(self):
        """Test that patient IDs are properly hashed for privacy."""
        algorithm = RiskAssessmentAlgorithm()
        clinical_data = {
            "age": 55,
            "sex": "M",
            "total_cholesterol": 220,
            "hdl_cholesterol": 45,
            "systolic_bp": 140
        }
        
        result = algorithm.calculate_composite_risk(
            clinical_data, 
            patient_id="SENSITIVE_PATIENT_ID"
        )
        
        result_str = str(result)
        assert "SENSITIVE_PATIENT_ID" not in result_str
        assert "patient_hash" in result
