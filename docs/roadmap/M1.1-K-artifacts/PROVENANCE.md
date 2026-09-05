M1.1-K artifact provenance

Purpose

These files preserve the exact unmasked composited captures used to correct the K visual finding. They are review evidence. They are not product files.

Source

- Product source commit: d23642d841c00b937af28e997c92523eea2eec0d (M1.1-H: integrate published runtime and HUD gate).
- Capture worktree: /home/bobbyranka/Projects/pastel-rts-m11-final-review.
- Original capture directory: /tmp/pastel-m11-k-artifacts.Rp0bB8.
- Capture route: interaction lab in explicit studio mode, fixed scenario interaction-lab-alien-fantasy, seed 42, WebGL, DPR 1, 70-percent zoom.
- Renderer: Linux Chromium SwiftShader. This is desktop evidence, not physical-device evidence.
- The files were copied byte-for-byte from the original capture directory. Existing M1.1-final-browser-artifacts files were not overwritten.

Mask correction

The framing test at apps/game-web/e2e/interaction-lab.spec.ts:278-282 intentionally masks page.locator('.pastel-hud') at line 281. Playwright's default mask color is magenta. The magenta area in the historical masked framing image is therefore test masking, not a game render.

The K studio captures below are full unmasked composited screenshots. Direct inspection shows the teal Diagnostics panel and normal game scene. No solid magenta render block is present in either studio capture.

Files and SHA-256

- unmasked-studio-1280x800.png: 98a9e838a65831ed2764aefdb4cf9e1000bb08044da573f243710d612074d1a5
- unmasked-studio-1280x800.json: 79677df773c55abe6ddb634ef2d1c98f53cfc25575b45e02f83bd83fdfe7f10f
- unmasked-studio-1194x834.png: 27d5bf6e0d75e7a17c45a9997a4cd399e679db59431a72ad8c9e68dffe1b5354
- unmasked-studio-1194x834.json: 2c255a3f5d6e431884467c9696794c77db5314af3c2acfec491e692c0c07d0fa
- unmasked-cosmetic-replacement.png: 57e10ea41c4a5bd1d3a4340bbbbaf857b5a11c71ba43c54a6410faead4294f26
- unmasked-cosmetic-replacement.json: 4f3403ee8805b648dc1874b702e90ddfd3c2376b0aaaf3bdddc2bfd9f1f0646a
- unmasked-rules-restart.png: e56d20b60a3f96a1299a41df0b17d20f5b712d0641a6e55daa8e9627e49dc12b
- unmasked-rules-restart.json: 5455004bfa74b819dc444f2ffbec73b3a02c2651866a263336929d2890e08a01
- unmasked-reconnect-and-pin.png: 1281009cc94a88de25c67782e4e3522b58345aa07038e6e5c548d20409c5955c
- unmasked-reconnect-and-pin.json: 0818316fb4f90d76b7c84188ef0a899a6cb15b5564c0479bab533a3fed92c8c2
- unmasked-foundry-launcher.png: 2d71dcde1c766c8cf6976cd04914a945bc7948dca1015ee1b3e566ba57a8119d
- unmasked-foundry-launcher.json: c0feb437e1f7ea5230362033038ab972323b7d97ccf263d0386662fd12bfa7b8

Related baseline evidence

- L handoff: docs/roadmap/M1.1-L-handoff.md.
- L failure and reconciliation evidence: docs/roadmap/M1.1-L-artifacts/.
- The L reconciliation changed only the approved framing PNG. It did not change the framing test mask or threshold.
