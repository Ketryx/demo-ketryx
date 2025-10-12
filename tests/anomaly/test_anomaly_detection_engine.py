```python
import os
import time
import pytest
import numpy as np
from PIL import Image

from anomaly.anomaly_detection_engine import AnomalyDetectionEngine

# Sample fixture paths - replace with actual test image paths in test environment
KNOWN_ANOMALY_IMAGES = [
    "tests/test_data/anomalies/frame_001.png",
    "tests/test_data/anomalies/frame_002.png",
    "tests/test_data/anomalies/frame_003.png",
]
NORMAL_IMAGES = [
    "tests/test_data/normal/frame_010.png",
    "tests/test_data/normal/frame_011.png",
]
CORRUPTED_IMAGE = "tests/test_data/corrupted/frame_999.png"
BATCH_IMAGES = KNOWN_ANOMALY_IMAGES + NORMAL_IMAGES

# Thresholds for sensitivity validation per anomaly type (hypothetical)
SENSITIVITY_THRESHOLDS = {
    "calcification": 0.85,
    "mass": 0.90,
    "asymmetry": 0.80,
}

@pytest.fixture(scope="module")
def detection_engine():
    return AnomalyDetectionEngine()

def load_image(path):
    with Image.open(path) as img:
        return np.array(img.convert("L"))  # convert to grayscale numpy array for processing

@pytest.mark.parametrize("img_path", KNOWN_ANOMALY_IMAGES)
def test_detect_known_anomalies(detection_engine, img_path):
    image = load_image(img_path)
    result = detection_engine.analyze(image)
    assert result.is_anomalous is True
    assert result.anomaly_type in SENSITIVITY_THRESHOLDS
    assert result.confidence >= SENSITIVITY_THRESHOLDS[result.anomaly_type]

@pytest.mark.parametrize("img_path", NORMAL_IMAGES)
def test_no_anomaly_detection(detection_engine, img_path):
    image = load_image(img_path)
    result = detection_engine.analyze(image)
    assert result.is_anomalous is False
    assert result.confidence < 0.5

@pytest.mark.parametrize("anomaly_type,threshold", SENSITIVITY_THRESHOLDS.items())
def test_sensitivity_validation_per_anomaly_type(detection_engine, anomaly_type, threshold):
    # Simulate loading multiple images known for each anomaly_type
    anomaly_images_dir = f"tests/test_data/anomalies/{anomaly_type}"
    if not os.path.isdir(anomaly_images_dir):
        pytest.skip(f"No test images found for anomaly type: {anomaly_type}")

    confidences = []
    for fname in os.listdir(anomaly_images_dir):
        if not fname.lower().endswith((".png", ".jpg", ".jpeg")):
            continue
        img_path = os.path.join(anomaly_images_dir, fname)
        image = load_image(img_path)
        result = detection_engine.analyze(image)
        if result.anomaly_type == anomaly_type:
            confidences.append(result.confidence)

    assert confidences, f"No images tested for anomaly type {anomaly_type}"
    average_confidence = sum(confidences) / len(confidences)
    assert average_confidence >= threshold

def test_performance_benchmark(detection_engine):
    image = load_image(KNOWN_ANOMALY_IMAGES[0])
    start = time.perf_counter()
    for _ in range(10):
        detection_engine.analyze(image)
    elapsed = time.perf_counter() - start
    avg_time_ms = (elapsed / 10) * 1000
    assert avg_time_ms < 250, f"Average processing time too high: {avg_time_ms:.2f} ms"

def test_batch_processing(detection_engine):
    images = [load_image(p) for p in BATCH_IMAGES]
    results = detection_engine.batch_analyze(images)
    assert len(results) == len(images)
    for img, result in zip(images, results):
        assert hasattr(result, "is_anomalous")
        assert hasattr(result, "confidence")

def test_integration_with_clinical_workflow(detection_engine):
    # Simulate input from clinical workflow system (dict with image and metadata)
    clinical_image = load_image(KNOWN_ANOMALY_IMAGES[0])
    clinical_data = {
        "patient_id": "PAT123",
        "study_id": "STUDY456",
        "image_data": clinical_image,
        "metadata": {"modality": "mammography", "view": "CC"},
    }
    # The engine may have a special integration method or accept dict inputs
    result = detection_engine.analyze_clinical(clinical_data)
    assert isinstance(result, dict)
    assert "is_anomalous" in result
    assert "anomaly_type" in result
    assert result["is_anomalous"] is True

def test_error_handling_corrupted_images(detection_engine):
    # Simulate corrupted image loading: corrupted image data or invalid file
    with pytest.raises(Exception):
        detection_engine.analyze(load_image(CORRUPTED_IMAGE))

@pytest.mark.parametrize("img_path", KNOWN_ANOMALY_IMAGES)
def test_anomaly_detection_sensitivity_requirement(detection_engine, img_path):
    image = load_image(img_path)
    result = detection_engine.analyze(image)
    # Sensitivity requirement: detect anomalies with confidence > 0.80
    assert result.is_anomalous is True
    assert result.confidence >= 0.80
```