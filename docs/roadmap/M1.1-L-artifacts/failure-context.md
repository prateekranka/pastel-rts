# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/game-web/e2e/interaction-lab.spec.ts >> interaction lab >> visual capture — army rail and lab framing
- Location: apps/game-web/e2e/interaction-lab.spec.ts:274:3

# Error details

```
Error: expect(locator).toHaveScreenshot(expected) failed

Locator: locator('#game-canvas')
  31101 pixels (ratio 0.04 of all image pixels) are different.

  Snapshot: interaction-lab-framing.png

Call log:
  - Expect "toHaveScreenshot(interaction-lab-framing.png)" with timeout 15000ms
    - verifying given screenshot expectation
  - waiting for locator('#game-canvas')
    - locator resolved to <canvas width="1280" height="800" tabindex="0" id="game-canvas" data-engine="three.js r185"></canvas>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - 31101 pixels (ratio 0.04 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - waiting for locator('#game-canvas')
    - locator resolved to <canvas width="1280" height="800" tabindex="0" id="game-canvas" data-engine="three.js r185"></canvas>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - captured a stable screenshot
  - 31101 pixels (ratio 0.04 of all image pixels) are different.

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic:
    - generic [ref=e3]:
      - generic [ref=e4]: "0"
      - combobox "Formation" [ref=e5] [cursor=pointer]:
        - 'option "Formation: none" [selected]'
        - 'option "Formation: line"'
        - 'option "Formation: box"'
      - button "Select" [ref=e6] [cursor=pointer]
      - button "Stop" [ref=e7] [cursor=pointer]
    - generic:
      - generic: content bundle revision 3 hash c1eea326…0995 rules 7675a3e1…b1fd scenario interaction-lab-alien-fantasy seed 42
      - generic:
        - combobox "Scenario preset" [ref=e10]:
          - option "lab-skirmish" [selected]
          - option "interaction-lab-alien-fantasy"
          - option "m11-fixture-gallery"
        - button "Load scenario" [ref=e11]
        - spinbutton "Scenario seed" [ref=e12]: "42"
        - button "Apply seed" [ref=e13]
      - generic:
        - combobox "Spawn unit" [ref=e14]:
          - option "Sunweaver Scout" [selected]
          - option "Sunweaver Infantry"
          - option "Sunweaver Walker (Proxy)"
        - button "Spawn" [ref=e15]
        - combobox "Place building" [ref=e16]:
          - option "Sunweaver Sanctum" [selected]
        - button "Place" [ref=e17]
        - button "Nav debug" [ref=e18]
      - generic:
        - button "Reset match" [ref=e19]
        - button "Export save" [ref=e20]
        - button "Import save" [ref=e21]
        - button "Replay check" [ref=e22]
      - generic:
        - button "Export bug bundle" [ref=e23]
        - button "Reproduce bug bundle" [ref=e24]
      - generic: Export a JSON-only bug bundle. On a fresh lab page, choose the file with Reproduce bug bundle. The check uses the same scenario, seed, commands, and checksum sequence.
      - generic:
        - textbox "Content revision" [ref=e25]:
          - /placeholder: revision
        - button "Select revision" [disabled] [ref=e26]
        - button "Restart pending" [disabled] [ref=e27]
        - button "Acknowledge" [disabled] [ref=e28]
    - generic [ref=e29]:
      - generic [ref=e30]:
        - strong [ref=e31]: Diagnostics
        - button "Collapse diagnostics" [expanded] [ref=e32]: Collapse
      - generic [ref=e33]:
        - generic [ref=e34]: "FPS 15.0 avg 12.1 1% low 2.7 frame 66.70ms avg 82.53ms p95 100.00ms p99 229.91ms sim 1.60ms nav-debug 0.00ms snapshot latency 1008.90ms draw calls 24 tris 4852 textures 7 geometries 17 chunks 9 units 25 entities 25 renderer webgl (webgl) requested webgl init error: none DPR cap 1 effective 1.00 viewport 1280×800 buffer 1280×800 elapsed 6.9s soak idle content revision 3 phase ready content manifest none content visual 5c35bc7369b4d2c99ce84c7f2e1e4515389dd7da59005eb6c18bd3d98f153d58 content rules 7675a3e17dd711d341c27c240326efd33aa0405110ade623885e219f5305b1fd content assets /content/dev-pack-v2/ content error: none"
        - generic [ref=e35]:
          - generic [ref=e36]:
            - text: Renderer
            - combobox "Renderer" [ref=e37]:
              - option "WebGL" [selected]
              - option "WebGPU"
          - generic [ref=e38]:
            - text: Benchmark
            - combobox "Benchmark" [ref=e39]:
              - option "idle-base"
              - option "normal-midgame"
              - option "dense-battle" [selected]
              - option "camera-pan-stress"
              - option "maximum-population"
              - option "2x-stress"
              - option "20-minute-soak"
              - option "visual-capture"
          - generic [ref=e40]:
            - text: DPR
            - combobox "DPR" [ref=e41]:
              - option "1" [selected]
              - option "1.25"
              - option "1.5"
              - option "native"
          - generic [ref=e42]:
            - checkbox "Touch debug" [ref=e43]
            - text: Touch debug
          - button "Haptic" [ref=e44]
          - button "Download report" [ref=e45]
          - button "Start 20-min soak" [ref=e46]
```

# Test source

```ts
  178 |         formation: { kind: 'line', spacingSubunits: 1024 },
  179 |       });
  180 |       let goals = new Set<string>();
  181 |       for (let attempt = 0; attempt < 20; attempt += 1) {
  182 |         await new Promise((resolve) => setTimeout(resolve, 100));
  183 |         const debug = lab.runtime.getNavDebug();
  184 |         goals = new Set(
  185 |           (debug?.paths ?? [])
  186 |             .map((path) => {
  187 |               const last = path.cells[path.cells.length - 1];
  188 |               return last ? `${String(last.cx)},${String(last.cz)}` : '';
  189 |             })
  190 |             .filter((key) => key.length > 0),
  191 |         );
  192 |         if (goals.size >= 2) {
  193 |           break;
  194 |         }
  195 |       }
  196 |       return goals.size >= 2;
  197 |     });
  198 |     expect(distinct).toBe(true);
  199 |   });
  200 |
  201 |   test('building placement replans moving units', async ({ page }) => {
  202 |     await page.goto(LAB_URL, { waitUntil: 'networkidle' });
  203 |     await waitForLab(page);
  204 |     const replanned = await page.evaluate(async () => {
  205 |       const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
  206 |       if (!lab) {
  207 |         return false;
  208 |       }
  209 |       const friendlies = lab
  210 |         .getPickableEntities()
  211 |         .filter((entity) => entity.kind === 'unit' && entity.relationship === 'friendly')
  212 |         .slice(0, 4);
  213 |       lab.selection.selectMany(friendlies.map((entity) => entity.id));
  214 |       lab.debugOverlays.set('paths', true);
  215 |       const tick = lab.runtime.getLatestTick();
  216 |       lab.commandClient.issueMove({
  217 |         entityIds: friendlies.map((entity) => entity.id),
  218 |         destination: { x: 70 * 1024, z: 45 * 1024 },
  219 |         issuedAtTick: tick,
  220 |         executeTick: tick,
  221 |       });
  222 |       let beforePaths: Array<{ cells: Array<{ cx: number; cz: number }> }> = [];
  223 |       for (let attempt = 0; attempt < 20; attempt += 1) {
  224 |         await new Promise((resolve) => setTimeout(resolve, 100));
  225 |         beforePaths = lab.runtime.getNavDebug()?.paths ?? [];
  226 |         if (beforePaths.some((path) => path.cells.length > 2)) {
  227 |           break;
  228 |         }
  229 |       }
  230 |       const before = JSON.stringify(beforePaths);
  231 |       const longPath = beforePaths.find((path) => path.cells.length > 2) ?? beforePaths[0];
  232 |       const mid = longPath?.cells[Math.floor((longPath?.cells.length ?? 1) / 2)];
  233 |       const originCell = mid ?? { cx: 28, cz: 22 };
  234 |       lab.commandClient.issuePlaceBuilding({
  235 |         archetypeId: 'sunweaver-sanctum',
  236 |         originCell,
  237 |         issuedAtTick: lab.runtime.getLatestTick(),
  238 |         executeTick: lab.runtime.getLatestTick(),
  239 |       });
  240 |       let after = before;
  241 |       for (let attempt = 0; attempt < 20; attempt += 1) {
  242 |         await new Promise((resolve) => setTimeout(resolve, 100));
  243 |         after = JSON.stringify(lab.runtime.getNavDebug()?.paths ?? []);
  244 |         if (after !== before) {
  245 |           break;
  246 |         }
  247 |       }
  248 |       return before !== after && before.length > 2;
  249 |     });
  250 |     expect(replanned).toBe(true);
  251 |   });
  252 |
  253 |   test('replay checksums match the recorded sequence', async ({ page }) => {
  254 |     await page.goto(LAB_URL, { waitUntil: 'networkidle' });
  255 |     await waitForLab(page);
  256 |     const matched = await page.evaluate(async () => {
  257 |       const lab = window.getInteractionLab?.() ?? window.__pastelApp?.getInteractionLab?.();
  258 |       if (!lab) {
  259 |         return { ok: false, checksums: 0 };
  260 |       }
  261 |       await new Promise((resolve) => setTimeout(resolve, 800));
  262 |       const commands = lab.recorder.exportLog();
  263 |       const checksums = [...lab.runtime.getChecksums()];
  264 |       lab.replay.setRecorded(commands, checksums);
  265 |       return {
  266 |         ok: checksums.length > 0 && lab.replay.runReplay(lab.runtime.getLatestTick()),
  267 |         checksums: checksums.length,
  268 |       };
  269 |     });
  270 |     expect(matched.checksums).toBeGreaterThan(0);
  271 |     expect(matched.ok).toBe(true);
  272 |   });
  273 |
  274 |   test('visual capture — army rail and lab framing', async ({ page }) => {
  275 |     await page.goto(`${LAB_URL}&touchDebug=0`, { waitUntil: 'networkidle' });
  276 |     await waitForLab(page);
  277 |     await page.waitForTimeout(500);
> 278 |     await expect(page.locator('#game-canvas')).toHaveScreenshot('interaction-lab-framing.png', {
      |                                                ^ Error: expect(locator).toHaveScreenshot(expected) failed
  279 |       maxDiffPixelRatio: 0.02,
  280 |       timeout: 15_000,
  281 |       mask: [page.locator('.pastel-hud')],
  282 |     });
  283 |     await expect(page.locator('.pastel-match-hud')).toHaveScreenshot('interaction-lab-army-rail.png', {
  284 |       maxDiffPixelRatio: 0.02,
  285 |       timeout: 15_000,
  286 |     });
  287 |   });
  288 | });
  289 |
  290 | declare global {
  291 |   interface Window {
  292 |     getInteractionLab?: () => LabHook | null;
  293 |     __pastelApp?: {
  294 |       getCamera: () => {
  295 |         lookAt: { x: number; z: number };
  296 |         camera: {
  297 |           position: {
  298 |             constructor: new (
  299 |               x: number,
  300 |               y: number,
  301 |               z: number,
  302 |             ) => { x: number; y: number; project: (cam: unknown) => void };
  303 |           };
  304 |         };
  305 |       };
  306 |       getInteractionLab?: () => LabHook | null;
  307 |     };
  308 |   }
  309 | }
  310 |
  311 | type LabHook = {
  312 |   isReady: () => boolean;
  313 |   selection: {
  314 |     getSelected: () => Array<{ index: number; generation: number }>;
  315 |     selectMany: (ids: Array<{ index: number; generation: number }>) => void;
  316 |   };
  317 |   interaction: { issuedCommands: Array<{ kind: string }> };
  318 |   getPickableEntities: () => Array<{
  319 |     id: { index: number; generation: number };
  320 |     kind: string;
  321 |     relationship: string;
  322 |     x: number;
  323 |     z: number;
  324 |   }>;
  325 |   commandClient: {
  326 |     issueMove: (params: unknown) => void;
  327 |     issuePlaceBuilding: (params: unknown) => void;
  328 |   };
  329 |   runtime: {
  330 |     getLatestTick: () => number;
  331 |     getEntityCount: () => number;
  332 |     getChecksums: () => Array<{ tick: number; hash: number }>;
  333 |     getNavDebug: () => { paths: Array<{ cells: Array<{ cx: number; cz: number }> }> } | null;
  334 |   };
  335 |   recorder: { exportLog: () => unknown[] };
  336 |   replay: {
  337 |     setRecorded: (commands: unknown[], checksums: unknown[]) => void;
  338 |     runReplay: (ticks: number) => boolean;
  339 |   };
  340 |   debugOverlays: { set: (key: string, value: boolean) => void };
  341 | };
  342 |
```