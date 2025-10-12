```swift
import XCTest
import UIKit
@testable import CardiacViz

final class VisualizationInterfaceTests: XCTestCase {

    var sut: VisualizationInterface!
    var window: UIWindow!
    var mockAnomalyEngine: MockAnomalyDetectionEngine!

    // MARK: - Setup / Teardown

    override func setUp() {
        super.setUp()
        window = UIWindow()
        mockAnomalyEngine = MockAnomalyDetectionEngine()
        sut = VisualizationInterface(anomalyEngine: mockAnomalyEngine)
        window.rootViewController = sut
        window.makeKeyAndVisible()
    }

    override func tearDown() {
        sut = nil
        mockAnomalyEngine = nil
        window = nil
        super.tearDown()
    }

    // MARK: - Lifecycle and Initialization

    func test_viewController_loadsViewProperly() {
        XCTAssertNotNil(sut.view, "View should be loaded")
        XCTAssertTrue(sut.isViewLoaded, "View should be marked as loaded")
    }

    func test_visualizationLayer_isAddedAfterViewDidLoad() {
        sut.loadViewIfNeeded()
        XCTAssertNotNil(sut.visualizationLayer, "3D visualization layer should be present")
    }

    // MARK: - 3D Model Loading and Rendering

    func test_load3DModel_successfullyRendersModel() {
        let exp = expectation(description: "Model loaded and rendered")
        sut.load3DModel(named: "heartModel") { success in
            XCTAssertTrue(success, "3D Model should load successfully")
            XCTAssertTrue(self.sut.visualizationLayer?.hasModel == true, "Visualization layer should contain model")
            exp.fulfill()
        }
        waitForExpectations(timeout: 2)
    }

    func test_load3DModel_failureReturnsFalse() {
        let exp = expectation(description: "Model loading failed")
        sut.load3DModel(named: "nonExistentModel") { success in
            XCTAssertFalse(success, "Loading non-existent model should fail")
            XCTAssertNil(self.sut.visualizationLayer?.model, "Visualization layer model should be nil on failure")
            exp.fulfill()
        }
        waitForExpectations(timeout: 2)
    }

    // MARK: - Blockage Overlay Display

    func test_displayBlockageOverlay_showsCorrectOverlay() {
        sut.loadViewIfNeeded()
        let blockages: [Blockage] = [
            Blockage(location: CGPoint(x: 0.5, y: 0.5), severity: .moderate),
            Blockage(location: CGPoint(x: 0.2, y: 0.8), severity: .severe)
        ]
        sut.displayBlockageOverlay(blockages)
        let overlays = sut.blockageOverlays
        XCTAssertEqual(overlays.count, 2, "Should display two blockage overlays")
        XCTAssertTrue(overlays.allSatisfy { $0.isDescendant(of: sut.view) }, "All overlays should be added to view hierarchy")
        XCTAssertEqual(overlays[0].severity, .moderate)
        XCTAssertEqual(overlays[1].severity, .severe)
    }

    // MARK: - Gesture Recognizers

    func test_setupGestureRecognizers_addsPanPinchRotate() {
        sut.loadViewIfNeeded()
        let gestures = sut.view.gestureRecognizers ?? []
        let types = Set(gestures.map { type(of: $0) })
        XCTAssertTrue(types.contains(UIPanGestureRecognizer.self), "Pan gesture should be added")
        XCTAssertTrue(types.contains(UIPinchGestureRecognizer.self), "Pinch gesture should be added")
        XCTAssertTrue(types.contains(UIRotationGestureRecognizer.self), "Rotation gesture should be added")
    }

    func test_gestureRecognizer_panUpdatesModelRotation() {
        sut.loadViewIfNeeded()
        let initialRotation = sut.modelRotation
        let panGesture = UIPanGestureRecognizer()
        panGesture.state = .changed
        let translation = CGPoint(x: 50, y: 20)
        sut.handlePanGesture(panGesture, translation: translation)
        XCTAssertNotEqual(sut.modelRotation, initialRotation, "Rotation should update on pan gesture")
    }

    func test_gestureRecognizer_pinchUpdatesModelScale() {
        sut.loadViewIfNeeded()
        let initialScale = sut.modelScale
        let pinchGesture = UIPinchGestureRecognizer()
        pinchGesture.state = .changed
        pinchGesture.scale = 1.2
        sut.handlePinchGesture(pinchGesture)
        XCTAssertGreaterThan(sut.modelScale, initialScale, "Scale should increase on pinch out")
    }

    func test_gestureRecognizer_rotationUpdatesModelRotation() {
        sut.loadViewIfNeeded()
        let initialRotation = sut.modelRotation
        let rotationGesture = UIRotationGestureRecognizer()
        rotationGesture.state = .changed
        rotationGesture.rotation = CGFloat.pi / 4
        sut.handleRotationGesture(rotationGesture)
        XCTAssertNotEqual(sut.modelRotation, initialRotation, "Rotation should update on rotation gesture")
    }

    // MARK: - Integration with Anomaly Detection Engine

    func test_anomalyEngine_detectsAnomaliesAndUpdatesUI() {
        sut.loadViewIfNeeded()
        mockAnomalyEngine.anomaliesToReturn = [
            Anomaly(location: CGPoint(x: 0.3, y: 0.4), description: "Test Anomaly")
        ]
        let exp = expectation(description: "Anomalies detected and displayed")
        sut.runAnomalyDetection {
            XCTAssertEqual(self.sut.anomalyOverlays.count, 1, "One anomaly overlay should be added")
            XCTAssertEqual(self.sut.anomalyOverlays.first?.descriptionText, "Test Anomaly")
            exp.fulfill()
        }
        waitForExpectations(timeout: 2)
    }

    func test_anomalyEngine_propagatesErrorAndShowsErrorState() {
        sut.loadViewIfNeeded()
        mockAnomalyEngine.shouldFail = true
        let exp = expectation(description: "Anomaly detection failure handled")
        sut.runAnomalyDetection {
            XCTAssertTrue(self.sut.isShowingErrorState, "Error state should be shown on anomaly detection failure")
            XCTAssertEqual(self.sut.errorLabel.text, "Failed to detect anomalies")
            exp.fulfill()
        }
        waitForExpectations(timeout: 2)
    }

    // MARK: - Error State Handling

    func test_showErrorState_displaysErrorLabel() {
        sut.loadViewIfNeeded()
        sut.showErrorState(message: "Test Error")
        XCTAssertFalse(sut.errorLabel.isHidden, "Error label should be visible")
        XCTAssertEqual(sut.errorLabel.text, "Test Error")
    }

    func test_hideErrorState_hidesErrorLabel() {
        sut.loadViewIfNeeded()
        sut.showErrorState(message: "Test Error")
        sut.hideErrorState()
        XCTAssertTrue(sut.errorLabel.isHidden, "Error label should be hidden")
    }

    // MARK: - Dark Mode Theme Application

    func test_interfaceAppliesDarkModeColors() {
        sut.loadViewIfNeeded()
        let darkTrait = UITraitCollection(userInterfaceStyle: .dark)
        sut.traitCollectionDidChange(darkTrait)
        XCTAssertEqual(sut.view.backgroundColor, .black, "Background should be black in dark mode")
        XCTAssertEqual(sut.errorLabel.textColor, .white, "Error label text color should be white in dark mode")
    }

    func test_interfaceAppliesLightModeColors() {
        sut.loadViewIfNeeded()
        let lightTrait = UITraitCollection(userInterfaceStyle: .light)
        sut.traitCollectionDidChange(lightTrait)
        XCTAssertEqual(sut.view.backgroundColor, .white, "Background should be white in light mode")
        XCTAssertEqual(sut.errorLabel.textColor, .black, "Error label text color should be black in light mode")
    }

    // MARK: - Accessibility Features

    func test_accessibilityLabelsAreSetCorrectly() {
        sut.loadViewIfNeeded()
        XCTAssertEqual(sut.visualizationLayer?.accessibilityLabel, "Heart 3D Model Visualization")
        sut.blockageOverlays.forEach {
            XCTAssertNotNil($0.accessibilityLabel)
            XCTAssertFalse($0.accessibilityLabel!.isEmpty, "Blockage overlay should have accessibility label")
        }
        sut.anomalyOverlays.forEach {
            XCTAssertNotNil($0.accessibilityLabel)
            XCTAssertFalse($0.accessibilityLabel!.isEmpty, "Anomaly overlay should have accessibility label")
        }
    }

    func test_accessibilityTraitsForOverlays() {
        sut.loadViewIfNeeded()
        sut.blockageOverlays.forEach {
            XCTAssertTrue($0.accessibilityTraits.contains(.staticText))
        }
        sut.anomalyOverlays.forEach {
            XCTAssertTrue($0.accessibilityTraits.contains(.staticText))
        }
    }

    // MARK: - Performance Tests

    func test_performance_loadLargeDataSet() {
        measure {
            let largeBlockages = (0..<1000).map { i in
                Blockage(location: CGPoint(x: CGFloat(i % 100) / 100.0, y: CGFloat(i / 100) / 10.0),
                         severity: .mild)
            }
            sut.displayBlockageOverlay(largeBlockages)
            sut.load3DModel(named: "heartModel", completion: {_ in})
            sut.view.layoutIfNeeded()
        }
    }

    func test_performance_renderWithMultipleAnomalies() {
        measure {
            let anomalies = (0..<500).map { i in
                Anomaly(location: CGPoint(x: CGFloat(i % 50)/50.0, y: CGFloat(i / 50)/10.0),
                        description: "Anomaly \(i)")
            }
            mockAnomalyEngine.anomaliesToReturn = anomalies
            let exp = expectation(description: "Run anomaly detection for large data")
            sut.runAnomalyDetection {
                exp.fulfill()
            }
            wait(for: [exp], timeout: 5)
        }
    }
}

// MARK: - Mock Classes

private final class MockAnomalyDetectionEngine: AnomalyDetectionEngine {
    var anomaliesToReturn: [Anomaly] = []
    var shouldFail = false

    override func detectAnomalies(completion: @escaping (Result<[Anomaly], Error>) -> Void) {
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) {
            if self.shouldFail {
                completion(.failure(MockError.detectionFailed))
            } else {
                completion(.success(self.anomaliesToReturn))
            }
        }
    }

    enum MockError: Error {
        case detectionFailed
    }
}
```