import Combine
import SwiftUI
import UIKit
import WebKit

struct StudioWebView: UIViewRepresentable {
    @ObservedObject var session: StudioSession

    func makeCoordinator() -> Coordinator {
        Coordinator(session: session)
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContent = WKUserContentController()
        let wkConfig = WKWebViewConfiguration()
        wkConfig.processPool = WKProcessPool()
        wkConfig.userContentController = userContent
        wkConfig.websiteDataStore = .nonPersistent()
        wkConfig.defaultWebpagePreferences.allowsContentJavaScript = true
        wkConfig.preferences.javaScriptCanOpenWindowsAutomatically = true
        let webView = WKWebView(frame: .zero, configuration: wkConfig)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.13, alpha: 1)
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        context.coordinator.attach(webView)
        var request = URLRequest(
            url: StudioOrigin.launcherURL,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: StudioOrigin.loadTimeout
        )
        request.httpShouldHandleCookies = true
        webView.load(request)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.session = session
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.teardown(uiView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var session: StudioSession
        private var observations = Set<AnyCancellable>()
        private var confirmCompletion: Once<Bool>?
        private var promptCompletion: Once<String?>?
        private var alertCompletion: (() -> Void)?

        init(session: StudioSession) {
            self.session = session
        }

        func attach(_ webView: WKWebView) {
            session.browser.webView = webView
            webView.publisher(for: \.canGoBack)
                .receive(on: DispatchQueue.main)
                .sink { [weak self, weak webView] value in
                    guard let self, let webView else { return }
                    self.session.updateControlState(
                        canGoBack: value,
                        canGoForward: webView.canGoForward,
                        isLoading: webView.isLoading
                    )
                }
                .store(in: &observations)
            webView.publisher(for: \.canGoForward)
                .receive(on: DispatchQueue.main)
                .sink { [weak self, weak webView] value in
                    guard let self, let webView else { return }
                    self.session.updateControlState(
                        canGoBack: webView.canGoBack,
                        canGoForward: value,
                        isLoading: webView.isLoading
                    )
                }
                .store(in: &observations)
            webView.publisher(for: \.isLoading)
                .receive(on: DispatchQueue.main)
                .sink { [weak self, weak webView] value in
                    guard let self, let webView else { return }
                    self.session.updateControlState(
                        canGoBack: webView.canGoBack,
                        canGoForward: webView.canGoForward,
                        isLoading: value
                    )
                }
                .store(in: &observations)
        }

        func teardown(_ webView: WKWebView) {
            observations.removeAll()
            confirmCompletion?.call(false)
            confirmCompletion = nil
            promptCompletion?.call(nil)
            promptCompletion = nil
            alertCompletion?()
            alertCompletion = nil
            if let alert = Self.topPresenter(from: webView) as? UIAlertController {
                alert.dismiss(animated: false)
            }
            webView.stopLoading()
            webView.navigationDelegate = nil
            webView.uiDelegate = nil
            if session.browser.webView === webView {
                session.browser.webView = nil
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            preferences: WKWebpagePreferences,
            decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
        ) {
            preferences.allowsContentJavaScript = true
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel, preferences)
                return
            }
            if navigationAction.targetFrame == nil {
                if StudioOrigin.isAllowed(url) {
                    if session.restrictsMainFrameToLauncher && !StudioOrigin.isLauncherURL(url) {
                        decisionHandler(.cancel, preferences)
                        return
                    }
                    webView.load(navigationAction.request)
                }
                decisionHandler(.cancel, preferences)
                return
            }
            if navigationAction.targetFrame?.isMainFrame == true,
               session.restrictsMainFrameToLauncher,
               !StudioOrigin.isLauncherURL(url) {
                decisionHandler(.cancel, preferences)
                session.handleDisallowedLauncherNavigation()
                return
            }
            if StudioOrigin.isAllowed(url) {
                decisionHandler(.allow, preferences)
            } else {
                decisionHandler(.cancel, preferences)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            guard let url = navigationResponse.response.url, StudioOrigin.isAllowed(url) else {
                decisionHandler(.cancel)
                return
            }
            if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse {
                if !session.handleMainFrameHTTP(url: url, statusCode: http.statusCode) {
                    decisionHandler(.cancel)
                    return
                }
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            let space = challenge.protectionSpace
            if space.authenticationMethod == NSURLAuthenticationMethodServerTrust {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            guard StudioOrigin.isExpectedBasicProtectionSpace(space) else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            if challenge.previousFailureCount > 0 {
                completionHandler(.cancelAuthenticationChallenge, nil)
                session.handleRejectedChallenge()
                return
            }
            guard let password = session.passwordForExpectedChallenge() else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            session.noteOfferedCredentialIfLauncher(url: webView.url)
            let credential = URLCredential(
                user: StudioOrigin.username,
                password: password,
                persistence: .none
            )
            completionHandler(.useCredential, credential)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            session.handleNavigationFailure(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            session.handleNavigationFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            session.handleNavigationFailure(URLError(.unknown), isProcessTermination: true)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url, StudioOrigin.isAllowed(url) {
                if session.restrictsMainFrameToLauncher && !StudioOrigin.isLauncherURL(url) {
                    return nil
                }
                webView.load(navigationAction.request)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.deny)
        }

        func webView(
            _ webView: WKWebView,
            authenticationChallenge challenge: URLAuthenticationChallenge,
            shouldAllowDeprecatedTLS decisionHandler: @escaping (Bool) -> Void
        ) {
            decisionHandler(false)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let once = Once<Bool> { _ in completionHandler() }
            alertCompletion = { once.call(true) }
            presentAlert(on: webView, title: nil, message: message, textField: false, cancel: false) { _ in
                once.call(true)
                self.alertCompletion = nil
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let once = Once(completionHandler)
            confirmCompletion = once
            presentAlert(on: webView, title: nil, message: message, textField: false, cancel: true) { accepted in
                once.call(accepted != nil)
                self.confirmCompletion = nil
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let once = Once(completionHandler)
            promptCompletion = once
            presentAlert(on: webView, title: nil, message: prompt, textField: true, defaultText: defaultText, cancel: true) { value in
                once.call(value)
                self.promptCompletion = nil
            }
        }

        private func presentAlert(
            on webView: WKWebView,
            title: String?,
            message: String,
            textField: Bool,
            defaultText: String? = nil,
            cancel: Bool,
            completion: @escaping (String?) -> Void
        ) {
            guard let presenter = Self.topPresenter(from: webView) else {
                completion(nil)
                return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            if textField {
                alert.addTextField { field in
                    field.text = defaultText
                    field.autocorrectionType = .no
                    field.autocapitalizationType = .none
                }
            }
            if cancel {
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                    completion(nil)
                })
            }
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                if textField {
                    completion(alert.textFields?.first?.text)
                } else {
                    completion("")
                }
            })
            presenter.present(alert, animated: true)
        }

        private static func topPresenter(from webView: WKWebView) -> UIViewController? {
            var presenter = webView.window?.rootViewController
            while let shown = presenter?.presentedViewController {
                presenter = shown
            }
            return presenter
        }
    }
}

private final class Once<Value> {
    private var handler: ((Value) -> Void)?

    init(_ handler: @escaping (Value) -> Void) {
        self.handler = handler
    }

    func call(_ value: Value) {
        let current = handler
        handler = nil
        current?(value)
    }
}
