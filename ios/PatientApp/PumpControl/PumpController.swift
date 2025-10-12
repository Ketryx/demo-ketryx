```swift
import Foundation
import CoreBluetooth

final class PumpController: NSObject {
    // MARK: - Types
    
    enum PumpError: Error {
        case bluetoothUnavailable
        case connectionFailed
        case communicationError
        case commandRejected
        case timeout
        case unknown
    }
    
    enum PumpStatus {
        case disconnected
        case connecting
        case connected
        case deliveringInsulin
        case alarmActive(String)
        case unknown
    }
    
    struct DeliveryEntry {
        let date: Date
        let type: DeliveryType
        let amountUnits: Double
    }
    
    enum DeliveryType {
        case basal
        case bolus
    }
    
    // MARK: - Properties
    
    private let pumpServiceUUID = CBUUID(string: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX") // Replace with actual UUID
    private let commandCharacteristicUUID = CBUUID(string: "YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY")
    private let responseCharacteristicUUID = CBUUID(string: "ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ")
    
    private var centralManager: CBCentralManager!
    private var pumpPeripheral: CBPeripheral?
    
    private var commandCharacteristic: CBCharacteristic?
    private var responseCharacteristic: CBCharacteristic?
    
    private var commandQueue = [(command: Data, retryCount: Int, completion: (Result<Void, PumpError>) -> Void)]()
    private var isSendingCommand = false
    
    private var pumpStatus: PumpStatus = .disconnected {
        didSet {
            statusChangedHandler?(pumpStatus)
        }
    }
    
    public var statusChangedHandler: ((PumpStatus) -> Void)?
    public var alarmTriggeredHandler: ((String) -> Void)?
    
    private let maxRetries = 3
    private let responseTimeout: TimeInterval = 5
    
    private var responseTimer: Timer?
    
    // MARK: - Initialization
    
    override init() {
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }
    
    // MARK: - Public Methods
    
    /// Connect to the pump device via Bluetooth
    func connect() {
        guard centralManager.state == .poweredOn else {
            pumpStatus = .disconnected
            return
        }
        pumpStatus = .connecting
        centralManager.scanForPeripherals(withServices: [pumpServiceUUID], options: nil)
    }
    
    /// Disconnect from the pump
    func disconnect() {
        if let peripheral = pumpPeripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
        pumpStatus = .disconnected
    }
    
    /// Adjust basal rate safely with validation
    func adjustBasalRate(to unitsPerHour: Double, completion: @escaping (Result<Void, PumpError>) -> Void) {
        guard unitsPerHour >= 0 && unitsPerHour <= 10 else {
            completion(.failure(.commandRejected))
            return
        }
        let command = buildCommand(type: .basalRateAdjustment, payload: unitsPerHour)
        sendCommand(command, completion: completion)
    }
    
    /// Deliver a bolus insulin dose
    func deliverBolus(units: Double, completion: @escaping (Result<Void, PumpError>) -> Void) {
        guard units > 0 && units <= 25 else {
            completion(.failure(.commandRejected))
            return
        }
        let command = buildCommand(type: .bolusDelivery, payload: units)
        sendCommand(command, completion: completion)
    }
    
    /// Retrieve delivery history from the pump
    func retrieveDeliveryHistory(completion: @escaping (Result<[DeliveryEntry], PumpError>) -> Void) {
        let command = buildCommand(type: .deliveryHistoryRequest, payload: nil)
        sendCommand(command) { [weak self] result in
            switch result {
            case .success:
                self?.receiveHistoryResponse(completion: completion)
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }
    
    /// Synchronize local pump settings with stored definitions
    func synchronizeSettings(completion: @escaping (Result<Void, PumpError>) -> Void) {
        let command = buildCommand(type: .settingsSync, payload: nil)
        sendCommand(command, completion: completion)
    }
    
    /// Configure alarms on the pump
    func configureAlarms(enabled: Bool, completion: @escaping (Result<Void, PumpError>) -> Void) {
        let payload = enabled ? Data([0x01]) : Data([0x00])
        let command = buildCommand(type: .alarmConfig, payload: payload)
        sendCommand(command, completion: completion)
    }
    
    // MARK: - Private Helpers
    
    private enum CommandType: UInt8 {
        case basalRateAdjustment = 0x01
        case bolusDelivery = 0x02
        case deliveryHistoryRequest = 0x03
        case settingsSync = 0x04
        case alarmConfig = 0x05
    }
    
    private func buildCommand(type: CommandType, payload: Any?) -> Data {
        var commandData = Data()
        commandData.append(type.rawValue)
        if let doubleValue = payload as? Double {
            // Encode double as 64-bit float big-endian
            var temp = doubleValue.bitPattern.bigEndian
            let bytes = withUnsafeBytes(of: &temp) { Data($0) }
            commandData.append(bytes)
        } else if let dataPayload = payload as? Data {
            commandData.append(dataPayload)
        }
        // Append checksum or encryption if needed here
        return commandData
    }
    
    private func sendCommand(_ command: Data, completion: @escaping (Result<Void, PumpError>) -> Void) {
        guard pumpStatus == .connected,
              let commandChar = commandCharacteristic,
              let peripheral = pumpPeripheral else {
            completion(.failure(.bluetoothUnavailable))
            return
        }
        
        // Enqueue command with retry count
        commandQueue.append((command: command, retryCount: maxRetries, completion: completion))
        processNextCommand()
    }
    
    private func processNextCommand() {
        guard !isSendingCommand, !commandQueue.isEmpty,
              let commandChar = commandCharacteristic,
              let peripheral = pumpPeripheral else { return }
        
        isSendingCommand = true
        let current = commandQueue.first!
        
        peripheral.writeValue(current.command, for: commandChar, type: .withResponse)
        
        startResponseTimeout()
    }
    
    private func startResponseTimeout() {
        DispatchQueue.main.async {
            self.responseTimer?.invalidate()
            self.responseTimer = Timer.scheduledTimer(withTimeInterval: self.responseTimeout, repeats: false, block: { [weak self] _ in
                self?.handleResponseTimeout()
            })
        }
    }
    
    private func handleResponseTimeout() {
        guard !commandQueue.isEmpty else {
            isSendingCommand = false
            return
        }
        
        var current = commandQueue.removeFirst()
        if current.retryCount > 0 {
            current.retryCount -= 1
            commandQueue.insert(current, at: 0) // Retry
            isSendingCommand = false
            processNextCommand()
        } else {
            current.completion(.failure(.timeout))
            isSendingCommand = false
            processNextCommand()
        }
    }
    
    private func commandAcknowledged(success: Bool) {
        responseTimer?.invalidate()
        guard !commandQueue.isEmpty else {
            isSendingCommand = false
            return
        }
        let current = commandQueue.removeFirst()
        
        if success {
            current.completion(.success(()))
        } else {
            current.completion(.failure(.commandRejected))
        }
        isSendingCommand = false
        processNextCommand()
    }
    
    private func receiveHistoryResponse(completion: @escaping (Result<[DeliveryEntry], PumpError>) -> Void) {
        // The actual response will be handled in peripheral(_:didUpdateValueFor:error:)
        // Save completion to call when data arrives.
        historyRetrievalCompletion = completion
    }
    
    private var historyRetrievalCompletion: ((Result<[DeliveryEntry], PumpError>) -> Void)?
    
    private func parseHistoryData(_ data: Data) -> [DeliveryEntry]? {
        // Parsing logic assumed:
        // Data entries: each 17 bytes
        // - 8 bytes timestamp (TimeInterval since 1970, Double)
        // - 1 byte delivery type (0=basal, 1=bolus)
        // - 8 bytes amountUnits (Double)
        var entries: [DeliveryEntry] = []
        let entryLength = 17
        guard data.count % entryLength == 0 else { return nil }
        
        for i in stride(from: 0, to: data.count, by: entryLength) {
            let slice = data[i..<i+entryLength]
            let tsData = slice.prefix(8)
            let typeData = slice[8]
            let amountData = slice[9..<17]
            
            let tsBits = tsData.withUnsafeBytes { $0.load(as: UInt64.self) }.bigEndian
            let timestamp = TimeInterval(bitPattern: tsBits)
            let date = Date(timeIntervalSince1970: timestamp)
            
            let amountBits = amountData.withUnsafeBytes { $0.load(as: UInt64.self) }.bigEndian
            let amount = Double(bitPattern: amountBits)
            
            let deliveryType: DeliveryType = (typeData == 0) ? .basal : .bolus
            
            entries.append(DeliveryEntry(date: date, type: deliveryType, amountUnits: amount))
        }
        return entries
    }
    
    private func updatePumpStatus(from data: Data) {
        // Assumed: status payload format known
        // For example, first byte indicates status code, optional string alarm message follows
        guard data.count >= 1 else { return }
        
        switch data[0] {
        case 0x00:
            pumpStatus = .connected
        case 0x01:
            pumpStatus = .deliveringInsulin
        case 0xFF:
            if data.count > 1,
               let alarmMessage = String(data: data.dropFirst(), encoding: .utf8) {
                pumpStatus = .alarmActive(alarmMessage)
                alarmTriggeredHandler?(alarmMessage)
            } else {
                pumpStatus = .alarmActive("Unknown alarm")
                alarmTriggeredHandler?("Unknown alarm")
            }
        default:
            pumpStatus = .unknown
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension PumpController: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            pumpStatus = .disconnected
        } else {
            pumpStatus = .disconnected
        }
    }
    
    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String : Any],
                        rssi RSSI: NSNumber) {
        centralManager.stopScan()
        pumpPeripheral = peripheral
        pumpPeripheral?.delegate = self
        centralManager.connect(peripheral, options: nil)
        pumpStatus = .connecting
    }
    
    func centralManager(_ central: CBCentralManager,
                        didConnect peripheral: CBPeripheral) {
        pumpStatus = .connected
        peripheral.discoverServices([pumpServiceUUID])
    }
    
    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        pumpStatus = .disconnected
    }
    
    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        pumpStatus = .disconnected
        pumpPeripheral = nil
        commandQueue.removeAll()
    }
}

// MARK: - CBPeripheralDelegate

extension PumpController: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error = error {
            pumpStatus = .disconnected
            return
        }
        guard let services = peripheral.services else { return }
        for service in services where service.uuid == pumpServiceUUID {
            peripheral.discoverCharacteristics([commandCharacteristicUUID, responseCharacteristicUUID], for: service)
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        if let error = error {
            pumpStatus = .disconnected
            return
        }
        guard let characteristics = service.characteristics else { return }
        for characteristic in characteristics {
            if characteristic.uuid == commandCharacteristicUUID {
                commandCharacteristic = characteristic
            } else if characteristic.uuid == responseCharacteristicUUID {
                responseCharacteristic = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }
        if commandCharacteristic != nil, responseCharacteristic != nil {
            pumpStatus = .connected
        }
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        if let error = error {
            // Write failed
            handleResponseTimeout()
            return
        }
        // Successfully written, awaiting response notification
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard error == nil else { return }
        guard let data = characteristic.value else { return }
        // Response handling protocol:
        // First byte: response code
        // 0xAA = ack success
        // 0xFF = ack failure
        // 0x10..0x1F = status update or data response
        
        let responseCode = data[0]
        
        switch responseCode {
        case 0xAA:
            // Acknowledgment success
            commandAcknowledged(success: true)
            
        case 0xFF:
            // Acknowledgment failure
            commandAcknowledged(success: false)
            
        case 0x10:
            // Status update
            updatePumpStatus(from: data.advanced(by: 1))
            
        case 0x11:
            // Delivery history data follows
            guard let completion = historyRetrievalCompletion else { break }
            if let entries = parseHistoryData(data.advanced(by: 1)) {
                completion(.success(entries))
            } else {
                completion(.failure(.communicationError))
            }
            historyRetrievalCompletion = nil
            
        default:
            break
        }
    }
}
```