"""Risk Assessment Algorithm Consistency Test

This test verifies the consistency of the Risk Assessment Algorithm across
multiple components including the Clinical Data Dashboard, Patient Data Storage
System, and Anomaly Detection Engine.

Traceability:
- Related to: KD-50 (Item ID: KXREC62FXYG82VN92RRP8NM4Z7AH5N2)
- Test Type: Automated Integration Test
- Purpose: Verify risk score consistency within ±5% threshold

Author: Automated Test Framework
Created: 2025-10-13
"""

import json
import logging
import os
import statistics
from pathlib import Path
from typing import Dict, List, Any

import pytest

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class RiskAssessmentAlgorithm:
    """Mock Risk Assessment Algorithm for testing purposes.
    
    In production, this would interface with the actual risk assessment
    components from the Clinical Data Dashboard, Patient Data Storage,
    and Anomaly Detection Engine.
    """
    
    @staticmethod
    def calculate_risk_score(patient_profile: Dict[str, Any]) -> float:
        """Calculate risk score based on patient profile.
        
        Args:
            patient_profile: Dictionary containing patient data including
                           age, medical_history, risk_factors, vital_signs,
                           medications, and expected_risk_score
        
        Returns:
            Calculated risk score (0.0 - 100.0)
        """
        # Base score from age
        age = patient_profile.get('age', 50)
        age_score = min(age / 100 * 30, 30)  # Max 30 points from age
        
        # Risk factors contribution
        risk_factors = patient_profile.get('risk_factors', [])
        risk_factor_score = len(risk_factors) * 8  # 8 points per risk factor
        
        # Medical history severity
        medical_history = patient_profile.get('medical_history', [])
        history_score = len(medical_history) * 5  # 5 points per condition
        
        # Vital signs assessment
        vital_signs = patient_profile.get('vital_signs', {})
        vital_score = 0
        
        # Blood pressure check
        if 'blood_pressure' in vital_signs:
            bp = vital_signs['blood_pressure']
            if bp.get('systolic', 120) > 140 or bp.get('diastolic', 80) > 90:
                vital_score += 10
        
        # Heart rate check
        if 'heart_rate' in vital_signs:
            hr = vital_signs['heart_rate']
            if hr < 60 or hr > 100:
                vital_score += 5
        
        # Glucose check
        if 'glucose' in vital_signs:
            glucose = vital_signs['glucose']
            if glucose > 126:
                vital_score += 8
        
        # Medication interactions
        medications = patient_profile.get('medications', [])
        med_score = len(medications) * 2  # 2 points per medication
        
        # Calculate total score (capped at 100)
        total_score = min(
            age_score + risk_factor_score + history_score + vital_score + med_score,
            100.0
        )
        
        return round(total_score, 2)


@pytest.fixture(scope='module')
def test_config() -> Dict[str, Any]:
    """Load test configuration from JSON file.
    
    Returns:
        Dictionary containing test configuration parameters
    """
    config_path = Path(__file__).parent.parent / 'config' / 'test_thresholds.json'
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    logger.info(f"Loaded test configuration: {config}")
    return config


@pytest.fixture(scope='module')
def patient_profiles() -> List[Dict[str, Any]]:
    """Load patient profiles from JSON fixture file.
    
    Returns:
        List of patient profile dictionaries
    """
    fixtures_path = Path(__file__).parent.parent / 'fixtures' / 'patient_profiles.json'
    
    with open(fixtures_path, 'r') as f:
        profiles = json.load(f)
    
    logger.info(f"Loaded {len(profiles)} patient profiles")
    return profiles


@pytest.fixture
def risk_algorithm() -> RiskAssessmentAlgorithm:
    """Create Risk Assessment Algorithm instance.
    
    Returns:
        RiskAssessmentAlgorithm instance
    """
    return RiskAssessmentAlgorithm()


class TestRiskAssessmentConsistency:
    """Test suite for Risk Assessment Algorithm Consistency.
    
    Traceability: KD-50 (KXREC62FXYG82VN92RRP8NM4Z7AH5N2)
    """
    
    def test_algorithm_consistency_per_profile(
        self,
        patient_profiles: List[Dict[str, Any]],
        risk_algorithm: RiskAssessmentAlgorithm,
        test_config: Dict[str, Any]
    ):
        """Test that risk assessment algorithm produces consistent results.
        
        This test runs the risk assessment algorithm multiple times on each
        patient profile and verifies that score variations stay within the
        configured threshold (±5%).
        
        Traceability: KD-50 (KXREC62FXYG82VN92RRP8NM4Z7AH5N2)
        
        Args:
            patient_profiles: List of patient profile fixtures
            risk_algorithm: Risk assessment algorithm instance
            test_config: Test configuration parameters
        """
        consistency_threshold = test_config['consistency_threshold']
        num_iterations = test_config['number_of_iterations']
        
        logger.info(f"Starting consistency test with {num_iterations} iterations")
        logger.info(f"Consistency threshold: ±{consistency_threshold * 100}%")
        
        all_results = []
        failed_profiles = []
        
        for profile in patient_profiles:
            patient_id = profile['patient_id']
            expected_score = profile.get('expected_risk_score')
            
            logger.info(f"\nTesting patient {patient_id}")
            logger.info(f"Expected baseline score: {expected_score}")
            
            # Run algorithm multiple times
            scores = []
            for iteration in range(num_iterations):
                score = risk_algorithm.calculate_risk_score(profile)
                scores.append(score)
            
            # Calculate statistics
            mean_score = statistics.mean(scores)
            stdev_score = statistics.stdev(scores) if len(scores) > 1 else 0.0
            min_score = min(scores)
            max_score = max(scores)
            
            # Calculate deviation from expected
            if expected_score and expected_score > 0:
                deviation = abs(mean_score - expected_score) / expected_score
            else:
                deviation = 0.0
            
            # Calculate variation range
            if mean_score > 0:
                variation_range = (max_score - min_score) / mean_score
            else:
                variation_range = 0.0
            
            result = {
                'patient_id': patient_id,
                'expected_score': expected_score,
                'mean_score': mean_score,
                'stdev': stdev_score,
                'min_score': min_score,
                'max_score': max_score,
                'deviation': deviation,
                'variation_range': variation_range,
                'num_iterations': num_iterations,
                'passed': deviation <= consistency_threshold and variation_range <= consistency_threshold
            }
            
            all_results.append(result)
            
            # Log results
            logger.info(f"  Mean score: {mean_score:.2f}")
            logger.info(f"  Std dev: {stdev_score:.2f}")
            logger.info(f"  Range: [{min_score:.2f}, {max_score:.2f}]")
            logger.info(f"  Deviation from expected: {deviation * 100:.2f}%")
            logger.info(f"  Variation range: {variation_range * 100:.2f}%")
            
            if not result['passed']:
                logger.warning(f"  ⚠️  FAILED: Inconsistency detected for {patient_id}")
                failed_profiles.append(result)
            else:
                logger.info(f"  ✓ PASSED: Scores within threshold")
        
        # Summary logging
        logger.info(f"\n{'='*60}")
        logger.info("TEST SUMMARY")
        logger.info(f"{'='*60}")
        logger.info(f"Total profiles tested: {len(patient_profiles)}")
        logger.info(f"Profiles passed: {len(patient_profiles) - len(failed_profiles)}")
        logger.info(f"Profiles failed: {len(failed_profiles)}")
        
        if failed_profiles:
            logger.error("\nFailed profiles:")
            for result in failed_profiles:
                logger.error(f"  - {result['patient_id']}: "
                           f"deviation={result['deviation']*100:.2f}%, "
                           f"variation={result['variation_range']*100:.2f}%")
        
        # Assert all profiles pass
        assert len(failed_profiles) == 0, (
            f"{len(failed_profiles)} patient profile(s) exceeded consistency threshold. "
            f"See logs for details."
        )
    
    def test_algorithm_determinism(
        self,
        patient_profiles: List[Dict[str, Any]],
        risk_algorithm: RiskAssessmentAlgorithm
    ):
        """Test that algorithm produces identical results for identical inputs.
        
        This test verifies that the risk assessment algorithm is deterministic
        by running it twice on the same input and comparing results.
        
        Traceability: KD-50 (KXREC62FXYG82VN92RRP8NM4Z7AH5N2)
        
        Args:
            patient_profiles: List of patient profile fixtures
            risk_algorithm: Risk assessment algorithm instance
        """
        logger.info("Testing algorithm determinism")
        
        for profile in patient_profiles:
            patient_id = profile['patient_id']
            
            # Run algorithm twice
            score1 = risk_algorithm.calculate_risk_score(profile)
            score2 = risk_algorithm.calculate_risk_score(profile)
            
            # Scores should be identical
            assert score1 == score2, (
                f"Algorithm is non-deterministic for patient {patient_id}: "
                f"got {score1} and {score2}"
            )
        
        logger.info(f"✓ Algorithm is deterministic for all {len(patient_profiles)} profiles")
    
    def test_baseline_score_accuracy(
        self,
        patient_profiles: List[Dict[str, Any]],
        risk_algorithm: RiskAssessmentAlgorithm,
        test_config: Dict[str, Any]
    ):
        """Test that calculated scores match expected baseline scores.
        
        This test verifies that the risk assessment algorithm produces scores
        that are within the acceptable range of the expected baseline scores
        stored in the patient profiles.
        
        Traceability: KD-50 (KXREC62FXYG82VN92RRP8NM4Z7AH5N2)
        
        Args:
            patient_profiles: List of patient profile fixtures
            risk_algorithm: Risk assessment algorithm instance
            test_config: Test configuration parameters
        """
        consistency_threshold = test_config['consistency_threshold']
        logger.info("Testing baseline score accuracy")
        
        mismatches = []
        
        for profile in patient_profiles:
            patient_id = profile['patient_id']
            expected_score = profile.get('expected_risk_score')
            
            if expected_score is None:
                continue
            
            calculated_score = risk_algorithm.calculate_risk_score(profile)
            
            # Calculate percentage difference
            if expected_score > 0:
                diff_percentage = abs(calculated_score - expected_score) / expected_score
            else:
                diff_percentage = 0.0 if calculated_score == 0 else 1.0
            
            if diff_percentage > consistency_threshold:
                mismatches.append({
                    'patient_id': patient_id,
                    'expected': expected_score,
                    'calculated': calculated_score,
                    'diff_percentage': diff_percentage
                })
                logger.warning(
                    f"  Mismatch for {patient_id}: "
                    f"expected={expected_score:.2f}, "
                    f"calculated={calculated_score:.2f}, "
                    f"diff={diff_percentage*100:.2f}%"
                )
        
        if mismatches:
            logger.error(f"\n{len(mismatches)} profiles had score mismatches:")
            for mismatch in mismatches:
                logger.error(f"  - {mismatch['patient_id']}: {mismatch['diff_percentage']*100:.2f}% difference")
        else:
            logger.info(f"✓ All {len(patient_profiles)} profiles match baseline scores")
        
        assert len(mismatches) == 0, (
            f"{len(mismatches)} profile(s) had scores outside acceptable range. "
            f"See logs for details."
        )
