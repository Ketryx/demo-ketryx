```swift
import Foundation

final class DoseCalculator {
    // MARK: - Types
    
    struct DoseCalculationResult {
        let recommendedDose: Decimal
        let correctionDose: Decimal
        let carbDose: Decimal
        let activeInsulin: Decimal
        let glucose: Decimal
        let carbs: Decimal
        let timestamp: Date
    }
    
    struct SafetyLimits {
        let maxDose: Decimal
        let minDose: Decimal
        let maxCorrectionDose: Decimal
    }
    
    // MARK: - Properties
    
    private let carbRatio: Decimal                  // grams of carb per unit insulin
    private let insulinSensitivityFactor: Decimal  // mg/dL glucose drop per unit insulin
    private let targetGlucose: Decimal              // mg/dL target glucose
    private let safetyLimits: SafetyLimits
    
    private(set) var calculationHistory: [DoseCalculationResult] = []
    
    private var activeInsulinEntries: [(timestamp: Date, units: Decimal)] = []
    private let insulinDuration: TimeInterval       // seconds insulin remains active
    
    // MARK: - Init
    
    /// - Parameters:
    ///   - carbRatio: grams carb covered by one unit insulin
    ///   - insulinSensitivityFactor: mg/dL glucose reduced by one unit insulin
    ///   - targetGlucose: target glucose (mg/dL)
    ///   - insulinDuration: Duration insulin is active (seconds)
    ///   - safetyLimits: safety dose limits
    init(
        carbRatio: Decimal,
        insulinSensitivityFactor: Decimal,
        targetGlucose: Decimal,
        insulinDuration: TimeInterval = 4 * 60 * 60,
        safetyLimits: SafetyLimits = SafetyLimits(maxDose: 20, minDose: 0, maxCorrectionDose: 10)
    ) {
        self.carbRatio = carbRatio
        self.insulinSensitivityFactor = insulinSensitivityFactor
        self.targetGlucose = targetGlucose
        self.insulinDuration = insulinDuration
        self.safetyLimits = safetyLimits
    }
    
    // MARK: - Public Methods
    
    /// Adds a new active insulin entry for tracking.
    /// - Parameters:
    ///   - units: units of insulin injected
    ///   - timestamp: injection time (default now)
    func addActiveInsulin(units: Decimal, timestamp: Date = Date()) {
        guard units > 0 else { return }
        activeInsulinEntries.append((timestamp: timestamp, units: units))
        cleanupOldActiveInsulin()
    }

    /// Calculates recommended insulin dose based on glucose and carbs input.
    /// - Parameters:
    ///   - glucose: Current blood glucose (mg/dL)
    ///   - carbs: Amount of carbs to cover (grams)
    ///   - timestamp: Time of calculation (default now)
    /// - Returns: DoseCalculationResult with detailed doses and active insulin info
    func calculateDose(glucose: Decimal, carbs: Decimal, timestamp: Date = Date()) -> DoseCalculationResult {
        cleanupOldActiveInsulin(at: timestamp)
        
        let activeInsulin = calculateActiveInsulin(at: timestamp)
        
        // Carb Dose = carbs / carbRatio
        let carbDose = safeDivide(carbs, carbRatio)
        
        // Correction Dose = (currentGlucose - targetGlucose) / sensitivityFactor - activeInsulin
        let glucoseDelta = glucose - targetGlucose
        let rawCorrectionDose = safeDivide(glucoseDelta, insulinSensitivityFactor)
        let correctionDosePreClamp = max(rawCorrectionDose - activeInsulin, 0)
        
        let correctionDose = clamp(correctionDosePreClamp, min: 0, max: safetyLimits.maxCorrectionDose)
        
        var recommendedDose = carbDose + correctionDose
        recommendedDose = clamp(recommendedDose, min: safetyLimits.minDose, max: safetyLimits.maxDose)
        
        let result = DoseCalculationResult(
            recommendedDose: recommendedDose,
            correctionDose: correctionDose,
            carbDose: carbDose,
            activeInsulin: activeInsulin,
            glucose: glucose,
            carbs: carbs,
            timestamp: timestamp
        )
        
        calculationHistory.append(result)
        return result
    }
    
    // MARK: - Private Methods
    
    /// Calculates total active insulin on board at a given time.
    /// Active insulin decays linearly based on insulinDuration.
    private func calculateActiveInsulin(at time: Date) -> Decimal {
        var totalActive: Decimal = 0
        let durationSeconds = Decimal(insulinDuration)
        
        for entry in activeInsulinEntries {
            let elapsed = Decimal(time.timeIntervalSince(entry.timestamp))
            if elapsed >= 0 && elapsed < durationSeconds {
                let fractionRemaining = (durationSeconds - elapsed) / durationSeconds
                let activeForEntry = entry.units * fractionRemaining
                totalActive += activeForEntry
            }
        }
        
        return totalActive
    }
    
    /// Removes active insulin entries older than insulinDuration to keep tracking tidy.
    private func cleanupOldActiveInsulin(at time: Date = Date()) {
        let cutoff = time.addingTimeInterval(-insulinDuration)
        activeInsulinEntries.removeAll { $0.timestamp < cutoff }
    }
    
    /// Clamps a Decimal value between min and max.
    private func clamp(_ value: Decimal, min: Decimal, max: Decimal) -> Decimal {
        if value < min { return min }
        if value > max { return max }
        return value
    }
    
    /// Safely divides two Decimals returning zero if denominator is zero or negative.
    private func safeDivide(_ numerator: Decimal, _ denominator: Decimal) -> Decimal {
        guard denominator > 0 else { return 0 }
        return numerator / denominator
    }
    
    // MARK: - Public - Utility
    
    /// Resets calculation history and active insulin tracking.
    func reset() {
        calculationHistory.removeAll()
        activeInsulinEntries.removeAll()
    }
}
```