```python
import numpy as np
import pandas as pd
from lifelines import FineGrayModel, KaplanMeierFitter
from lifelines.utils import restricted_mean_survival_time
from lifelines.statistics import logrank_test
from scipy.stats import norm


class EventPrediction:
    """
    Coronary event prediction leveraging competing risks survival analysis.

    Features:
    - Time-to-event modeling with competing risks (Fine-Gray model)
    - Event type prediction (MI, revascularization, death)
    - Probability estimation at various time horizons
    - Confidence interval estimation for probabilities
    - Risk trajectory over time
    - Intervention impact modeling (covariate modification)
    - Clinical decision threshold evaluation
    """

    EVENT_CODES = {
        'mi': 1,
        'revascularization': 2,
        'death': 3,
        'censored': 0
    }

    def __init__(self, covariates: pd.DataFrame, durations: pd.Series, event_types: pd.Series):
        """
        Initialize and fit the Fine-Gray competing risks model for each event type.

        Parameters
        ----------
        covariates : pd.DataFrame
            Patient features / covariates.
        durations : pd.Series
            Time to event or censoring.
        event_types : pd.Series
            Observed event type at duration. Use codes from EVENT_CODES.
        """
        self.covariates = covariates.copy()
        self.durations = durations.copy()
        self.event_types = event_types.copy()

        self.models = dict()  # key=event_name, value=FineGrayModel fitted
        self._fit_models()

    def _fit_models(self):
        # Fit one Fine-Gray model per event type (excluding censoring)
        for event_name, code in self.EVENT_CODES.items():
            if event_name == 'censored':
                continue
            mask = self.event_types.isin([code, self.EVENT_CODES['censored']])
            if mask.sum() == 0:
                continue
            fg = FineGrayModel(alpha=0.05)
            fg.fit(
                self.durations[mask],
                self.event_types[mask],
                event_of_interest=code,
                X=self.covariates.loc[mask]
            )
            self.models[event_name] = fg

    def predict_cumulative_incidence(self, X: pd.DataFrame, times: np.ndarray):
        """
        Predict cumulative incidence function (CIF) for all event types at specified times.

        Parameters
        ----------
        X : pd.DataFrame
            New patient covariates.
        times : np.ndarray
            Time horizons at which to estimate probabilities.

        Returns
        -------
        pd.DataFrame
            Multi-index (patient_id, event_type) with CIF values at each time.
            Columns correspond to each time horizon.
        """
        results = []
        for event_name, model in self.models.items():
            cif = model.predict_cumulative_hazard_function(X, times=times)
            # lifelines FineGrayModel returns cumulative subdistribution hazard.
            # Convert to CIF: CIF(t) = 1 - exp(-subdistribution_hazard(t))
            cif_values = 1 - np.exp(-cif.T.values)
            df_cif = pd.DataFrame(
                cif_values,
                index=X.index,
                columns=times
            )
            df_cif = df_cif.stack().reset_index()
            df_cif.columns = ['patient_id', 'time', 'probability']
            df_cif['event_type'] = event_name
            results.append(df_cif)
        return pd.concat(results).set_index(['patient_id', 'event_type', 'time']).sort_index()

    def confidence_intervals(self, X: pd.DataFrame, times: np.ndarray, alpha=0.05, n_bootstrap=100):
        """
        Bootstrap-based confidence intervals for CIF predictions.

        Parameters
        ----------
        X : pd.DataFrame
            New patient covariates.
        times : np.ndarray
            Time horizons.
        alpha : float
            Significance level.
        n_bootstrap : int
            Number of bootstrap samples.

        Returns
        -------
        pd.DataFrame
            Multi-index (patient_id, event_type, time) with columns ['lower', 'upper'] containing CI bounds.
        """
        preds = {event: [] for event in self.models.keys()}
        n = len(self.covariates)
        for _ in range(n_bootstrap):
            idx = np.random.choice(n, n, replace=True)
            cov_bs = self.covariates.iloc[idx].reset_index(drop=True)
            dur_bs = self.durations.iloc[idx].reset_index(drop=True)
            evt_bs = self.event_types.iloc[idx].reset_index(drop=True)

            models_bs = {}
            for event_name, code in self.EVENT_CODES.items():
                if event_name == 'censored':
                    continue
                mask = evt_bs.isin([code, self.EVENT_CODES['censored']])
                if mask.sum() == 0:
                    continue
                fg_bs = FineGrayModel(alpha=alpha)
                try:
                    fg_bs.fit(dur_bs[mask], evt_bs[mask], event_of_interest=code, X=cov_bs.loc[mask])
                    models_bs[event_name] = fg_bs
                except Exception:
                    # Model failed to converge, skip this bootstrap iteration for this event
                    continue

            for event_name, model_bs in models_bs.items():
                cif_bs = model_bs.predict_cumulative_hazard_function(X, times=times)
                cif_values_bs = 1 - np.exp(-cif_bs.T.values)
                preds[event_name].append(cif_values_bs)

        cis = []
        z = norm.ppf(1 - alpha / 2)
        for event_name in self.models.keys():
            if len(preds[event_name]) == 0:
                continue
            arr = np.stack(preds[event_name], axis=0)  # (bootstraps, patients, times)
            mean_pred = arr.mean(axis=0)
            std_pred = arr.std(axis=0, ddof=1)
            lower = mean_pred - z * std_pred
            upper = mean_pred + z * std_pred
            lower = np.clip(lower, 0, 1)
            upper = np.clip(upper, 0, 1)

            for i, pid in enumerate(X.index):
                for j, t in enumerate(times):
                    cis.append({
                        'patient_id': pid,
                        'event_type': event_name,
                        'time': t,
                        'lower': lower[i, j],
                        'upper': upper[i, j]
                    })
        df_cis = pd.DataFrame(cis)
        df_cis.set_index(['patient_id', 'event_type', 'time'], inplace=True)
        return df_cis.sort_index()

    def predict_event_type_probabilities(self, X: pd.DataFrame, time_horizon: float):
        """
        Calculate probabilities for each event type at a single time horizon.

        Parameters
        ----------
        X : pd.DataFrame
            New patient covariates.
        time_horizon : float
            Time at which to estimate probabilities.

        Returns
        -------
        pd.DataFrame
            DataFrame indexed by patient_id with columns as event types and probabilities.
        """
        result = pd.DataFrame(index=X.index)
        for event_name, model in self.models.items():
            cif = model.predict_cumulative_hazard_function(X, times=[time_horizon])
            prob = 1 - np.exp(-cif.T.values).flatten()
            result[event_name] = prob
        return result

    def risk_trajectory(self, X: pd.DataFrame, max_time: float, n_points=100):
        """
        Generate risk trajectories over time for each patient and event type.

        Parameters
        ----------
        X : pd.DataFrame
            Patient covariates.
        max_time : float
            Maximum time horizon to predict.
        n_points : int
            Number of time points.

        Returns
        -------
        pd.DataFrame
            Multi-index (patient_id, event_type, time) with predicted CIF.
        """
        times = np.linspace(0, max_time, n_points)
        return self.predict_cumulative_incidence(X, times)

    def intervention_impact(self, X: pd.DataFrame, intervention_func, times: np.ndarray):
        """
        Model impact of intervention by applying a covariate transformation and re-predicting risks.

        Parameters
        ----------
        X : pd.DataFrame
            Baseline covariates.
        intervention_func : callable
            Function accepting a DataFrame and returning modified DataFrame (e.g. reduced LDL).
        times : np.ndarray
            Time horizons.

        Returns
        -------
        pd.DataFrame
            Differences in predicted CIF (baseline - post-intervention) as risk reduction.
            Multi-index (patient_id, event_type, time).
        """
        X_intervened = intervention_func(X.copy())
        baseline_cif = self.predict_cumulative_incidence(X, times)
        intervened_cif = self.predict_cumulative_incidence(X_intervened, times)

        diff = baseline_cif - intervened_cif
        diff.columns = ['risk_reduction']
        return diff

    def apply_decision_thresholds(self, risks: pd.DataFrame, thresholds: dict):
        """
        Apply clinical decision thresholds to predicted probabilities to yield recommendations.

        Parameters
        ----------
        risks : pd.DataFrame
            Multi-index (patient_id, event_type, time) predicted probabilities.
        thresholds : dict
            event_type -> threshold float between 0 and 1

        Returns
        -------
        pd.DataFrame
            Binary flags indicating if risk exceeds threshold for given event and time.
            Multi-index (patient_id, event_type, time), column 'action_recommended' (bool)
        """
        df = risks.copy()
        df = df.rename(columns={df.columns[0]: 'probability'}) if df.columns.size == 1 else df
        decisions = []
        for (pid, event, time), row in df.iterrows():
            thresh = thresholds.get(event)
            if thresh is None:
                decision = False
            else:
                prob = row['probability'] if 'probability' in row else row
                decision = prob >= thresh
            decisions.append(decision)
        decisions = pd.Series(decisions, index=df.index, name='action_recommended')
        return decisions.to_frame()

    def estimate_restricted_mean_survival_time(self, X: pd.DataFrame, time_horizon: float):
        """
        Estimate restricted mean event-free survival time for each patient.

        Parameters
        ----------
        X : pd.DataFrame
            Patient covariates.
        time_horizon : float
            Time horizon to compute RMST.

        Returns
        -------
        pd.Series
            Estimated RMST per patient (float).
        """
        # Sum CIFs for all competing events
        times = np.linspace(0, time_horizon, 100)
        cif_sum = np.zeros((len(X), len(times)))
        for model in self.models.values():
            cif = model.predict_cumulative_hazard_function(X, times=times)
            cif_val = 1 - np.exp(-cif.T.values)
            cif_sum += cif_val

        survival_prob = 1 - cif_sum  # event-free survival function estimates
        dt = times[1] - times[0]
        rmst = np.trapz(survival_prob, dx=dt, axis=1)
        return pd.Series(rmst, index=X.index, name='rmst')

```