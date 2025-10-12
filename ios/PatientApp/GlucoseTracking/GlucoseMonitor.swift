```swift
import Foundation
import HealthKit
import Combine
import UIKit

final class GlucoseMonitor {
    struct GlucoseSample: Identifiable, Codable {
        let id: UUID
        let date: Date
        let glucoseMgPerDl: Double
        let source: SampleSource
        
        enum SampleSource: String, Codable {
            case cgmSensor
            case manualEntry
        }
        
        init(id: UUID = UUID(), date: Date, glucoseMgPerDl: Double, source: SampleSource) {
            self.id = id
            self.date = date
            self.glucoseMgPerDl = glucoseMgPerDl
            self.source = source
        }
    }
    
    enum GlucoseMonitorError: Error {
        case healthKitNotAvailable
        case authorizationDenied
        case exportFailed
    }
    
    // MARK: - Properties
    
    private let healthStore = HKHealthStore()
    private let glucoseType = HKQuantityType.quantityType(forIdentifier: .bloodGlucose)!
    private var cancellables = Set<AnyCancellable>()
    
    /// Stores glucose samples locally, sorted by date ascending
    private(set) var glucoseSamples: [GlucoseSample] = []
    
    /// Alert thresholds (mg/dL)
    var lowGlucoseThreshold: Double = 70
    var highGlucoseThreshold: Double = 180
    
    /// Publisher for new data or updates
    let glucoseSamplesPublisher = PassthroughSubject<[GlucoseSample], Never>()
    
    // MARK: - Initialization
    
    init() {
        guard HKHealthStore.isHealthDataAvailable() else {
            return
        }
    }
    
    // MARK: - HealthKit Authorization
    
    func requestAuthorization(completion: @escaping (Result<Void, GlucoseMonitorError>) -> Void) {
        let typesToRead: Set = [glucoseType]
        let typesToWrite: Set = [glucoseType]
        
        healthStore.requestAuthorization(toShare: typesToWrite, read: typesToRead) { success, error in
            DispatchQueue.main.async {
                if success {
                    completion(.success(()))
                } else {
                    completion(.failure(.authorizationDenied))
                }
            }
        }
    }
    
    // MARK: - Data Management
    
    /// Fetch glucose data from HealthKit (last 7 days by default)
    func fetchGlucoseData(from startDate: Date = Calendar.current.date(byAdding: .day, value: -7, to: Date())!,
                          to endDate: Date = Date(),
                          completion: @escaping (Result<[GlucoseSample], GlucoseMonitorError>) -> Void) {
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: glucoseType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { [weak self] _, samples, error in
            guard let self = self else { return }
            if let _ = error {
                DispatchQueue.main.async {
                    completion(.failure(.healthKitNotAvailable))
                }
                return
            }
            
            let extractedSamples: [GlucoseSample] = samples?.compactMap {
                guard let quantitySample = $0 as? HKQuantitySample else { return nil }
                let glucoseMg = quantitySample.quantity.doubleValue(for: HKUnit.milligramPerDeciliter)
                return GlucoseSample(date: quantitySample.startDate,
                                     glucoseMgPerDl: glucoseMg,
                                     source: .cgmSensor)
            } ?? []
            
            DispatchQueue.main.async {
                self.mergeSamples(newSamples: extractedSamples)
                completion(.success(self.glucoseSamples))
            }
        }
        healthStore.execute(query)
    }
    
    /// Add a manual glucose entry
    func addManualEntry(glucoseMgPerDl: Double, date: Date = Date(), completion: ((Result<Void, Error>) -> Void)? = nil) {
        let sample = GlucoseSample(date: date, glucoseMgPerDl: glucoseMgPerDl, source: .manualEntry)
        saveToHealthKit(sample: sample, completion: completion)
    }
    
    private func saveToHealthKit(sample: GlucoseSample, completion: ((Result<Void, Error>) -> Void)? = nil) {
        let quantity = HKQuantity(unit: HKUnit.milligramPerDeciliter, doubleValue: sample.glucoseMgPerDl)
        let hkSample = HKQuantitySample(type: glucoseType, quantity: quantity, start: sample.date, end: sample.date)
        healthStore.save(hkSample) { [weak self] success, error in
            DispatchQueue.main.async {
                if success {
                    self?.mergeSamples(newSamples: [sample])
                    completion?(.success(()))
                } else {
                    completion?(.failure(error ?? GlucoseMonitorError.healthKitNotAvailable))
                }
            }
        }
    }
    
    /// Merge new samples into existing data avoiding duplicates and keeping sorted order
    private func mergeSamples(newSamples: [GlucoseSample]) {
        var all = glucoseSamples
        let existingIDs = Set(all.map(\.id))
        let filteredNew = newSamples.filter { !existingIDs.contains($0.id) }
        all.append(contentsOf: filteredNew)
        all.sort { $0.date < $1.date }
        glucoseSamples = all
        glucoseSamplesPublisher.send(glucoseSamples)
    }
    
    // MARK: - Trend Analysis & Prediction
    
    /// Returns the average glucose over the last period (in days)
    func averageGlucose(days: Int = 7) -> Double? {
        let fromDate = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        let recentSamples = glucoseSamples.filter { $0.date >= fromDate }
        guard !recentSamples.isEmpty else { return nil }
        let sum = recentSamples.reduce(0) { $0 + $1.glucoseMgPerDl }
        return sum / Double(recentSamples.count)
    }
    
    /// Returns the min and max glucose in the last period (in days)
    func glucoseRange(days: Int = 7) -> (min: Double, max: Double)? {
        let fromDate = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        let recentSamples = glucoseSamples.filter { $0.date >= fromDate }
        guard let minG = recentSamples.min(by: { $0.glucoseMgPerDl < $1.glucoseMgPerDl }),
              let maxG = recentSamples.max(by: { $0.glucoseMgPerDl < $1.glucoseMgPerDl }) else {
            return nil
        }
        return (min: minG.glucoseMgPerDl, max: maxG.glucoseMgPerDl)
    }
    
    /// Simple linear prediction for glucose trends over next N minutes
    /// Uses linear regression on last N samples (default 10)
    func predictGlucose(minutesAhead: Int = 30, sampleCount: Int = 10) -> Double? {
        let recentSamples = glucoseSamples.suffix(sampleCount)
        guard recentSamples.count >= 2 else { return nil }
        
        // x: seconds from first sample, y: glucose
        let t0 = recentSamples.first!.date.timeIntervalSinceReferenceDate
        let xs = recentSamples.map { $0.date.timeIntervalSinceReferenceDate - t0 }
        let ys = recentSamples.map { $0.glucoseMgPerDl }
        
        let xMean = xs.reduce(0, +) / Double(xs.count)
        let yMean = ys.reduce(0, +) / Double(ys.count)
        
        let numerator = zip(xs, ys).map { ($0 - xMean) * ($1 - yMean) }.reduce(0, +)
        let denominator = xs.map { ($0 - xMean) * ($0 - xMean) }.reduce(0, +)
        guard denominator != 0 else { return nil }
        
        let slope = numerator / denominator
        let intercept = yMean - slope * xMean
        
        let futureX = xs.last! + Double(minutesAhead * 60)
        let prediction = slope * futureX + intercept
        return max(prediction, 0)
    }
    
    // MARK: - Alert Threshold Monitoring
    
    /// Checks current glucose levels against thresholds and returns alerts if any
    func checkAlerts() -> [GlucoseAlert] {
        guard let latestSample = glucoseSamples.last else { return [] }
        var alerts: [GlucoseAlert] = []
        
        if latestSample.glucoseMgPerDl < lowGlucoseThreshold {
            alerts.append(.low(glucose: latestSample.glucoseMgPerDl, date: latestSample.date))
        } else if latestSample.glucoseMgPerDl > highGlucoseThreshold {
            alerts.append(.high(glucose: latestSample.glucoseMgPerDl, date: latestSample.date))
        }
        return alerts
    }
    
    enum GlucoseAlert: Equatable {
        case low(glucose: Double, date: Date)
        case high(glucose: Double, date: Date)
    }
    
    // MARK: - Data Export
    
    /// Export glucose data as CSV string
    func exportDataAsCSV() throws -> String {
        guard !glucoseSamples.isEmpty else {
            throw GlucoseMonitorError.exportFailed
        }
        
        var csv = "Date,Glucose (mg/dL),Source\n"
        let formatter = ISO8601DateFormatter()
        
        for sample in glucoseSamples {
            let dateString = formatter.string(from: sample.date)
            let sourceString = sample.source.rawValue
            csv.append("\(dateString),\(String(format: "%.1f", sample.glucoseMgPerDl)),\(sourceString)\n")
        }
        return csv
    }
    
    /// Export glucose data as JSON Data
    func exportDataAsJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(glucoseSamples)
    }
    
    // MARK: - CGM Integration Placeholder
    
    /// This method should be connected to a real CGM data source to receive live updates.
    /// Here we provide a stub to demonstrate data intake.
    func receiveCGMSample(date: Date, glucoseMgPerDl: Double) {
        let sample = GlucoseSample(date: date, glucoseMgPerDl: glucoseMgPerDl, source: .cgmSensor)
        mergeSamples(newSamples: [sample])
    }
}
```