import SwiftUI

struct DeveloperPanel: View {
    @EnvironmentObject var config: DeveloperConfig
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Runtime source") {
                    Picker("Load from", selection: $config.source) {
                        ForEach(RuntimeSource.allCases) { source in
                            Text(source.title).tag(source)
                        }
                    }
                    #if DEBUG
                    TextField("Vite hostname / IP", text: $config.host)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Debug builds can load http://HOST:5173 over the local network. WKWebView is inspectable in Safari.")
                        .font(.footnote)
                    #else
                    Text("Release/local device builds load the bundled production web files. They do not use a remote URL.")
                        .font(.footnote)
                    #endif
                }
                Section("Preferences") {
                    Toggle("Haptics", isOn: $config.hapticsEnabled)
                    Picker("Renderer preference", selection: $config.renderer) {
                        ForEach(RendererPreference.allCases) { renderer in
                            Text(renderer.rawValue).tag(renderer)
                        }
                    }
                }
                if let report = config.lastPerformanceReportJSON {
                    Section("Last performance report") {
                        Text(report).font(.system(.footnote, design: .monospaced))
                    }
                }
                if let error = config.lastRuntimeError {
                    Section("Last runtime error") {
                        Text(error)
                    }
                }
            }
            .navigationTitle("Developer")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply & Reload") {
                        config.persist()
                        config.loadGeneration += 1
                        dismiss()
                    }
                }
            }
        }
        .onDisappear { config.persist() }
    }
}
