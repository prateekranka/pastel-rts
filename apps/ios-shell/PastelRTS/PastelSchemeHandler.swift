import UniformTypeIdentifiers
import WebKit

/// Serves the bundled Vite production build over a custom scheme so ES modules and workers resolve locally.
final class PastelSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "pastel"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        do {
            let fileURL = try resolve(url)
            let data = try Data(contentsOf: fileURL)
            let mime = mimeType(for: fileURL)
            let response = URLResponse(
                url: url,
                mimeType: mime,
                expectedContentLength: data.count,
                textEncodingName: "utf-8"
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func resolve(_ url: URL) throws -> URL {
        guard var relative = url.path.removingPercentEncoding, !relative.isEmpty else {
            throw URLError(.fileDoesNotExist)
        }
        if relative.hasPrefix("/") {
            relative.removeFirst()
        }
        if relative.isEmpty || relative.hasSuffix("/") {
            relative = "index.html"
        }
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("WebGame", isDirectory: true) else {
            throw URLError(.fileDoesNotExist)
        }
        let candidate = root.appendingPathComponent(relative)
        let standardized = candidate.standardizedFileURL
        guard standardized.path.hasPrefix(root.standardizedFileURL.path) else {
            throw URLError(.noPermissionsToReadFile)
        }
        if FileManager.default.fileExists(atPath: standardized.path) {
            return standardized
        }
        let index = root.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: index.path) {
            return index
        }
        throw URLError(.fileDoesNotExist)
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        case "map": return "application/json"
        default:
            return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
