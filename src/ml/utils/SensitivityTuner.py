```python
import numpy as np
from sklearn.metrics import roc_curve, auc, precision_recall_curve, confusion_matrix
from sklearn.calibration import CalibratedClassifierCV
from sklearn.base import BaseEstimator, ClassifierMixin
from typing import Optional, Dict, Any, Tuple


class SensitivityTuner:
    def __init__(
        self,
        classifier: BaseEstimator,
        calibration_method: Optional[str] = None,
        clinical_scenarios: Optional[Dict[str, Dict[str, Any]]] = None,
    ):
        """
        Utility for tuning detection sensitivity with adjustable parameters and clinical validation support.

        Parameters
        ----------
        classifier : BaseEstimator
            A scikit-learn compatible classifier (should support predict_proba).
        calibration_method : Optional[str]
            Calibration method name ('sigmoid', 'isotonic', or None).
        clinical_scenarios : Optional[dict]
            Dictionary defining config parameters for different clinical scenarios.
            Example:
            {
                'cardiology': {'threshold': 0.4, 'recall_weight': 0.7},
                'neurology': {'threshold': 0.5, 'recall_weight': 0.5}
            }
        """
        self.classifier = classifier
        self.calibration_method = calibration_method
        self.clinical_scenarios = clinical_scenarios or {}

        self.calibrated_classifier = None
        self.current_threshold = 0.5
        self.current_recall_weight = 0.5

    def calibrate(
        self,
        X_calib: np.ndarray,
        y_calib: np.ndarray,
        method: Optional[str] = None,
        cv: int = 3,
    ):
        """
        Calibrate classifier probabilities for better probability estimates.

        Parameters
        ----------
        X_calib : ndarray, shape (n_samples, n_features)
            Calibration feature matrix.
        y_calib : ndarray, shape (n_samples,)
            Calibration labels.
        method : Optional[str]
            Calibration method ('sigmoid', 'isotonic'), fallback to instance method if None.
        cv : int
            Number of folds for cross-validation calibration.
        """
        method = method or self.calibration_method
        if method not in ('sigmoid', 'isotonic', None):
            raise ValueError("Calibration method must be one of: 'sigmoid', 'isotonic', None")

        if method is None:
            self.calibrated_classifier = self.classifier
            return self

        calibrated = CalibratedClassifierCV(self.classifier, method=method, cv=cv)
        calibrated.fit(X_calib, y_calib)
        self.calibrated_classifier = calibrated
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Predict calibrated probabilities if calibrated, or raw probabilities otherwise.

        Parameters
        ----------
        X : ndarray, shape (n_samples, n_features)

        Returns
        -------
        ndarray, shape (n_samples, 2)
            Probability estimates for classes [negative, positive].
        """
        clf = self.calibrated_classifier or self.classifier
        return clf.predict_proba(X)

    def optimize_threshold(
        self,
        X_val: np.ndarray,
        y_val: np.ndarray,
        recall_weight: float = 0.5,
        thresholds: Optional[np.ndarray] = None,
    ) -> Tuple[float, Dict[str, float]]:
        """
        Optimize detection threshold balancing sensitivity (recall) and precision.

        Parameters
        ----------
        X_val : ndarray
            Validation features.
        y_val : ndarray
            Validation labels.
        recall_weight : float
            Weight for recall in weighted harmonic mean optimization (0 <= recall_weight <= 1).
        thresholds : Optional[np.ndarray]
            Candidate thresholds to evaluate. If None, generated automatically.

        Returns
        -------
        best_threshold : float
            Threshold achieving best weighted harmonic mean of recall and precision.
        metrics : dict
            Metrics at best threshold: {'precision', 'recall', 'fpr', 'tnr', 'accuracy'}
        """
        assert 0 <= recall_weight <= 1, "recall_weight must be between 0 and 1"

        proba = self.predict_proba(X_val)[:, 1]
        if thresholds is None:
            thresholds = np.linspace(0, 1, 101)

        best_score = -np.inf
        best_threshold = 0.5
        best_metrics = {}

        for thr in thresholds:
            pred = (proba >= thr).astype(int)
            tn, fp, fn, tp = confusion_matrix(y_val, pred).ravel()
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
            tnr = tn / (tn + fp) if (tn + fp) > 0 else 0
            accuracy = (tp + tn) / (tp + tn + fp + fn)

            # Weighted harmonic mean emphasizing recall or precision
            if recall + precision == 0:
                whm = 0
            else:
                whm = 1 / (
                    recall_weight / recall + (1 - recall_weight) / precision
                )

            if whm > best_score:
                best_score = whm
                best_threshold = thr
                best_metrics = {
                    'precision': precision,
                    'recall': recall,
                    'fpr': fpr,
                    'tnr': tnr,
                    'accuracy': accuracy,
                    'weighted_harmonic_mean': whm,
                }

        self.current_threshold = best_threshold
        self.current_recall_weight = recall_weight
        return best_threshold, best_metrics

    def compute_roc_auc(
        self,
        X: np.ndarray,
        y_true: np.ndarray,
    ) -> Dict[str, Any]:
        """
        Calculate ROC curve points and AUC.

        Parameters
        ----------
        X : ndarray
            Feature matrix.
        y_true : ndarray
            True binary labels.

        Returns
        -------
        dict
            {
                'fpr': ndarray,
                'tpr': ndarray,
                'thresholds': ndarray,
                'auc': float
            }
        """
        proba = self.predict_proba(X)[:, 1]
        fpr, tpr, thresholds = roc_curve(y_true, proba)
        roc_auc = auc(fpr, tpr)
        return {'fpr': fpr, 'tpr': tpr, 'thresholds': thresholds, 'auc': roc_auc}

    def compute_precision_recall_curve(
        self,
        X: np.ndarray,
        y_true: np.ndarray,
    ) -> Dict[str, Any]:
        """
        Calculate precision-recall curve points.

        Parameters
        ----------
        X : ndarray
            Feature matrix.
        y_true : ndarray
            True binary labels.

        Returns
        -------
        dict
            {
                'precision': ndarray,
                'recall': ndarray,
                'thresholds': ndarray
            }
        """
        proba = self.predict_proba(X)[:, 1]
        precision, recall, thresholds = precision_recall_curve(y_true, proba)
        return {'precision': precision, 'recall': recall, 'thresholds': thresholds}

    def apply_clinical_scenario(
        self,
        scenario_name: str,
    ) -> None:
        """
        Apply predefined clinical scenario configuration.

        Parameters
        ----------
        scenario_name : str
            The clinical scenario key.

        Raises
        ------
        KeyError if scenario not found.
        """
        config = self.clinical_scenarios.get(scenario_name)
        if config is None:
            raise KeyError(f"Clinical scenario '{scenario_name}' not found.")

        threshold = config.get('threshold')
        recall_weight = config.get('recall_weight')

        if threshold is not None:
            self.current_threshold = threshold

        if recall_weight is not None:
            assert 0 <= recall_weight <= 1, "recall_weight must be between 0 and 1"
            self.current_recall_weight = recall_weight

    def predict(
        self,
        X: np.ndarray,
        threshold: Optional[float] = None,
    ) -> np.ndarray:
        """
        Predict binary labels using tuned threshold.

        Parameters
        ----------
        X : ndarray
            Features.
        threshold : Optional[float]
            Threshold to apply. If None, uses current tuned threshold.

        Returns
        -------
        ndarray
            Binary predictions.
        """
        thr = threshold if threshold is not None else self.current_threshold
        proba = self.predict_proba(X)[:, 1]
        return (proba >= thr).astype(int)

    def evaluate_performance(
        self,
        X: np.ndarray,
        y_true: np.ndarray,
        threshold: Optional[float] = None,
    ) -> Dict[str, float]:
        """
        Calculate performance metrics at given threshold.

        Parameters
        ----------
        X : ndarray
            Features.
        y_true : ndarray
            True labels.
        threshold : Optional[float]
            Threshold for classification.

        Returns
        -------
        dict
            Dictionary with precision, recall, f1, accuracy, specificity, npv.
        """
        y_pred = self.predict(X, threshold)
        tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        specificity = tn / (tn + fp) if (tn + fp) > 0 else 0
        npv = tn / (tn + fn) if (tn + fn) > 0 else 0
        accuracy = (tp + tn) / (tp + tn + fp + fn)
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0
        )

        return {
            'precision': precision,
            'recall (sensitivity)': recall,
            'specificity': specificity,
            'negative_predictive_value': npv,
            'accuracy': accuracy,
            'f1_score': f1,
        }

    def clinical_validation_workflow(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray,
        y_val: np.ndarray,
        X_calib: Optional[np.ndarray] = None,
        y_calib: Optional[np.ndarray] = None,
        scenario: Optional[str] = None,
        recall_weight: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Execute full clinical validation workflow:
        1) Calibrate model (optional)
        2) Apply scenario config (optional)
        3) Optimize threshold on validation set balancing recall/precision trade-off
        4) Compute ROC and PR curves
        5) Report performance metrics at optimized threshold

        Parameters
        ----------
        X_train, y_train : ndarray
            Training data to fit model if not already fitted.
        X_val, y_val : ndarray
            Validation data for threshold optimization and evaluation.
        X_calib, y_calib : Optional[ndarray]
            Calibration data.
        scenario : Optional[str]
            Clinical scenario to apply.
        recall_weight : float
            Weight for recall during threshold optimization.

        Returns
        -------
        dict
            Dictionary including threshold, metrics, ROC/PR curve data.
        """
        # Fit classifier if not fitted
        if not hasattr(self.classifier, "predict_proba") or not hasattr(self.classifier, "fit"):
            raise RuntimeError(
                "Provided classifier must implement fit and predict_proba methods."
            )

        try:
            # Check if fitted
            getattr(self.classifier, "classes_")
        except AttributeError:
            self.classifier.fit(X_train, y_train)

        # Calibrate if data provided
        if X_calib is not None and y_calib is not None and self.calibration_method:
            self.calibrate(X_calib, y_calib)

        # Apply clinical scenario config if provided
        if scenario is not None:
            self.apply_clinical_scenario(scenario)

        # Optimize threshold
        best_thr, metrics = self.optimize_threshold(
            X_val, y_val, recall_weight=recall_weight
        )

        roc = self.compute_roc_auc(X_val, y_val)
        pr = self.compute_precision_recall_curve(X_val, y_val)
        performance = self.evaluate_performance(X_val, y_val, threshold=best_thr)

        return dict(
            optimized_threshold=best_thr,
            optimization_metrics=metrics,
            roc_curve=roc,
            precision_recall_curve=pr,
            performance=performance,
        )
```