```python
import numpy as np
from scipy.stats import norm
from sklearn.ensemble import GradientBoostingClassifier


class RiskAssessmentAlgorithm:
    """
    Coronary Event Risk Assessment combining multi-factor patient data,
    blockage metrics, predictive modeling, confidence intervals, temporal analysis,
    and producing explanatory outputs tailored for clinical decision support.
    """

    def __init__(self):
        # Pre-trained Gradient Boosting model placeholder (should be replaced with real trained model)
        self.model = GradientBoostingClassifier(random_state=42)
        self._train_dummy_model()

        # Risk stratification thresholds (probabilities)
        self.risk_thresholds = {
            "Low": 0.05,
            "Moderate": 0.10,
            "High": 0.20,
            "Very High": 1.0,
        }

    def _train_dummy_model(self):
        # Dummy training for demonstration (replace with real clinical model load)
        np.random.seed(42)
        X_dummy = np.random.rand(1000, 8)
        y_dummy = (X_dummy[:, 0] + X_dummy[:, 1] * 2 + X_dummy[:, 2] > 1.5).astype(int)
        self.model.fit(X_dummy, y_dummy)

    def _prepare_features(
        self,
        age: int,
        sex: str,
        smoking: bool,
        diabetes: bool,
        hypertension: bool,
        cholesterol_hdl_ratio: float,
        systolic_bp: float,
        max_blockage_pct: float,
    ) -> np.ndarray:
        sex_encoded = 1 if sex.lower() == "male" else 0
        features = np.array(
            [
                age / 100,
                sex_encoded,
                int(smoking),
                int(diabetes),
                int(hypertension),
                cholesterol_hdl_ratio / 10,
                systolic_bp / 200,
                max_blockage_pct / 100,
            ],
            dtype=np.float32,
        )
        return features.reshape(1, -1)

    def predict_event_probability(
        self,
        age: int,
        sex: str,
        smoking: bool,
        diabetes: bool,
        hypertension: bool,
        cholesterol_hdl_ratio: float,
        systolic_bp: float,
        max_blockage_pct: float,
    ) -> dict:
        """
        Predicts the 5-year coronary event risk probability with confidence intervals
        and risk category.

        Returns a dict with:
            - probability: float in [0,1]
            - ci_lower: float
            - ci_upper: float
            - risk_category: str
            - explanation: dict with feature contributions and reasoning
        """
        features = self._prepare_features(
            age,
            sex,
            smoking,
            diabetes,
            hypertension,
            cholesterol_hdl_ratio,
            systolic_bp,
            max_blockage_pct,
        )

        # Predict probability using the model
        prob = self.model.predict_proba(features)[0, 1]

        # Calculate approximate confidence interval via normal approximation to the model output,
        # assuming variance from model's calibrated output or bootstrap - simplified here.
        se = np.sqrt(prob * (1 - prob) / 1000)  # assume n=1000 as effective sample size proxy
        z = norm.ppf(0.975)
        ci_lower = max(0.0, prob - z * se)
        ci_upper = min(1.0, prob + z * se)

        risk_category = self._stratify_risk(prob)

        explanation = self._generate_explanation(
            age,
            sex,
            smoking,
            diabetes,
            hypertension,
            cholesterol_hdl_ratio,
            systolic_bp,
            max_blockage_pct,
            prob,
            risk_category,
        )

        return {
            "probability": prob,
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
            "risk_category": risk_category,
            "explanation": explanation,
        }

    def _stratify_risk(self, probability: float) -> str:
        for category, threshold in self.risk_thresholds.items():
            if probability <= threshold:
                return category
        return "Very High"

    def temporal_risk_progression(
        self,
        baseline_data: dict,
        followup_data: dict,
        years_between: float,
    ) -> dict:
        """
        Analyze risk progression between two time points.

        Parameters baseline_data and followup_data must contain keys:
            age, sex, smoking, diabetes, hypertension, cholesterol_hdl_ratio,
            systolic_bp, max_blockage_pct

        Returns dict with:
            - baseline_prob
            - followup_prob
            - absolute_risk_change
            - annualized_risk_change
            - baseline_category
            - followup_category
            - progression_comment
        """
        base_pred = self.predict_event_probability(**baseline_data)
        follow_pred = self.predict_event_probability(**followup_data)

        absolute_change = follow_pred["probability"] - base_pred["probability"]
        annualized_change = absolute_change / years_between if years_between > 0 else 0

        progression_comment = self._interpret_progression(
            base_pred["risk_category"], follow_pred["risk_category"], absolute_change
        )

        return {
            "baseline_prob": base_pred["probability"],
            "followup_prob": follow_pred["probability"],
            "absolute_risk_change": absolute_change,
            "annualized_risk_change": annualized_change,
            "baseline_category": base_pred["risk_category"],
            "followup_category": follow_pred["risk_category"],
            "progression_comment": progression_comment,
        }

    def _interpret_progression(
        self, baseline_cat: str, followup_cat: str, change: float
    ) -> str:
        if change > 0.05:
            if baseline_cat != followup_cat:
                return (
                    f"Risk category increased from {baseline_cat} to {followup_cat}."
                    f" Clinical review recommended."
                )
            return "Significant risk increase detected; consider intervention."
        if change < -0.05:
            return "Risk decreased, likely reflecting effective management."
        return "Risk stable; maintain current management strategy."

    def _generate_explanation(
        self,
        age,
        sex,
        smoking,
        diabetes,
        hypertension,
        cholesterol_hdl_ratio,
        systolic_bp,
        max_blockage_pct,
        probability,
        risk_category,
    ):
        contribs = []
        if max_blockage_pct > 70:
            contribs.append(
                f"High blockage ({max_blockage_pct}%) strongly elevates risk."
            )
        else:
            contribs.append(f"Blockage at {max_blockage_pct}% contributes moderately.")

        if age >= 65:
            contribs.append("Advanced age (≥65 years) adds to risk burden.")
        else:
            contribs.append("Younger age helps reduce risk.")

        if smoking:
            contribs.append("Smoking significantly raises coronary risk.")
        else:
            contribs.append("Non-smoking status mitigates risk.")

        if diabetes:
            contribs.append("Diabetes presence increases vascular risk.")
        else:
            contribs.append("No diabetes reduces risk.")

        if hypertension:
            contribs.append("Hypertension elevates risk.")
        else:
            contribs.append("Normal blood pressure is protective.")

        if cholesterol_hdl_ratio > 5.0:
            contribs.append(
                f"Elevated cholesterol/HDL ratio ({cholesterol_hdl_ratio}) worsens risk."
            )
        else:
            contribs.append("Healthy cholesterol/HDL ratio helps lower risk.")

        if systolic_bp > 140:
            contribs.append(
                f"Elevated systolic blood pressure ({systolic_bp} mmHg) contributes."
            )
        else:
            contribs.append("Controlled blood pressure aids risk reduction.")

        explanation = {
            "summary": f"Patient categorized as {risk_category} risk with predicted probability {probability:.3f}.",
            "contributing_factors": contribs,
            "recommendation": self._recommendation(risk_category),
        }
        return explanation

    def _recommendation(self, risk_category: str) -> str:
        recs = {
            "Low": "Maintain lifestyle and periodic monitoring.",
            "Moderate": "Consider lifestyle modification and clinical follow-up.",
            "High": "Initiate risk-lowering therapies and close clinical monitoring.",
            "Very High": "Urgent intervention and specialist management recommended.",
        }
        return recs.get(risk_category, "Clinical evaluation advised.")


if __name__ == "__main__":
    # Minimal example use-case
    algo = RiskAssessmentAlgorithm()
    patient_data = dict(
        age=62,
        sex="male",
        smoking=True,
        diabetes=False,
        hypertension=True,
        cholesterol_hdl_ratio=6.2,
        systolic_bp=150,
        max_blockage_pct=75.0,
    )
    result = algo.predict_event_probability(**patient_data)
    from pprint import pprint

    pprint(result)
```