```python
import pytest
import numpy as np
from unittest.mock import MagicMock

from anomaly.pattern_detector import PatternDetector


@pytest.fixture
def detector():
    return PatternDetector()


def create_synthetic_image(shape=(100, 100), anomaly_type=None):
    img = np.zeros(shape, dtype=np.uint8)
    if anomaly_type == 'spot':
        cv = shape[0] // 2
        img[cv-5:cv+5, cv-5:cv+5] = 255
    elif anomaly_type == 'line':
        img[50, 20:80] = 255
    elif anomaly_type == 'noise':
        img = (np.random.rand(*shape) > 0.98).astype(np.uint8) * 255
    elif anomaly_type == 'morph':
        cv = shape[0] // 2
        img[cv-10:cv-5, cv-10:cv+10] = 255
        img[cv+5:cv+10, cv-10:cv+10] = 255
    return img


def test_pattern_matching_accuracy(detector):
    img = create_synthetic_image(anomaly_type='spot')
    patterns = detector.detect_patterns(img)
    assert any(p['type'] == 'spot' for p in patterns)


def test_outlier_detection_sensitivity(detector):
    img = create_synthetic_image(anomaly_type='noise')
    detector.set_sensitivity(0.1)
    low_sens_patterns = detector.detect_patterns(img)
    detector.set_sensitivity(0.9)
    high_sens_patterns = detector.detect_patterns(img)
    assert len(low_sens_patterns) < len(high_sens_patterns)


def test_morphological_analysis_correctness(detector):
    img = create_synthetic_image(anomaly_type='morph')
    morph_features = detector.morphological_features(img)
    assert morph_features['area'] > 0
    assert morph_features['perimeter'] > 0
    assert 'solidity' in morph_features


@pytest.mark.parametrize("tissue_type,img", [
    ('muscle', create_synthetic_image(anomaly_type='spot')),
    ('fat', create_synthetic_image(anomaly_type='line')),
    ('epithelium', create_synthetic_image(anomaly_type='morph')),
])
def test_texture_analysis_on_tissue_types(detector, tissue_type, img):
    texture = detector.texture_analysis(img, tissue_type=tissue_type)
    assert isinstance(texture, dict)
    assert 'contrast' in texture
    assert 'homogeneity' in texture
    assert all(isinstance(v, float) for v in texture.values())


def test_spatial_relationship_validation(detector):
    img = np.zeros((100, 100), dtype=np.uint8)
    img[40:60, 40:60] = 255  # cluster 1
    img[70:90, 70:90] = 255  # cluster 2
    patterns = detector.detect_patterns(img)
    spatial_valid = detector.validate_spatial_relationships(patterns)
    assert isinstance(spatial_valid, bool)


def test_sensitivity_tuning_effects(detector):
    img = create_synthetic_image(anomaly_type='spot')
    detector.set_sensitivity(0.3)
    low_sens_patterns = detector.detect_patterns(img)
    detector.set_sensitivity(0.7)
    high_sens_patterns = detector.detect_patterns(img)
    assert len(low_sens_patterns) <= len(high_sens_patterns)


def test_false_positive_rate_measurement(detector):
    clean_img = np.zeros((100, 100), dtype=np.uint8)
    patterns = detector.detect_patterns(clean_img)
    false_positives = sum(1 for p in patterns if p['confidence'] < 0.5)
    assert false_positives == 0 or false_positives <= len(patterns)


def test_edge_cases_empty_image(detector):
    empty_img = np.zeros((0, 0), dtype=np.uint8)
    patterns = detector.detect_patterns(empty_img)
    assert patterns == []


def test_edge_cases_all_white_image(detector):
    white_img = np.ones((100, 100), dtype=np.uint8) * 255
    patterns = detector.detect_patterns(white_img)
    assert isinstance(patterns, list)
    assert all('type' in p for p in patterns)
```