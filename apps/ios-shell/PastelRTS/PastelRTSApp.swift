import SwiftUI

@main
struct PastelRTSApp: App {
    @StateObject private var config = DeveloperConfig.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(config)
                .statusBarHidden(true)
        }
    }
}
