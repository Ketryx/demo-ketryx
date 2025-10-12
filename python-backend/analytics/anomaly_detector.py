```python
import os
import json
import joblib
import numpy as np
import pandas as pd
from typing import Union, Dict, Any
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


class AnomalyDetectorConfig:
    def __init__(self, contamination: float = 0.05, sensitivity: float = 0.5):
        """
        Args:
            contamination: expected proportion of anomalies in data (0-0.5)
            sensitivity: sensitivity level (0.0 low, 1.0 high) controls decision threshold subtly
        """
        self.contamination = contamination
        self.sensitivity = np.clip(sensitivity, 0.0, 1.0)

    def to_dict(self) -> Dict[str, Any]:
        return {'contamination': self.contamination, 'sensitivity': self.sensitivity}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'AnomalyDetectorConfig':
        return cls(d.get('contamination', 0.05), d.get('sensitivity', 0.5))


class AnomalyDetector:
    MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
    MODEL_VERSION_FILE = os.path.join(MODEL_DIR, 'model_version.json')

    def __init__(self, config: AnomalyDetectorConfig = None):
        self.config = config or AnomalyDetectorConfig()
        self.model: Union[IsolationForest, None] = None
        self.scaler: Union[StandardScaler, None] = None
        self.model_version: str = ''
        self._load_model_and_version()

    def _load_model_and_version(self):
        os.makedirs(self.MODEL_DIR, exist_ok=True)
        model_path = os.path.join(self.MODEL_DIR, 'isolation_forest.joblib')
        scaler_path = os.path.join(self.MODEL_DIR, 'scaler.joblib')
        if os.path.isfile(model_path) and os.path.isfile(scaler_path) and os.path.isfile(self.MODEL_VERSION_FILE):
            self.model = joblib.load(model_path)
            self.scaler = joblib.load(scaler_path)
            with open(self.MODEL_VERSION_FILE, 'r') as f:
                version_data = json.load(f)
                self.model_version = version_data.get('version', '')
        else:
            # Initialize default model for first run or fallback
            self._initialize_default_model()

    def _initialize_default_model(self):
        self.model_version = '1.0.0'
        self.model = IsolationForest(
            contamination=self.config.contamination,
            n_jobs=-1,
            random_state=42,
            behaviour='new'
        )
        self.scaler = StandardScaler()
        # Save initialized version metadata
        self._save_version_metadata()

    def _save_version_metadata(self):
        version_data = {'version': self.model_version}
        with open(self.MODEL_VERSION_FILE, 'w') as f:
            json.dump(version_data, f)

    def preprocess(self, data: Union[pd.DataFrame, np.ndarray]) -> np.ndarray:
        if isinstance(data, pd.DataFrame):
            data = data.select_dtypes(include=[np.number]).values
        elif isinstance(data, np.ndarray):
            if data.ndim == 1:
                data = data.reshape(-1, 1)
        else:
            raise ValueError("Input data must be a pandas DataFrame or numpy.ndarray")
        if self.scaler is None:
            self.scaler = StandardScaler()
            data_scaled = self.scaler.fit_transform(data)
        else:
            data_scaled = self.scaler.transform(data)
        return data_scaled

    def fit(self, data: Union[pd.DataFrame, np.ndarray]) -> None:
        data_scaled = self.preprocess(data)
        self.model.set_params(contamination=self.config.contamination)
        self.model.fit(data_scaled)
        self.model_version = self._increment_version(self.model_version)
        self._save_model()
        self._save_version_metadata()

    def _increment_version(self, version: str) -> str:
        parts = version.split('.')
        if len(parts) != 3:
            return '1.0.0'
        major, minor, patch = map(int, parts)
        patch += 1
        return f"{major}.{minor}.{patch}"

    def _save_model(self):
        model_path = os.path.join(self.MODEL_DIR, 'isolation_forest.joblib')
        scaler_path = os.path.join(self.MODEL_DIR, 'scaler.joblib')
        joblib.dump(self.model, model_path, compress=3)
        joblib.dump(self.scaler, scaler_path, compress=3)

    def detect_anomalies(self, data: Union[pd.DataFrame, np.ndarray]) -> Dict[str, Any]:
        data_scaled = self.preprocess(data)
        raw_scores = None
        if hasattr(self.model, 'score_samples'):
            raw_scores = self.model.score_samples(data_scaled)
        preds = self.model.predict(data_scaled)  # -1 anomaly, 1 normal

        # Sensitivity adjustment by threshold shifting
        # Normally: preds = (score_samples < threshold)
        # Increasing sensitivity means more points flagged anomaly.
        # We calculate adjusted threshold by percentile of scores
        if raw_scores is not None:
            threshold_percentile = 100 * (self.config.contamination * (1 - self.config.sensitivity))
            threshold = np.percentile(raw_scores, threshold_percentile)
            adjusted_preds = (raw_scores < threshold).astype(int)
            preds = np.where(adjusted_preds == 1, -1, 1)
        else:
            # fallback if no score_samples
            preds = preds

        anomalies_idx = np.where(preds == -1)[0]
        results = {
            'anomalies': anomalies_idx.tolist(),
            'total_points': len(preds),
            'model_version': self.model_version,
            'sensitivity': self.config.sensitivity,
            'contamination': self.config.contamination,
        }
        return results


def load_config(filepath: str) -> AnomalyDetectorConfig:
    if os.path.isfile(filepath):
        with open(filepath, 'r') as f:
            cfg_dict = json.load(f)
        return AnomalyDetectorConfig.from_dict(cfg_dict)
    return AnomalyDetectorConfig()


def save_config(config: AnomalyDetectorConfig, filepath: str) -> None:
    with open(filepath, 'w') as f:
        json.dump(config.to_dict(), f, indent=2)
```