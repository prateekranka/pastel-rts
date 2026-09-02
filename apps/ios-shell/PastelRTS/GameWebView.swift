import SwiftUI
import UIKit
import WebKit

struct GameWebView: UIViewRepresentable {
    @ObservedObject var config: DeveloperConfig
    @Binding var loading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(config: config, loading: $loading, errorMessage: $errorMessage)
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: "pastelBridge")
        let wkConfig = WKWebViewConfiguration()
        wkConfig.userContentController = userContent
        wkConfig.defaultWebpagePreferences.allowsContentJavaScript = true
        wkConfig.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        wkConfig.setURLSchemeHandler(context.coordinator.schemeHandler, forURLScheme: PastelSchemeHandler.scheme)
        let webView = WKWebView(frame: .zero, configuration: wkConfig)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.08, green: 0.21, blue: 0.23, alpha: 1)
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        context.coordinator.webView = webView
        context.coordinator.observedGeneration = config.loadGeneration
        context.coordinator.load()
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.config = config
        if context.coordinator.observedGeneration != config.loadGeneration {
            context.coordinator.observedGeneration = config.loadGeneration
            context.coordinator.load()
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var config: DeveloperConfig
        var loading: Binding<Bool>
        var errorMessage: Binding<String?>
        let schemeHandler = PastelSchemeHandler()
        weak var webView: WKWebView?
        var observedGeneration = 0
        private var phaseObserver: NSObjectProtocol?

        init(config: DeveloperConfig, loading: Binding<Bool>, errorMessage: Binding<String?>) {
            self.config = config
            self.loading = loading
            self.errorMessage = errorMessage
            super.init()
            phaseObserver = NotificationCenter.default.addObserver(
                forName: .pastelScenePhase,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let phase = notification.object as? ScenePhase else { return }
                if phase == .background || phase == .inactive {
                    self?.sendToJS(NativeOutbound.pauseJSON())
                } else if phase == .active {
                    self?.sendToJS(NativeOutbound.resumeJSON())
                }
            }
        }

        deinit {
            if let phaseObserver {
                NotificationCenter.default.removeObserver(phaseObserver)
            }
        }

        func load() {
            loading.wrappedValue = true
            errorMessage.wrappedValue = nil
            guard let webView else { return }
            #if DEBUG
            if config.source == .localDevServer {
                guard let url = config.viteURL else {
                    errorMessage.wrappedValue = "Invalid Vite host. Use a LAN IP such as 192.168.1.10"
                    loading.wrappedValue = false
                    return
                }
                webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
                return
            }
            #endif
            loadBundled(webView)
        }

        func reloadFromConfig() {
            load()
        }

        func sendToJS(_ json: String) {
            let script = "window.__pastelNative && window.__pastelNative.postMessage(\(json))"
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            do {
                let inbound = try NativeInboundMessage.parse(message.body)
                switch inbound.type {
                case .gameReady:
                    loading.wrappedValue = false
                    sendToJS(NativeOutbound.developerConfiguration(
                        haptics: config.hapticsEnabled,
                        renderer: config.renderer.rawValue
                    ))
                case .requestHaptic:
                    guard config.hapticsEnabled else { return }
                    let style = inbound.payload["style"] as? String ?? "medium"
                    haptic(style)
                case .performanceReport:
                    if let data = try? JSONSerialization.data(withJSONObject: inbound.payload, options: [.prettyPrinted]),
                       let text = String(data: data, encoding: .utf8) {
                        config.lastPerformanceReportJSON = text
                        saveReport(data)
                    }
                case .runtimeError:
                    let messageText = inbound.payload["message"] as? String ?? "Unknown runtime error"
                    config.lastRuntimeError = messageText
                    errorMessage.wrappedValue = messageText
                    loading.wrappedValue = false
                }
            } catch {
                errorMessage.wrappedValue = error.localizedDescription
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            loading.wrappedValue = false
            if config.source == .localDevServer {
                errorMessage.wrappedValue = """
                Could not reach the Vite dev server at \(config.host):5173.
                Start `npm run dev` on your Mac, put this iPad on the same network, and set the host to your Mac's LAN IP.
                \(error.localizedDescription)
                """
            } else {
                errorMessage.wrappedValue = "Failed to load bundled web runtime: \(error.localizedDescription)"
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            loading.wrappedValue = false
            errorMessage.wrappedValue = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loading.wrappedValue = false
        }

        private func loadBundled(_ webView: WKWebView) {
            guard let url = URL(string: "\(PastelSchemeHandler.scheme)://game/index.html") else { return }
            webView.load(URLRequest(url: url))
        }

        private func haptic(_ style: String) {
            let generator: UIImpactFeedbackGenerator
            switch style {
            case "light":
                generator = UIImpactFeedbackGenerator(style: .light)
            case "heavy":
                generator = UIImpactFeedbackGenerator(style: .heavy)
            default:
                generator = UIImpactFeedbackGenerator(style: .medium)
            }
            generator.prepare()
            generator.impactOccurred()
        }

        private func saveReport(_ data: Data) {
            let fm = FileManager.default
            guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
            let dir = docs.appendingPathComponent("performance-reports", isDirectory: true)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let name = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let file = dir.appendingPathComponent("pastel-rts-\(name).json")
            try? data.write(to: file)
        }
    }
}
