import Testing
@testable import {{APP_NAME}}

@Suite("Smoke")
struct SmokeTests {
    @Test func moduleLoads() {
        #expect(Bool(true))
    }
}
