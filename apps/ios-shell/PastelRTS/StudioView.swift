import SwiftUI

struct StudioView: View {
    @ObservedObject var session: StudioSession
    @State private var password = ""
    @FocusState private var passwordFocused: Bool

    var body: some View {
        ZStack {
            Color(red: 0.06, green: 0.09, blue: 0.13).ignoresSafeArea()
            switch session.phase {
            case .signedOut:
                login
            case .loadError:
                loadError
            case .authenticating, .authenticated:
                browser
            }
        }
        .onAppear {
            session.prepareIfNeeded()
        }
    }

    private var login: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Studio")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(Color(red: 0.96, green: 0.94, blue: 0.91))
                Text("Enter the hosted studio password. It stays on this iPad and is never stored in the app bundle.")
                    .foregroundStyle(Color(red: 0.72, green: 0.77, blue: 0.79))
                SecureField("Password", text: $password)
                    .textContentType(.none)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($passwordFocused)
                    .padding(14)
                    .background(Color(red: 0.09, green: 0.19, blue: 0.23))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
                    .onSubmit(submitPassword)
                if let loginError = session.loginError {
                    Text(loginError)
                        .foregroundStyle(Color(red: 0.96, green: 0.72, blue: 0.55))
                }
                Button(action: submitPassword) {
                    Text("Sign In")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .disabled(password.isEmpty || session.isSigningIn)
            }
            .padding(32)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            passwordFocused = true
        }
    }

    private var loadError: some View {
        VStack(spacing: 16) {
            Text("Studio is unavailable")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color(red: 0.96, green: 0.94, blue: 0.91))
            Text(session.loadErrorMessage ?? StudioUserMessage.unreachable)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color(red: 0.72, green: 0.77, blue: 0.79))
            Button("Retry") {
                session.retry()
            }
            .buttonStyle(.borderedProminent)
            Button("Log Out", role: .destructive) {
                password = ""
                session.logOut()
            }
        }
        .padding(32)
    }

    private var browser: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Button {
                    session.browser.goBack()
                } label: {
                    Image(systemName: "chevron.backward")
                }
                .accessibilityLabel("Back")
                .disabled(!session.canGoBack)
                Button {
                    session.browser.goForward()
                } label: {
                    Image(systemName: "chevron.forward")
                }
                .accessibilityLabel("Forward")
                .disabled(!session.canGoForward)
                Button {
                    session.browser.reload()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Reload")
                if session.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
                Spacer()
                Button("Log Out", role: .destructive) {
                    password = ""
                    session.logOut()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
            StudioWebView(session: session)
                .id(session.webSessionID)
            if let saveNotice = session.saveNotice {
                Text(saveNotice)
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.96, green: 0.72, blue: 0.55))
                    .padding(8)
            }
        }
    }

    private func submitPassword() {
        let candidate = password
        guard !candidate.isEmpty else { return }
        password = ""
        session.signIn(password: candidate)
    }
}

struct StudioIdlePlaceholder: View {
    var body: some View {
        Color(red: 0.06, green: 0.09, blue: 0.13)
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}
