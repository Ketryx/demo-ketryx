```python
import numpy as np
from typing import Dict, List, Optional, Tuple, Union


class BlockageAnalyzer:
    """
    Class for analyzing blockage characteristics for cardiovascular risk assessment.
    """

    # Location-based risk weighting by vessel
    _LOCATION_RISK_WEIGHTS = {
        'LAD': 1.5,
        'RCA': 1.0,
        'LCX': 1.2
    }

    # Plaque composition risk weights
    _PLAQUE_COMPOSITION_WEIGHTS = {
        'fibrous': 1.0,
        'calcified': 0.8,
        'lipid-rich': 1.4,
        'mixed': 1.2
    }

    def __init__(self, imaging_data: Optional[Dict] = None):
        """
        Initialize the BlockageAnalyzer.

        Args:
            imaging_data (Optional[Dict]): Preprocessed imaging data such as CTCA or angiography input.
        """
        self.imaging_data = imaging_data

    def blockage_severity_score(self, stenosis_percent: float) -> float:
        """
        Calculate severity score based on percentage stenosis.

        Args:
            stenosis_percent (float): Percentage stenosis (0 to 100).

        Returns:
            float: Severity score scaled 0-10.
        """
        if stenosis_percent < 0 or stenosis_percent > 100:
            raise ValueError("Stenosis percent must be between 0 and 100")
        # Nonlinear scaling: more steep increase after 50%
        if stenosis_percent < 50:
            score = (stenosis_percent / 50) * 5
        else:
            score = 5 + ((stenosis_percent - 50) / 50) * 5
        return score

    def location_risk_weight(self, vessel: str) -> float:
        """
        Get risk weighting factor based on vessel location.

        Args:
            vessel (str): Vessel name ('LAD', 'RCA', 'LCX').

        Returns:
            float: Risk weighting factor.
        """
        return self._LOCATION_RISK_WEIGHTS.get(vessel.upper(), 1.0)

    def plaque_composition_score(self, composition: str) -> float:
        """
        Assign plaque composition risk weighting.

        Args:
            composition (str): Plaque type ('fibrous', 'calcified', 'lipid-rich', 'mixed').

        Returns:
            float: Weight factor.
        """
        return self._PLAQUE_COMPOSITION_WEIGHTS.get(composition.lower(), 1.0)

    def vessel_territory_at_risk(self, vessel_stenoses: Dict[str, float]) -> float:
        """
        Estimate vessel territory at risk by summing weighted stenoses.

        Args:
            vessel_stenoses (Dict[str, float]): Mapping vessel to percent stenosis.

        Returns:
            float: Territory risk score.
        """
        score = 0.0
        for vessel, stenosis in vessel_stenoses.items():
            severity = self.blockage_severity_score(stenosis)
            weight = self.location_risk_weight(vessel)
            score += severity * weight
        return score

    def detect_multivessel_disease(self, vessel_stenoses: Dict[str, float], threshold: float = 50.0) -> bool:
        """
        Detect multi-vessel disease based on stenosis threshold.

        Args:
            vessel_stenoses (Dict[str, float]): Vessel stenoses percentages.
            threshold (float): Threshold percent stenosis to count as significant.

        Returns:
            bool: True if >=2 vessels have significant stenosis.
        """
        count = sum(1 for s in vessel_stenoses.values() if s >= threshold)
        return count >= 2

    def collateral_circulation_score(self, collateral_grade: Union[int, float]) -> float:
        """
        Assign score based on collateral circulation grade (Rentrop classification).

        Args:
            collateral_grade (int or float): Rentrop grade 0-3.

        Returns:
            float: Score 0 (none) to 3 (well developed).
        """
        if not (0 <= collateral_grade <= 3):
            raise ValueError("Collateral grade must be between 0 and 3")
        return collateral_grade

    def syntax_score(self, lesion_data: List[Dict]) -> float:
        """
        Calculate SYNTAX score based on lesion characteristics.

        Args:
            lesion_data (List[Dict]): List of lesions with keys:
                - 'vessel': str,
                - 'stenosis': float,
                - 'location': str (segment),
                - 'length': float (mm),
                - 'complexity': int (1-3),
                - 'total_occlusion': bool

        Returns:
            float: SYNTAX score.
        """
        score = 0.0
        for lesion in lesion_data:
            s = lesion.get('stenosis', 0)
            if s < 50:
                continue
            base = self.blockage_severity_score(s)

            complexity = lesion.get('complexity', 1)
            length = lesion.get('length', 5.0)
            total_occlusion = lesion.get('total_occlusion', False)

            lesion_score = base

            # Length weight
            if length > 20:
                lesion_score += 2

            # Total occlusion weight
            if total_occlusion:
                lesion_score += 5

            # Complexity factor
            lesion_score *= complexity

            # Vessel weighting
            vessel = lesion.get('vessel', '')
            lesion_score *= self.location_risk_weight(vessel)

            score += lesion_score
        return round(score, 2)

    def gensini_score(self, vessel_stenoses: Dict[str, float]) -> float:
        """
        Calculate Gensini score based on vessel stenoses.

        Args:
            vessel_stenoses (Dict[str, float]): Mapping vessel segment to percent stenosis.

        Returns:
            float: Gensini score.
        """
        # Gensini weighting factors by segment location
        gensini_weights = {
            'LM': 5,
            'proximal_LAD': 2.5,
            'mid_LAD': 1.5,
            'distal_LAD': 1.0,
            'first_diagonal': 1.0,
            'second_diagonal': 0.5,
            'proximal_LCX': 2.5,
            'distal_LCX': 1.0,
            'OM_branch': 1.0,
            'RCA': 1.0,
            'posterior_descending_artery': 1.0,
            'posterolateral_branch': 0.5
        }

        def stenosis_score(s):
            if s >= 75:
                return 32
            elif s >= 50:
                return 16
            elif s >= 25:
                return 8
            elif s > 0:
                return 4
            return 0

        total_score = 0.0
        for segment, stenosis in vessel_stenoses.items():
            weight = gensini_weights.get(segment.lower(), 1.0)
            s_score = stenosis_score(stenosis)
            total_score += weight * s_score
        return total_score

    def integrate_imaging_data(self) -> Dict[str, Union[float, Dict]]:
        """
        Extract and aggregate lesion characteristics from imaging data.

        Returns:
            Dict[str, Union[float, Dict]]: Processed results including:
                - 'severity_scores'
                - 'location_weights'
                - 'plaque_scores'
                - 'multi_vessel_disease'
                - 'syntax_score'
                - 'gensini_score'
                - 'collateral_score'
        """
        if not self.imaging_data:
            raise ValueError("No imaging data provided")

        vessel_stenoses = self.imaging_data.get('vessel_stenoses', {})
        plaques = self.imaging_data.get('plaques', [])  # list of dict {vessel, plaque_type, stenosis}
        collateral_grade = self.imaging_data.get('collateral_grade', 0)
        lesions = self.imaging_data.get('lesions', [])

        severity_scores = {}
        location_weights = {}
        plaque_scores = {}

        for vessel, stenosis in vessel_stenoses.items():
            severity_scores[vessel] = self.blockage_severity_score(stenosis)
            location_weights[vessel] = self.location_risk_weight(vessel)

        for plaque in plaques:
            vessel = plaque.get('vessel')
            composition = plaque.get('plaque_type', 'fibrous')
            score = self.plaque_composition_score(composition)
            plaque_scores[vessel] = plaque_scores.get(vessel, 0) + score

        multi_vessel = self.detect_multivessel_disease(vessel_stenoses)
        syntax = self.syntax_score(lesions)
        gensini = self.gensini_score(vessel_stenoses)
        collateral = self.collateral_circulation_score(collateral_grade)

        return {
            'severity_scores': severity_scores,
            'location_weights': location_weights,
            'plaque_scores': plaque_scores,
            'multi_vessel_disease': multi_vessel,
            'syntax_score': syntax,
            'gensini_score': gensini,
            'collateral_score': collateral,
        }
```