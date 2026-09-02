import { BENCHMARK_NAMES, reloadWithQuery, type BenchmarkName, type RuntimeConfig } from '../runtime/config';
import { DPR_PRESETS, type DprPreset } from '../config/constants';
import type { RendererKind } from '../renderer/adapter';
import type { SimCounts } from '../sim/types';

export type HudModel = {
  currentFps: number;
  rollingAvgFps: number;
  onePercentLowFps: number;
  currentFrameTimeMs: number;
  avgFrameTimeMs: number;
  simTickMs: number;
  snapshotLatencyMs: number;
  drawCalls: number;
  triangles: number;
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
        <button type="button" data-action="toggle">Collapse</button>
      </div>
      <div class="pastel-hud-body">
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
      `frame ${model.currentFrameTimeMs.toFixed(2)}ms  avg ${model.avgFrameTimeMs.toFixed(2)}ms`,
      `sim ${model.simTickMs.toFixed(2)}ms  snapshot latency ${model.snapshotLatencyMs.toFixed(2)}ms`,
      `draw calls ${model.drawCalls}  tris ${model.triangles}`,
      `chunks ${model.visibleChunks}  units ${model.visibleUnits}  entities ${model.totalEntities}`,
      `renderer ${model.renderer} (${model.rendererBackend}) requested ${model.rendererRequested}`,
      model.rendererInitError ? `init error: ${model.rendererInitError}` : 'init error: none',
      `DPR cap ${model.dprPreset}  effective ${model.effectiveDpr.toFixed(2)}`,
      `viewport ${model.viewport.width}×${model.viewport.height}  buffer ${model.drawingBuffer.width}×${model.drawingBuffer.height}`,
      `elapsed ${(model.elapsedMs / 1000).toFixed(1)}s  soak ${model.soakActive ? 'running' : 'idle'}`,
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
    const action = target.dataset['action'];
    if (action === 'toggle') {
      this.collapsed = !this.collapsed;
      this.body.style.display = this.collapsed ? 'none' : 'block';
      target.textContent = this.collapsed ? 'Expand' : 'Collapse';
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
    .pastel-hud { position:absolute; top:12px; right:12px; width:min(380px,92vw); background:rgba(10,24,26,.88); color:#f2e6d0; border:1px solid #4a8187; border-radius:10px; font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow:hidden; }
    .pastel-hud-bar { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#1c4549; }
    .pastel-hud-bar button, .pastel-hud-controls button, .pastel-hud-controls select { pointer-events:auto; font:inherit; }
    .pastel-hud-body { padding:8px 10px 10px; }
    .pastel-hud pre { margin:0 0 8px; white-space:pre-wrap; }
    .pastel-hud-controls { display:grid; gap:6px; }
    .pastel-hud-controls label { display:flex; flex-direction:column; gap:2px; }
    .pastel-hud-controls label.inline { flex-direction:row; align-items:center; gap:6px; }
    .pastel-hud button, .pastel-hud select { background:#2f565b; color:#f2e6d0; border:1px solid #5ce1e6; border-radius:6px; padding:4px 8px; }
  `;
  document.head.append(style);
}
