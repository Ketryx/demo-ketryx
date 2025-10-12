```python
import pytest
import time
import numpy as np
from risk.risk_assessment_algorithm import RiskAssessmentAlgorithm
from risk.blockage_detection import BlockageDetectionOutput

# Sample clinical test datasets for testing
clinical_cases = [
    {
        "input": {"age": 65, "cholesterol": 210, "blood_pressure": 135, "smoking": True, "diabetes": False},
        "expected_risk": 0.78,
        "risk_category": "High"
    },
    {
        "input": {"age": 45, "cholesterol": 180, "blood_pressure": 120, "smoking": False, "diabetes": False},
        "expected_risk": 0.22,
        "risk_category": "Low"
    },
    {
        "input": {"age": 55, "cholesterol": 240, "blood_pressure": 150, "smoking": True, "diabetes": True},
        "expected_risk": 0.90,
        "risk_category": "Very High"
    },
    {
        "input": {"age": 30, "cholesterol": 170, "blood_pressure": 110, "smoking": False, "diabetes": False},
        "expected_risk": 0.05,
        "risk_category": "Very Low"
    }
]

edge_cases = [
    # Missing data case
    ({"age": None, "cholesterol": 200, "blood_pressure": 130, "smoking": True, "diabetes": False}, False),
    ({"age": 50, "cholesterol": None, "blood_pressure": 130, "smoking": False, "diabetes": False}, False),
    # Extreme values
    ({"age": 120, "cholesterol": 1000, "blood_pressure": 300, "smoking": True, "diabetes": True}, True),
    ({"age": -5, "cholesterol": 150, "blood_pressure": 80, "smoking": False, "diabetes": False}, False),
]

@pytest.fixture
def risk_algo():
    return RiskAssessmentAlgorithm()

def test_risk_calculation_accuracy(risk_algo):
    for case in clinical_cases:
        risk = risk_algo.calculate_risk(case["input"])
        assert pytest.approx(risk, 0.05) == case["expected_risk"]

def test_consistency_of_results(risk_algo):
    test_input = clinical_cases[0]["input"]
    result1 = risk_algo.calculate_risk(test_input)
    result2 = risk_algo.calculate_risk(test_input)
    result3 = risk_algo.calculate_risk(test_input)
    assert result1 == result2 == result3

@pytest.mark.parametrize("input_data,should_succeed", edge_cases)
def test_edge_case_handling(risk_algo, input_data, should_succeed):
    if should_succeed:
        risk = risk_algo.calculate_risk(input_data)
        assert 0.0 <= risk <= 1.0
    else:
        with pytest.raises((ValueError, TypeError)):
            risk_algo.calculate_risk(input_data)

def test_performance_real_time_requirement(risk_algo):
    # Real time requirement: must complete within 100 milliseconds per calculation
    test_input = clinical_cases[0]["input"]
    start_time = time.perf_counter()
    for _ in range(100):
        risk_algo.calculate_risk(test_input)
    elapsed_ms = (time.perf_counter() - start_time) * 1000 / 100
    assert elapsed_ms <= 100, f"Average calculation took {elapsed_ms:.2f}ms, exceeds real-time requirement"

def test_integration_with_blockage_detection(risk_algo):
    # Fake blockage detection output affecting risk calculation
    base_input = clinical_cases[1]["input"]
    output_clean = BlockageDetectionOutput(blockages_detected=False, blockage_score=0.0)
    output_blocked = BlockageDetectionOutput(blockages_detected=True, blockage_score=0.85)

    risk_clean = risk_algo.calculate_risk(base_input, blockage_output=output_clean)
    risk_blocked = risk_algo.calculate_risk(base_input, blockage_output=output_blocked)

    # Risk should be higher when blockage detected
    assert risk_blocked > risk_clean
    assert 0.0 <= risk_clean <= 1.0
    assert 0.0 <= risk_blocked <= 1.0

def test_risk_stratification_correctness(risk_algo):
    for case in clinical_cases:
        risk = risk_algo.calculate_risk(case["input"])
        category = risk_algo.stratify_risk(risk)
        assert category == case["risk_category"]

def test_predictive_model_reliability(risk_algo):
    # Model should provide risk predictions in [0,1] range and deterministic output
    test_input = clinical_cases[2]["input"]
    risk = risk_algo.calculate_risk(test_input)
    assert isinstance(risk, float)
    assert 0.0 <= risk <= 1.0

    # Deterministic: same input yields same output
    risk_second = risk_algo.calculate_risk(test_input)
    assert risk == risk_second

def test_risk_mitigation_for_delayed_analysis_and_downtime(risk_algo):
    # Simulate delayed analysis by caching previous result
    test_input = clinical_cases[0]["input"]

    # First call: fresh calculation
    risk_fresh = risk_algo.calculate_risk(test_input)

    # Simulate application downtime by forcibly using a cached value on next call
    risk_algo.cache_risk(test_input, risk_fresh)
    risk_cached = risk_algo.get_cached_risk(test_input)

    assert risk_cached == risk_fresh

    # The algorithm's fallback for delayed analysis should not raise errors and return a valid risk
    risk_fallback = risk_algo.calculate_risk_with_fallback(test_input)
    assert 0.0 <= risk_fallback <= 1.0

    # If no cached risk available fallback should handle gracefully
    unknown_input = {"age": 40, "cholesterol": 190, "blood_pressure": 128, "smoking": False, "diabetes": False}
    risk_fallback_unknown = risk_algo.calculate_risk_with_fallback(unknown_input)
    assert 0.0 <= risk_fallback_unknown <= 1.0
```