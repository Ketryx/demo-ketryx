```python
import numpy as np
from scipy import stats
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional


class RiskCalculator:
    def __init__(self):
        self.history: List[Dict[str, Any]] = []

    def validate_inputs(self, factors: Dict[str, Any]) -> None:
        if not isinstance(factors, dict) or not factors:
            raise ValueError("Input factors must be a non-empty dictionary.")
        for k, v in factors.items():
            if not isinstance(v, (int, float, np.number)):
                raise TypeError(f"Factor '{k}' must be numeric.")
            if np.isnan(v) or np.isinf(v):
                raise ValueError(f"Factor '{k}' cannot be NaN or infinite.")

    def multi_factor_risk_score(self, factors: Dict[str, float], weights: Optional[Dict[str, float]] = None) -> float:
        self.validate_inputs(factors)
        keys = factors.keys()
        values = np.array([factors[k] for k in keys], dtype=np.float64)
        if weights:
            if set(weights.keys()) != set(keys):
                raise ValueError("Weights keys must exactly match factors keys.")
            w = np.array([weights[k] for k in keys], dtype=np.float64)
            score = np.dot(values, w)
            total_weight = np.sum(w)
            if total_weight <= 0:
                raise ValueError("Sum of weights must be positive.")
            score /= total_weight
        else:
            score = np.mean(values)
        return max(0.0, score)

    def calculate_confidence_interval(self, scores: List[float], confidence: float = 0.95) -> Tuple[float, float]:
        if len(scores) < 2:
            raise ValueError("At least two scores are needed to compute a confidence interval.")
        scores_array = np.array(scores, dtype=np.float64)
        mean = np.mean(scores_array)
        sem = stats.sem(scores_array)
        margin = sem * stats.t.ppf((1 + confidence) / 2., len(scores_array) - 1)
        return mean - margin, mean + margin

    def risk_category(self, score: float) -> str:
        if score < 0.2:
            return "Very Low"
        elif score < 0.4:
            return "Low"
        elif score < 0.6:
            return "Moderate"
        elif score < 0.8:
            return "High"
        else:
            return "Very High"

    def statistical_analysis(self, data: List[float]) -> Dict[str, float]:
        arr = np.array(data, dtype=np.float64)
        return {
            "mean": np.mean(arr),
            "median": np.median(arr),
            "variance": np.var(arr, ddof=1),
            "stddev": np.std(arr, ddof=1),
            "min": np.min(arr),
            "max": np.max(arr),
            "count": len(arr)
        }

    def calculate_risk(self, factors: Dict[str, float], weights: Optional[Dict[str, float]] = None,
                       sample_scores: Optional[List[float]] = None,
                       confidence: float = 0.95) -> Dict[str, Any]:
        score = self.multi_factor_risk_score(factors, weights)
        category = self.risk_category(score)
        ci: Optional[Tuple[float, float]] = None
        if sample_scores:
            ci = self.calculate_confidence_interval(sample_scores, confidence)
        result = {
            "score": score,
            "category": category,
            "confidence_interval": ci,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "input_factors": factors.copy(),
            "weights": weights.copy() if weights else None
        }
        self.history.append(result)
        return result

    def get_history(self) -> List[Dict[str, Any]]:
        return self.history.copy()

    def clear_history(self) -> None:
        self.history.clear()
```