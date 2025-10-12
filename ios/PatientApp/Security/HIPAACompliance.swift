```swift
import Foundation
import CryptoKit
import os.log
import Network

public enum HIPAACompliance {

    // MARK: - Encryption keys & utilities

    private struct Keys {
        static let symmetricKeyTag = "com.patientapp.hipaa.symmetrickey"
    }

    // Retrieve or create symmetric key for encryption
    private static var symmetricKey: SymmetricKey = {
        if let keyData = KeychainHelper.shared.getKey(tag: Keys.symmetricKeyTag) {
            return SymmetricKey(data: keyData)
        } else {
            let newKey = SymmetricKey(size: .bits256)
            KeychainHelper.shared.saveKey(newKey.dataRepresentation, tag: Keys.symmetricKeyTag)
            return newKey
        }
    }()


    // MARK: - Data Encryption At Rest

    public static func encryptDataAtRest(_ data: Data) throws -> Data {
        let sealedBox = try AES.GCM.seal(data, using: symmetricKey)
        return sealedBox.combined!
    }

    public static func decryptDataAtRest(_ encryptedData: Data) throws -> Data {
        let sealedBox = try AES.GCM.SealedBox(combined: encryptedData)
        return try AES.GCM.open(sealedBox, using: symmetricKey)
    }


    // MARK: - Data Encryption In Transit

    /// Secure data transmission using TLS enforced by URLSession by default
    /// For manual encryption if needed:
    public static func encryptDataInTransit(_ data: Data, with publicKey: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let encryptedData = SecKeyCreateEncryptedData(publicKey,
                                                            SecKeyAlgorithm.rsaEncryptionOAEPSHA256,
                                                            data as CFData,
                                                            &error) as Data? else {
            throw error!.takeRetainedValue() as Error
        }
        return encryptedData
    }

    public static func decryptDataInTransit(_ encryptedData: Data, with privateKey: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let decryptedData = SecKeyCreateDecryptedData(privateKey,
                                                            SecKeyAlgorithm.rsaEncryptionOAEPSHA256,
                                                            encryptedData as CFData,
                                                            &error) as Data? else {
            throw error!.takeRetainedValue() as Error
        }
        return decryptedData
    }


    // MARK: - Audit Logging

    private static let log = OSLog(subsystem: "com.patientapp.hipaa", category: "Audit")

    public static func logDataAccess(userID: String, dataIdentifier: String, accessType: AccessType) {
        os_log("User %{public}@ accessed data %{public}@ with access type %{public}@", log: log, type: .info, userID, dataIdentifier, accessType.rawValue)
    }

    public enum AccessType: String {
        case read = "READ"
        case write = "WRITE"
        case delete = "DELETE"
        case modify = "MODIFY"
    }


    // MARK: - Secure Data Deletion

    /// Overwrites data and removes references securely
    public static func secureDelete(dataURL: URL) throws {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: dataURL.path) else { return }
        let fileSize = try fileManager.attributesOfItem(atPath: dataURL.path)[.size] as? Int ?? 0
        guard fileSize > 0 else {
            try fileManager.removeItem(at: dataURL)
            return
        }
        // Overwrite file content with zeros
        let handle = try FileHandle(forWritingTo: dataURL)
        handle.seek(toFileOffset: 0)
        let zeroData = Data(repeating: 0, count: min(fileSize, 1024 * 1024)) // up to 1MB chunks
        var bytesLeft = fileSize
        while bytesLeft > 0 {
            let writeSize = min(bytesLeft, zeroData.count)
            handle.write(zeroData.prefix(writeSize))
            bytesLeft -= writeSize
        }
        try handle.close()
        try fileManager.removeItem(at: dataURL)
    }


    // MARK: - User Consent Management

    private static let consentKey = "com.patientapp.hipaa.userConsent"

    public static var userHasConsented: Bool {
        get {
            UserDefaults.standard.bool(forKey: consentKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: consentKey)
        }
    }

    public static func requestUserConsent(completion: @escaping (Bool) -> Void) {
        // Implementation should prompt user UI outside this utility
        completion(userHasConsented)
    }


    // MARK: - Data Retention Policies

    /// Validate if data is expired per policy and remove if necessary
    public static func enforceDataRetention(for dataURL: URL, retentionPeriodDays: Int) throws {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: dataURL.path) else { return }
        let attrs = try fileManager.attributesOfItem(atPath: dataURL.path)
        guard let creationDate = attrs[.creationDate] as? Date else { return }
        let expiryDate = creationDate.addingTimeInterval(TimeInterval(retentionPeriodDays * 24 * 60 * 60))
        if Date() > expiryDate {
            try secureDelete(dataURL: dataURL)
            os_log("Data at %{public}@ deleted due to retention policy", log: log, type: .info, dataURL.path)
        }
    }


    // MARK: - Privacy Controls

    public enum PrivacyLevel {
        case restricted    // access needs explicit authorization
        case internalOnly  // only internal app modules can access
        case publicData    // no restrictions
    }

    public static func checkAccessPrivileges(for userRole: UserRole, dataPrivacy: PrivacyLevel) -> Bool {
        switch dataPrivacy {
        case .publicData:
            return true

        case .internalOnly:
            return userRole == .internalUser || userRole == .admin

        case .restricted:
            return userRole == .admin
        }
    }

    public enum UserRole {
        case guest
        case internalUser
        case admin
    }


    // MARK: - Secure Communication Helpers

    public static func createSecureConnection(to host: String, port: NWEndpoint.Port) -> NWConnection {
        let parameters = NWParameters.tls
        parameters.defaultProtocolStack.applicationProtocols.insert(NWProtocolFramer.Options(definition: NWProtocolFramer.Definition()), at: 0)
        let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: parameters)
        return connection
    }


    // MARK: - Compliance Violation Detection

    /// Basic monitoring for unauthorized access attempts and policy violations
    public static func detectComplianceViolations(events: [AuditEvent]) -> [ComplianceViolation] {
        var violations = [ComplianceViolation]()

        for event in events {
            // Detect access without consent
            if !userHasConsented && (event.accessType == .read || event.accessType == .write) {
                violations.append(.missingUserConsent(userID: event.userID))
            }
            // Detect unauthorized role access to restricted data
            if !checkAccessPrivileges(for: event.userRole, dataPrivacy: event.dataPrivacy) {
                violations.append(.unauthorizedAccess(userID: event.userID, dataID: event.dataIdentifier))
            }
        }
        return violations
    }

    public struct AuditEvent {
        public let userID: String
        public let dataIdentifier: String
        public let accessType: AccessType
        public let userRole: UserRole
        public let dataPrivacy: PrivacyLevel
        public let timestamp: Date
    }

    public enum ComplianceViolation: Error, CustomStringConvertible {
        case missingUserConsent(userID: String)
        case unauthorizedAccess(userID: String, dataID: String)

        public var description: String {
            switch self {
            case .missingUserConsent(let userID):
                return "User \(userID) accessed data without user consent."
            case .unauthorizedAccess(let userID, let dataID):
                return "User \(userID) unauthorized access to data \(dataID)."
            }
        }
    }
}



// MARK: - Keychain Helper

private class KeychainHelper {

    static let shared = KeychainHelper()

    func saveKey(_ keyData: Data, tag: String) {
        let query: [String: Any] = [
            kSecClass as String       : kSecClassKey,
            kSecAttrApplicationTag as String : tag.data(using: .utf8)!,
            kSecAttrKeyType as String : kSecAttrKeyTypeAES,
            kSecValueData as String   : keyData,
            kSecAttrAccessible as String : kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    func getKey(tag: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String          : kSecClassKey,
            kSecAttrApplicationTag as String : tag.data(using: .utf8)!,
            kSecAttrKeyType as String    : kSecAttrKeyTypeAES,
            kSecReturnData as String     : kCFBooleanTrue!,
            kSecMatchLimit as String     : kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }
}
```