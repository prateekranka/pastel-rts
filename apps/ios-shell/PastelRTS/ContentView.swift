import SwiftUI

struct ContentView: View {
    @EnvironmentObject var config: DeveloperConfig
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var showDeveloper = false

    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.21, blue: 0.23).ignoresSafeArea()
            GameWebView(config: config, loading: $loading, errorMessage: $errorMessage)
                .ignoresSafeArea(edges: [.top, .leading, .trailing])
            if loading {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading battlefield…")
                        .foregroundStyle(Color(red: 0.95, green: 0.90, blue: 0.82))
                }
                .safeAreaPadding()
            }
            if let errorMessage {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Web runtime error")
                        .font(.headline)
                    Text(errorMessage)
                        .font(.body)
                    Button("Retry") {
                        self.errorMessage = nil
                        loading = true
                        config.loadGeneration += 1
                    }
                }
                .padding(24)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding()
                .safeAreaPadding()
            }
            VStack {
                HStack {
                    Spacer()
                    Button {
                        showDeveloper = true
                    } label: {
                        Image(systemName: "gearshape")
                            .padding(12)
                            .background(.ultraThinMaterial)
                            .clipShape(Circle())
                    }
                    .padding()
                    .safeAreaPadding()
                }
                Spacer()
            }
        }
        .sheet(isPresented: $showDeveloper) {
            DeveloperPanel()
                .environmentObject(config)
        }
    }
}
