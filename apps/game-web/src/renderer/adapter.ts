import {
  Scene,
  Vector2,
  WebGLRenderer,
  type Camera,
  type WebGLRendererParameters,
} from 'three';

export type RendererKind = 'webgl' | 'webgpu';

export type RendererStats = {
  drawCalls: number;
  triangles: number;
};

export type RendererResourceCounts = {
  textures: number;
  geometries: number;
};

export type RendererAdapter = {
  canvas: HTMLCanvasElement;
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
  getResourceCounts: () => RendererResourceCounts;
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
    memory?: {
      textures?: number;
      geometries?: number;
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
      await assertWebGpuAvailable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createWebGlAdapter(canvas, requested, message);
    }
    try {
      return await createWebGpuAdapter(canvas);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackCanvas = replaceCanvasPreservingIdentity(canvas);
      try {
        return createWebGlAdapter(fallbackCanvas, requested, message);
      } catch (fallbackError) {
        const replaced = replaceCanvasPreservingIdentity(fallbackCanvas);
        const extra = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return createWebGlAdapter(replaced, requested, `${message}; ${extra}`);
      }
    }
  }
  return createWebGlAdapter(canvas, requested, null);
}

type GpuLike = {
  requestAdapter: () => Promise<unknown>;
};

export async function assertWebGpuAvailable(): Promise<void> {
  const gpu = 'gpu' in navigator ? (navigator as Navigator & { gpu?: GpuLike }).gpu : undefined;
  if (!gpu) {
    throw new Error('WebGPU is not available on this browser/device');
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU adapter request failed');
  }
}

export function replaceCanvasPreservingIdentity(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const next = document.createElement('canvas');
  for (const attr of Array.from(canvas.attributes)) {
    next.setAttribute(attr.name, attr.value);
  }
  canvas.replaceWith(next);
  return next;
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
  return wrap(renderer, canvas, 'webgl', requested, 'webgl', initError);
}

async function createWebGpuAdapter(canvas: HTMLCanvasElement): Promise<RendererAdapter> {
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
  return wrap(renderer as unknown as GpuRenderer, canvas, kind, 'webgpu', backend, null);
}

function wrap(
  renderer: GpuRenderer,
  canvas: HTMLCanvasElement,
  kind: RendererKind,
  requested: RendererKind,
  backend: string,
  initError: string | null,
): RendererAdapter {
  return {
    canvas,
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
      const size = new Vector2();
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
    getResourceCounts() {
      const memory = renderer.info.memory;
      return {
        textures: memory?.textures ?? 0,
        geometries: memory?.geometries ?? 0,
      };
    },
  };
}
