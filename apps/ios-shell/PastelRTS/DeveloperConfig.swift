import Combine
import Foundation

enum RuntimeSource: String, CaseIterable, Identifiable {
    case bundled
    case localDevServer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .bundled: return "Bundled production build"
        case .localDevServer: return "Local Vite dev server"
        }
    }
}

enum RendererPreference: String, CaseIterable, Identifiable {
    case webgl
    case webgpu

    var id: String { rawValue }
}

/// Native developer launch configuration. Not a live match HUD.
final class DeveloperConfig: ObservableObject {
    static let shared = DeveloperConfig()

    @Published var source: RuntimeSource
    @Published var host: String
    @Published var hapticsEnabled: Bool
    @Published var renderer: RendererPreference
    @Published var lastPerformanceReportJSON: String?
    @Published var lastRuntimeError: String?
    @Published var loadGeneration: Int = 0

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        #if DEBUG
        let defaultSource = RuntimeSource.localDevServer.rawValue
        #else
        let defaultSource = RuntimeSource.bundled.rawValue
        #endif
        source = RuntimeSource(rawValue: defaults.string(forKey: "source") ?? defaultSource) ?? .bundled
        host = defaults.string(forKey: "host") ?? "127.0.0.1"
        hapticsEnabled = defaults.object(forKey: "haptics") as? Bool ?? true
        renderer = RendererPreference(rawValue: defaults.string(forKey: "renderer") ?? "webgl") ?? .webgl
    }

    var viteURL: URL? {
        URL(string: "http://\(host):5173/?renderer=\(renderer.rawValue)")
    }

    func persist() {
        defaults.set(source.rawValue, forKey: "source")
        defaults.set(host, forKey: "host")
        defaults.set(hapticsEnabled, forKey: "haptics")
        defaults.set(renderer.rawValue, forKey: "renderer")
    }
}
