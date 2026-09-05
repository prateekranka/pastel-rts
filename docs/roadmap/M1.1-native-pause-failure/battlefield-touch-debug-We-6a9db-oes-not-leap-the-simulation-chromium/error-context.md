# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/game-web/e2e/battlefield.spec.ts >> touch debug, WebGPU fallback, pause, soak >> native pause/resume does not leap the simulation
- Location: apps/game-web/e2e/battlefield.spec.ts:121:3

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 3
Received:   4
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - strong [ref=e5]: Diagnostics
    - button "Collapse diagnostics" [expanded] [ref=e6]: Collapse
  - generic [ref=e7]:
    - generic [ref=e8]: "FPS 8.6 avg 7.1 1% low 3.2 frame 116.70ms avg 140.35ms p95 271.61ms p99 307.69ms sim 0.00ms nav-debug 0.00ms snapshot latency 1644.00ms draw calls 31 tris 6608 textures 1 geometries 22 chunks 16 units 40 entities 80 renderer webgl (webgl) requested webgl init error: none DPR cap 1 effective 1.00 viewport 1280×800 buffer 1280×800 elapsed 2.7s soak idle content revision none phase not-applicable content manifest none content visual none content rules none content assets none content error: none"
    - generic [ref=e9]:
      - generic [ref=e10]:
        - text: Renderer
        - combobox "Renderer" [ref=e11]:
          - option "WebGL" [selected]
          - option "WebGPU"
      - generic [ref=e12]:
        - text: Benchmark
        - combobox "Benchmark" [ref=e13]:
          - option "idle-base" [selected]
          - option "normal-midgame"
          - option "dense-battle"
          - option "camera-pan-stress"
          - option "maximum-population"
          - option "2x-stress"
          - option "20-minute-soak"
          - option "visual-capture"
      - generic [ref=e14]:
        - text: DPR
        - combobox "DPR" [ref=e15]:
          - option "1" [selected]
          - option "1.25"
          - option "1.5"
          - option "native"
      - generic [ref=e16]:
        - checkbox "Touch debug" [ref=e17]
        - text: Touch debug
      - button "Haptic" [ref=e18]
      - button "Download report" [ref=e19]
      - button "Start 20-min soak" [ref=e20]
```

# Test source

```ts
  33  |       waitUntil: 'networkidle',
  34  |     });
  35  |     await page.waitForSelector('#game-canvas');
  36  |     await page.waitForSelector('.pastel-hud');
  37  |     await expect(page.locator('.pastel-hud')).toBeVisible();
  38  |     await expect(page.locator('.pastel-hud')).toContainText('Diagnostics');
  39  |     await expect(page.locator('.pastel-hud')).toContainText(/FPS/i);
  40  |     await expect(page.locator('.pastel-hud')).toContainText(/1% low/i);
  41  |     await expect(page.locator('.pastel-hud')).toContainText(/p95/i);
  42  |     await expect(page.locator('.pastel-hud')).toContainText(/p99/i);
  43  |     await expect(page.locator('.pastel-hud')).toContainText(/draw calls/i);
  44  |     await expect(page.locator('.pastel-hud')).toContainText(/snapshot latency/i);
  45  |     await expect(page.locator('.pastel-hud')).toContainText(/viewport/i);
  46  |     await expect(page.locator('.pastel-hud')).toContainText(/DPR/i);
  47  |     await expect(page.locator('.pastel-hud')).toContainText(/chunks/i);
  48  |     await expect(page.locator('.pastel-hud')).toContainText(/renderer/i);
  49  | 
  50  |     const before = await page.evaluate(() => {
  51  |       const app = window.__pastelApp;
  52  |       return app
  53  |         ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z, zoom: app.getCamera().getVisibleCellsX() }
  54  |         : null;
  55  |     });
  56  |     expect(before).not.toBeNull();
  57  | 
  58  |     const canvas = page.locator('#game-canvas');
  59  |     const box = await canvas.boundingBox();
  60  |     expect(box).toBeTruthy();
  61  |     if (!box) {
  62  |       return;
  63  |     }
  64  |     await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  65  |     await page.mouse.down();
  66  |     await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 80);
  67  |     await page.mouse.up();
  68  | 
  69  |     const afterPan = await page.evaluate(() => {
  70  |       const app = window.__pastelApp;
  71  |       return app
  72  |         ? { x: app.getCamera().lookAt.x, z: app.getCamera().lookAt.z, zoom: app.getCamera().getVisibleCellsX() }
  73  |         : null;
  74  |     });
  75  |     expect(afterPan).not.toBeNull();
  76  |     if (!before || !afterPan) {
  77  |       return;
  78  |     }
  79  |     expect(Math.hypot(afterPan.x - before.x, afterPan.z - before.z)).toBeGreaterThan(2);
  80  | 
  81  |     const wheelPrevented = await canvas.evaluate((el) => {
  82  |       const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  83  |       el.dispatchEvent(event);
  84  |       return event.defaultPrevented;
  85  |     });
  86  |     expect(wheelPrevented).toBe(true);
  87  | 
  88  |     await canvas.evaluate((el) => {
  89  |       el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
  90  |       el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
  91  |       el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
  92  |     });
  93  |     await page.waitForTimeout(250);
  94  |     const afterZoom = await page.evaluate(() => window.__pastelApp?.getCamera().getVisibleCellsX() ?? 0);
  95  |     expect(afterZoom).toBeLessThan(before.zoom - 5);
  96  | 
  97  |     await page.getByRole('button', { name: 'Collapse' }).click();
  98  |     await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible();
  99  |   });
  100 | });
  101 | 
  102 | test.describe('touch debug, WebGPU fallback, pause, soak', () => {
  103 |   test('optional touch-debug overlay is addressable', async ({ page }) => {
  104 |     await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1&touchDebug=1', {
  105 |       waitUntil: 'networkidle',
  106 |     });
  107 |     await expect(page.locator('.pastel-touch-debug')).toBeVisible();
  108 |     await expect(page.locator('.pastel-touch-debug')).toContainText(/gesture:/);
  109 |   });
  110 | 
  111 |   test('WebGPU request falls back and still renders', async ({ page }) => {
  112 |     await page.goto('/?benchmark=idle-base&seed=1&renderer=webgpu&dpr=1', {
  113 |       waitUntil: 'networkidle',
  114 |     });
  115 |     await page.waitForSelector('#game-canvas');
  116 |     await expect(page.locator('.pastel-hud')).toContainText(/requested webgpu/i);
  117 |     const ready = await page.evaluate(() => Boolean(window.__pastelApp?.getRenderer()));
  118 |     expect(ready).toBe(true);
  119 |   });
  120 | 
  121 |   test('native pause/resume does not leap the simulation', async ({ page }) => {
  122 |     await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1', {
  123 |       waitUntil: 'networkidle',
  124 |     });
  125 |     await page.waitForFunction(() => (window.__pastelApp?.getSim().getLatestTick() ?? 0) > 4);
  126 |     const before = await page.evaluate(() => window.__pastelApp?.getSim().getLatestTick() ?? 0);
  127 |     await page.evaluate(() => {
  128 |       window.__pastelNative?.postMessage({ type: 'pause' });
  129 |     });
  130 |     await expect.poll(async () => page.evaluate(() => window.__pastelApp?.isPaused() ?? false)).toBe(true);
  131 |     await page.waitForTimeout(600);
  132 |     const paused = await page.evaluate(() => window.__pastelApp?.getSim().getLatestTick() ?? 0);
> 133 |     expect(paused - before).toBeLessThan(3);
      |                             ^ Error: expect(received).toBeLessThan(expected)
  134 |     await page.evaluate(() => {
  135 |       window.__pastelNative?.postMessage({ type: 'resume' });
  136 |     });
  137 |     await expect.poll(async () => page.evaluate(() => window.__pastelApp?.isPaused() ?? true)).toBe(false);
  138 |     await page.waitForFunction((tick) => (window.__pastelApp?.getSim().getLatestTick() ?? 0) > tick, paused);
  139 |   });
  140 | 
  141 |   test('matching native developer config does not reload', async ({ page }) => {
  142 |     await page.goto('/?benchmark=idle-base&seed=1&renderer=webgl&dpr=1.5', {
  143 |       waitUntil: 'networkidle',
  144 |     });
  145 |     const before = page.url();
  146 |     await page.evaluate(() => {
  147 |       window.__pastelNative?.postMessage({
  148 |         type: 'setDeveloperConfiguration',
  149 |         payload: { renderer: 'webgl', haptics: true },
  150 |       });
  151 |     });
  152 |     await page.waitForTimeout(400);
  153 |     expect(page.url()).toBe(before);
  154 |   });
  155 | 
  156 |   test('short soak exports JSON with required fields and moves the camera', async ({ page }) => {
  157 |     const downloadPromise = page.waitForEvent('download', { timeout: 25_000 });
  158 |     await page.goto('/?benchmark=20-minute-soak&soakMs=3000&seed=1&renderer=webgl&dpr=1', {
  159 |       waitUntil: 'domcontentloaded',
  160 |     });
  161 |     await page.waitForSelector('#game-canvas');
  162 |     const startLook = await page.evaluate(() => {
  163 |       const look = window.__pastelApp?.getCamera().lookAt;
  164 |       return look ? { x: look.x, z: look.z } : null;
  165 |     });
  166 |     await page.waitForTimeout(1200);
  167 |     const moved = await page.evaluate((start) => {
  168 |       const look = window.__pastelApp?.getCamera().lookAt;
  169 |       if (!look || !start) {
  170 |         return 0;
  171 |       }
  172 |       return Math.hypot(look.x - start.x, look.z - start.z);
  173 |     }, startLook);
  174 |     expect(moved).toBeGreaterThan(1);
  175 | 
  176 |     const download = await downloadPromise;
  177 |     const path = await download.path();
  178 |     expect(path).toBeTruthy();
  179 |     const report = JSON.parse(readFileSync(path ?? '', 'utf8')) as Record<string, unknown>;
  180 |     for (const key of REQUIRED_PERFORMANCE_REPORT_KEYS) {
  181 |       expect(report).toHaveProperty(key);
  182 |     }
  183 |     expect(report['physicalValidationStatus']).toBe('awaiting-physical-validation');
  184 |     expect(report['autoCameraMotion']).toBe(true);
  185 |     expect(report['benchmark']).toBe('20-minute-soak');
  186 |     expect(typeof report['userAgent']).toBe('string');
  187 |     expect(report['viewport']).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
  188 |   });
  189 | });
  190 | 
```