```python
import io
import sys
import time
import pytest
import tracemalloc
import numpy as np
from PIL import Image

from blockage_detection import (
    load_model,
    preprocess_image,
    run_inference,
    calculate_sensitivity,
    BlockageDetectionError,
)

@pytest.fixture(scope="module")
def model():
    return load_model("tests/ml/models/test_blockage_model.pth")


@pytest.fixture
def sample_image():
    # Create a clean synthetic medical image (256x256 grayscale)
    arr = np.linspace(0, 255, 256*256, dtype=np.uint8).reshape((256, 256))
    return Image.fromarray(arr)


@pytest.fixture
def poor_quality_image():
    # Very noisy image (simulate poor quality)
    arr = np.random.randint(0, 256, (256, 256), dtype=np.uint8)
    return Image.fromarray(arr)


@pytest.fixture
def edge_artifact_image():
    # Image with sharp black border simulating edge artifact
    arr = np.full((256, 256), 128, dtype=np.uint8)
    arr[0:5, :] = 0
    arr[-5:, :] = 0
    arr[:, 0:5] = 0
    arr[:, -5:] = 0
    return Image.fromarray(arr)


@pytest.fixture
def test_dataset():
    # Synthetic test dataset: tuples of (image, ground_truth_label)
    data = []
    for i in range(10):
        # Half positive, half negative samples
        label = 1 if i < 5 else 0
        base_val = 180 if label == 1 else 70
        arr = np.full((256, 256), base_val, dtype=np.uint8)
        img = Image.fromarray(arr)
        data.append((img, label))
    return data


def test_preprocessing_pipeline_correctness(sample_image, poor_quality_image, edge_artifact_image):
    for img in [sample_image, poor_quality_image, edge_artifact_image]:
        processed = preprocess_image(img)
        assert processed.ndim == 3
        assert processed.shape[0] in {1, 3}  # channels-first or 1 channel grayscale after preprocess
        # Values scaled appropriately
        assert processed.min() >= 0.0
        assert processed.max() <= 1.0


@pytest.mark.parametrize("image,label", [
    pytest.param(img, label) for img, label in [
        (Image.fromarray(np.full((256,256), 180, dtype=np.uint8)), 1),
        (Image.fromarray(np.full((256,256), 70, dtype=np.uint8)), 0)
    ]
])
def test_model_inference_accuracy(model, image, label):
    processed = preprocess_image(image)
    pred = run_inference(model, processed)
    # Model returns probability or score between 0 and 1
    assert 0.0 <= pred <= 1.0
    # Use 0.5 threshold for classification in this synthetic test
    predicted_label = int(pred >= 0.5)
    assert predicted_label == label


def test_sensitivity_requirement(model, test_dataset):
    y_true = []
    y_scores = []
    for img, label in test_dataset:
        processed = preprocess_image(img)
        score = run_inference(model, processed)
        y_true.append(label)
        y_scores.append(score)
    sens = calculate_sensitivity(y_true, y_scores, threshold=0.5)
    # Sensitivity must meet requirement (arbitrary threshold e.g., 0.8)
    assert sens >= 0.8, f"Sensitivity too low: {sens}"


def test_edge_cases(model, poor_quality_image, edge_artifact_image):
    for img in [poor_quality_image, edge_artifact_image]:
        processed = preprocess_image(img)
        pred = run_inference(model, processed)
        assert 0.0 <= pred <= 1.0


def test_performance_benchmark(model, sample_image):
    processed = preprocess_image(sample_image)
    start_time = time.perf_counter()
    for _ in range(20):
        _ = run_inference(model, processed)
    duration = time.perf_counter() - start_time
    avg_time_ms = (duration / 20)*1000
    # Inference average time should be under 100ms
    assert avg_time_ms < 100, f"Inference too slow: {avg_time_ms:.2f}ms"


def test_memory_usage_validation(model, sample_image):
    processed = preprocess_image(sample_image)
    tracemalloc.start()
    _ = run_inference(model, processed)
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    # Peak memory usage should be below 100MB
    assert peak < 100 * 1024 * 1024, f"Memory peak too high: {peak / (1024*1024):.2f}MB"


def test_error_handling_invalid_input(model):
    with pytest.raises(BlockageDetectionError):
        # Passing None instead of image
        run_inference(model, None)
    with pytest.raises(BlockageDetectionError):
        # Passing wrong data type to preprocess
        preprocess_image("invalid input")


def test_error_handling_model_load_failure(monkeypatch):
    def fake_load_model_fail(*args, **kwargs):
        raise BlockageDetectionError("Model file corrupted or missing")
    monkeypatch.setattr("blockage_detection.load_model", fake_load_model_fail)
    with pytest.raises(BlockageDetectionError):
        load_model("invalid_path.pth")
```