```python
import pytest
import time
import numpy as np
import pandas as pd
from anomaly_detector import AnomalyDetector

@pytest.fixture
def sample_data_df():
    times = pd.date_range("2023-01-01", periods=100, freq="T")
    values = np.random.normal(loc=0.0, scale=1.0, size=100)
    # Insert known anomalies
    values[20] = 10
    values[50] = -8
    df = pd.DataFrame({"timestamp": times, "value": values})
    return df

@pytest.fixture
def sample_data_np():
    # Simple numpy array with base normal values and anomalies at indices 5 and 15
    data = np.random.normal(0, 1, 30)
    data[5] = 7.5
    data[15] = -6.0
    return data

@pytest.fixture
def sample_data_list():
    # List format: (timestamp, value) tuples with anomalies
    base_time = 1672531200  # Epoch for 2023-01-01
    normal_values = np.random.normal(0, 1, 40)
    normal_values[10] = 6.0
    normal_values[25] = -7.0
    data = [(base_time + i * 60, v) for i, v in enumerate(normal_values)]
    return data

@pytest.fixture
def model_default():
    return AnomalyDetector()

@pytest.fixture
def model_sensitive():
    return AnomalyDetector(sensitivity=0.9)

@pytest.fixture
def model_insensitive():
    return AnomalyDetector(sensitivity=0.1)

def test_model_loads_correctly(model_default):
    assert model_default.model is not None
    assert hasattr(model_default, "preprocess")
    assert hasattr(model_default, "detect")

@pytest.mark.parametrize("data_input", ["sample_data_df", "sample_data_np", "sample_data_list"])
def test_preprocessing_formats(request, model_default, data_input):
    data = request.getfixturevalue(data_input)
    processed = model_default.preprocess(data)
    # Check that output is array-like and numeric
    assert isinstance(processed, np.ndarray)
    assert processed.ndim == 1 or processed.ndim == 2
    assert np.issubdtype(processed.dtype, np.number)
    assert len(processed) > 0

def test_anomaly_detection_identifies_known_anomalies(sample_data_df, model_default):
    data = model_default.preprocess(sample_data_df)
    anomalies = model_default.detect(data)
    # Known anomaly indices (20 and 50)
    detected_indices = set(anomalies["indices"])
    assert 20 in detected_indices
    assert 50 in detected_indices
    # Confirm anomaly scores or flags are above threshold
    assert all(score > 0 for score in anomalies["scores"])

def test_sensitivity_affects_results(sample_data_np, model_sensitive, model_insensitive):
    data_sensitive = model_sensitive.preprocess(sample_data_np)
    data_insensitive = model_insensitive.preprocess(sample_data_np)

    result_sensitive = model_sensitive.detect(data_sensitive)
    result_insensitive = model_insensitive.detect(data_insensitive)

    count_sensitive = len(result_sensitive["indices"])
    count_insensitive = len(result_insensitive["indices"])

    # Higher sensitivity should detect more or equal anomalies
    assert count_sensitive >= count_insensitive

def test_performance_latency(sample_data_df, model_default):
    data = model_default.preprocess(sample_data_df)
    start = time.time()
    anomalies = model_default.detect(data)
    duration = time.time() - start
    # Performance requirement: detection under 0.5 seconds
    assert duration < 0.5
```