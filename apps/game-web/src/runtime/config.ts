import {
  DEFAULT_DPR_CAP,
  DEFAULT_SEED,
  DEFAULT_ZOOM_STOP,
  STRESS_COUNTS,
  type DprPreset,
  type ZoomStopName,
} from '../config/constants';
import type { DeveloperConfigurationPayload } from '../bridge/messages';
import { type SimCounts } from '../sim/types';
import { isValidContentId } from '@pastel-rts/content-schema';

export const BENCHMARK_NAMES = [
  'idle-base',
  'normal-midgame',
  'dense-battle',
  'camera-pan-stress',
  'maximum-population',
  '2x-stress',
  '20-minute-soak',
  'visual-capture',
] as const;

export type BenchmarkName = (typeof BENCHMARK_NAMES)[number];
export type RendererPreference = 'webgl' | 'webgpu';

export type BenchmarkDefinition = {
  name: BenchmarkName;
  counts: SimCounts;
  concentrate: boolean;
  autoPan: boolean;
  soak: boolean;
  freezeAnimation: boolean;
};

export type RuntimeMode = 'benchmark' | 'interaction-lab';
export type ContentMode = 'bundle' | 'studio';

export type RuntimeConfig = {
  renderer: RendererPreference;
  dprPreset: DprPreset;
  benchmark: BenchmarkName;
  seed: number;
  zoomStop: ZoomStopName;
  touchDebug: boolean;
  soakMs: number | null;
  haptics: boolean;
  mode: RuntimeMode;
  content: ContentMode;
  contentRevision: string | null;
  scenarioId: string | null;
  spawnUnitId: string | null;
  spawnBuildingId: string | null;
};

export const BENCHMARKS: Record<BenchmarkName, BenchmarkDefinition> = {
  'idle-base': {
    name: 'idle-base',
    counts: { combat: 24, workers: 8, buildings: 8, props: 40 },
    concentrate: false,
    autoPan: false,
    soak: false,
    freezeAnimation: false,
  },
  'normal-midgame': {
    name: 'normal-midgame',
    counts: { ...STRESS_COUNTS },
    concentrate: true,
    autoPan: false,
    soak: false,
    freezeAnimation: false,
  },
  'dense-battle': {
    name: 'dense-battle',
    counts: { ...STRESS_COUNTS },
    concentrate: true,
    autoPan: false,
    soak: false,
    freezeAnimation: false,
  },
  'camera-pan-stress': {
    name: 'camera-pan-stress',
    counts: { ...STRESS_COUNTS },
    concentrate: true,
    autoPan: true,
    soak: false,
    freezeAnimation: false,
  },
  'maximum-population': {
    name: 'maximum-population',
    counts: { combat: 240, workers: 80, buildings: 60, props: 400 },
    concentrate: true,
    autoPan: false,
    soak: false,
    freezeAnimation: false,
  },
  '2x-stress': {
    name: '2x-stress',
    counts: { combat: 240, workers: 80, buildings: 60, props: 400 },
    concentrate: true,
    autoPan: false,
    soak: false,
    freezeAnimation: false,
  },
  '20-minute-soak': {
    name: '20-minute-soak',
    counts: { ...STRESS_COUNTS },
    concentrate: true,
    autoPan: true,
    soak: true,
    freezeAnimation: false,
  },
  'visual-capture': {
    name: 'visual-capture',
    counts: { ...STRESS_COUNTS },
    concentrate: true,
    autoPan: false,
    soak: false,
    freezeAnimation: true,
  },
};

export function parseRuntimeConfig(search = window.location.search): RuntimeConfig {
  const params = new URLSearchParams(search);
  const rendererParam = params.get('renderer');
  const renderer: RendererPreference = rendererParam === 'webgpu' ? 'webgpu' : 'webgl';
  const benchmarkParam = params.get('benchmark');
  const benchmark: BenchmarkName = BENCHMARK_NAMES.includes(benchmarkParam as BenchmarkName)
    ? (benchmarkParam as BenchmarkName)
    : 'dense-battle';
  const dprParam = params.get('dpr');
  const dprPreset: DprPreset =
    dprParam === 'native'
      ? 'native'
      : dprParam === '1'
        ? 1
        : dprParam === '1.25'
          ? 1.25
          : dprParam === '1.5'
            ? 1.5
            : DEFAULT_DPR_CAP;
  const seedParam = Number(params.get('seed') ?? DEFAULT_SEED);
  const soakMsParam = params.get('soakMs');
  const zoomParam = params.get('zoom');
  const modeParam = params.get('mode');
  return {
    renderer,
    dprPreset,
    benchmark,
    seed: Number.isSafeInteger(seedParam) ? seedParam : DEFAULT_SEED,
    zoomStop: zoomParam === '50-percent' || zoomParam === '100-percent' || zoomParam === '140-percent'
      ? zoomParam
      : DEFAULT_ZOOM_STOP,
    touchDebug: params.get('touchDebug') === '1',
    soakMs: soakMsParam ? Number(soakMsParam) : null,
    haptics: params.get('haptics') !== '0',
    mode: modeParam === 'interaction-lab' ? 'interaction-lab' : 'benchmark',
    content: params.get('content') === 'studio' ? 'studio' : 'bundle',
    contentRevision: params.get('revision'),
    scenarioId: parseOptionalContentId(params.get('scenario')),
    spawnUnitId: parseOptionalContentId(params.get('spawnUnit')),
    spawnBuildingId: parseOptionalContentId(params.get('spawnBuilding')),
  };
}

export function reloadWithQuery(patch: Record<string, string>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    url.searchParams.set(key, value);
  }
  window.location.assign(url.toString());
}

/**
 * Native `setDeveloperConfiguration` always includes the current renderer.
 * Only reload when a field actually differs from the running config.
 */
export function developerConfigQueryPatch(
  current: RuntimeConfig,
  payload: DeveloperConfigurationPayload,
): Record<string, string> | null {
  const patch: Record<string, string> = {};
  if (payload.renderer && payload.renderer !== current.renderer) {
    patch['renderer'] = payload.renderer;
  }
  if (payload.benchmark && payload.benchmark !== current.benchmark) {
    patch['benchmark'] = payload.benchmark;
  }
  if (payload.dprPreset !== undefined && String(payload.dprPreset) !== String(current.dprPreset)) {
    patch['dpr'] = String(payload.dprPreset);
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export function pixelRatioForPreset(preset: DprPreset, devicePixelRatio: number): number {
  if (preset === 'native') {
    return Math.max(1, devicePixelRatio);
  }
  return Math.min(devicePixelRatio, preset);
}

/** Pack v2 public URL prefix. Relative so WKWebView bundled loads resolve. */
export function packV2PublicBaseUrl(): string {
  const base = import.meta.env.BASE_URL;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}content/dev-pack-v2/`;
}

function parseOptionalContentId(value: string | null): string | null {
  if (value === null || value.length === 0) {
    return null;
  }
  return isValidContentId(value) ? value : null;
}
