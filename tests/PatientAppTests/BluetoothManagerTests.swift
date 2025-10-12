```swift
import XCTest
import CoreBluetooth
@testable import PatientApp

final class BluetoothManagerTests: XCTestCase {
    
    var bluetoothManager: BluetoothManager!
    var centralManager: MockCentralManager!
    
    override func setUp() {
        super.setUp()
        centralManager = MockCentralManager()
        bluetoothManager = BluetoothManager(centralManager: centralManager)
    }
    
    override func tearDown() {
        bluetoothManager = nil
        centralManager = nil
        super.tearDown()
    }
    
    func testDeviceDiscoveryAndPairing() {
        let expectationDiscover = expectation(description: "Device discovery expectation")
        let expectationPair = expectation(description: "Device pairing expectation")
        
        bluetoothManager.onDeviceDiscovered = { device in
            XCTAssertEqual(device.name, "TestDevice")
            expectationDiscover.fulfill()
            self.bluetoothManager.pair(device: device) { success in
                XCTAssertTrue(success)
                expectationPair.fulfill()
            }
        }
        
        centralManager.simulatePowerOn()
        centralManager.simulateDiscoverPeripheral(identifier: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
                                                  name: "TestDevice")
        
        wait(for: [expectationDiscover, expectationPair], timeout: 2)
    }
    
    func testConnectionEstablishmentAndMaintenance() {
        let expectationConnect = expectation(description: "Connection established")
        let expectationMaintain = expectation(description: "Connection maintained")
        
        let testPeripheral = centralManager.simulatePeripheral(identifier: UUID(), name: "ConnDevice")
        
        bluetoothManager.connect(to: testPeripheral) { success in
            XCTAssertTrue(success)
            expectationConnect.fulfill()
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            XCTAssertTrue(self.bluetoothManager.isConnected(to: testPeripheral))
            expectationMaintain.fulfill()
        }
        
        wait(for: [expectationConnect, expectationMaintain], timeout: 2)
    }
    
    func testDataTransmissionReliability() {
        let expectationSend = expectation(description: "Data sent successfully")
        let expectationReceive = expectation(description: "Data received successfully")
        
        let testPeripheral = centralManager.simulatePeripheral(identifier: UUID(), name: "DataDevice")
        
        bluetoothManager.connect(to: testPeripheral) { success in
            XCTAssertTrue(success)
            let testData = "Hello".data(using: .utf8)!
            self.bluetoothManager.send(data: testData, to: testPeripheral) { error in
                XCTAssertNil(error)
                expectationSend.fulfill()
            }
            self.bluetoothManager.onDataReceived = { data, peripheral in
                XCTAssertEqual(data, testData)
                XCTAssertEqual(peripheral.identifier, testPeripheral.identifier)
                expectationReceive.fulfill()
            }
            // Simulate receiving data back
            self.centralManager.simulateReceiveData(testData, from: testPeripheral)
        }
        
        wait(for: [expectationSend, expectationReceive], timeout: 3)
    }
    
    func testDisconnectionHandlingAndReconnection() {
        let expectationDisconnect = expectation(description: "Disconnected")
        let expectationReconnect = expectation(description: "Reconnected")
        
        let testPeripheral = centralManager.simulatePeripheral(identifier: UUID(), name: "DisconnectDevice")
        
        bluetoothManager.connect(to: testPeripheral) { success in
            XCTAssertTrue(success)
            self.bluetoothManager.onDisconnected = { peripheral, error in
                XCTAssertEqual(peripheral.identifier, testPeripheral.identifier)
                XCTAssertNil(error)
                expectationDisconnect.fulfill()
            }
            // Simulate unexpected disconnection
            self.centralManager.simulateDisconnect(peripheral: testPeripheral, error: nil)
            
            // Simulate automatic reconnection attempt
            self.bluetoothManager.connect(to: testPeripheral) { reconnectSuccess in
                XCTAssertTrue(reconnectSuccess)
                expectationReconnect.fulfill()
            }
        }
        
        wait(for: [expectationDisconnect, expectationReconnect], timeout: 5)
    }
    
    func testErrorRecovery() {
        let expectationFailure = expectation(description: "Connection failure handled")
        let expectationRecovery = expectation(description: "Recovery succeeded")
        
        let testPeripheral = centralManager.simulatePeripheral(identifier: UUID(), name: "ErrorDevice")
        
        // Simulate failure on first connection attempt
        centralManager.shouldFailNextConnection = true
        
        bluetoothManager.connect(to: testPeripheral) { success in
            XCTAssertFalse(success)
            expectationFailure.fulfill()
            
            // Next connection should succeed
            self.centralManager.shouldFailNextConnection = false
            self.bluetoothManager.connect(to: testPeripheral) { successRetry in
                XCTAssertTrue(successRetry)
                expectationRecovery.fulfill()
            }
        }
        
        wait(for: [expectationFailure, expectationRecovery], timeout: 5)
    }
    
    func testConcurrentOperationHandling() {
        let expectationAll = expectation(description: "All concurrent operations completed")
        expectationAll.expectedFulfillmentCount = 5
        
        let peripherals = (1...5).map {
            centralManager.simulatePeripheral(identifier: UUID(), name: "ConcDevice\($0)")
        }
        
        for peripheral in peripherals {
            bluetoothManager.connect(to: peripheral) { success in
                XCTAssertTrue(success)
                let testData = "Data\((1...5).randomElement()!)".data(using: .utf8)!
                self.bluetoothManager.send(data: testData, to: peripheral) { error in
                    XCTAssertNil(error)
                    expectationAll.fulfill()
                }
            }
        }
        
        wait(for: [expectationAll], timeout: 8)
    }
}

// MARK: - Mock Classes

private class MockCentralManager: NSObject, CBCentralManagerProtocol {
    var delegate: CBCentralManagerDelegate?
    var state: CBManagerState = .unknown
    var peripherals: [UUID: MockPeripheral] = [:]
    var shouldFailNextConnection = false
    
    func scanForPeripherals(withServices serviceUUIDs: [CBUUID]?, options: [String : Any]?) {
        // no-op for scan (we simulate discovery manually)
    }
    
    func stopScan() {
        // no-op for stop scan
    }
    
    func connect(_ peripheral: CBPeripheralProtocol, options: [String : Any]?) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            if self.shouldFailNextConnection {
                self.shouldFailNextConnection = false
                self.delegate?.centralManager?(CBCentralManager(), didFailToConnect: peripheral as! CBPeripheral, error: NSError(domain: "ConnectError", code: -1))
            } else {
                self.delegate?.centralManager?(CBCentralManager(), didConnect: peripheral as! CBPeripheral)
            }
        }
    }
    
    func cancelPeripheralConnection(_ peripheral: CBPeripheralProtocol) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.delegate?.centralManager?(CBCentralManager(), didDisconnectPeripheral: peripheral as! CBPeripheral, error: nil)
        }
    }
    
    func simulatePowerOn() {
        state = .poweredOn
        delegate?.centralManagerDidUpdateState?(CBCentralManager())
    }
    
    func simulateDiscoverPeripheral(identifier: UUID, name: String?) {
        let peripheral = simulatePeripheral(identifier: identifier, name: name)
        delegate?.centralManager?(CBCentralManager(), didDiscover: peripheral, advertisementData: [:], rssi: NSNumber(value: -60))
    }
    
    func simulatePeripheral(identifier: UUID, name: String?) -> MockPeripheral {
        if let existing = peripherals[identifier] {
            return existing
        }
        let peripheral = MockPeripheral(identifier: identifier, name: name)
        peripherals[identifier] = peripheral
        return peripheral
    }
    
    func simulateDisconnect(peripheral: MockPeripheral, error: Error?) {
        delegate?.centralManager?(CBCentralManager(), didDisconnectPeripheral: peripheral, error: error)
    }
    
    func simulateReceiveData(_ data: Data, from peripheral: MockPeripheral) {
        peripheral.notifyListeners(data: data)
    }
}

private protocol CBCentralManagerProtocol: AnyObject {
    var delegate: CBCentralManagerDelegate? { get set }
    var state: CBManagerState { get }
    func scanForPeripherals(withServices: [CBUUID]?, options: [String: Any]?)
    func stopScan()
    func connect(_ peripheral: CBPeripheralProtocol, options: [String: Any]?)
    func cancelPeripheralConnection(_ peripheral: CBPeripheralProtocol)
}

private protocol CBPeripheralProtocol: AnyObject {
    var identifier: UUID { get }
    var name: String? { get }
}

private class MockPeripheral: NSObject, CBPeripheralProtocol {
    let identifier: UUID
    let name: String?
    
    private var dataListeners: [(Data) -> Void] = []
    
    init(identifier: UUID, name: String?) {
        self.identifier = identifier
        self.name = name
        super.init()
    }
    
    func addDataListener(_ listener: @escaping (Data) -> Void) {
        dataListeners.append(listener)
    }
    
    func notifyListeners(data: Data) {
        dataListeners.forEach { $0(data) }
    }
}

// Extend CBCentralManager to conform to the protocol for type compatibility in mocks
extension CBCentralManager: CBCentralManagerProtocol {}
extension CBPeripheral: CBPeripheralProtocol {}
```