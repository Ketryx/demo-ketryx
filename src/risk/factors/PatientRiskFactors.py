```python
import pandas as pd
import numpy as np


class PatientRiskFactors:
    DEMOGRAPHIC_COLS = ['age', 'sex', 'ethnicity']
    CLINICAL_HISTORY_COLS = ['diabetes', 'hypertension', 'smoking']
    LAB_VALUES_COLS = ['total_cholesterol', 'hdl_cholesterol', 'ldl_cholesterol', 'triglycerides', 'hba1c']
    FAMILY_HISTORY_COLS = ['family_history_coronary_disease']
    PRIOR_EVENTS_COLS = ['prior_mi', 'prior_angina', 'prior_revascularization']
    MEDICATION_COLS = ['statins', 'antihypertensives', 'antiplatelets', 'diabetes_medications']

    RISK_WEIGHTS = {
        'age': lambda age: 0 if age < 40 else (1 if age < 60 else 2),
        'sex': {'male': 1, 'female': 0},
        'ethnicity': {'Caucasian': 0, 'African American': 1, 'Hispanic': 0.5, 'Asian': 0.5, 'Other': 0.5},
        'diabetes': {True: 2, False: 0},
        'hypertension': {True: 1.5, False: 0},
        'smoking': {True: 2, False: 0},
        'total_cholesterol': lambda val: 0 if val < 200 else (1 if val < 240 else 2),
        'hdl_cholesterol': lambda val: 2 if val < 40 else (1 if val < 60 else 0),
        'ldl_cholesterol': lambda val: 0 if val < 100 else (1 if val < 160 else 2),
        'triglycerides': lambda val: 0 if val < 150 else 1,
        'hba1c': lambda val: 0 if val < 5.7 else (1 if val < 6.5 else 2),
        'family_history_coronary_disease': {True: 1.5, False: 0},
        'prior_mi': {True: 3, False: 0},
        'prior_angina': {True: 2, False: 0},
        'prior_revascularization': {True: 2, False: 0},
        'statins': {True: -1, False: 0},
        'antihypertensives': {True: -0.5, False: 0},
        'antiplatelets': {True: -0.5, False: 0},
        'diabetes_medications': {True: -1, False: 0},
    }

    def __init__(self, patient_data: pd.DataFrame):
        self.patient_data = patient_data.copy()
        self._impute_missing()
        self._validate_columns()
        self.scores = None
        self.trends = None

    def _validate_columns(self):
        expected_cols = (self.DEMOGRAPHIC_COLS + self.CLINICAL_HISTORY_COLS +
                         self.LAB_VALUES_COLS + self.FAMILY_HISTORY_COLS +
                         self.PRIOR_EVENTS_COLS + self.MEDICATION_COLS)
        missing = [c for c in expected_cols if c not in self.patient_data.columns]
        if missing:
            raise ValueError(f'Missing required columns: {missing}')

    def _impute_missing(self):
        # Demographic: age - median; sex/ethnicity - mode
        if 'age' in self.patient_data:
            self.patient_data['age'] = self.patient_data['age'].fillna(self.patient_data['age'].median())
        for col in ['sex', 'ethnicity']:
            if col in self.patient_data:
                mode = self.patient_data[col].mode()
                if not mode.empty:
                    self.patient_data[col] = self.patient_data[col].fillna(mode[0])
                else:
                    self.patient_data[col] = self.patient_data[col].fillna('Unknown')

        # Clinical history: fill NA with False (assume absent)
        for col in self.CLINICAL_HISTORY_COLS + self.FAMILY_HISTORY_COLS + self.PRIOR_EVENTS_COLS + self.MEDICATION_COLS:
            if col in self.patient_data:
                self.patient_data[col] = self.patient_data[col].fillna(False)

        # Lab values: fill NA with median of each lab
        for col in self.LAB_VALUES_COLS:
            if col in self.patient_data:
                median_val = self.patient_data[col].median()
                self.patient_data[col] = self.patient_data[col].fillna(median_val)

    def _score_individual_factor(self, col, val):
        weights = self.RISK_WEIGHTS.get(col)
        if callable(weights):
            try:
                return float(weights(val))
            except Exception:
                return 0.0
        elif isinstance(weights, dict):
            return float(weights.get(val, 0))
        return 0.0

    def calculate_risk_scores(self):
        scores = []
        for _, row in self.patient_data.iterrows():
            score = 0
            for col in self.RISK_WEIGHTS.keys():
                if col not in row:
                    continue
                score += self._score_individual_factor(col, row[col])
            scores.append(score)
        self.scores = pd.Series(scores, index=self.patient_data.index, name='risk_score')
        return self.scores

    def risk_factor_trends(self, history_data: pd.DataFrame, patient_id_col='patient_id', date_col='date'):
        """
        Analyze risk factor temporal trends for each patient.
        history_data: must contain patient_id_col, date_col, and risk factor columns
        Returns a dict of DataFrames keyed by patient_id with trend summaries
        """
        trends = {}
        factors = (self.DEMOGRAPHIC_COLS + self.CLINICAL_HISTORY_COLS +
                   self.LAB_VALUES_COLS + self.FAMILY_HISTORY_COLS +
                   self.PRIOR_EVENTS_COLS + self.MEDICATION_COLS)
        history_data = history_data.copy()
        history_data[date_col] = pd.to_datetime(history_data[date_col])

        grouped = history_data.groupby(patient_id_col)
        for pid, group in grouped:
            group = group.sort_values(date_col)
            trend_summary = {}
            for factor in factors:
                if factor not in group.columns:
                    continue
                vals = group[factor]

                if pd.api.types.is_numeric_dtype(vals):
                    # Compute slope of linear fit vs time (in days)
                    x = (group[date_col] - group[date_col].min()).dt.days.values
                    y = vals.values
                    if len(x) < 2 or np.all(np.isnan(y)):
                        trend = np.nan
                    else:
                        mask = ~np.isnan(y)
                        if mask.sum() < 2:
                            trend = np.nan
                        else:
                            coef = np.polyfit(x[mask], y[mask], 1)
                            trend = coef[0]  # slope
                    trend_summary[factor + '_trend'] = trend
                else:
                    # For categorical/binary factors, track proportion change
                    freq = vals.value_counts(normalize=True)
                    trend_summary[factor + '_trend'] = freq.get(True, 0) - freq.get(False, 0)
            trends[pid] = pd.Series(trend_summary)
        self.trends = trends
        return trends
```