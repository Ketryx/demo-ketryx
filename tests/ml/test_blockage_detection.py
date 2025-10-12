```python
import time
import pytest
import numpy as np

from tests.ml.fixtures import synthetic_ct_scan_with_blockage, synthetic_ct_scan_no_blockage, synthetic_ct_scan_varied_quality
from ml.blockage_detection import BlockageDetectionModule
from visualization.interface import VisualizationInterface


@pytest.fixture(scope="module")
def model():
    mod = BlockageDetectionModule()
    mod.load_pretrained_weights()
    return mod


@pytest.fixture
def blockage_scan(synthetic_ct_scan_with_blockage):
    return synthetic_ct_scan_with_blockage


@pytest.fixture
def no_blockage_scan(synthetic_ct_scan_no_blockage):
    return synthetic_ct_scan_no_blockage


@pytest.fixture(params=["low", "medium", "high"])
def varied_quality_scan(request, synthetic_ct_scan_varied_quality):
    return synthetic_ct_scan_varied_quality(request.param)


def test_detection_on_known_blockage_cases(model, blockage_scan):
    prediction = model.predict(blockage_scan)
    assert prediction.has_blockage()
    assert prediction.confidence >= 0.85


def test_no_blockage_cases(model, no_blockage_scan):
    prediction = model.predict(no_blockage_scan)
    assert not prediction.has_blockage()
    assert prediction.confidence <= 0.15


@pytest.mark.parametrize("sensitivity, expected_detected", [
    (0.3, True),
    (0.5, True),
    (0.7, True),
    (0.9, False),
])
def test_sensitivity_tuning_effects(model, blockage_scan, sensitivity, expected_detected):
    model.set_sensitivity_threshold(sensitivity)
    prediction = model.predict(blockage_scan)
    assert prediction.has_blockage() == expected_detected


@pytest.mark.parametrize("quality", ["low", "medium", "high"])
def test_performance_on_various_scan_qualities(model, varied_quality_scan, quality):
    scan = varied_quality_scan
    prediction = model.predict(scan)
    # We expect mostly consistent detection on blockage when present; confidence may vary with quality
    assert 0.5 <= prediction.confidence <= 1.0 or not prediction.has_blockage()


def test_model_robustness_to_image_variations(model, blockage_scan):
    # Generate slight variation by adding noise
    noisy_scan = blockage_scan + np.random.normal(0, 0.01, blockage_scan.shape)
    noisy_scan = np.clip(noisy_scan, 0, 1)
    prediction_orig = model.predict(blockage_scan)
    prediction_noisy = model.predict(noisy_scan)
    assert abs(prediction_orig.confidence - prediction_noisy.confidence) < 0.1
    assert prediction_noisy.has_blockage() == prediction_orig.has_blockage()


def test_inference_speed_benchmark(model, blockage_scan):
    start = time.perf_counter()
    for _ in range(10):
        model.predict(blockage_scan)
    duration = time.perf_counter() - start
    avg_time_ms = (duration / 10) * 1000
    assert avg_time_ms < 200  # Average inference below 200 ms


def test_integration_with_visualization_interface(model, blockage_scan):
    vis = VisualizationInterface()
    vis.load_module(model)

    vis.set_current_scan(blockage_scan)
    output = vis.render_blockage_overlay()

    assert output is not None
    assert output.shape == blockage_scan.shape[:2] or output.ndim == 2  # overlay is 2D mask or heatmap
    assert output.dtype == np.uint8 or output.dtype == np.float32
```