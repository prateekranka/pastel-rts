import Combine
import Foundation
import WebKit

enum StudioPhase: Equatable {
    case signedOut
    case authenticating
    case authenticated
    case loadError
}

final class StudioBrowserBridge {
    weak var webView: WKWebView?

    func goBack() {
        webView?.goBack()
    }

    func goForward() {
        webView?.goForward()
    }

    func reload() {
        webView?.reload()
    }
}

final class StudioSession: ObservableObject {
    @Published private(set) var phase: StudioPhase = .signedOut
    @Published var loginError: String?
    @Published var loadErrorMessage: String?
    @Published var saveNotice: String?
    @Published private(set) var webSessionID = UUID()
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var isLoading = false
    @Published private(set) var isSigningIn = false

    let browser = StudioBrowserBridge()

    private var didPrepare = false
    private var candidatePassword: String?
    private var storedPassword: String?
    private var offeredCredentialForLauncher = false
    private var launcherNavigationInFlight = false
    private var didCommitCandidate = false
    private var rejectionHandledForSession = false

    func prepareIfNeeded() {
        guard !didPrepare else { return }
        didPrepare = true
        switch StudioKeychainStore.read() {
        case .missing:
            phase = .signedOut
        case .secret(let secret):
            storedPassword = secret
            startLoad(usingStoredCredential: true)
        case .failed:
            phase = .signedOut
            loginError = StudioUserMessage.keychainRead
        }
    }

    func signIn(password: String) {
        guard !password.isEmpty, !isSigningIn, phase == .signedOut else { return }
        isSigningIn = true
        loginError = nil
        saveNotice = nil
        loadErrorMessage = nil
        candidatePassword = password
        storedPassword = nil
        startLoad(usingStoredCredential: false)
        isSigningIn = false
    }

    func logOut() {
        guard StudioKeychainStore.delete() else {
            if phase == .loadError {
                loadErrorMessage = StudioUserMessage.keychainLogout
            } else {
                saveNotice = StudioUserMessage.keychainLogout
            }
            return
        }
        clearSecrets()
        loginError = nil
        loadErrorMessage = nil
        saveNotice = nil
        phase = .signedOut
        destroyWebSession()
    }

    func retry() {
        guard phase == .loadError else { return }
        loadErrorMessage = nil
        if storedPassword != nil {
            startLoad(usingStoredCredential: true)
        } else {
            phase = .signedOut
        }
    }

    var restrictsMainFrameToLauncher: Bool {
        launcherNavigationInFlight
    }

    func passwordForExpectedChallenge() -> String? {
        candidatePassword ?? storedPassword
    }

    func noteOfferedCredentialIfLauncher(url: URL?) {
        if let url {
            if url.absoluteString == "about:blank" || StudioOrigin.isLauncherURL(url) {
                offeredCredentialForLauncher = true
            }
            return
        }
        offeredCredentialForLauncher = true
    }

    func handleRejectedChallenge() {
        guard !rejectionHandledForSession else { return }
        rejectionHandledForSession = true
        let usedStored = candidatePassword == nil && storedPassword != nil
        candidatePassword = nil
        storedPassword = nil
        offeredCredentialForLauncher = false
        launcherNavigationInFlight = false
        didCommitCandidate = false
        if usedStored {
            StudioKeychainStore.delete()
        }
        loginError = StudioUserMessage.wrongPassword
        loadErrorMessage = nil
        saveNotice = nil
        phase = .signedOut
        destroyWebSession()
    }

    /// Returns whether the web view should commit the response.
    func handleMainFrameHTTP(url: URL, statusCode: Int) -> Bool {
        if launcherNavigationInFlight {
            if (300...399).contains(statusCode) || !StudioOrigin.isLauncherURL(url) {
                failCurrentLoad(message: StudioUserMessage.unreachable)
                return false
            }
            if !(200...299).contains(statusCode) {
                if statusCode == 401 && rejectionHandledForSession {
                    return false
                }
                failCurrentLoad(message: StudioUserMessage.unreachable)
                return false
            }
            launcherNavigationInFlight = false
            guard offeredCredentialForLauncher, let candidate = candidatePassword, !didCommitCandidate else {
                return true
            }
            if StudioKeychainStore.save(candidate) {
                saveNotice = nil
            } else {
                saveNotice = StudioUserMessage.keychainSave
            }
            storedPassword = candidate
            candidatePassword = nil
            didCommitCandidate = true
            offeredCredentialForLauncher = false
            phase = .authenticated
            loginError = nil
            return true
        }
        if (500...599).contains(statusCode) {
            failCurrentLoad(message: StudioUserMessage.unreachable)
            return false
        }
        return true
    }

    func handleDisallowedLauncherNavigation() {
        guard launcherNavigationInFlight, !rejectionHandledForSession else { return }
        failCurrentLoad(message: StudioUserMessage.unreachable)
    }

    func handleNavigationFailure(_ error: Error, isProcessTermination: Bool = false) {
        if rejectionHandledForSession {
            return
        }
        let nsError = error as NSError
        if !isProcessTermination && nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return
        }
        failCurrentLoad(message: sanitizedFailure(nsError))
    }

    func updateControlState(canGoBack: Bool, canGoForward: Bool, isLoading: Bool) {
        if self.canGoBack != canGoBack {
            self.canGoBack = canGoBack
        }
        if self.canGoForward != canGoForward {
            self.canGoForward = canGoForward
        }
        if self.isLoading != isLoading {
            self.isLoading = isLoading
        }
    }

    private func startLoad(usingStoredCredential: Bool) {
        offeredCredentialForLauncher = false
        launcherNavigationInFlight = true
        didCommitCandidate = usingStoredCredential
        rejectionHandledForSession = false
        canGoBack = false
        canGoForward = false
        phase = usingStoredCredential ? .authenticated : .authenticating
        destroyWebSession()
        isLoading = true
    }

    private func destroyWebSession() {
        browser.webView = nil
        webSessionID = UUID()
        canGoBack = false
        canGoForward = false
        isLoading = false
    }

    private func failCurrentLoad(message: String) {
        guard phase == .authenticating || phase == .authenticated else { return }
        let hadUnverifiedCandidate = candidatePassword != nil && !didCommitCandidate
        if hadUnverifiedCandidate {
            candidatePassword = nil
            offeredCredentialForLauncher = false
            launcherNavigationInFlight = false
            loginError = message
            loadErrorMessage = nil
            phase = .signedOut
            destroyWebSession()
            return
        }
        loadErrorMessage = message
        phase = .loadError
        destroyWebSession()
    }

    private func clearSecrets() {
        candidatePassword = nil
        storedPassword = nil
        offeredCredentialForLauncher = false
        launcherNavigationInFlight = false
        didCommitCandidate = false
        rejectionHandledForSession = false
    }

    private func sanitizedFailure(_ error: NSError) -> String {
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorTimedOut {
            return StudioUserMessage.timeout
        }
        return StudioUserMessage.unreachable
    }
}
