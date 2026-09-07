# Pastel RTS iOS shell

Minimal SwiftUI + WKWebView host for the Three.js runtime.

## Generate the Xcode project

This repository checks in an XcodeGen spec rather than a generated `.xcodeproj`.

```bash
brew install xcodegen
cd apps/ios-shell
xcodegen generate
open PastelRTS.xcodeproj
```

Exact generation command from the repo root:

```bash
(cd apps/ios-shell && xcodegen generate)
```

## Bundled production vs local Vite

1. Build the web runtime and copy it into the app bundle:

```bash
npm run build
npm run ios:sync-web
```

2. Release / local-device runs load those files through the `pastel://` URL scheme with the Milestone 1 Interaction Lab query (`mode=interaction-lab`, `content=bundle`, `scenario=interaction-lab-alien-fantasy`, `seed=42`, and the selected renderer). No network is required.

3. Debug builds can instead load `http://<LAN-IP>:5173/` with the same Interaction Lab query from the Developer gear. Set the host to the Mac running `npm run dev`. If the server is unreachable, the shell shows a concrete error.

The app has two tabs:

- **Game**: the bundled Interaction Lab. Release builds load `pastel://game/index.html` and do not make a network request at startup or in the frame loop.
- **Studio**: a separate in-app browser for `https://pastel.contenthelper.in`. It is created only after the Studio tab is selected. With no saved password it shows a login form and makes no request until Sign In. The password is stored in the iOS Keychain after a successful launcher sign-in.

The Developer sheet on the Game tab still includes two external Safari links:

- **Open hosted studio**: `https://pastel.contenthelper.in/`
- **Open browser playtest**: `https://pastel.contenthelper.in/game/?mode=interaction-lab`

WKWebView is inspectable in Debug on iOS 16.4+.

## App Store release generation

Generate the Xcode project from `project.yml` on macOS. The spec sets team `4JRB53LG5C`, version `0.0.1`, build `2`, automatic signing, iPad-only deployment, and the non-exempt encryption declaration. Use `apps/ios-shell/ExportOptions-AppStore.plist` when exporting an App Store archive with automatic App Store Connect signing.

## Physical iPad

See `docs/ipad-physical-device-checklist.md`. Connect the iPad, select it as the run destination, and keep the device in landscape.
