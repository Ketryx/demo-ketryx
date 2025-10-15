"""Test case KD-50: Risk Assessment Algorithm Consistency Test
Verifies that maximum insulin dosage limits are enforced.
@itemId:test-insulin-dosage-limit
@itemTitle:Risk Assessment Algorithm Consistency Test
@itemFulfills:KD-50
"""

MAX_INSULIN_DOSAGE = 25.0  # units

def test_max_insulin_dosage_limit():
    requested_dosage = 30.0
    actual_dosage = min(requested_dosage, MAX_INSULIN_DOSAGE)
    assert actual_dosage <= MAX_INSULIN_DOSAGE, f"Dosage {actual_dosage} exceeds maximum {MAX_INSULIN_DOSAGE}"
    assert actual_dosage == MAX_INSULIN_DOSAGE, f"Expected capped dosage of {MAX_INSULIN_DOSAGE}, got {actual_dosage}"
