```python
import pytest
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, roc_auc_score
from risk.coronary_risk_model import CoronaryRiskModel

@pytest.fixture(scope="module")
def synthetic_data():
    np.random.seed(42)
    n = 1000
    age = np.random.randint(30, 80, n)
    sex = np.random.choice([0, 1], n)
    cholesterol = np.random.normal(200, 30, n)
    systolic_bp = np.random.normal(130, 20, n)
    smoking = np.random.choice([0, 1], n)
    diabetes = np.random.choice([0, 1], n)
    # Binary outcome with some dependence on features
    risk = 0.03*age + 0.5*sex + 0.015*cholesterol + 0.02*systolic_bp + 0.4*smoking + 0.7*diabetes
    prob = 1 / (1 + np.exp(-0.01*(risk - 15)))
    outcome = np.random.binomial(1, prob)
    df = pd.DataFrame({
        'age': age,
        'sex': sex,
        'cholesterol': cholesterol,
        'systolic_bp': systolic_bp,
        'smoking': smoking,
        'diabetes': diabetes,
        'outcome': outcome
    })
    return df

@pytest.fixture(scope="module")
def real_clinical_data():
    # Simulate loading real data
    # In real tests, replace this with a real clinical dataset load step
    np.random.seed(123)
    n = 500
    data = {
        'age': np.random.randint(40, 85, n),
        'sex': np.random.choice([0, 1], n),
        'cholesterol': np.random.normal(210, 25, n),
        'systolic_bp': np.random.normal(135, 15, n),
        'smoking': np.random.choice([0, 1], n),
        'diabetes': np.random.choice([0, 1], n),
    }
    base_risk = 0.035*np.array(data['age']) + 0.6*np.array(data['sex']) + \
                0.02*np.array(data['cholesterol']) + 0.03*np.array(data['systolic_bp']) + \
                0.5*np.array(data['smoking']) + 0.9*np.array(data['diabetes'])
    prob = 1 / (1 + np.exp(-0.015*(base_risk - 20)))
    outcome = np.random.binomial(1, prob)
    df = pd.DataFrame(data)
    df['outcome'] = outcome
    return df

def test_model_prediction_shape_and_range(synthetic_data):
    model = CoronaryRiskModel()
    X = synthetic_data.drop(columns='outcome')
    predictions = model.predict(X)
    assert isinstance(predictions, np.ndarray)
    assert predictions.shape == (len(X),)
    assert np.all(predictions >= 0) and np.all(predictions <= 1)

def test_brier_score_and_c_statistic(synthetic_data):
    model = CoronaryRiskModel()
    X = synthetic_data.drop(columns='outcome')
    y_true = synthetic_data['outcome'].values
    y_pred = model.predict(X)
    brier = brier_score_loss(y_true, y_pred)
    c_stat = roc_auc_score(y_true, y_pred)
    assert 0 <= brier <= 1
    assert 0.5 <= c_stat <= 1  # Better than random
    # Typical reasonable thresholds (not too strict, since synthetic)
    assert brier < 0.25
    assert c_stat > 0.7

def test_discrimination_ability_roc_auc(real_clinical_data):
    model = CoronaryRiskModel()
    X = real_clinical_data.drop(columns='outcome')
    y_true = real_clinical_data['outcome'].values
    y_pred = model.predict(X)
    auc = roc_auc_score(y_true, y_pred)
    assert 0.6 < auc <= 1

def test_handling_of_different_populations():
    model = CoronaryRiskModel()
    # Younger population
    young_patients = pd.DataFrame({
        'age': np.random.randint(20, 40, 100),
        'sex': np.random.choice([0, 1], 100),
        'cholesterol': np.random.normal(180, 20, 100),
        'systolic_bp': np.random.normal(120, 10, 100),
        'smoking': np.random.choice([0, 1], 100),
        'diabetes': np.random.choice([0, 1], 100),
    })
    preds_young = model.predict(young_patients)
    assert np.all(preds_young >= 0) and np.all(preds_young <= 1)

    # Elderly population
    elderly_patients = pd.DataFrame({
        'age': np.random.randint(75, 95, 100),
        'sex': np.random.choice([0, 1], 100),
        'cholesterol': np.random.normal(220, 25, 100),
        'systolic_bp': np.random.normal(150, 15, 100),
        'smoking': np.random.choice([0, 1], 100),
        'diabetes': np.random.choice([0, 1], 100),
    })
    preds_elderly = model.predict(elderly_patients)
    assert np.all(preds_elderly >= 0) and np.all(preds_elderly <= 1)
    # Elderly risk should tend higher (mean)
    assert preds_elderly.mean() >= preds_young.mean()

def test_uncertainty_quantification_accuracy(synthetic_data):
    model = CoronaryRiskModel()
    X = synthetic_data.drop(columns='outcome')
    y_true = synthetic_data['outcome'].values
    preds, uncert = model.predict_with_uncertainty(X)
    assert preds.shape == uncert.shape == (len(X),)
    assert np.all(uncert >= 0)
    # Uncertainty should correlate with errors roughly
    error = np.abs(preds - y_true)
    corr = np.corrcoef(error, uncert)[0,1]
    assert corr > 0

def test_feature_importance_consistency():
    model = CoronaryRiskModel()
    importance_1 = model.feature_importance()
    importance_2 = model.feature_importance()
    assert isinstance(importance_1, dict)
    assert importance_1.keys() == importance_2.keys()
    for k in importance_1:
        assert np.isclose(importance_1[k], importance_2[k], rtol=1e-5)

def test_model_reproducibility(synthetic_data):
    model1 = CoronaryRiskModel(random_state=0)
    model2 = CoronaryRiskModel(random_state=0)
    X = synthetic_data.drop(columns='outcome')
    pred1 = model1.predict(X)
    pred2 = model2.predict(X)
    assert np.allclose(pred1, pred2, rtol=1e-7)

def test_edge_cases_handling():
    model = CoronaryRiskModel()
    # Empty input
    empty_df = pd.DataFrame(columns=['age','sex','cholesterol','systolic_bp','smoking','diabetes'])
    preds_empty = model.predict(empty_df)
    assert preds_empty.shape == (0,)

    # All-zero features
    zero_df = pd.DataFrame({
        'age': [0],
        'sex': [0],
        'cholesterol': [0],
        'systolic_bp': [0],
        'smoking': [0],
        'diabetes': [0],
    })
    preds_zero = model.predict(zero_df)
    assert preds_zero.shape == (1,)
    assert 0 <= preds_zero[0] <= 1

    # NaN values should raise or be handled
    nan_df = pd.DataFrame({
        'age': [50, np.nan],
        'sex': [1, 0],
        'cholesterol': [200, 180],
        'systolic_bp': [130, np.nan],
        'smoking': [0, 1],
        'diabetes': [0, 1],
    })
    with pytest.raises(ValueError):
        model.predict(nan_df)
```