```python
import logging
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import pandas as pd
from datetime import datetime


class ConsistencyChecker:
    """
    ConsistencyChecker performs various validation checks on algorithm outputs related to risk calculations.
    Supports:
     - consistency across repeated calculations
     - temporal consistency for the same patient
     - boundary condition validation
     - sensitivity analysis
     - comparison with clinical expectations
     - outlier detection
     - audit trail generation

    Supports test requirement: KXREC62FXYG82VN92RRP8NM4Z7AH5N2
    """

    def __init__(self, clinical_expectations: Optional[Dict[str, Tuple[float, float]]] = None):
        """
        :param clinical_expectations: dict mapping metric names to (min_expected, max_expected) clinical ranges
        """
        self.clinical_expectations = clinical_expectations or {}
        self.audit_trail: List[Dict[str, Any]] = []
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.DEBUG)

    def check_repeated_calculations(self, repeated_outputs: List[Dict[str, Any]], tolerance: float = 1e-6) -> bool:
        """
        Check consistency across repeated algorithm outputs for the same input.

        :param repeated_outputs: List of algorithm output dicts for the same input.
        :param tolerance: maximum allowed difference for numeric values.
        :return: True if consistent, False otherwise.
        """
        self.logger.debug("Checking repeated calculations consistency across %d outputs.", len(repeated_outputs))
        if not repeated_outputs or len(repeated_outputs) < 2:
            self._log_audit("repeated_calculations", "Insufficient repeated outputs for consistency check.")
            return False

        keys = set(repeated_outputs[0].keys())
        for output in repeated_outputs[1:]:
            keys.intersection_update(output.keys())
        if not keys:
            self._log_audit("repeated_calculations", "No common keys found among repeated outputs.")
            return False

        consistent = True
        for key in keys:
            values = [out[key] for out in repeated_outputs]
            if all(isinstance(v, (int, float)) for v in values):
                arr = np.array(values, dtype=float)
                max_diff = np.max(arr) - np.min(arr)
                if max_diff > tolerance:
                    consistent = False
                    self._log_audit(
                        "repeated_calculations",
                        f"Inconsistent values for key '{key}': max difference {max_diff} exceeds tolerance {tolerance}.",
                        details={"values": values, "tolerance": tolerance}
                    )
            else:
                if len(set(values)) > 1:
                    consistent = False
                    self._log_audit(
                        "repeated_calculations",
                        f"Inconsistent categorical/string values for key '{key}': found {set(values)}.",
                        details={"values": values}
                    )
        if consistent:
            self._log_audit("repeated_calculations", "Repeated calculations consistent within tolerance.")
        return consistent

    def check_temporal_consistency(
            self,
            patient_id: str,
            outputs_time_sorted: List[Dict[str, Any]],
            timestamp_key: str = "timestamp",
            critical_keys: Optional[List[str]] = None,
            max_variation: float = 0.2
    ) -> bool:
        """
        Check temporal consistency on algorithm outputs of the same patient over time.

        :param patient_id: Identifier for the patient.
        :param outputs_time_sorted: List of algorithm output dicts sorted by timestamp ascending.
        :param timestamp_key: key in output dict containing timestamp (datetime or ISO string).
        :param critical_keys: keys of values to check temporal consistency for.
        :param max_variation: max allowed relative difference between consecutive values.
        :return: True if temporal consistency holds, False otherwise.
        """
        self.logger.debug("Checking temporal consistency for patient %s with %d timepoints.", patient_id, len(outputs_time_sorted))
        if len(outputs_time_sorted) < 2 or not critical_keys:
            self._log_audit("temporal_consistency", "Insufficient data points or critical keys missing.", patient=patient_id)
            return False

        consistent = True
        for key in critical_keys:
            prev_val = None
            prev_time = None
            for output in outputs_time_sorted:
                ts = output.get(timestamp_key)
                if isinstance(ts, str):
                    try:
                        ts = datetime.fromisoformat(ts)
                    except Exception:
                        self._log_audit("temporal_consistency", f"Invalid timestamp format: {ts}", patient=patient_id)
                        return False

                val = output.get(key)
                if val is None or not isinstance(val, (int, float)):
                    self._log_audit(
                        "temporal_consistency",
                        f"Missing or non-numeric value for key '{key}' at time {ts}",
                        patient=patient_id
                    )
                    return False
                if prev_val is not None:
                    rel_diff = abs(val - prev_val) / (abs(prev_val) + 1e-12)
                    if rel_diff > max_variation:
                        consistent = False
                        self._log_audit(
                            "temporal_consistency",
                            f"Temporal inconsistency for key '{key}': value changed from {prev_val} at {prev_time} to {val} at {ts} (relative difference {rel_diff:.3f} exceeds {max_variation}).",
                            patient=patient_id
                        )
                prev_val, prev_time = val, ts
        if consistent:
            self._log_audit("temporal_consistency", "Temporal consistency validated for patient.", patient=patient_id)
        return consistent

    def check_boundary_conditions(
            self,
            output: Dict[str, Any],
            boundaries: Dict[str, Tuple[Optional[float], Optional[float]]]
    ) -> bool:
        """
        Validate if output numeric values fall within specified boundary conditions.

        :param output: Algorithm output dict.
        :param boundaries: dict mapping key to (min_value, max_value), None for no bound.
        :return: True if all values fall within boundaries, False if any violation.
        """
        self.logger.debug("Checking boundary conditions for keys: %s", ','.join(boundaries.keys()))
        valid = True
        for key, (min_val, max_val) in boundaries.items():
            value = output.get(key)
            if value is None:
                self._log_audit("boundary_conditions", f"Missing value for key '{key}'.", details=output)
                valid = False
                continue
            if not isinstance(value, (int, float)):
                self._log_audit("boundary_conditions", f"Non-numeric value for key '{key}': {value}", details=output)
                valid = False
                continue
            if (min_val is not None and value < min_val) or (max_val is not None and value > max_val):
                self._log_audit(
                    "boundary_conditions",
                    f"Value {value} for key '{key}' out of bounds [{min_val}, {max_val}].",
                    details=output
                )
                valid = False
        if valid:
            self._log_audit("boundary_conditions", "Output within all boundary conditions.")
        return valid

    def perform_sensitivity_analysis(
            self,
            baseline_input: Dict[str, Any],
            perturbations: Dict[str, List[Any]],
            algorithm_func,
            output_key: str,
            sensitivity_threshold: float = 0.05
    ) -> Dict[str, bool]:
        """
        Perform sensitivity analysis by perturbing input parameters and measuring output changes.

        :param baseline_input: Baseline input dict to the algorithm.
        :param perturbations: Dict of parameter to list of perturbations to apply.
        :param algorithm_func: callable that takes input dict and returns output dict.
        :param output_key: key in output dict to analyze sensitivity for.
        :param sensitivity_threshold: minimum relative output change considered sensitive.
        :return: Dict of parameter to boolean indicating if output is sensitive to parameter.
        """
        self.logger.debug("Performing sensitivity analysis on output key '%s'.", output_key)
        results = {}
        baseline_output = algorithm_func(baseline_input)
        baseline_val = baseline_output.get(output_key)
        if baseline_val is None or not isinstance(baseline_val, (int, float)):
            self._log_audit(
                "sensitivity_analysis",
                f"Baseline output missing or non-numeric for key '{output_key}': {baseline_val}"
            )
            return {}

        for param, values in perturbations.items():
            sensitive = False
            for pert_val in values:
                perturbed_input = baseline_input.copy()
                perturbed_input[param] = pert_val
                try:
                    pert_output = algorithm_func(perturbed_input)
                    pert_val_out = pert_output.get(output_key)
                except Exception as e:
                    self._log_audit(
                        "sensitivity_analysis",
                        f"Algorithm function error with perturbed input param '{param}'={pert_val}: {e}",
                        details={"param": param, "value": pert_val}
                    )
                    continue
                if pert_val_out is None or not isinstance(pert_val_out, (int, float)):
                    self._log_audit(
                        "sensitivity_analysis",
                        f"Perturbed output missing or non-numeric for key '{output_key}' with {param}={pert_val}: {pert_val_out}",
                        details={"param": param, "value": pert_val}
                    )
                    continue
                rel_change = abs(pert_val_out - baseline_val) / (abs(baseline_val) + 1e-12)
                if rel_change >= sensitivity_threshold:
                    sensitive = True
                    break
            results[param] = sensitive
            self._log_audit(
                "sensitivity_analysis",
                f"Sensitivity for parameter '{param}': {'sensitive' if sensitive else 'not sensitive'}.",
                details={"threshold": sensitivity_threshold}
            )
        return results

    def compare_with_clinical_expectations(
            self,
            output: Dict[str, Any]
    ) -> bool:
        """
        Compare algorithm output values with clinical expected ranges.

        :param output: algorithm output dict.
        :return: True if all values fall within clinical expectations, False otherwise.
        """
        self.logger.debug("Comparing output with clinical expectations for keys: %s", self.clinical_expectations.keys())
        if not self.clinical_expectations:
            self._log_audit("clinical_expectations", "No clinical expectations provided.")
            return False

        meets_expectations = True
        for key, (min_exp, max_exp) in self.clinical_expectations.items():
            value = output.get(key)
            if value is None or not isinstance(value, (int, float)):
                self._log_audit(
                    "clinical_expectations",
                    f"Missing or non-numeric output value for key '{key}': {value}",
                    details=output
                )
                meets_expectations = False
                continue
            if not (min_exp <= value <= max_exp):
                self._log_audit(
                    "clinical_expectations",
                    f"Output value {value} for key '{key}' outside clinical expected range [{min_exp}, {max_exp}].",
                    details=output
                )
                meets_expectations = False
        if meets_expectations:
            self._log_audit("clinical_expectations", "Output meets all clinical expectations.")
        return meets_expectations

    def detect_outliers(
            self,
            outputs: List[Dict[str, Any]],
            key: str,
            zscore_threshold: float = 3.0
    ) -> List[int]:
        """
        Detect outliers based on z-score for a specific numeric key in outputs.

        :param outputs: List of algorithm output dicts.
        :param key: key in output dict to check for outliers.
        :param zscore_threshold: z-score above which an output is considered an outlier.
        :return: List of indices corresponding to outlier outputs.
        """
        self.logger.debug("Detecting outliers for key '%s' in %d outputs.", key, len(outputs))
        values = []
        for idx, output in enumerate(outputs):
            val = output.get(key)
            if isinstance(val, (int, float)):
                values.append(val)
            else:
                self._log_audit(
                    "outlier_detection",
                    f"Non-numeric or missing value for key '{key}' at index {idx}: {val}",
                    details={"index": idx}
                )
                values.append(np.nan)
        vals_array = np.array(values, dtype=np.float64)
        mask = ~np.isnan(vals_array)
        clean_vals = vals_array[mask]
        if len(clean_vals) < 2:
            self._log_audit("outlier_detection", "Insufficient numeric data for outlier detection.")
            return []

        mean = np.mean(clean_vals)
        std = np.std(clean_vals)
        if std == 0:
            self._log_audit("outlier_detection", "Standard deviation zero, no outliers possible.")
            return []

        outlier_indices = []
        for idx, val in enumerate(vals_array):
            if np.isnan(val):
                continue
            zscore = abs((val - mean) / std)
            if zscore > zscore_threshold:
                outlier_indices.append(idx)
                self._log_audit(
                    "outlier_detection",
                    f"Outlier detected at index {idx} for key '{key}': value={val}, z-score={zscore:.2f} exceeds threshold {zscore_threshold}.",
                    details={"value": val, "zscore": zscore}
                )
        if not outlier_indices:
            self._log_audit("outlier_detection", "No outliers detected.")
        return outlier_indices

    def generate_audit_trail(self) -> List[Dict[str, Any]]:
        """
        Return audit trail records collected during validations.

        :return: List of audit entries.
        """
        return self.audit_trail

    def _log_audit(self, check_type: str, message: str, patient: Optional[str] = None, details: Optional[Dict] = None):
        entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "check_type": check_type,
            "message": message
        }
        if patient:
            entry["patient_id"] = patient
        if details:
            entry["details"] = details
        self.audit_trail.append(entry)
        self.logger.debug("Audit log - %s: %s", check_type, message)
```