```swift
import XCTest
@testable import PatientApp

final class DoseCalculatorTests: XCTestCase {
    
    struct TestFixture {
        let currentGlucose: Double
        let targetGlucose: Double
        let carbIntake: Double
        let carbRatio: Double
        let insulinSensitivity: Double
        let activeInsulin: Double
        let maxDose: Double
        let expectedDose: Double
        let description: String
    }
    
    // Helper for approximate equality check to meet medical precision requirements
    func assertDoseEqual(_ dose1: Double, _ dose2: Double, accuracy: Double = 0.05, _ message: String = "") {
        XCTAssertEqual(dose1, dose2, accuracy: accuracy, message)
    }
    
    func testGlucoseBasedCalculations() throws {
        let fixtures = [
            TestFixture(currentGlucose: 180, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 50, activeInsulin: 0, maxDose: 10, expectedDose: 1.6, description: "High glucose, no carbs"),
            TestFixture(currentGlucose: 80, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 50, activeInsulin: 0, maxDose: 10, expectedDose: 0, description: "Low glucose, no carbs"),
            TestFixture(currentGlucose: 100, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 50, activeInsulin: 0, maxDose: 10, expectedDose: 0, description: "Normal glucose, no carbs")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            assertDoseEqual(dose, fixture.expectedDose, "Glucose-based calculation failed: \(fixture.description)")
        }
    }
    
    func testCarbohydrateRatiosAppliedCorrectly() throws {
        let fixtures = [
            TestFixture(currentGlucose: 100, targetGlucose: 100, carbIntake: 60, carbRatio: 15, insulinSensitivity: 50, activeInsulin: 0, maxDose: 10, expectedDose: 4.0, description: "Carbs only, ratio 15"),
            TestFixture(currentGlucose: 100, targetGlucose: 100, carbIntake: 45, carbRatio: 12, insulinSensitivity: 50, activeInsulin: 0, maxDose: 10, expectedDose: 3.75, description: "Carbs only, ratio 12"),
            TestFixture(currentGlucose: 180, targetGlucose: 100, carbIntake: 30, carbRatio: 10, insulinSensitivity: 40, activeInsulin: 0, maxDose: 10, expectedDose: 5.5, description: "Carbs and high glucose")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            assertDoseEqual(dose, fixture.expectedDose, "Carb ratio calculation failed: \(fixture.description)")
        }
    }
    
    func testInsulinSensitivityFactorsWork() throws {
        let fixtures = [
            TestFixture(currentGlucose: 200, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 30, activeInsulin: 0, maxDose: 10, expectedDose: 3.33, description: "High insulin sensitivity"),
            TestFixture(currentGlucose: 200, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 60, activeInsulin: 0, maxDose: 10, expectedDose: 1.67, description: "Low insulin sensitivity")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            assertDoseEqual(dose, fixture.expectedDose, "Insulin sensitivity factor failed: \(fixture.description)")
        }
    }
    
    func testActiveInsulinProperlyTracked() throws {
        let fixtures = [
            TestFixture(currentGlucose: 180, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 40, activeInsulin: 1.0, maxDose: 10, expectedDose: 1.5, description: "Active insulin reduces dose"),
            TestFixture(currentGlucose: 180, targetGlucose: 100, carbIntake: 60, carbRatio: 10, insulinSensitivity: 40, activeInsulin: 1.5, maxDose: 10, expectedDose: 4.0, description: "Active insulin partially reduces total dose")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            assertDoseEqual(dose, fixture.expectedDose, "Active insulin tracking failed: \(fixture.description)")
        }
    }
    
    func testSafetyLimitsEnforced() throws {
        let fixtures = [
            TestFixture(currentGlucose: 400, targetGlucose: 100, carbIntake: 200, carbRatio: 5, insulinSensitivity: 15, activeInsulin: 0, maxDose: 8, expectedDose: 8, description: "Dose capped at max dose"),
            TestFixture(currentGlucose: 100, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 50, activeInsulin: 0, maxDose: 2, expectedDose: 0, description: "Zero dose below max dose"),
            TestFixture(currentGlucose: 250, targetGlucose: 100, carbIntake: 150, carbRatio: 4, insulinSensitivity: 20, activeInsulin: 0, maxDose: 15, expectedDose: 15, description: "Dose capped precisely at max dose")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            XCTAssertLessThanOrEqual(dose, fixture.maxDose, "Safety limit exceeded: \(fixture.description)")
        }
    }
    
    func testEdgeCasesVeryHighLowGlucose() throws {
        let fixtures = [
            TestFixture(currentGlucose: 600, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 20, activeInsulin: 0, maxDose: 20, expectedDose: 20, description: "Very high glucose, dose capped"),
            TestFixture(currentGlucose: 40, targetGlucose: 100, carbIntake: 0, carbRatio: 10, insulinSensitivity: 20, activeInsulin: 0, maxDose: 10, expectedDose: 0, description: "Very low glucose, no insulin"),
            TestFixture(currentGlucose: 300, targetGlucose: 80, carbIntake: 50, carbRatio: 12, insulinSensitivity: 30, activeInsulin: 0, maxDose: 15, expectedDose: 11.67, description: "High glucose and carbs combined")
        ]
        
        for fixture in fixtures {
            let dose = DoseCalculator.calculateDose(
                currentGlucose: fixture.currentGlucose,
                targetGlucose: fixture.targetGlucose,
                carbIntake: fixture.carbIntake,
                carbRatio: fixture.carbRatio,
                insulinSensitivity: fixture.insulinSensitivity,
                activeInsulin: fixture.activeInsulin,
                maxDose: fixture.maxDose
            )
            assertDoseEqual(dose, fixture.expectedDose, "Edge case failed: \(fixture.description)")
        }
    }
    
    func testCalculationPrecisionMeetsMedicalRequirements() throws {
        let dose = DoseCalculator.calculateDose(
            currentGlucose: 185,
            targetGlucose: 100,
            carbIntake: 45,
            carbRatio: 14,
            insulinSensitivity: 45,
            activeInsulin: 0.6,
            maxDose: 10
        )
        // Expected: glucose correction = (185-100)/45 = 1.89..., carb dose = 45/14 = 3.21..., total = 5.10..., active insulin = 0.6, result ~4.5
        let expectedDose = 4.5
        assertDoseEqual(dose, expectedDose, accuracy: 0.05, "Precision requirement failed")
    }
}
```