export const MAP_CELLS = 160;
export const CHUNK_CELLS = 16;
export const CHUNK_COUNT = MAP_CELLS / CHUNK_CELLS;
export const CELL_SIZE = 1;
export const MAP_WORLD_SIZE = MAP_CELLS * CELL_SIZE;

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Landscape-first default: ~44 cells across the ground AABB width. */
export const PRESET_70_VISIBLE_CELLS_X = 44;
export const PRESET_70_VISIBLE_CELLS_Y = 28;

export const ISO_AZIMUTH = Math.PI / 4;
export const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2));
export const CAMERA_DISTANCE = 140;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 600;

export const DEFAULT_DPR_CAP = 1.5;

export const DEFAULT_SEED = 0x5eed0;

export const STRESS_COUNTS = {
  combat: 120,
  workers: 40,
  buildings: 30,
  props: 200,
} as const;

export const ZOOM_STOP_NAMES = [
  '50-percent',
  '70-percent',
  '100-percent',
  '140-percent',
] as const;

export type ZoomStopName = (typeof ZOOM_STOP_NAMES)[number];

/**
 * Named zoom stops. `70-percent` is the default gameplay framing.
 * Higher percent = more zoomed in (fewer cells visible).
 */
export const ZOOM_STOPS: ReadonlyArray<{ name: ZoomStopName; visibleCellsX: number }> = [
  { name: '50-percent', visibleCellsX: 62 },
  { name: '70-percent', visibleCellsX: PRESET_70_VISIBLE_CELLS_X },
  { name: '100-percent', visibleCellsX: 31 },
  { name: '140-percent', visibleCellsX: 22 },
];

export const DEFAULT_ZOOM_STOP: ZoomStopName = '70-percent';

export const MIN_VISIBLE_CELLS_X = 16;
export const MAX_VISIBLE_CELLS_X = 90;

export const DPR_PRESETS = [1, 1.25, 1.5, 'native'] as const;
export type DprPreset = (typeof DPR_PRESETS)[number];

export const PERFORMANCE_REPORT_SCHEMA_VERSION = 1;

export const SOAK_DURATION_MS = 20 * 60 * 1000;
export const SOAK_CAMERA_PERIOD_MS = 12_000;
export const LONG_FRAME_MS = 33.5;
