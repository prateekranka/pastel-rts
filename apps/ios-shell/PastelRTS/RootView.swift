import SwiftUI

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var studioSession = StudioSession()
    @State private var selectedTab: AppTab = .game
    @State private var hasOpenedStudio = false

    var body: some View {
        TabView(selection: $selectedTab) {
            ContentView()
                .tabItem {
                    Label("Game", systemImage: "gamecontroller")
                }
                .tag(AppTab.game)

            studioTab
                .tabItem {
                    Label("Studio", systemImage: "hammer")
                }
                .tag(AppTab.studio)
        }
        .toolbarBackground(.visible, for: .tabBar)
        .onChange(of: selectedTab) { _, tab in
            if tab == .studio {
                hasOpenedStudio = true
                studioSession.prepareIfNeeded()
            }
            NotificationCenter.default.post(name: .pastelSelectedTab, object: tab)
        }
        .onChange(of: scenePhase) { _, phase in
            NotificationCenter.default.post(name: .pastelScenePhase, object: phase)
        }
        .onAppear {
            NotificationCenter.default.post(name: .pastelSelectedTab, object: selectedTab)
            NotificationCenter.default.post(name: .pastelScenePhase, object: scenePhase)
        }
    }

    @ViewBuilder
    private var studioTab: some View {
        if hasOpenedStudio {
            StudioView(session: studioSession)
        } else {
            StudioIdlePlaceholder()
        }
    }
}
