import SwiftUI

struct AppShellView: View {
    @StateObject private var store: OnboardingFlowStore

    init(store: OnboardingFlowStore = TradieAppBootstrap.makeStore()) {
        _store = StateObject(wrappedValue: store)
    }

    var body: some View {
        NavigationStack {
            OnboardingJourneyView(store: store)
        }
    }
}

#Preview {
    AppShellView(store: OnboardingFlowStore(client: MockTradieAPIClient()))
}
