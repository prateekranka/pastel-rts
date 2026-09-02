import type { DirectionCount } from '@pastel-rts/content-schema';

export type DirectionResolution = {
  /** Index into authored direction frames (0..directions-1). */
  directionIndex: number;
  /** When true, render with horizontal flip. */
  mirrorX: boolean;
};

const OCTANT_LABELS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
const QUAD_LABELS = ['n', 'e', 's', 'w'] as const;

/** Map heading radians (+Y) to direction index and optional mirror. */
export function resolveDirection(
  headingRadians: number,
  directions: DirectionCount,
  mirrored: boolean,
): DirectionResolution {
  if (directions === 1) {
    return { directionIndex: 0, mirrorX: false };
  }

  const normalized = normalizeRadians(headingRadians);
  const octantIndex = Math.round(normalized / (Math.PI / 4)) % 8;

  if (directions === 8 && !mirrored) {
    return { directionIndex: octantIndex, mirrorX: false };
  }

  if (directions === 4 && !mirrored) {
    const quadIndex = Math.floor(((octantIndex + 1) % 8) / 2);
    return { directionIndex: quadIndex, mirrorX: false };
  }

  // Mirrored 4/8: store east-side frames only, flip for west.
  const eastSide = [1, 2, 3, 0] as const; // NE, E, SE, N visual slots
  const westMirror = [7, 6, 5, 0] as const;
  const isWest = octantIndex === 5 || octantIndex === 6 || octantIndex === 7;
  if (directions === 4) {
    if (octantIndex === 0 || octantIndex === 4) {
      return { directionIndex: octantIndex === 0 ? 0 : 2, mirrorX: false };
    }
  if (isWest) {
    const mapped = westMirror.indexOf(octantIndex as 5 | 6 | 7);
    return { directionIndex: mapped >= 0 ? mapped : 1, mirrorX: true };
  }
  const mapped = eastSide.indexOf(octantIndex as 1 | 2 | 3 | 0);
    return { directionIndex: mapped >= 0 ? mapped : 1, mirrorX: false };
  }

  // 8-way mirrored: N/S unmirrored, E-side authored, W-side mirrored.
  if (octantIndex === 0 || octantIndex === 4) {
    return { directionIndex: octantIndex === 0 ? 0 : 4, mirrorX: false };
  }
  if (isWest) {
    const mirrorMap: Record<number, number> = { 5: 3, 6: 2, 7: 1 };
    return { directionIndex: mirrorMap[octantIndex] ?? 2, mirrorX: true };
  }
  return { directionIndex: octantIndex, mirrorX: false };
}

export function directionLabel(
  directionIndex: number,
  directions: DirectionCount,
): string {
  if (directions === 8) {
    return OCTANT_LABELS[directionIndex % 8] ?? 'n';
  }
  if (directions === 4) {
    return QUAD_LABELS[directionIndex % 4] ?? 'n';
  }
  return 'n';
}

/** Resolve clip frame index from phase and authored frame list. */
export function sampleClipFrame(frameIndexes: readonly number[], phase: number, looping: boolean): number {
  if (frameIndexes.length === 0) {
    return 0;
  }
  const clampedPhase = looping ? phase % 1 : Math.min(1, Math.max(0, phase));
  const frameSlot = Math.floor(clampedPhase * frameIndexes.length) % frameIndexes.length;
  return frameIndexes[frameSlot] ?? frameIndexes[0] ?? 0;
}

function normalizeRadians(value: number): number {
  let angle = value;
  while (angle < 0) {
    angle += Math.PI * 2;
  }
  while (angle >= Math.PI * 2) {
    angle -= Math.PI * 2;
  }
  return angle;
}
