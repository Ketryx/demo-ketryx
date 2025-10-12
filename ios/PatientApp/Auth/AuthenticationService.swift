```swift
import Foundation
import LocalAuthentication
import Security
import UIKit
import os.log

final class AuthenticationService {
    // MARK: - Types
    
    enum AuthError: Error {
        case biometricUnavailable
        case biometricFailed
        case pinInvalid
        case accountLocked
        case tokenRefreshFailed
        case credentialSaveFailed
        case credentialLoadFailed
        case sessionExpired
    }
    
    // MARK: - Constants
    
    private let keychainService = "com.patientapp.auth"
    private let keychainAccount = "userCredentials"
    private let maxFailedAttempts = 5
    private let lockoutDuration: TimeInterval = 15 * 60 // 15 minutes
    private let sessionTimeout: TimeInterval = 30 * 60 // 30 minutes
    private let auditLogCategory = "com.patientapp.AuthAudit"
    
    private let context = LAContext()
    private let log = OSLog(subsystem: Bundle.main.bundleIdentifier ?? "com.patientapp", category: "AuthenticationService")
    
    // MARK: - Properties
    
    private var failedAttempts: Int {
        get { UserDefaults.standard.integer(forKey: "failedAttempts") }
        set { UserDefaults.standard.set(newValue, forKey: "failedAttempts") }
    }
    
    private var lockoutUntil: Date? {
        get { UserDefaults.standard.object(forKey: "lockoutUntil") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "lockoutUntil") }
    }
    
    private var sessionExpiry: Date? {
        get { UserDefaults.standard.object(forKey: "sessionExpiry") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "sessionExpiry") }
    }
    
    private var userToken: String? {
        get { UserDefaults.standard.string(forKey: "userToken") }
        set { UserDefaults.standard.set(newValue, forKey: "userToken") }
    }
    
    private var tokenExpiry: Date? {
        get { UserDefaults.standard.object(forKey: "tokenExpiry") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "tokenExpiry") }
    }
    
    // MARK: - Public API
    
    static let shared = AuthenticationService()
    private init() {}
    
    // MARK: Biometric Authentication
    
    func authenticateWithBiometrics(completion: @escaping (Result<Void, AuthError>) -> Void) {
        guard canEvaluateBiometrics() else {
            logAudit(event: "Biometric unavailable")
            completion(.failure(.biometricUnavailable))
            return
        }
        
        context.localizedCancelTitle = "Use PIN"
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "Authenticate to access your account") { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if success {
                    self.resetFailedAttempts()
                    self.refreshSession()
                    self.logAudit(event: "Biometric authentication succeeded")
                    completion(.success(()))
                } else {
                    self.incrementFailedAttempts()
                    self.logAudit(event: "Biometric authentication failed")
                    completion(.failure(.biometricFailed))
                }
            }
        }
    }
    
    func canEvaluateBiometrics() -> Bool {
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        return canEvaluate
    }
    
    // MARK: PIN Login
    
    func verifyPin(_ pin: String, completion: @escaping (Result<Void, AuthError>) -> Void) {
        guard !isAccountLocked() else {
            logAudit(event: "Attempted PIN login on locked account")
            completion(.failure(.accountLocked))
            return
        }
        
        guard let savedPin = try? retrieveSecurePin(), savedPin == pin else {
            incrementFailedAttempts()
            logAudit(event: "Invalid PIN entered")
            if failedAttempts >= maxFailedAttempts {
                lockAccount()
                logAudit(event: "Account locked due to multiple failed attempts")
                completion(.failure(.accountLocked))
            } else {
                completion(.failure(.pinInvalid))
            }
            return
        }
        resetFailedAttempts()
        refreshSession()
        logAudit(event: "PIN authentication succeeded")
        completion(.success(()))
    }
    
    func savePin(_ pin: String) throws {
        guard Self.isStrongPin(pin) else { throw AuthError.pinInvalid }
        try storeSecurePin(pin)
        logAudit(event: "PIN saved securely")
    }
    
    // MARK: Password Strength Validation
    
    static func isStrongPin(_ pin: String) -> Bool {
        let pinRegex = "^[0-9]{4,6}$"
        return NSPredicate(format: "SELF MATCHES %@", pinRegex).evaluate(with: pin)
    }
    
    static func isStrongPassword(_ password: String) -> Bool {
        // Minimum 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
        let passwordRegex = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$&*])[A-Za-z\\d!@#$&*]{8,}$"
        return NSPredicate(format: "SELF MATCHES %@", passwordRegex).evaluate(with: password)
    }
    
    // MARK: Account Lockout
    
    func isAccountLocked() -> Bool {
        guard let lockoutUntil = lockoutUntil else { return false }
        if lockoutUntil > Date() {
            return true
        } else {
            // Lockout expired
            self.lockoutUntil = nil
            resetFailedAttempts()
            return false
        }
    }
    
    private func lockAccount() {
        lockoutUntil = Date().addingTimeInterval(lockoutDuration)
        failedAttempts = maxFailedAttempts
    }
    
    private func incrementFailedAttempts() {
        failedAttempts += 1
    }
    
    private func resetFailedAttempts() {
        failedAttempts = 0
    }
    
    // MARK: Keychain Storage (PIN)
    
    private func storeSecurePin(_ pin: String) throws {
        let pinData = pin.data(using: .utf8)!
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".pin"
        ]
        SecItemDelete(query as CFDictionary)
        
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".pin",
            kSecValueData as String: pinData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            throw AuthError.credentialSaveFailed
        }
    }
    
    private func retrieveSecurePin() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".pin",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let pin = String(data: data, encoding: .utf8)
        else {
            throw AuthError.credentialLoadFailed
        }
        return pin
    }
    
    // MARK: Session Management
    
    func refreshSession() {
        sessionExpiry = Date().addingTimeInterval(sessionTimeout)
    }
    
    func isSessionActive() -> Bool {
        guard let expiry = sessionExpiry else { return false }
        if expiry > Date() {
            return true
        } else {
            sessionExpiry = nil
            logAudit(event: "Session expired")
            return false
        }
    }
    
    func invalidateSession() {
        sessionExpiry = nil
        logAudit(event: "Session invalidated")
    }
    
    // MARK: OAuth Token Management (Dummy placeholder)
    
    func saveToken(_ token: String, expiresIn: TimeInterval) {
        userToken = token
        tokenExpiry = Date().addingTimeInterval(expiresIn)
        logAudit(event: "Token saved with expiry \(expiresIn)s")
    }
    
    func getValidToken(completion: @escaping (Result<String, AuthError>) -> Void) {
        guard let token = userToken,
              let expiry = tokenExpiry,
              expiry > Date() else {
            logAudit(event: "Token expired or missing, attempting refresh")
            refreshToken { result in
                switch result {
                case .success(let newToken):
                    completion(.success(newToken))
                case .failure:
                    completion(.failure(.tokenRefreshFailed))
                }
            }
            return
        }
        completion(.success(token))
    }
    
    private func refreshToken(completion: @escaping (Result<String, AuthError>) -> Void) {
        // Simulate async token refresh
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            let newToken = UUID().uuidString
            self.saveToken(newToken, expiresIn: 3600)
            self.logAudit(event: "Token refreshed successfully")
            completion(.success(newToken))
        }
    }
    
    // MARK: Audit Logging (HIPAA-compliant)
    
    private func logAudit(event: String) {
        // Use os_log with privacy considerations
        os_log("AUDIT EVENT: %{public}@", log: log, type: .info, event)
        // Extend this method to securely log to internal or remote HIPAA-compliant logging service if needed
    }
    
    // MARK: Secure Credential Storage (Optional Password Storage)
    
    func savePassword(_ password: String) throws {
        guard Self.isStrongPassword(password) else { throw AuthError.pinInvalid }
        
        let passwordData = password.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".password"
        ]
        SecItemDelete(query as CFDictionary)
        
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".password",
            kSecValueData as String: passwordData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            throw AuthError.credentialSaveFailed
        }
        logAudit(event: "Password saved securely")
    }
    
    func retrievePassword() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount + ".password",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let password = String(data: data, encoding: .utf8)
        else {
            throw AuthError.credentialLoadFailed
        }
        return password
    }
}
```