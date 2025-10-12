```swift
import Foundation
import Combine
import Network

final class AnomalyDetectionService {
    static let shared = AnomalyDetectionService()
    
    // MARK: - Public Publishers
    @Published private(set) var anomalies: [AnomalyUIModel] = []
    @Published private(set) var errorMessage: String? = nil
    @Published private(set) var isNetworkAvailable: Bool = true
    
    // MARK: - Private Properties
    private let apiURL = URL(string: "https://api.cardiacviz.com/anomalies")!
    private let modelURL = URL(string: "https://api.cardiacviz.com/model/anomaly_detection_model")!
    
    private var cancellables = Set<AnyCancellable>()
    private var modelCache: AnomalyDetectionModel?
    private var retryCount = 0
    private let maxRetries = 3
    
    private let networkMonitor = NWPathMonitor()
    private let networkQueue = DispatchQueue(label: "AnomalyDetectionService.NetworkMonitor")
    
    private let realtimeUpdatesURL = URL(string: "wss://api.cardiacviz.com/anomalies/stream")!
    private var realtimeWebSocketTask: URLSessionWebSocketTask?
    
    private var urlSession: URLSession {
        URLSession(configuration: .default)
    }
    
    // MARK: - Initialization
    private init() {
        monitorNetwork()
        subscribeToRealtimeUpdates()
    }
    
    // MARK: - Public API
    
    func loadModelIfNeeded() async throws {
        if modelCache != nil { return }
        do {
            let modelData = try await fetchModelData()
            let model = try AnomalyDetectionModel(data: modelData)
            modelCache = model
        } catch {
            throw error
        }
    }
    
    func fetchAnomalies() async {
        guard isNetworkAvailable else {
            DispatchQueue.main.async {
                self.errorMessage = "No network connection. Please check your internet settings."
            }
            return
        }
        
        do {
            retryCount = 0
            let data = try await fetchAnomalyData()
            let anomalies = transformAPIDataToUIModel(data)
            DispatchQueue.main.async {
                self.anomalies = anomalies
                self.errorMessage = nil
            }
        } catch {
            await handleFetchError(error)
        }
    }
    
    // MARK: - Private Methods
    
    private func fetchModelData() async throws -> Data {
        let (data, response) = try await urlSession.data(from: modelURL)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw ServiceError.invalidResponse
        }
        return data
    }
    
    private func fetchAnomalyData() async throws -> Data {
        let (data, response) = try await urlSession.data(from: apiURL)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw ServiceError.invalidResponse
        }
        return data
    }
    
    private func transformAPIDataToUIModel(_ data: Data) -> [AnomalyUIModel] {
        do {
            let apiModels = try JSONDecoder().decode([AnomalyAPIModel].self, from: data)
            return apiModels.map { AnomalyUIModel(from: $0) }
        } catch {
            DispatchQueue.main.async {
                self.errorMessage = "Failed to parse anomaly data."
            }
            return []
        }
    }
    
    private func handleFetchError(_ error: Error) async {
        guard retryCount < maxRetries else {
            DispatchQueue.main.async {
                self.errorMessage = userFriendlyMessage(for: error)
            }
            return
        }
        retryCount += 1
        try? await Task.sleep(nanoseconds: UInt64(1_000_000_000 * pow(2.0, Double(retryCount))))
        await fetchAnomalies()
    }
    
    private func userFriendlyMessage(for error: Error) -> String {
        switch error {
        case is URLError:
            return "Network error occurred. Please try again later."
        case ServiceError.invalidResponse:
            return "Received invalid data from server."
        default:
            return "An unexpected error occurred. Please try again."
        }
    }
    
    private func monitorNetwork() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.isNetworkAvailable = path.status == .satisfied
                if self?.isNetworkAvailable == true {
                    Task {
                        await self?.fetchAnomalies()
                    }
                }
            }
        }
        networkMonitor.start(queue: networkQueue)
    }
    
    private func subscribeToRealtimeUpdates() {
        realtimeWebSocketTask = urlSession.webSocketTask(with: realtimeUpdatesURL)
        realtimeWebSocketTask?.resume()
        listenForUpdates()
    }
    
    private func listenForUpdates() {
        realtimeWebSocketTask?.receive { [weak self] result in
            switch result {
            case .failure(let error):
                DispatchQueue.main.async {
                    self?.errorMessage = "Real-time update error: \(error.localizedDescription)"
                }
                self?.reconnectWebSocket()
                
            case .success(let message):
                self?.handleRealtimeMessage(message)
                self?.listenForUpdates()
            }
        }
    }
    
    private func handleRealtimeMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .data(let data):
            let newAnomalies = transformAPIDataToUIModel(data)
            DispatchQueue.main.async {
                self.anomalies.append(contentsOf: newAnomalies)
            }
        case .string(let text):
            guard let data = text.data(using: .utf8) else { return }
            let newAnomalies = transformAPIDataToUIModel(data)
            DispatchQueue.main.async {
                self.anomalies.append(contentsOf: newAnomalies)
            }
        @unknown default:
            break
        }
    }
    
    private func reconnectWebSocket() {
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.realtimeWebSocketTask?.cancel()
            self?.subscribeToRealtimeUpdates()
        }
    }
}

// MARK: - Models

struct AnomalyAPIModel: Codable {
    let id: String
    let timestamp: TimeInterval
    let severity: Int
    let description: String
}

struct AnomalyUIModel: Identifiable {
    let id: String
    let date: Date
    let severityLevel: SeverityLevel
    let details: String
    
    init(from apiModel: AnomalyAPIModel) {
        self.id = apiModel.id
        self.date = Date(timeIntervalSince1970: apiModel.timestamp)
        self.severityLevel = SeverityLevel(from: apiModel.severity)
        self.details = apiModel.description
    }
    
    enum SeverityLevel {
        case low, medium, high
        
        init(from rawValue: Int) {
            switch rawValue {
            case 0...3: self = .low
            case 4...7: self = .medium
            default: self = .high
            }
        }
    }
}

struct AnomalyDetectionModel {
    // Dummy initializer assumes model data deserialization
    
    init(data: Data) throws {
        // Here model initialization logic would be implemented
        // For example loading ML model, deserializing etc.
        // Throw if corrupted or invalid.
    }
}

// MARK: - Errors

enum ServiceError: Error {
    case invalidResponse
}
```