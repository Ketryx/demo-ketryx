```python
import time
import threading
import pytest
import numpy as np

from risk.risk_algorithm import (
    calculate_risk_score,
    predict_risk_label,
    load_model,
    preprocess_input,
)

# Sample clinical validation datasets (mocked for tests)
clinical_cases = [
    # format: (input_data_dict, expected_risk_score, expected_label)
    (
        {"age": 65, "cholesterol": 220, "blood_pressure": 130, "glucose": 100, "smoking": True},
        0.72,
        "high",
    ),
    (
        {"age": 45, "cholesterol": 180, "blood_pressure": 120, "glucose": 85, "smoking": False},
        0.25,
        "low",
    ),
    (
        {"age": 55, "cholesterol": 240, "blood_pressure": 140, "glucose": 110, "smoking": True},
        0.85,
        "high",
    ),
]

@pytest.fixture(scope="module")
def loaded_model():
    model = load_model("KXREC5HB8JW72E99MFSDJAD4SKH6YQN")
    return model


@pytest.mark.parametrize("input_data,expected_score,expected_label", clinical_cases)
def test_risk_calculation_accuracy(input_data, expected_score, expected_label, loaded_model):
    preprocessed = preprocess_input(input_data)
    score = calculate_risk_score(preprocessed, loaded_model)
    assert pytest.approx(score, 0.02) == expected_score  # Allow small floating differences

    label = predict_risk_label(score, loaded_model)
    assert label == expected_label


def test_predictive_model_reliability(loaded_model):
    # Test that for a fixed input, the model prediction is stable and reasonable
    input_data = {
        "age": 50,
        "cholesterol": 200,
        "blood_pressure": 125,
        "glucose": 95,
        "smoking": False,
    }
    preprocessed = preprocess_input(input_data)
    predictions = [calculate_risk_score(preprocessed, loaded_model) for _ in range(10)]
    mean_pred = np.mean(predictions)
    std_pred = np.std(predictions)
    assert std_pred < 0.01  # Very low variance in prediction
    assert 0.2 < mean_pred < 0.6  # Expected plausible range


def test_consistency_across_runs(loaded_model):
    input_data = {
        "age": 60,
        "cholesterol": 210,
        "blood_pressure": 135,
        "glucose": 105,
        "smoking": True,
    }
    preprocessed = preprocess_input(input_data)
    results = []
    for _ in range(5):
        results.append(calculate_risk_score(preprocessed, loaded_model))
    for i in range(1, len(results)):
        assert pytest.approx(results[i], 1e-6) == results[i - 1]


def test_performance_latency_requirement(loaded_model):
    input_data = {
        "age": 55,
        "cholesterol": 230,
        "blood_pressure": 140,
        "glucose": 115,
        "smoking": True,
    }
    preprocessed = preprocess_input(input_data)

    start = time.perf_counter()
    for _ in range(50):
        calculate_risk_score(preprocessed, loaded_model)
    end = time.perf_counter()

    avg_latency_ms = (end - start) / 50 * 1000  # milliseconds
    # The latency requirement: model should process each case under 50ms on average
    assert avg_latency_ms < 50, f"Latency too high: {avg_latency_ms:.2f}ms"


@pytest.mark.parametrize("input_data", [
    # Extreme values
    {"age": 120, "cholesterol": 500, "blood_pressure": 250, "glucose": 400, "smoking": True},
    {"age": 0, "cholesterol": 100, "blood_pressure": 60, "glucose": 50, "smoking": False},
    # Missing data (None)
    {"age": None, "cholesterol": 220, "blood_pressure": 130, "glucose": 100, "smoking": True},
    {"age": 45, "cholesterol": None, "blood_pressure": 120, "glucose": 85, "smoking": False},
    {"age": 55, "cholesterol": 240, "blood_pressure": None, "glucose": 110, "smoking": True},
    {"age": 50, "cholesterol": 200, "blood_pressure": 125, "glucose": None, "smoking": False},
])
def test_edge_cases_handling(input_data, loaded_model):
    preprocessed = preprocess_input(input_data)
    score = calculate_risk_score(preprocessed, loaded_model)
    assert 0.0 <= score <= 1.0
    label = predict_risk_label(score, loaded_model)
    assert label in {"low", "medium", "high"}


def _threaded_risk_computation(input_data, model, results, idx):
    preprocessed = preprocess_input(input_data)
    score = calculate_risk_score(preprocessed, model)
    label = predict_risk_label(score, model)
    results[idx] = (score, label)


def test_multithreaded_correctness(loaded_model):
    input_data = {
        "age": 58,
        "cholesterol": 210,
        "blood_pressure": 132,
        "glucose": 108,
        "smoking": True,
    }
    threads = []
    results = [None] * 20

    for i in range(20):
        t = threading.Thread(target=_threaded_risk_computation, args=(input_data, loaded_model, results, i))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # All results should be identical across threads
    first_score, first_label = results[0]
    for score, label in results[1:]:
        assert pytest.approx(score, 1e-6) == first_score
        assert label == first_label
```