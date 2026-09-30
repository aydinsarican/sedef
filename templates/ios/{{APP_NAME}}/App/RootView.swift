import SwiftUI

/// Placeholder root. Phase 01 replaces it with the product's real entry point and
/// the Theme generated from DESIGN.md.
struct RootView: View {
    var body: some View {
        Text("{{APP_NAME}}")
            .accessibilityIdentifier("root.title")
    }
}

#Preview {
    RootView()
}
