```python
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import brier_score_loss
import shap
import joblib
import json
from datetime import datetime


class CoronaryRiskModel:
    """
    Coronary Event Risk Prediction Model
    ------------------------------------------------
    Predicts coronary event risk based on blockage features and patient data.
    Implements:
      - Random Forest classifier with calibration
      - Feature extraction and scaling pipeline
      - Risk stratification (low/moderate/high/very high)
      - Model calibration per population
      - Uncertainty quantification via calibrated probabilities
      - Model versioning and metadata tracking
      - Integration with ACC/AHA clinical guidelines
      - Explainability using SHAP values
    """

    VERSION = "1.0.0"
    METADATA = {
        "model_name": "CoronaryRisk_RF_1.0.0",
        "author": "CardioAI Team",
        "date_created": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": (
            "Random Forest model for coronary event risk prediction with calibration and explainability."
        ),
        "clinical_guidelines": ["ACC/AHA 2019 Cholesterol Guidelines"],
        "libraries": {
            "scikit-learn": ">=1.0",
            "shap": ">=0.39"
        }
    }

    FEATURE_COLUMNS = [
        # Blockage-related features
        "num_blockages",
        "max_blockage_percent",
        "mean_blockage_percent",
        "stenosis_location_score",

        # Patient data
        "age",
        "sex",  # 0=Female, 1=Male
        "smoking_status",  # 0=Never, 1=Former, 2=Current
        "hdl_cholesterol",
        "ldl_cholesterol",
        "systolic_bp",
        "diastolic_bp",
        "diabetes",  # 0=no, 1=yes
        "hypertension",  # 0=no, 1=yes
        "family_history_heart_disease",  # 0=no, 1=yes
        "weight_kg",
        "height_cm"
    ]

    RISK_THRESHOLDS = {
        "low": 0.05,        # <5%  10-year risk
        "moderate": 0.10,   # 5-10%
        "high": 0.20,       # 10-20%
        "very_high": 1.00   # >20%
    }

    def __init__(self):
        self.pipeline = None
        self.calibrated_model = None
        self.shap_explainer = None
        self.population = None

    def _build_pipeline(self):
        return Pipeline([
            ("scaler", StandardScaler()),
            ("rf", RandomForestClassifier(n_estimators=150, max_depth=8, random_state=42, class_weight='balanced'))
        ])

    def train(self, X: pd.DataFrame, y: pd.Series, population: str = "general"):
        """
        Train and calibrate the model on provided dataset.

        Args:
            X: DataFrame with feature columns.
            y: Binary outcome (0=no event, 1=event).
            population: Population identifier for calibration ("general", "asian", "african_american", etc.).
        """
        self.population = population
        X = self._extract_features(X)
        self.pipeline = self._build_pipeline()
        self.pipeline.fit(X, y)

        # Calibrate model probabilities using isotonic regression
        calibrator = CalibratedClassifierCV(self.pipeline.named_steps['rf'], cv=5, method='isotonic')
        calibrator.fit(X, y)
        self.calibrated_model = calibrator

        # Initialize SHAP explainer
        self.shap_explainer = shap.TreeExplainer(self.pipeline.named_steps['rf'])

    def _extract_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Extract and engineer features from raw blockage and patient data.

        Expected columns:
          - blockages: list of dicts, each dict with 'percent', 'location' keys
          - patient data keys matching FEATURE_COLUMNS

        If input df already in FEATURE_COLUMNS format, select those columns for model input.
        """
        # If features already present, select them directly
        if set(self.FEATURE_COLUMNS).issubset(df.columns):
            features = df[self.FEATURE_COLUMNS].copy()
            return features

        # Otherwise, build features from raw inputs
        features = pd.DataFrame(index=df.index)

        # Blockage features
        def blockage_stats(blockages):
            if not isinstance(blockages, list) or len(blockages) == 0:
                return pd.Series({
                    "num_blockages": 0,
                    "max_blockage_percent": 0.0,
                    "mean_blockage_percent": 0.0,
                    "stenosis_location_score": 0.0
                })
            percents = [b.get("percent", 0) for b in blockages]
            locations = [b.get("location", 0) for b in blockages]
            # Weight for location: proximal arteries have higher score, normalized 0-1
            loc_score = np.mean([min(1, loc / 10) for loc in locations])
            return pd.Series({
                "num_blockages": len(blockages),
                "max_blockage_percent": max(percents),
                "mean_blockage_percent": np.mean(percents),
                "stenosis_location_score": loc_score
            })

        blockage_features = df["blockages"].apply(blockage_stats)
        features = pd.concat([features, blockage_features], axis=1)

        # Patient features extraction with defaults and encoding
        features["age"] = df.get("age", 55).astype(float)
        features["sex"] = df.get("sex", 0).astype(int)  # Female=0, Male=1

        # Smoking_status encoding: map from string or integer to 0-2
        def encode_smoking(x):
            if pd.isna(x):
                return 0
            if isinstance(x, int):
                return x if x in (0, 1, 2) else 0
            x = str(x).lower()
            if x in ("never", "non-smoker", "no"):
                return 0
            elif x in ("former", "ex-smoker"):
                return 1
            elif x in ("current", "yes", "smoker"):
                return 2
            return 0

        features["smoking_status"] = df.get("smoking_status", 0).apply(encode_smoking).astype(int)
        features["hdl_cholesterol"] = df.get("hdl_cholesterol", 50).astype(float)
        features["ldl_cholesterol"] = df.get("ldl_cholesterol", 100).astype(float)
        features["systolic_bp"] = df.get("systolic_bp", 120).astype(float)
        features["diastolic_bp"] = df.get("diastolic_bp", 80).astype(float)
        features["diabetes"] = df.get("diabetes", 0).astype(int)
        features["hypertension"] = df.get("hypertension", 0).astype(int)
        features["family_history_heart_disease"] = df.get("family_history_heart_disease", 0).astype(int)
        features["weight_kg"] = df.get("weight_kg", 70).astype(float)
        features["height_cm"] = df.get("height_cm", 170).astype(float)

        return features[self.FEATURE_COLUMNS]

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """
        Predict calibrated probabilities of coronary event.

        Args:
            X: Raw data or preprocessed features DataFrame

        Returns:
            ndarray of probabilities for positive class (event)
        """
        if self.calibrated_model is None:
            raise RuntimeError("Model not trained. Call `train` first.")
        features = self._extract_features(X)
        proba = self.calibrated_model.predict_proba(features)[:, 1]
        return proba

    def predict_risk_category(self, X: pd.DataFrame) -> np.ndarray:
        """
        Predict categorical risk stratification based on probability.

        Returns:
            ndarray of category strings: 'low', 'moderate', 'high', 'very_high'
        """
        proba = self.predict_proba(X)
        cats = np.full(proba.shape, "low", dtype=object)
        cats[proba >= self.RISK_THRESHOLDS["low"]] = "moderate"
        cats[proba >= self.RISK_THRESHOLDS["moderate"]] = "high"
        cats[proba >= self.RISK_THRESHOLDS["high"]] = "very_high"
        return cats

    def uncertainty(self, X: pd.DataFrame) -> np.ndarray:
        """
        Estimate uncertainty in prediction using probability calibration and margin.

        Returns:
            ndarray of uncertainty scores (0=low uncertainty, 0.5=max uncertainty)
        """
        proba = self.predict_proba(X)
        # Uncertainty highest near 0.5 probability; lower near 0 or 1
        uncertainty = 0.5 - np.abs(proba - 0.5)
        return uncertainty

    def explain(self, X: pd.DataFrame) -> pd.DataFrame:
        """
        Generate SHAP values for explainability.

        Returns:
            DataFrame where columns correspond to feature contributions per sample.
        """
        if self.shap_explainer is None:
            raise RuntimeError("Model not trained. Call `train` first.")
        features = self._extract_features(X)
        shap_values = self.shap_explainer.shap_values(self.pipeline.named_steps['rf'].transform(features))
        # shap_values for binary classification is a list if multiclass, else array
        # For RandomForestClassifier, shap_values is list of length 2
        if isinstance(shap_values, list):
            shap_vals_for_pos_class = shap_values[1]
        else:
            shap_vals_for_pos_class = shap_values

        return pd.DataFrame(shap_vals_for_pos_class, columns=self.FEATURE_COLUMNS, index=features.index)

    def save(self, filepath: str):
        """
        Save model pipeline, calibration, and metadata to file.
        """
        save_dict = {
            "version": self.VERSION,
            "metadata": self.METADATA,
            "population": self.population,
            "pipeline": self.pipeline,
            "calibrated_model": self.calibrated_model
        }
        joblib.dump(save_dict, filepath)

    def load(self, filepath: str):
        """
        Load model pipeline, calibration, and metadata from file.
        """
        load_dict = joblib.load(filepath)
        self.VERSION = load_dict.get("version", "unknown")
        self.METADATA = load_dict.get("metadata", {})
        self.population = load_dict.get("population", None)
        self.pipeline = load_dict["pipeline"]
        self.calibrated_model = load_dict["calibrated_model"]
        self.shap_explainer = shap.TreeExplainer(self.pipeline.named_steps['rf'])

    def integrate_acc_aha_guidelines(self, prob: float) -> str:
        """
        Provide clinical guideline-based recommendations given predicted risk probability.

        ACC/AHA 2019 lipid guidelines used as reference for risk thresholds and recommendations.

        Args:
            prob: estimated 10-year atherosclerotic cardiovascular disease risk

        Returns:
            Recommendation string
        """
        if prob < 0.05:
            return ("Low risk: Emphasize lifestyle modification. "
                    "Consider periodic monitoring.")
        elif 0.05 <= prob < 0.10:
            return ("Moderate risk: Lifestyle modification recommended. "
                    "Evaluate risk enhancers to consider moderate-intensity statin therapy.")
        elif 0.10 <= prob < 0.20:
            return ("High risk: Recommend initiation of statin therapy "
                    "and aggressive risk factor control.")
        else:
            return ("Very high risk: Consider high-intensity statin therapy, "
                    "possible addition of non-statin agents, and close clinical monitoring.")

    def clinical_decision_support(self, X: pd.DataFrame) -> pd.DataFrame:
        """
        For given raw data, provide full decision support including:
          - predicted probability,
          - risk category,
          - uncertainty,
          - guideline recommendation,
          - SHAP explanations.

        Returns:
            DataFrame indexed as X with columns:
               'predicted_risk', 'risk_category', 'uncertainty', 'recommendation', plus SHAP feature contributions
        """
        proba = self.predict_proba(X)
        category = self.predict_risk_category(X)
        uncertainty = self.uncertainty(X)
        recs = [self.integrate_acc_aha_guidelines(p) for p in proba]
        shap_df = self.explain(X)
        result = pd.DataFrame({
            "predicted_risk": proba,
            "risk_category": category,
            "uncertainty": uncertainty,
            "recommendation": recs
        }, index=X.index)
        return pd.concat([result, shap_df], axis=1)
```