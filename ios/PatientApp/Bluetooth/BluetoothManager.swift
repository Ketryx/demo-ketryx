```swift
import Foundation
import CoreBluetooth
import Security

final class BluetoothManager: NSObject {

    // MARK: - Nested Types

    enum BluetoothError: Error {
        case bluetoothUnavailable
        case pairingFailed
        case connectionFailed
        case serviceDiscoveryFailed
        case characteristicDiscoveryFailed
        case dataTransmissionFailed
        case invalidDataReceived
        case unknown
    }

    enum ConnectionStatus {
        case disconnected
        case connecting
        case connected
        case failed(BluetoothError)
    }

    // MARK: - Properties

    static let shared = BluetoothManager()

    private var centralManager: CBCentralManager!
    private var insulinPumpPeripheral: CBPeripheral?
    private var insulinPumpCharacteristicTx: CBCharacteristic? // Write characteristic
    private var insulinPumpCharacteristicRx: CBCharacteristic? // Notify characteristic
    private var batteryLevelCharacteristic: CBCharacteristic?

    private(set) var connectionStatus: ConnectionStatus = .disconnected {
        didSet { notifyConnectionStatusChanged() }
    }

    private let insulinPumpServiceUUID = CBUUID(string: "1810") // Example service UUID (Replace with real)
    private let txCharacteristicUUID = CBUUID(string: "2A58") // Example write characteristic UUID
    private let rxCharacteristicUUID = CBUUID(string: "2A59") // Example notify characteristic UUID
    private let batteryServiceUUID = CBUUID(string: "180F")
    private let batteryLevelCharacteristicUUID = CBUUID(string: "2A19")

    private var autoReconnect = true
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private var reconnectTimer: Timer?

    private var securityManager: SecurityManager = SecurityManager()

    // MARK: - Initialization

    private override init() {
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }

    // MARK: - Public Methods

    func startScanning() {
        guard centralManager.state == .poweredOn else {
            connectionStatus = .failed(.bluetoothUnavailable)
            return
        }
        reconnectAttempts = 0
        insulinPumpPeripheral = nil
        connectionStatus = .disconnected

        centralManager.scanForPeripherals(withServices: [insulinPumpServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stopScanning() {
        centralManager.stopScan()
    }

    func disconnect() {
        guard let peripheral = insulinPumpPeripheral else { return }
        autoReconnect = false
        centralManager.cancelPeripheralConnection(peripheral)
    }

    func sendData(_ data: Data) throws {
        guard connectionStatus == .connected,
              let peripheral = insulinPumpPeripheral,
              let characteristic = insulinPumpCharacteristicTx else {
            throw BluetoothError.dataTransmissionFailed
        }

        // Encrypt data before sending
        let encryptedData = try securityManager.encrypt(data: data)
        peripheral.writeValue(encryptedData, for: characteristic, type: .withResponse)
    }

    // MARK: - Private Methods

    private func notifyConnectionStatusChanged() {
        NotificationCenter.default.post(name: .BluetoothManagerConnectionStatusChanged, object: connectionStatus)
    }

    private func discoverServices() {
        guard let peripheral = insulinPumpPeripheral else { return }
        peripheral.discoverServices([insulinPumpServiceUUID, batteryServiceUUID])
    }

    private func discoverCharacteristics(for service: CBService) {
        guard insulinPumpPeripheral != nil else { return }

        switch service.uuid {
        case insulinPumpServiceUUID:
            insulinPumpPeripheral?.discoverCharacteristics([txCharacteristicUUID, rxCharacteristicUUID], for: service)
        case batteryServiceUUID:
            insulinPumpPeripheral?.discoverCharacteristics([batteryLevelCharacteristicUUID], for: service)
        default:
            break
        }
    }

    private func startAutoReconnect() {
        reconnectTimer?.invalidate()
        guard reconnectAttempts < maxReconnectAttempts else {
            connectionStatus = .failed(.connectionFailed)
            return
        }

        reconnectAttempts += 1
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: Double(reconnectAttempts) * 3.0, repeats: false) { [weak self] _ in
            guard let self = self, let peripheral = self.insulinPumpPeripheral else { return }
            self.connectionStatus = .connecting
            self.centralManager.connect(peripheral, options: nil)
        }
    }

    private func handleReceivedData(_ data: Data) {
        do {
            let decrypted = try securityManager.decrypt(data: data)
            NotificationCenter.default.post(name: .BluetoothManagerDidReceiveData, object: decrypted)
        } catch {
            // Handle invalid decrypted data silently or notify error
        }
    }

    private func updateBatteryLevel(from value: Data) {
        guard let batteryLevel = value.first else { return }
        NotificationCenter.default.post(name: .BluetoothManagerBatteryLevelUpdated, object: Int(batteryLevel))
    }
}

// MARK: - CBCentralManagerDelegate

extension BluetoothManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            startScanning()
        case .unauthorized, .unsupported, .poweredOff, .resetting, .unknown:
            connectionStatus = .failed(.bluetoothUnavailable)
        @unknown default:
            connectionStatus = .failed(.unknown)
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String : Any],
                        rssi RSSI: NSNumber) {
        central.stopScan()
        insulinPumpPeripheral = peripheral
        insulinPumpPeripheral?.delegate = self
        connectionStatus = .connecting
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager,
                        didConnect peripheral: CBPeripheral) {
        reconnectAttempts = 0
        connectionStatus = .connected
        discoverServices()
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        connectionStatus = .failed(.connectionFailed)
        if autoReconnect {
            startAutoReconnect()
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        connectionStatus = .disconnected
        if autoReconnect {
            startAutoReconnect()
        }
    }
}

// MARK: - CBPeripheralDelegate

extension BluetoothManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverServices error: Error?) {
        guard error == nil,
            let services = peripheral.services else {
            connectionStatus = .failed(.serviceDiscoveryFailed)
            return
        }
        for service in services {
            discoverCharacteristics(for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        guard error == nil,
            let characteristics = service.characteristics else {
            connectionStatus = .failed(.characteristicDiscoveryFailed)
            return
        }

        for characteristic in characteristics {
            switch characteristic.uuid {
            case txCharacteristicUUID:
                insulinPumpCharacteristicTx = characteristic
            case rxCharacteristicUUID:
                insulinPumpCharacteristicRx = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
            case batteryLevelCharacteristicUUID:
                batteryLevelCharacteristic = characteristic
                peripheral.readValue(for: characteristic)
            default:
                break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard error == nil,
              let data = characteristic.value else { return }

        switch characteristic.uuid {
        case rxCharacteristicUUID:
            handleReceivedData(data)
        case batteryLevelCharacteristicUUID:
            updateBatteryLevel(from: data)
        default:
            break
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        if let error = error {
            connectionStatus = .failed(.dataTransmissionFailed)
            print("Write error: \(error.localizedDescription)")
        }
    }
}

// MARK: - Security Manager

private class SecurityManager {

    private let symmetricKeyTag = "com.patientapp.bluetooth.symmetrickey"

    private var symmetricKey: SecKey?

    init() {
        symmetricKey = loadOrCreateSymmetricKey()
    }

    private func loadOrCreateSymmetricKey() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: symmetricKeyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeAES,
            kSecReturnRef as String: true
        ]
        var item: CFTypeRef?

        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let key = item as? SecKey {
            return key
        }

        // Create symmetric key (AES 256)
        var keyAttributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeAES,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: symmetricKeyTag
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(keyAttributes as CFDictionary, &error) else {
            return nil
        }
        return key
    }

    func encrypt(data: Data) throws -> Data {
        guard let key = symmetricKey else { throw BluetoothManager.BluetoothError.unknown }
        // Use AES GCM or AES CBC for encryption - for simplicity AES GCM is recommended but not fully supported on all iOS versions
        // Here we use SecKeyCreateEncryptedData with AES, assuming iOS 13+

        if #available(iOS 13.0, *) {
            let algorithm = SecKeyAlgorithm.aesGCM
            guard SecKeyIsAlgorithmSupported(key, .encrypt, algorithm) else {
                throw BluetoothManager.BluetoothError.unknown
            }
            var error: Unmanaged<CFError>?
            guard let cipherText = SecKeyCreateEncryptedData(key,
                                                             algorithm,
                                                             data as CFData,
                                                             &error) as Data? else {
                throw error!.takeRetainedValue()
            }
            return cipherText
        } else {
            // fallback or throw
            throw BluetoothManager.BluetoothError.unknown
        }
    }

    func decrypt(data: Data) throws -> Data {
        guard let key = symmetricKey else { throw BluetoothManager.BluetoothError.unknown }

        if #available(iOS 13.0, *) {
            let algorithm = SecKeyAlgorithm.aesGCM
            guard SecKeyIsAlgorithmSupported(key, .decrypt, algorithm) else {
                throw BluetoothManager.BluetoothError.unknown
            }
            var error: Unmanaged<CFError>?
            guard let clearText = SecKeyCreateDecryptedData(key,
                                                           algorithm,
                                                           data as CFData,
                                                           &error) as Data? else {
                throw error!.takeRetainedValue()
            }
            return clearText
        } else {
            // fallback or throw
            throw BluetoothManager.BluetoothError.unknown
        }
    }
}

// MARK: - Notifications

extension Notification.Name {
    static let BluetoothManagerConnectionStatusChanged = Notification.Name("BluetoothManagerConnectionStatusChanged")
    static let BluetoothManagerDidReceiveData = Notification.Name("BluetoothManagerDidReceiveData")
    static let BluetoothManagerBatteryLevelUpdated = Notification.Name("BluetoothManagerBatteryLevelUpdated")
}
```