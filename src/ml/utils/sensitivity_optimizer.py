```python
import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import (
    precision_recall_curve,
    roc_curve,
    auc,
    confusion_matrix,
    precision_score,
    recall_score,
    f1_score,
)
from time import time


class SensitivityOptimizer:
    def __init__(self, y_true, y_scores):
        """
        Initialize with ground truth labels and model probability scores.

        Args:
            y_true (np.ndarray): Binary ground truth labels (0 or 1).
            y_scores (np.ndarray): Model output probabilities or scores.
        """
        self.y_true = np.array(y_true)
        self.y_scores = np.array(y_scores)
        self.thresholds_pr = None
        self.precisions = None
        self.recalls = None
        self.fprs = None
        self.tprs = None
        self.thresholds_roc = None

    def tune_sensitivity_threshold(self, metric="f1", step=0.01):
        """
        Tune detection sensitivity threshold based on target metric maximization.

        Args:
            metric (str): Metric to maximize ['f1', 'precision', 'recall'].
            step (float): Threshold step size in [0,1].

        Returns:
            Dict with 'threshold', 'precision', 'recall', 'f1'.
        """
        assert metric in ("f1", "precision", "recall"), "Invalid metric"
        thresholds = np.arange(0, 1 + step, step)
        best_metric = -1
        best_stats = {}

        for thr in thresholds:
            y_pred = (self.y_scores >= thr).astype(int)
            p = precision_score(self.y_true, y_pred, zero_division=0)
            r = recall_score(self.y_true, y_pred, zero_division=0)
            f1 = f1_score(self.y_true, y_pred, zero_division=0)

            val = {"precision": p, "recall": r, "f1": f1}[metric]
            if val > best_metric:
                best_metric = val
                best_stats = {"threshold": thr, "precision": p, "recall": r, "f1": f1}
        return best_stats

    def precision_recall_tradeoff(self):
        """
        Calculate precision, recall, f1-score, and thresholds for PR curve.

        Returns:
            precisions (np.ndarray), recalls (np.ndarray), f1_scores (np.ndarray), thresholds (np.ndarray)
        """
        precisions, recalls, thresholds = precision_recall_curve(self.y_true, self.y_scores)
        # Thresholds returned by precision_recall_curve does not include last thresh
        f1_scores = (2 * precisions * recalls) / (precisions + recalls + 1e-10)
        return precisions, recalls, f1_scores, np.append(thresholds, 1.0)

    def roc_curve_metrics(self):
        """
        Compute false positive rates, true positive rates, and thresholds for ROC curve.

        Returns:
            fprs (np.ndarray), tprs (np.ndarray), thresholds (np.ndarray), roc_auc (float)
        """
        fprs, tprs, thresholds = roc_curve(self.y_true, self.y_scores)
        roc_auc = auc(fprs, tprs)
        self.fprs = fprs
        self.tprs = tprs
        self.thresholds_roc = thresholds
        return fprs, tprs, thresholds, roc_auc

    def sensitivity_metrics(self, threshold=0.5):
        """
        Calculate sensitivity-related metrics at a given threshold.

        Args:
            threshold (float): Decision threshold for binary classification.

        Returns:
            Dict with TP, TN, FP, FN, sensitivity (recall), specificity, precision, accuracy, f1.
        """
        y_pred = (self.y_scores >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(self.y_true, y_pred).ravel()

        sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0
        specificity = tn / (tn + fp) if (tn + fp) > 0 else 0
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        accuracy = (tp + tn) / (tp + tn + fp + fn)
        f1 = 2 * precision * sensitivity / (precision + sensitivity) if (precision + sensitivity) > 0 else 0

        return dict(
            TP=tp,
            TN=tn,
            FP=fp,
            FN=fn,
            sensitivity=sensitivity,
            specificity=specificity,
            precision=precision,
            accuracy=accuracy,
            f1=f1,
        )

    def false_positive_negative_analysis(self, threshold=0.5):
        """
        Analyze false positives and false negatives indices.

        Args:
            threshold (float): Decision threshold.

        Returns:
            Dict with false_positive_indices and false_negative_indices arrays.
        """
        y_pred = (self.y_scores >= threshold).astype(int)
        false_positive_indices = np.where((y_pred == 1) & (self.y_true == 0))[0]
        false_negative_indices = np.where((y_pred == 0) & (self.y_true == 1))[0]
        return dict(
            false_positive_indices=false_positive_indices,
            false_negative_indices=false_negative_indices,
        )

    def benchmark_performance(self, thresholds=None):
        """
        Benchmark performance across multiple thresholds.

        Args:
            thresholds (iterable or None): Sequence of thresholds to evaluate.
                If None, uses np.linspace(0,1,101).

        Returns:
            List of dicts with threshold and metrics (precision, recall, f1, accuracy).
        """
        if thresholds is None:
            thresholds = np.linspace(0, 1, 101)

        results = []
        for thr in thresholds:
            metrics = self.sensitivity_metrics(threshold=thr)
            results.append({"threshold": thr, **metrics})

        return results

    def plot_precision_recall_curve(self, ax=None):
        """
        Plot the Precision-Recall curve.

        Args:
            ax (matplotlib.axes.Axes or None): Axes to plot, creates new if None.

        Returns:
            matplotlib.axes.Axes
        """
        precisions, recalls, _, _ = self.precision_recall_tradeoff()
        if ax is None:
            fig, ax = plt.subplots()
        ax.plot(recalls, precisions, label="PR Curve")
        ax.set_xlabel("Recall")
        ax.set_ylabel("Precision")
        ax.set_title("Precision-Recall Curve")
        ax.set_xlim([0.0, 1.0])
        ax.set_ylim([0.0, 1.05])
        ax.grid(True)
        ax.legend()
        return ax

    def plot_roc_curve(self, ax=None):
        """
        Plot the ROC curve.

        Args:
            ax (matplotlib.axes.Axes or None): Axes to plot, creates new if None.

        Returns:
            matplotlib.axes.Axes
        """
        fprs, tprs, _, roc_auc = self.roc_curve_metrics()
        if ax is None:
            fig, ax = plt.subplots()
        ax.plot(fprs, tprs, label=f"ROC Curve (AUC = {roc_auc:.3f})")
        ax.plot([0, 1], [0, 1], "k--", label="Random Guess")
        ax.set_xlabel("False Positive Rate")
        ax.set_ylabel("True Positive Rate")
        ax.set_title("Receiver Operating Characteristic (ROC) Curve")
        ax.set_xlim([0.0, 1.0])
        ax.set_ylim([0.0, 1.05])
        ax.grid(True)
        ax.legend()
        return ax

    def plot_metrics_over_threshold(self, ax=None):
        """
        Plot precision, recall, f1 over a range of thresholds.

        Args:
            ax (matplotlib.axes.Axes or None): Axes to plot, creates new if None.

        Returns:
            matplotlib.axes.Axes
        """
        precisions, recalls, f1_scores, thresholds = self.precision_recall_tradeoff()
        if ax is None:
            fig, ax = plt.subplots()

        ax.plot(thresholds, precisions, label="Precision", linestyle="-")
        ax.plot(thresholds, recalls, label="Recall", linestyle="--")
        ax.plot(thresholds, f1_scores, label="F1 Score", linestyle=":")
        ax.set_xlabel("Threshold")
        ax.set_ylabel("Score")
        ax.set_title("Precision, Recall, and F1 Score vs. Threshold")
        ax.set_xlim([0.0, 1.0])
        ax.set_ylim([0.0, 1.05])
        ax.grid(True)
        ax.legend()
        return ax

    def timed_benchmark(self, thresholds=None):
        """
        Benchmark performance metrics and record timing.

        Args:
            thresholds (iterable or None): Thresholds to evaluate.

        Returns:
            Dict with 'results' (list of metrics dicts) and 'duration' (float seconds).
        """
        start = time()
        results = self.benchmark_performance(thresholds=thresholds)
        duration = time() - start
        return dict(results=results, duration=duration)
```