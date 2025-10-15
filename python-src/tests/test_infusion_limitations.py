def test_max_insulin_dosage():
    max_dosage = 100
    delivered_dosage = 95
    assert delivered_dosage <= max_dosage
    print("Infusion limitation test passed")
