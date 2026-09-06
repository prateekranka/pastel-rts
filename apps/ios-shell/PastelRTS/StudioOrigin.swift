import Foundation

enum StudioOrigin {
    static let host = "pastel.contenthelper.in"
    static let username = "studio"
    static let realm = "Pastel RTS Hosted Studio"
    static let keychainService = "com.pastelrts.app.studio"
    static let loadTimeout: TimeInterval = 20

    static var keychainAccount: String { "\(username)@\(host)" }

    static let launcherURL = URL(string: "https://\(host)/")!

    static func isAllowed(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https" else { return false }
        guard url.host?.lowercased() == host else { return false }
        guard url.port == nil || url.port == 443 else { return false }
        guard url.user == nil, url.password == nil else { return false }
        return true
    }

    static func isLauncherURL(_ url: URL) -> Bool {
        guard isAllowed(url) else { return false }
        let path = url.path.isEmpty ? "/" : url.path
        guard path == "/" else { return false }
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems, !items.isEmpty {
            return false
        }
        return true
    }

    static func isExpectedBasicProtectionSpace(_ space: URLProtectionSpace) -> Bool {
        guard space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic else { return false }
        guard space.host.lowercased() == host else { return false }
        guard space.`protocol` == "https" else { return false }
        guard space.port == 443 || space.port == 0 else { return false }
        guard space.realm == realm else { return false }
        guard space.receivesCredentialSecurely else { return false }
        return true
    }
}

enum StudioUserMessage {
    static let wrongPassword = "That password was not accepted."
    static let unreachable = "Studio is unreachable. Check the network and try again."
    static let timeout = "Studio took too long to respond. Try again."
    static let keychainSave = "Studio signed in, but this device could not remember the password."
    static let keychainRead = "Studio could not read a saved password on this device."
}
