import {
  Scene,
  WebGLRenderer,
  type Camera,
  type WebGLRendererParameters,
} from 'three';

export type RendererKind = 'webgl' | 'webgpu';

export type RendererStats = {
  drawCalls: number;
  triangles: number;
};

export type RendererAdapter = {
  kind: RendererKind;
  requested: RendererKind;
  backend: string;
  initError: string | null;
  setSize: (width: number, height: number) => void;
  setPixelRatio: (value: number) => void;
  getPixelRatio: () => number;
  getDrawingBufferSize: () => { width: number; height: number };
  render: (scene: Scene, camera: Camera) => void;
  dispose: () => void;
  getStats: () => RendererStats;
};

type GpuRenderer = {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(value: number): void;
  getPixelRatio(): number;
  getDrawingBufferSize(target: { set(width: number, height: number): unknown }): unknown;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
  info: {
    render: {
      calls: number;
      triangles: number;
      drawCalls?: number;
    };
  };
};

/**
 * WebGLRenderer is the baseline. WebGPURenderer is a developer-selected
 * benchmark path; initialization failure falls back to WebGL and is recorded.
 */
export async function createRendererAdapter(
  canvas: HTMLCanvasElement,
  requested: RendererKind,
): Promise<RendererAdapter> {
  if (requested === 'webgpu') {
    try {
      return await createWebGpuAdapter(canvas);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = createWebGlAdapter(canvas, requested, message);
      return fallback;
    }
  }
  return createWebGlAdapter(canvas, requested, null);
}

function createWebGlAdapter(
  canvas: HTMLCanvasElement,
  requested: RendererKind,
  initError: string | null,
): RendererAdapter {
  const parameters: WebGLRendererParameters = {
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
  };
  const renderer = new WebGLRenderer(parameters);
  renderer.autoClear = true;
  return wrap(renderer, 'webgl', requested, 'webgl', initError);
}

async function createWebGpuAdapter(canvas: HTMLCanvasElement): Promise<RendererAdapter> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is not available on this browser/device');
  }
  const mod = await import('three/webgpu');
  const renderer = new mod.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
  });
  await renderer.init();
  const backend =
    'backend' in renderer && renderer.backend && typeof renderer.backend === 'object'
      ? String((renderer.backend as { name?: string }).name ?? 'webgpu')
      : 'webgpu';
  const kind: RendererKind = backend.toLowerCase().includes('webgl') ? 'webgl' : 'webgpu';
  return wrap(renderer as unknown as GpuRenderer, kind, 'webgpu', backend, null);
}

function wrap(
  renderer: GpuRenderer,
  kind: RendererKind,
  requested: RendererKind,
  backend: string,
  initError: string | null,
): RendererAdapter {
  return {
    kind,
    requested,
    backend,
    initError,
    setSize(width: number, height: number) {
      renderer.setSize(width, height, false);
    },
    setPixelRatio(value: number) {
      renderer.setPixelRatio(value);
    },
    getPixelRatio() {
      return renderer.getPixelRatio();
    },
    getDrawingBufferSize() {
      const size = { x: 0, y: 0, set(width: number, height: number) {
        this.x = width;
        this.y = height;
        return this;
      } };
      renderer.getDrawingBufferSize(size);
      return { width: size.x, height: size.y };
    },
    render(scene: Scene, camera: Camera) {
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
    getStats() {
      const render = renderer.info.render;
      return {
        drawCalls: render.drawCalls ?? render.calls,
        triangles: render.triangles,
      };
    },
  };
}
