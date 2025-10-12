```swift
import Foundation
import Combine
import simd

final class VisualizationViewModel: ObservableObject {
    enum LoadingState {
        case idle
        case loading
        case success
        case failure(Error)
    }
    
    struct Blockage: Identifiable {
        let id: UUID
        let location: SIMD3<Float>
        let severity: Int
        let description: String
    }
    
    // MARK: - Published Properties
    @Published private(set) var modelData: Model3DData?
    @Published private(set) var blockages: [Blockage] = []
    @Published var filteredBlockages: [Blockage] = []
    @Published var loadingState: LoadingState = .idle
    
    @Published var selectedBlockageID: UUID?
    @Published var modelRotation: SIMD3<Float> = .zero
    @Published var blockageSeverityFilter: ClosedRange<Int> = 0...10
    
    // MARK: - Private Properties
    
    private let anomalyDetectionService: AnomalyDetectionServiceProtocol
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    init(anomalyDetectionService: AnomalyDetectionServiceProtocol = AnomalyDetectionService.shared) {
        self.anomalyDetectionService = anomalyDetectionService
        
        $blockageSeverityFilter
            .combineLatest($blockages)
            .map { range, blockages in
                blockages.filter { range.contains($0.severity) }
            }
            .receive(on: DispatchQueue.main)
            .assign(to: &$filteredBlockages)
    }
    
    // MARK: - Public Methods
    
    func loadVisualization(for patientID: String) {
        loadingState = .loading
        modelData = nil
        blockages = []
        selectedBlockageID = nil
        
        Task {
            do {
                let loadedModelData = try await loadModelData(for: patientID)
                await MainActor.run {
                    self.modelData = loadedModelData
                }
                
                let detectedBlockages = try await anomalyDetectionService.detectBlockages(in: loadedModelData)
                await MainActor.run {
                    self.blockages = detectedBlockages
                    self.loadingState = .success
                }
            } catch {
                await MainActor.run {
                    self.loadingState = .failure(error)
                }
            }
        }
    }
    
    func rotateModel(by delta: SIMD3<Float>) {
        modelRotation += delta
    }
    
    func selectBlockage(withID id: UUID?) {
        selectedBlockageID = id
    }
    
    func updateBlockageSeverityFilter(to range: ClosedRange<Int>) {
        blockageSeverityFilter = range
    }
    
    func resetState() {
        modelData = nil
        blockages = []
        filteredBlockages = []
        modelRotation = .zero
        selectedBlockageID = nil
        blockageSeverityFilter = 0...10
        loadingState = .idle
    }
    
    // MARK: - Private Helpers
    
    private func loadModelData(for patientID: String) async throws -> Model3DData {
        // Placeholder for model loading implementation.
        // This might involve network calls, local file reads, or database queries.
        try await Task.sleep(nanoseconds: 300_000_000) // Simulate delay
        guard let data = MockModelRepository.shared.model(forPatientID: patientID) else {
            throw VisualizationError.modelNotFound
        }
        return data
    }
}

// MARK: - Supporting Types and Protocols

protocol AnomalyDetectionServiceProtocol {
    func detectBlockages(in modelData: Model3DData) async throws -> [VisualizationViewModel.Blockage]
}

enum VisualizationError: LocalizedError {
    case modelNotFound
    
    var errorDescription: String? {
        switch self {
        case .modelNotFound:
            return "3D model data for the patient could not be found."
        }
    }
}

struct Model3DData {
    let vertices: [SIMD3<Float>]
    let indices: [UInt32]
}

// Mock repository for demonstration purposes.
fileprivate class MockModelRepository {
    static let shared = MockModelRepository()
    
    private var storedModels: [String: Model3DData] = [:]
    
    private init() {
        storedModels["patient123"] = Model3DData(
            vertices: [SIMD3<Float>(0,0,0), SIMD3<Float>(1,0,0), SIMD3<Float>(0,1,0)],
            indices: [0,1,2]
        )
    }
    
    func model(forPatientID id: String) -> Model3DData? {
        storedModels[id]
    }
}
```