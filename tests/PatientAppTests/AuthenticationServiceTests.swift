```swift
import XCTest
@testable import PatientApp
import LocalAuthentication

final class AuthenticationServiceTests: XCTestCase {

    var authService: AuthenticationService!
    var mockContext: MockLAContext!
    var mockSecureStore: MockSecureStore!
    var mockAuditLogger: MockAuditLogger!

    override func setUp() {
        super.setUp()
        mockContext = MockLAContext()
        mockSecureStore = MockSecureStore()
        mockAuditLogger = MockAuditLogger()
        authService = AuthenticationService(
            laContextFactory: { self.mockContext },
            secureStore: mockSecureStore,
            auditLogger: mockAuditLogger
        )
    }

    override func tearDown() {
        authService = nil
        mockContext = nil
        mockSecureStore = nil
        mockAuditLogger = nil
        super.tearDown()
    }

    // MARK: - Biometric Authentication Flows

    func testSuccessfulBiometricAuthentication() {
        mockContext.canEvaluatePolicyResult = true
        mockContext.evaluatePolicyResult = true

        let expect = expectation(description: "Biometric succeeds")
        authService.authenticateWithBiometrics { success in
            XCTAssertTrue(success)
            expect.fulfill()
        }
        waitForExpectations(timeout: 1)
        XCTAssertEqual(mockAuditLogger.loggedEvents.last, .biometricSuccess)
    }

    func testFailedBiometricAuthenticationFallsBackToPIN() {
        mockContext.canEvaluatePolicyResult = true
        mockContext.evaluatePolicyResult = false

        mockSecureStore.storedPIN = "1234"

        let expect = expectation(description: "PIN fallback succeeds")
        authService.authenticateWithBiometrics { success in
            XCTAssertFalse(success)
            self.authService.authenticateWithPIN("1234") { pinSuccess in
                XCTAssertTrue(pinSuccess)
                expect.fulfill()
            }
        }
        waitForExpectations(timeout: 2)
        XCTAssertEqual(mockAuditLogger.loggedEvents.prefix(2), [.biometricFail, .pinSuccess])
    }

    // MARK: - PIN Fallback Works Correctly

    func testPINFallbackFailure() {
        mockContext.canEvaluatePolicyResult = true
        mockContext.evaluatePolicyResult = false
        mockSecureStore.storedPIN = "1234"

        let expect = expectation(description: "PIN fallback fails with wrong PIN")
        authService.authenticateWithBiometrics { success in
            XCTAssertFalse(success)
            self.authService.authenticateWithPIN("0000") { pinSuccess in
                XCTAssertFalse(pinSuccess)
                expect.fulfill()
            }
        }
        waitForExpectations(timeout: 2)
        XCTAssertEqual(mockAuditLogger.loggedEvents.suffix(2), [.biometricFail, .pinFail])
    }

    // MARK: - Session Timeout Enforcement

    func testSessionTimeoutEnforced() {
        authService.startSession()
        XCTAssertTrue(authService.isSessionActive)

        // Simulate advancing time beyond timeout interval
        let timeoutInterval: TimeInterval = authService.sessionTimeoutInterval
        authService.sessionStartDate = Date().addingTimeInterval(-timeoutInterval - 1)

        XCTAssertFalse(authService.isSessionActive)
    }

    // MARK: - Audit Logging Captures Events

    func testAuditLoggingRecordsEvents() {
        mockContext.canEvaluatePolicyResult = true
        mockContext.evaluatePolicyResult = true

        let expect = expectation(description: "Audit logging test")
        authService.authenticateWithBiometrics { _ in
            self.authService.authenticateWithPIN("1234") { _ in
                self.authService.lockAccount()
                expect.fulfill()
            }
        }
        waitForExpectations(timeout: 3)

        XCTAssertTrue(mockAuditLogger.loggedEvents.contains(.biometricSuccess))
        XCTAssertTrue(mockAuditLogger.loggedEvents.contains(.pinFail) == false)
        XCTAssertTrue(mockAuditLogger.loggedEvents.contains(.accountLocked))
    }

    // MARK: - Account Lockout After Failed Attempts

    func testAccountLockoutAfterFailedPINAttempts() {
        mockSecureStore.storedPIN = "1234"
        let maxAttempts = authService.maxFailedAttempts

        let expect = expectation(description: "Account lockout after max failures")
        expect.expectedFulfillmentCount = maxAttempts + 1

        for i in 1...maxAttempts + 1 {
            authService.authenticateWithPIN("0000") { success in
                XCTAssertFalse(success)
                if i == maxAttempts + 1 {
                    XCTAssertTrue(self.authService.isAccountLocked)
                }
                expect.fulfill()
            }
        }
        waitForExpectations(timeout: 5)
        XCTAssertTrue(mockAuditLogger.loggedEvents.contains(.accountLocked))
    }

    // MARK: - Secure Credential Storage

    func testSecureStorageSavesAndRetrievesCredentials() {
        let credentials = Credentials(username: "user1", token: "token123")
        authService.saveCredentials(credentials)

        let retrieved = authService.getStoredCredentials()
        XCTAssertEqual(retrieved?.username, credentials.username)
        XCTAssertEqual(retrieved?.token, credentials.token)
    }
}

// MARK: - Mocks

final class MockLAContext: LAContextProtocol {
    var canEvaluatePolicyResult = true
    var evaluatePolicyResult = true

    func canEvaluatePolicy(_ policy: LAPolicy, error: NSErrorPointer) -> Bool {
        return canEvaluatePolicyResult
    }

    func evaluatePolicy(_ policy: LAPolicy,
                        localizedReason: String,
                        reply: @escaping (Bool, Error?) -> Void) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
            if self.evaluatePolicyResult {
                reply(true, nil)
            } else {
                let error = NSError(domain: LAError.errorDomain, code: LAError.authenticationFailed.rawValue)
                reply(false, error)
            }
        }
    }
}

final class MockSecureStore: SecureStoreProtocol {
    private var credentialsStorage: Credentials?
    var storedPIN: String?

    func saveCredentials(_ credentials: Credentials) {
        credentialsStorage = credentials
    }

    func retrieveCredentials() -> Credentials? {
        credentialsStorage
    }

    func savePIN(_ pin: String) {
        storedPIN = pin
    }

    func retrievePIN() -> String? {
        storedPIN
    }
}

final class MockAuditLogger: AuditLoggerProtocol {
    private(set) var loggedEvents: [AuditEvent] = []

    func logEvent(_ event: AuditEvent) {
        loggedEvents.append(event)
    }
}
```