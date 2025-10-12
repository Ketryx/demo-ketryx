```swift
import XCTest

final class VisualizationUITests: XCTestCase {

    let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments += ["-uiTestMode"]
    }
    
    func testFullUserFlow() throws {
        app.launch()
        
        // Wait for main screen
        XCTAssertTrue(app.buttons["StartVisualizationButton"].waitForExistence(timeout: 10))
        app.buttons["StartVisualizationButton"].tap()
        
        // Wait for 3D model to appear
        let model = app.otherElements["ThreeDHeartModel"]
        XCTAssertTrue(model.waitForExistence(timeout: 15))
        
        // Gesture: Pinch to zoom in
        model.pinch(withScale: 2.0, velocity: 1.0)
        // Gesture: Pinch to zoom out
        model.pinch(withScale: 0.5, velocity: -1.0)
        
        // Gesture: Rotate (simulate by rotation gesture)
        let startCoordinate = model.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let rotateStart = startCoordinate.withOffset(CGVector(dx: 0, dy: -30))
        let rotateEnd = startCoordinate.withOffset(CGVector(dx: 0, dy: 30))
        rotateStart.press(forDuration: 0, thenDragTo: rotateEnd)
        
        // Gesture: Pan
        let panStart = model.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.7))
        let panEnd = startCoordinate
        panStart.press(forDuration: 0, thenDragTo: panEnd)
        
        // Select blockage area
        let blockage = model.buttons["BlockageArea1"]
        XCTAssertTrue(blockage.waitForExistence(timeout: 5))
        blockage.tap()
        
        // Detail view should appear
        let detailView = app.otherElements["BlockageDetailView"]
        XCTAssertTrue(detailView.waitForExistence(timeout: 5))
        
        // Verify some detail label exists
        XCTAssertTrue(detailView.staticTexts["BlockageDescriptionLabel"].exists)
        
        // Close detail view
        detailView.buttons["CloseDetailButton"].tap()
        XCTAssertFalse(detailView.exists)
        
        // Navigate to next patient case
        let nextCaseButton = app.buttons["NextPatientCaseButton"]
        XCTAssertTrue(nextCaseButton.exists)
        nextCaseButton.tap()
        
        // Confirm new case loaded by checking model refresh
        let newModel = app.otherElements["ThreeDHeartModel"]
        XCTAssertTrue(newModel.waitForExistence(timeout: 10))
        XCTAssertNotEqual(model.frame, newModel.frame)
    }
    
    func testDarkModeAppearance() throws {
        app.launchArguments += ["-uiUserInterfaceStyle", "dark"]
        app.launch()
        
        XCTAssertTrue(app.buttons["StartVisualizationButton"].waitForExistence(timeout: 10))
        app.buttons["StartVisualizationButton"].tap()
        
        let model = app.otherElements["ThreeDHeartModel"]
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        
        // Verify interface elements adapt to dark mode
        let background = app.otherElements["VisualizationBackground"]
        XCTAssertTrue(background.exists)
        
        let isDark = background.value as? String
        XCTAssertEqual(isDark, "dark")
    }
    
    func testNavigationBetweenPatientCases() throws {
        app.launch()
        app.buttons["StartVisualizationButton"].tap()
        
        let nextButton = app.buttons["NextPatientCaseButton"]
        let prevButton = app.buttons["PreviousPatientCaseButton"]
        let model = app.otherElements["ThreeDHeartModel"]
        
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        XCTAssertTrue(nextButton.exists)
        XCTAssertTrue(prevButton.exists)
        
        let initialModelFrame = model.frame
        
        nextButton.tap()
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        XCTAssertNotEqual(initialModelFrame, model.frame)
        
        prevButton.tap()
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        XCTAssertEqual(initialModelFrame, model.frame)
    }
    
    func testSlowNetworkResponsiveness() throws {
        app.launchEnvironment["UITestNetworkCondition"] = "slow"
        app.launch()
        app.buttons["StartVisualizationButton"].tap()
        
        let model = app.otherElements["ThreeDHeartModel"]
        
        // Wait longer due to slow network
        XCTAssertTrue(model.waitForExistence(timeout: 30))
        
        // Test interactions still available
        XCTAssertTrue(model.buttons["BlockageArea1"].exists)
    }
    
    func testAccessibilityVoiceOver() throws {
        XCUIDevice.shared.perform(NSSelectorFromString("setVoiceOverRunning:"), with: true)
        addTeardownBlock {
            XCUIDevice.shared.perform(NSSelectorFromString("setVoiceOverRunning:"), with: false)
        }
        
        app.launch()
        app.buttons["StartVisualizationButton"].tap()
        
        let model = app.otherElements["ThreeDHeartModel"]
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        
        // Check accessibility labels
        XCTAssertTrue(model.buttons["BlockageArea1"].exists)
        XCTAssertEqual(model.buttons["BlockageArea1"].label, "Blockage area 1, double tap to view details")
        
        // Navigate using VoiceOver focus (simulate with accessibility focus)
        let blockageButton = model.buttons["BlockageArea1"]
        XCTContext.runActivity(named: "VoiceOver double tap on blockage") { _ in
            blockageButton.tap()
            let detailView = app.otherElements["BlockageDetailView"]
            XCTAssertTrue(detailView.waitForExistence(timeout: 5))
        }
    }
}
```