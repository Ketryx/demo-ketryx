```swift
import Foundation
import UIKit

final class APIClient {

    static let shared = APIClient()

    // MARK: - Configuration

    private let baseURL: URL
    private let session: URLSession
    private let jsonDecoder: JSONDecoder
    private let jsonEncoder: JSONEncoder
    private let timeoutInterval: TimeInterval = 30
    private let maxRetryCount = 2

    // MARK: - Authentication

    private var authToken: String? {
        didSet { updateAuthorizationHeader() }
    }

    private var defaultHeaders: [String: String] = [:]

    // MARK: - Offline Support

    private var isOfflineModeEnabled = false
    private var requestQueue = [QueuedRequest]()
    private var isProcessingQueue = false

    // MARK: - SSL Pinning

    private let pinnedCertificates: [Data]

    // MARK: - Init

    private init() {
        guard let url = URL(string: "https://api.patientapp.example.com") else {
            fatalError("Invalid base URL")
        }
        self.baseURL = url

        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = timeoutInterval
        sessionConfig.httpAdditionalHeaders = ["Accept": "application/json"]
        self.session = URLSession(configuration: sessionConfig, delegate: nil, delegateQueue: nil)

        self.jsonDecoder = JSONDecoder()
        self.jsonEncoder = JSONEncoder()

        self.pinnedCertificates = APIClient.loadPinnedCertificates()

        NotificationCenter.default.addObserver(self, selector: #selector(networkStatusChanged), name: .reachabilityChanged, object: nil)
        self.isOfflineModeEnabled = !Reachability.isConnectedToNetwork()
        if !isOfflineModeEnabled {
            processQueue()
        }
    }

    // MARK: - Public API

    func updateAuthToken(_ token: String?) {
        self.authToken = token
    }

    /// Enable or disable offline mode manually (useful for testing or explicit user control)
    func setOfflineMode(_ enabled: Bool) {
        isOfflineModeEnabled = enabled
        if !enabled {
            processQueue()
        }
    }

    /// Perform a request with Codable response and optional Codable body
    func request<T: Codable, U: Codable>(endpoint: String,
                                         method: HTTPMethod = .get,
                                         body: U? = nil,
                                         additionalHeaders: [String: String]? = nil,
                                         retryCount: Int = 0,
                                         completion: @escaping (Result<T, APIClientError>) -> Void) {
        do {
            let urlRequest = try buildRequest(endpoint: endpoint, method: method, body: body, additionalHeaders: additionalHeaders)

            if isOfflineModeEnabled {
                enqueueRequest(urlRequest, expecting: T.self, completion: completion)
                return
            }

            performRequest(urlRequest, expecting: T.self, retryCount: retryCount, completion: completion)
        } catch {
            completion(.failure(.requestBuildingFailed(error)))
        }
    }

    // MARK: - Private Logic

    private func buildRequest<U: Codable>(endpoint: String,
                                          method: HTTPMethod,
                                          body: U?,
                                          additionalHeaders: [String: String]?) throws -> URLRequest {
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue

        for (key, value) in defaultHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if let addHeaders = additionalHeaders {
            for (key, value) in addHeaders {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try jsonEncoder.encode(body)
        }

        return request
    }

    private func performRequest<T: Codable>(_ request: URLRequest,
                                            expecting type: T.Type,
                                            retryCount: Int,
                                            completion: @escaping (Result<T, APIClientError>) -> Void) {
        logRequest(request)

        let delegate = PinnedSessionDelegate(pinnedCertificates: pinnedCertificates)

        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = timeoutInterval
        let pinnedSession = URLSession(configuration: sessionConfig, delegate: delegate, delegateQueue: nil)

        let task = pinnedSession.dataTask(with: request) { data, response, error in
            self.logResponse(response, data: data, error: error)

            if let error = error as NSError?, error.domain == NSURLErrorDomain,
               (error.code == NSURLErrorNotConnectedToInternet || error.code == NSURLErrorNetworkConnectionLost) {
                self.enableOfflineModeAndQueue(request, expecting: type, completion: completion)
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(.invalidResponse))
                return
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                if retryCount < self.maxRetryCount, httpResponse.statusCode >= 500 {
                    // Retry on server errors
                    self.performRequest(request, expecting: type, retryCount: retryCount + 1, completion: completion)
                } else {
                    completion(.failure(.httpError(statusCode: httpResponse.statusCode)))
                }
                return
            }

            guard let data = data else {
                completion(.failure(.noData))
                return
            }

            do {
                let decoded = try self.jsonDecoder.decode(type, from: data)
                completion(.success(decoded))
            } catch let decodeError {
                completion(.failure(.decodingFailed(decodeError)))
            }
        }
        task.resume()
    }

    private func enableOfflineModeAndQueue<T: Codable>(_ request: URLRequest,
                                                       expecting: T.Type,
                                                       completion: @escaping (Result<T, APIClientError>) -> Void) {
        DispatchQueue.main.async {
            if !self.isOfflineModeEnabled {
                self.isOfflineModeEnabled = true
            }
            self.enqueueRequest(request, expecting: expecting, completion: completion)
        }
    }

    private func enqueueRequest<T: Codable>(_ request: URLRequest,
                                            expecting: T.Type,
                                            completion: @escaping (Result<T, APIClientError>) -> Void) {
        let queued = QueuedRequest(request: request, responseType: expecting, completion: { result in
            completion(result)
        })
        requestQueue.append(queued)
        log("Request queued due to offline mode. Queue size: \(requestQueue.count)")
    }

    private func processQueue() {
        guard !isProcessingQueue else { return }
        isProcessingQueue = true

        guard !requestQueue.isEmpty else {
            isProcessingQueue = false
            return
        }

        let queuedRequest = requestQueue.removeFirst()

        performRequest(queuedRequest.request, expecting: queuedRequest.responseType, retryCount: 0) { result in
            DispatchQueue.main.async {
                queuedRequest.completion(result)
                self.processQueue()
            }
        }
    }

    private func updateAuthorizationHeader() {
        if let token = authToken {
            defaultHeaders["Authorization"] = "Bearer \(token)"
        } else {
            defaultHeaders["Authorization"] = nil
        }
    }

    // MARK: - Logging

    private func logRequest(_ request: URLRequest) {
#if DEBUG
        let method = request.httpMethod ?? "UNKNOWN"
        let url = request.url?.absoluteString ?? "No URL"
        var bodyString = ""
        if let body = request.httpBody, let str = String(data: body, encoding: .utf8) {
            bodyString = "\nBody: \(str)"
        }
        print("[APIClient] Request: \(method) \(url)\(bodyString)")
#endif
    }

    private func logResponse(_ response: URLResponse?, data: Data?, error: Error?) {
#if DEBUG
        if let response = response as? HTTPURLResponse {
            print("[APIClient] Response: \(response.statusCode) \(response.url?.absoluteString ?? "")")
        }
        if let error = error {
            print("[APIClient] Error: \(error.localizedDescription)")
        }
        if let data = data, let string = String(data: data, encoding: .utf8), !string.isEmpty {
            print("[APIClient] Data: \(string)")
        }
#endif
    }

    private func log(_ message: String) {
#if DEBUG
        print("[APIClient] \(message)")
#endif
    }

    // MARK: - SSL Pinning Support

    private static func loadPinnedCertificates() -> [Data] {
        // Certificates should be added to the app bundle with extension .cer
        let certNames = ["patientapp_cert"] // put your cert file names here (without extension)
        var certificates = [Data]()

        for name in certNames {
            if let certPath = Bundle.main.path(forResource: name, ofType: "cer"),
               let certData = try? Data(contentsOf: URL(fileURLWithPath: certPath)) {
                certificates.append(certData)
            }
        }
        return certificates
    }

    // MARK: - Network Status Observer

    @objc private func networkStatusChanged(notification: Notification) {
        if Reachability.isConnectedToNetwork() {
            isOfflineModeEnabled = false
            processQueue()
        } else {
            isOfflineModeEnabled = true
        }
    }
}

// MARK: - Helpers & Types

private struct QueuedRequest {
    let request: URLRequest
    let responseType: Codable.Type
    let completion: (Result<Codable, APIClientError>) -> Void

    init<T: Codable>(request: URLRequest, responseType: T.Type, completion: @escaping (Result<T, APIClientError>) -> Void) {
        self.request = request
        self.responseType = responseType
        // Wrap completion to (Result<Codable, APIClientError>) via upcast
        self.completion = { result in
            switch result {
            case .success(let value):
                guard let typedValue = value as? T else { return }
                completion(.success(typedValue))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }
}

enum APIClientError: Error {
    case invalidURL
    case requestBuildingFailed(Error)
    case invalidResponse
    case httpError(statusCode: Int)
    case noData
    case decodingFailed(Error)
}

// HTTP Methods enum
enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

// MARK: - URLSessionDelegate for SSL Pinning

private class PinnedSessionDelegate: NSObject, URLSessionDelegate {
    private let pinnedCertificates: [Data]

    init(pinnedCertificates: [Data]) {
        self.pinnedCertificates = pinnedCertificates
    }

    func urlSession(_ session: URLSession,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {

        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let serverCertificateCount = SecTrustGetCertificateCount(serverTrust)
        for i in 0..<serverCertificateCount {
            if let serverCertificate = SecTrustGetCertificateAtIndex(serverTrust, i) {
                let serverCertificateData = SecCertificateCopyData(serverCertificate) as Data
                if pinnedCertificates.contains(serverCertificateData) {
                    let credential = URLCredential(trust: serverTrust)
                    completionHandler(.useCredential, credential)
                    return
                }
            }
        }

        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}

// MARK: - Reachability helper (basic)

private extension Reachability {
    static func isConnectedToNetwork() -> Bool {
        // Simplified connectivity check
        guard let reachability = Reachability() else { return false }
        switch reachability.connection {
        case .wifi, .cellular:
            return true
        default:
            return false
        }
    }
}

// Dummy Reachability class placeholder for compiling
// Replace with your own Reachability implementation or library like 'ReachabilitySwift'
private class Reachability {
    enum Connection {
        case wifi, cellular, none, unknown
    }

    var connection: Connection = .unknown

    init?() { }

    static let reachabilityChanged = Notification.Name("ReachabilityChangedNotification")

    static func startNotifier() throws { }

    static func stopNotifier() { }
}
```