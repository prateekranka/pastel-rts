import { BENCHMARK_NAMES, reloadWithQuery, type BenchmarkName, type RuntimeConfig } from '../runtime/config';
import { DPR_PRESETS, type DprPreset } from '../config/constants';
import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';
import type { RendererKind } from '../renderer/adapter';
import type { SimCounts } from '../sim/types';

const MINIMAP_SIZE_CSS = MIN_TOUCH_TARGET_CSS * 3;
const HUD_TOP_OFFSET_CSS = 12 + MINIMAP_SIZE_CSS + 12;
const HUD_BOTTOM_RESERVE_CSS = MIN_TOUCH_TARGET_CSS + 28;

export type HudModel = {
  currentFps: number;
  rollingAvgFps: number;
  onePercentLowFps: number;
  currentFrameTimeMs: number;
  avgFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  simTickMs: number;
  navTickMs: number;
  snapshotLatencyMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  visibleChunks: number;
  visibleUnits: number;
  totalEntities: number;
  renderer: RendererKind;
  rendererBackend: string;
  rendererRequested: RendererKind;
  rendererInitError: string | null;
  dprPreset: DprPreset;
  effectiveDpr: number;
  viewport: { width: number; height: number };
  drawingBuffer: { width: number; height: number };
  elapsedMs: number;
  soakActive: boolean;
  counts: SimCounts | null;
  activeRevision: string | null;
  contentPhase: string;
  contentError: string | null;
  activeManifestHash: string | null;
  activeVisualContentHash: string | null;
  activeSimulationRulesHash: string | null;
  activeAssetBaseUrl: string | null;
};

export type HudHandlers = {
  onToggle: () => void;
  onRenderer: (kind: RendererKind) => void;
  onBenchmark: (name: BenchmarkName) => void;
  onDpr: (preset: DprPreset) => void;
  onTouchDebug: (enabled: boolean) => void;
  onHaptic: () => void;
  onDownloadReport: () => void;
  onToggleSoak: () => void;
};

export class DiagnosticsHud {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly metrics: HTMLPreElement;
  private collapsed = false;
  private handlers: HudHandlers | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pastel-hud';
    this.root.innerHTML = `
      <div class="pastel-hud-bar">
        <strong>Diagnostics</strong>
        <button
          type="button"
          data-action="toggle"
          aria-controls="pastel-hud-body"
          aria-expanded="true"
          aria-label="Collapse diagnostics"
        >Collapse</button>
      </div>
      <div class="pastel-hud-body" id="pastel-hud-body">
        <pre data-role="metrics"></pre>
        <div class="pastel-hud-controls">
          <label>Renderer
            <select data-role="renderer">
              <option value="webgl">WebGL</option>
              <option value="webgpu">WebGPU</option>
            </select>
          </label>
          <label>Benchmark
            <select data-role="benchmark">
              ${BENCHMARK_NAMES.map((name) => `<option value="${name}">${name}</option>`).join('')}
            </select>
          </label>
          <label>DPR
            <select data-role="dpr">
              ${DPR_PRESETS.map((preset) => `<option value="${preset}">${preset}</option>`).join('')}
            </select>
          </label>
          <label class="inline"><input type="checkbox" data-role="touch-debug" /> Touch debug</label>
          <button type="button" data-action="haptic">Haptic</button>
          <button type="button" data-action="report">Download report</button>
          <button type="button" data-action="soak">Start 20-min soak</button>
        </div>
      </div>
    `;
    injectHudStyles();
    host.append(this.root);
    this.body = this.root.querySelector('.pastel-hud-body') as HTMLDivElement;
    this.metrics = this.root.querySelector('[data-role="metrics"]') as HTMLPreElement;
    this.root.addEventListener('change', (event) => this.onChange(event));
    this.root.addEventListener('click', (event) => this.onClick(event));
    for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      this.root.addEventListener(eventName, (event) => event.stopPropagation());
    }
  }

  setHandlers(handlers: HudHandlers): void {
    this.handlers = handlers;
  }

  syncConfig(config: RuntimeConfig): void {
    const renderer = this.root.querySelector('[data-role="renderer"]');
    const benchmark = this.root.querySelector('[data-role="benchmark"]');
    const dpr = this.root.querySelector('[data-role="dpr"]');
    const touch = this.root.querySelector('[data-role="touch-debug"]');
    if (renderer instanceof HTMLSelectElement) {
      renderer.value = config.renderer;
    }
    if (benchmark instanceof HTMLSelectElement) {
      benchmark.value = config.benchmark;
    }
    if (dpr instanceof HTMLSelectElement) {
      dpr.value = String(config.dprPreset);
    }
    if (touch instanceof HTMLInputElement) {
      touch.checked = config.touchDebug;
    }
  }

  update(model: HudModel): void {
    this.metrics.textContent = [
      `FPS ${model.currentFps.toFixed(1)}  avg ${model.rollingAvgFps.toFixed(1)}  1% low ${model.onePercentLowFps.toFixed(1)}`,
      `frame ${model.currentFrameTimeMs.toFixed(2)}ms  avg ${model.avgFrameTimeMs.toFixed(2)}ms  p95 ${model.p95FrameTimeMs.toFixed(2)}ms  p99 ${model.p99FrameTimeMs.toFixed(2)}ms`,
      `sim ${model.simTickMs.toFixed(2)}ms  nav-debug ${model.navTickMs.toFixed(2)}ms  snapshot latency ${model.snapshotLatencyMs.toFixed(2)}ms`,
      `draw calls ${model.drawCalls}  tris ${model.triangles}  textures ${model.textures}  geometries ${model.geometries}`,
      `chunks ${model.visibleChunks}  units ${model.visibleUnits}  entities ${model.totalEntities}`,
      `renderer ${model.renderer} (${model.rendererBackend}) requested ${model.rendererRequested}`,
      model.rendererInitError ? `init error: ${model.rendererInitError}` : 'init error: none',
      `DPR cap ${model.dprPreset}  effective ${model.effectiveDpr.toFixed(2)}`,
      `viewport ${model.viewport.width}×${model.viewport.height}  buffer ${model.drawingBuffer.width}×${model.drawingBuffer.height}`,
      `elapsed ${(model.elapsedMs / 1000).toFixed(1)}s  soak ${model.soakActive ? 'running' : 'idle'}`,
      `content revision ${model.activeRevision ?? 'none'}  phase ${model.contentPhase}`,
      `content manifest ${model.activeManifestHash ?? 'none'}`,
      `content visual ${model.activeVisualContentHash ?? 'none'}`,
      `content rules ${model.activeSimulationRulesHash ?? 'none'}`,
      `content assets ${model.activeAssetBaseUrl ?? 'none'}`,
      model.contentError ? `content error: ${model.contentError}` : 'content error: none',
    ].join('\n');
    const soakBtn = this.root.querySelector('[data-action="soak"]');
    if (soakBtn instanceof HTMLButtonElement) {
      soakBtn.textContent = model.soakActive ? 'Stop soak & export' : 'Start 20-min soak';
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const actionTarget = target.closest<HTMLElement>('[data-action]');
    const action = actionTarget?.dataset['action'];
    if (action === 'toggle') {
      this.collapsed = !this.collapsed;
      this.body.hidden = this.collapsed;
      if (actionTarget) {
        actionTarget.textContent = this.collapsed ? 'Expand' : 'Collapse';
        actionTarget.setAttribute('aria-expanded', String(!this.collapsed));
        actionTarget.setAttribute(
          'aria-label',
          this.collapsed ? 'Expand diagnostics' : 'Collapse diagnostics',
        );
      }
      this.handlers?.onToggle();
    } else if (action === 'haptic') {
      this.handlers?.onHaptic();
    } else if (action === 'report') {
      this.handlers?.onDownloadReport();
    } else if (action === 'soak') {
      this.handlers?.onToggleSoak();
    }
  }

  private onChange(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset['role'] === 'renderer') {
      this.handlers?.onRenderer(target.value === 'webgpu' ? 'webgpu' : 'webgl');
    }
    if (target instanceof HTMLSelectElement && target.dataset['role'] === 'benchmark') {
      this.handlers?.onBenchmark(target.value as BenchmarkName);
    }
    if (target instanceof HTMLSelectElement && target.dataset['role'] === 'dpr') {
      const value = target.value;
      const preset: DprPreset =
        value === 'native' ? 'native' : value === '1' ? 1 : value === '1.25' ? 1.25 : 1.5;
      this.handlers?.onDpr(preset);
    }
    if (target instanceof HTMLInputElement && target.dataset['role'] === 'touch-debug') {
      this.handlers?.onTouchDebug(target.checked);
    }
  }
}

export { reloadWithQuery };

function injectHudStyles(): void {
  if (document.getElementById('pastel-hud-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'pastel-hud-style';
  style.textContent = `
    .pastel-hud {
      position:fixed;
      top:${HUD_TOP_OFFSET_CSS}px;
      right:12px;
      z-index:20;
      width:min(380px,92vw);
      max-height:max(44px,calc(100vh - ${HUD_TOP_OFFSET_CSS + HUD_BOTTOM_RESERVE_CSS}px - env(safe-area-inset-bottom,0px)));
      max-height:max(44px,calc(100dvh - ${HUD_TOP_OFFSET_CSS + HUD_BOTTOM_RESERVE_CSS}px - env(safe-area-inset-bottom,0px)));
      display:flex;
      flex-direction:column;
      background:rgba(10,24,26,.88);
      color:#f2e6d0;
      border:1px solid #4a8187;
      border-radius:10px;
      font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow:hidden;
      pointer-events:auto;
    }
    .pastel-hud-bar {
      display:flex;
      flex:0 0 auto;
      justify-content:space-between;
      align-items:center;
      gap:8px;
      min-height:${MIN_TOUCH_TARGET_CSS + 16}px;
      padding:8px 10px;
      background:#1c4549;
    }
    .pastel-hud-bar strong { min-width:0; }
    .pastel-hud-bar button,
    .pastel-hud-controls button,
    .pastel-hud-controls select {
      pointer-events:auto;
      min-height:${MIN_TOUCH_TARGET_CSS}px;
      font:inherit;
    }
    .pastel-hud-bar button {
      flex:0 0 auto;
      min-width:88px;
    }
    .pastel-hud-body {
      min-height:0;
      flex:1 1 auto;
      overflow-x:hidden;
      overflow-y:auto;
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
      touch-action:pan-y;
      padding:8px 10px 10px;
    }
    .pastel-hud pre {
      max-width:100%;
      margin:0 0 8px;
      white-space:pre-wrap;
      overflow-wrap:anywhere;
      word-break:break-word;
    }
    .pastel-hud-controls { display:grid; gap:6px; }
    .pastel-hud-controls label { display:flex; flex-direction:column; gap:2px; }
    .pastel-hud-controls label.inline { flex-direction:row; align-items:center; min-height:${MIN_TOUCH_TARGET_CSS}px; gap:6px; }
    .pastel-hud button, .pastel-hud select {
      background:#2f565b;
      color:#f2e6d0;
      border:1px solid #5ce1e6;
      border-radius:6px;
      padding:4px 8px;
    }
    .pastel-hud button:focus-visible,
    .pastel-hud select:focus-visible,
    .pastel-hud input:focus-visible {
      outline:2px solid #f5c56b;
      outline-offset:2px;
    }
  `;
  document.head.append(style);
}
