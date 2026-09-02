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

2. Release / local-device runs load those files through the `pastel://` URL scheme. No network is required.

3. Debug builds can instead load `http://<LAN-IP>:5173` from the Developer gear. Set the host to the Mac running `npm run dev`. If the server is unreachable, the shell shows a concrete error.

WKWebView is inspectable in Debug on iOS 16.4+.

## Physical iPad

See `docs/ipad-physical-device-checklist.md`. Connect the iPad, select it as the run destination, and keep the device in landscape.
