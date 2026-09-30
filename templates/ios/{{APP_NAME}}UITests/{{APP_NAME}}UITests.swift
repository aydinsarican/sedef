import XCTest

final class {{APP_NAME}}UITests: XCTestCase {
    /// A smoke test that survives any redesign: the app launches, reaches the foreground and shows a window.
    /// Feature behaviour is covered by the Maestro acceptance contracts in .maestro/acceptance/.
    @MainActor
    func testAppLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    }
}
