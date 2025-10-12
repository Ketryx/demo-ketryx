```python
import numpy as np
from scipy.stats import norm
from scipy.optimize import minimize


class RiskCalculator:
    def __init__(self, framingham_coefficients=None):
        # Framingham risk model coeffs (log odds) and baseline hazard
        # If not provided, use default approximate values for coronary heart disease (10-year)
        # Coefficients order: [age, total_cholesterol, hdl_cholesterol, systolic_bp, treated_bp, smoker, diabetes]
        # This is a simplified placeholder; use validated coefficients in production.
        self.coefficients = framingham_coefficients or {
            "age": 0.063,
            "total_cholesterol": 0.013,
            "hdl_cholesterol": -0.014,
            "systolic_bp_treated": 0.021,
            "systolic_bp_untreated": 0.017,
            "smoker": 0.65,
            "diabetes": 0.68,
            "intercept": -5.4
        }
        self.baseline_survival_10yr = 0.88936  # 10-year survival from coronary event without risk factors
        self.confidence_level = 0.95

    def calculateRisk(self, blockage_data, patient_data):
        """
        Calculate coronary event risk incorporating blockage analysis and patient demographics.

        Parameters:
            blockage_data: list of dicts, each representing a blockage with keys:
                - 'severity': int or float (0-100, percentage stenosis)
                - 'location': str (e.g. 'LAD', 'LCX', 'RCA', 'LM')
                - 'length_mm': float, length of blockage
            patient_data: dict with keys:
                - 'age': int, years
                - 'total_cholesterol': float, mg/dL
                - 'hdl_cholesterol': float, mg/dL
                - 'systolic_bp': float, mmHg
                - 'bp_treated': bool
                - 'smoker': bool
                - 'diabetes': bool
                - 'history_mi': bool (prior myocardial infarction)

        Returns:
            dict with keys:
                - '10yr_risk_estimate': float, estimated 10-year coronary event risk (0-1)
                - 'ci_lower': float, lower bound of confidence interval
                - 'ci_upper': float, upper bound of confidence interval
                - 'time_to_event_probability': function(time_years) -> probability of event by time
                - 'model_details': dict with intermediate calculations
        """

        # Step 1: Compute blockage risk score with weighting by severity and lesion location priority
        location_weights = {
            'LM': 3.5,   # Left Main
            'LAD': 3.0,  # Left Anterior Descending
            'LCX': 2.5,  # Left Circumflex
            'RCA': 2.0,  # Right Coronary Artery
        }
        total_blockage_score = 0.0
        for lesion in blockage_data:
            sev = np.clip(lesion.get('severity', 0), 0, 100) / 100  # as fraction
            loc = lesion.get('location', '').upper()
            length = lesion.get('length_mm', 5.0)
            weight = location_weights.get(loc, 1.0)
            # Severity weighted by length and location importance, squared to emphasize severe lesions
            lesion_score = weight * (sev ** 2) * (length / 10)
            total_blockage_score += lesion_score

        # Normalize blockage score to [0,1] scale based on expected max (e.g. 10)
        blockage_risk_component = np.tanh(total_blockage_score / 4)  # saturates at ~1

        # Step 2: Clinical risk score from Framingham-like model (log odds)
        age = patient_data.get('age', 50)
        tc = patient_data.get('total_cholesterol', 200)
        hdl = patient_data.get('hdl_cholesterol', 50)
        sbp = patient_data.get('systolic_bp', 120)
        bp_treated = patient_data.get('bp_treated', False)
        smoker = patient_data.get('smoker', False)
        diabetes = patient_data.get('diabetes', False)
        history_mi = patient_data.get('history_mi', False)

        # Using simplified linear predictor
        lp = (
            self.coefficients['age'] * age +
            self.coefficients['total_cholesterol'] * tc +
            self.coefficients['hdl_cholesterol'] * hdl +
            (self.coefficients['systolic_bp_treated'] if bp_treated else self.coefficients['systolic_bp_untreated']) * sbp +
            self.coefficients['smoker'] * int(smoker) +
            self.coefficients['diabetes'] * int(diabetes) +
            self.coefficients['intercept']
        )

        # Step 3: Combine clinical risk and blockage risk multiplicatively for overall hazard ratio
        blockage_hazard_ratio = 1 + 2 * blockage_risk_component  # blockages can increase risk 1x-3x
        clinical_hazard_ratio = np.exp(lp)

        # Adjust for prior MI history (strong risk factor)
        history_hr = 2.5 if history_mi else 1.0

        combined_hazard_ratio = clinical_hazard_ratio * blockage_hazard_ratio * history_hr

        # Step 4: Calculate 10-year risk estimate using baseline survival function of Framingham model
        risk_10yr = 1 - self.baseline_survival_10yr ** combined_hazard_ratio
        risk_10yr = np.clip(risk_10yr, 0, 1)

        # Step 5: Estimate confidence interval using normal approximation on log hazard ratio
        # Variance approximated; in real models use model variance-covariance matrix.
        # Here assume fixed std dev for demonstration (could be dynamic)
        log_hr = np.log(combined_hazard_ratio)
        std_log_hr = 0.3  # assumed standard error
        z = norm.ppf(1 - (1 - self.confidence_level) / 2)
        lower_hr = np.exp(log_hr - z * std_log_hr)
        upper_hr = np.exp(log_hr + z * std_log_hr)
        ci_lower = 1 - self.baseline_survival_10yr ** upper_hr
        ci_upper = 1 - self.baseline_survival_10yr ** lower_hr
        ci_lower, ci_upper = np.clip([ci_lower, ci_upper], 0, 1)

        # Step 6: Time-to-event probability function using exponential hazard assumption
        # Simplified: hazard assumed constant over 10 years derived from 10yr risk
        # S(t) = exp(-hazard * t), risk(t) = 1 - S(t)
        hazard_10yr = -np.log(self.baseline_survival_10yr) * combined_hazard_ratio

        def time_to_event_probability(t_years):
            t = np.atleast_1d(t_years)
            survival = np.exp(-hazard_10yr * t)
            return np.clip(1 - survival, 0, 1)

        # Performance optimization note:
        # Only numpy vectorization used for internal math. For larger data sets,
        # consider numba or cython. Here data is small per-patient so Python overhead minimal.

        model_details = {
            "total_blockage_score": total_blockage_score,
            "blockage_risk_component": blockage_risk_component,
            "clinical_linear_predictor": lp,
            "blockage_hazard_ratio": blockage_hazard_ratio,
            "clinical_hazard_ratio": clinical_hazard_ratio,
            "history_hazard_ratio": history_hr,
            "combined_hazard_ratio": combined_hazard_ratio,
            "10_year_risk": risk_10yr,
            "confidence_interval": (ci_lower, ci_upper),
            "baseline_survival_10yr": self.baseline_survival_10yr,
        }

        return {
            "10yr_risk_estimate": risk_10yr,
            "ci_lower": ci_lower,
            "ci_upper": ci_upper,
            "time_to_event_probability": time_to_event_probability,
            "model_details": model_details
        }

    def validate(self, test_cases):
        """
        Validates the calculator against test cases.

        Parameters:
            test_cases: list of dicts with keys:
                - 'blockage_data': list of blockage dicts
                - 'patient_data': dict of patient demographics
                - 'expected_risk_range': tuple(min_risk, max_risk)

        Returns:
            results: list of dict { 'passed': bool, 'predicted_risk': float, 'expected_range': tuple }
        """
        results = []
        for case in test_cases:
            result = self.calculateRisk(case['blockage_data'], case['patient_data'])
            risk = result['10yr_risk_estimate']
            min_risk, max_risk = case.get('expected_risk_range', (0, 1))
            passed = min_risk <= risk <= max_risk
            results.append({
                'passed': passed,
                'predicted_risk': risk,
                'expected_range': (min_risk, max_risk),
                'ci_lower': result['ci_lower'],
                'ci_upper': result['ci_upper']
            })
        return results
```