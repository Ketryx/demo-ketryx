```python
from typing import Dict, List, Tuple, Optional

# Constants for clinical thresholds
SEVERE_STENOSIS_THRESHOLD = 70  # percent
MODERATE_STENOSIS_THRESHOLD = 50  # percent
RISK_WEIGHT_PROXIMAL = 1.5
RISK_WEIGHT_DISTAL = 1.0

# Vessel segments commonly accepted in cardiac anatomy
PROXIMAL_SEGMENTS = {"LAD_proximal", "LCX_proximal", "RCA_proximal"}
DISTAL_SEGMENTS = {"LAD_distal", "LCX_distal", "RCA_distal"}

# Plaque composition risk weights (arbitrary for example)
PLAQUE_RISK_WEIGHTS = {
    "fibrous": 1.0,
    "lipid-rich": 1.5,
    "calcified": 1.2,
    "mixed": 1.4,
}


class BlockageDataProcessor:
    def __init__(self, clinical_thresholds: Optional[Dict[str, int]] = None) -> None:
        self.severe_threshold = (
            clinical_thresholds.get("severe_stenosis", SEVERE_STENOSIS_THRESHOLD)
            if clinical_thresholds
            else SEVERE_STENOSIS_THRESHOLD
        )
        self.moderate_threshold = (
            clinical_thresholds.get("moderate_stenosis", MODERATE_STENOSIS_THRESHOLD)
            if clinical_thresholds
            else MODERATE_STENOSIS_THRESHOLD
        )

    def process_blockages(
        self, blockages: List[Dict]
    ) -> Dict[str, any]:
        """
        Input: List of blockages detected with keys:
          - vessel: str (e.g., "LAD", "LCX", "RCA")
          - segment: str (e.g., "proximal", "mid", "distal")
          - stenosis_percentage: float (0-100)
          - plaque_composition: str (one of plaque types)
        Output: Extracted features and risk metrics dictionary.
        """
        if not blockages:
            return {
                "num_blockages": 0,
                "multi_vessel_disease": False,
                "max_stenosis": 0.0,
                "weighted_severity_score": 0.0,
                "plaque_composition_scores": {},
                "clinical_risk_level": "none",
                "stenosis_percentages": [],
            }

        vessel_blockages: Dict[str, List[Dict]] = {}
        stenosis_percentages = []
        plaque_scores_accum = {key: 0.0 for key in PLAQUE_RISK_WEIGHTS.keys()}

        for b in blockages:
            vessel = b.get("vessel", "").upper()
            segment = b.get("segment", "").lower()
            stenosis = b.get("stenosis_percentage", 0.0)
            plaque = b.get("plaque_composition", "fibrous").lower()

            if vessel not in vessel_blockages:
                vessel_blockages[vessel] = []
            vessel_blockages[vessel].append(b)
            stenosis_percentages.append(stenosis)

            # Accumulate weighted plaque scores
            plaque_weight = PLAQUE_RISK_WEIGHTS.get(plaque, 1.0)
            plaque_scores_accum[plaque] += plaque_weight * (stenosis / 100.0)

        max_stenosis = max(stenosis_percentages)

        # Multi-vessel disease: blockages in 2 or more vessels with ≥ moderate stenosis
        vessels_with_significant = sum(
            1
            for vblock in vessel_blockages.values()
            if any(b["stenosis_percentage"] >= self.moderate_threshold for b in vblock)
        )
        multi_vessel_disease = vessels_with_significant >= 2

        # Weighted severity score incorporates stenosis and location
        weighted_severity_score = 0.0
        for vessel, b_list in vessel_blockages.items():
            for b in b_list:
                seg = b.get("segment", "").lower()
                sten = b.get("stenosis_percentage", 0.0)
                weight = (
                    RISK_WEIGHT_PROXIMAL
                    if f"{vessel}_{seg}" in PROXIMAL_SEGMENTS
                    else RISK_WEIGHT_DISTAL
                )
                weighted_severity_score += sten * weight / 100.0  # scaled 0..1.5 approx

        # Determine clinical risk level based on max stenosis
        if max_stenosis >= self.severe_threshold:
            clinical_risk_level = "severe"
        elif max_stenosis >= self.moderate_threshold:
            clinical_risk_level = "moderate"
        else:
            clinical_risk_level = "mild"

        # Normalize plaque composition scores (divide by number of blockages)
        num_blockages = len(blockages)
        plaque_composition_scores = {
            k: round(v / num_blockages, 4) for k, v in plaque_scores_accum.items()
        }

        features = {
            "num_blockages": num_blockages,
            "multi_vessel_disease": multi_vessel_disease,
            "max_stenosis": round(max_stenosis, 2),
            "weighted_severity_score": round(weighted_severity_score, 4),
            "plaque_composition_scores": plaque_composition_scores,
            "clinical_risk_level": clinical_risk_level,
            "stenosis_percentages": [round(s, 2) for s in stenosis_percentages],
        }

        return features

    def quantify_severity(self, stenosis_percentage: float) -> str:
        if stenosis_percentage >= self.severe_threshold:
            return "severe"
        elif stenosis_percentage >= self.moderate_threshold:
            return "moderate"
        elif stenosis_percentage > 0:
            return "mild"
        else:
            return "none"
```