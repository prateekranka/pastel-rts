import {
  isRecord,
  requireNonNegativeInt,
  requirePositiveInt,
  requireSafeAssetPath,
} from './validation';

export type AnimClipId = 'idle' | 'move';

export type DirectionCount = 1 | 4 | 8;

export const DIRECTION_COUNTS: readonly DirectionCount[] = [1, 4, 8];

export const DIRECTION_ORDER_4 = ['n', 'e', 's', 'w'] as const;
export const DIRECTION_ORDER_8 = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

export type SpriteFrameRef =
  | { kind: 'indexes'; indexes: number[] }
  | { kind: 'range'; start: number; end: number };

export type SpriteClip = {
  assetPath?: string;
  frames: SpriteFrameRef;
  fps: number;
  looping: boolean;
  directionalMapping?: Partial<Record<string, number>>;
};

export type FallbackAnimationRules = {
  missingClip?: AnimClipId;
  missingDirection?: string;
};

export type AnimationValidationOptions = {
  /** Units require a move clip. Buildings may omit it. Default true. */
  requireMove?: boolean;
};

export type AnimationDef = {
  clips: {
    idle: SpriteClip;
    move?: SpriteClip;
  };
  directions: DirectionCount;
  directionOrder?: readonly string[];
  mirrored?: boolean;
  mirroredDirectionMap?: Readonly<Record<string, string>>;
  fallbackRules?: FallbackAnimationRules;
};

/** Unit archetypes always include idle and move after validation. */
export type UnitAnimationDef = AnimationDef & {
  clips: {
    idle: SpriteClip;
    move: SpriteClip;
  };
};

export function resolveFrameIndexes(frames: SpriteFrameRef): number[] {
  if (frames.kind === 'indexes') {
    return [...frames.indexes];
  }
  const result: number[] = [];
  for (let i = frames.start; i <= frames.end; i += 1) {
    result.push(i);
  }
  return result;
}

export function countSpriteSheetFrames(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  marginX: number,
  marginY: number,
  spacingX: number,
  spacingY: number,
): number {
  let count = 0;
  let y = marginY;
  while (y + frameHeight <= sourceHeight) {
    let x = marginX;
    while (x + frameWidth <= sourceWidth) {
      count += 1;
      x += frameWidth + spacingX;
    }
    y += frameHeight + spacingY;
  }
  return count;
}

export function validateSpriteClip(
  value: unknown,
  label: string,
  totalFrames: number,
  defaultAssetPath?: string,
): SpriteClip {
  if (!isRecord(value)) {
    throw new Error(`${label} is required`);
  }
  const assetPathValue = value['assetPath'];
  let assetPath: string | undefined;
  if (assetPathValue !== undefined) {
    assetPath = requireSafeAssetPath(assetPathValue, `${label}.assetPath`);
  } else if (defaultAssetPath !== undefined) {
    assetPath = defaultAssetPath;
  }
  const frames = parseFrameRef(value['frames'] ?? value['frameIndexes'] ?? value['frameRange'], label);
  const frameIndexes = resolveFrameIndexes(frames);
  if (frameIndexes.length === 0) {
    throw new Error(`${label} must reference at least one frame`);
  }
  for (const index of frameIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= totalFrames) {
      throw new Error(`${label} references missing frame index ${String(index)}`);
    }
  }
  const fps = requirePositiveInt(value['fps'], `${label}.fps`);
  if (typeof value['looping'] !== 'boolean') {
    throw new Error(`${label}.looping must be a boolean`);
  }
  const clip: SpriteClip = {
    frames,
    fps,
    looping: value['looping'],
  };
  if (assetPath !== undefined) {
    clip.assetPath = assetPath;
  }
  const directionalMappingValue = value['directionalMapping'];
  if (directionalMappingValue !== undefined) {
    if (!isRecord(directionalMappingValue)) {
      throw new Error(`${label}.directionalMapping must be an object`);
    }
    const mapping: Partial<Record<string, number>> = {};
    for (const [key, mapped] of Object.entries(directionalMappingValue)) {
      if (typeof mapped !== 'number' || !Number.isInteger(mapped) || mapped < 0 || mapped >= totalFrames) {
        throw new Error(`${label}.directionalMapping.${key} references missing frame`);
      }
      mapping[key] = mapped;
    }
    clip.directionalMapping = mapping;
  }
  return clip;
}

export function validateAnimationDef(
  value: unknown,
  totalFrames: number,
  defaultAssetPath?: string,
  options?: AnimationValidationOptions,
): AnimationDef {
  if (!isRecord(value)) {
    throw new Error('animation is required');
  }
  const directionsValue = value['directions'];
  if (directionsValue !== 1 && directionsValue !== 4 && directionsValue !== 8) {
    throw new Error('Invalid direction count');
  }
  const directions = directionsValue as DirectionCount;
  const clipsValue = value['clips'];
  if (!isRecord(clipsValue)) {
    throw new Error('animation.clips is required');
  }
  const requireMove = options?.requireMove ?? true;
  const idle = validateSpriteClip(clipsValue['idle'], 'animation.clips.idle', totalFrames, defaultAssetPath);
  const clips: AnimationDef['clips'] = { idle };
  const moveValue = clipsValue['move'];
  if (moveValue !== undefined) {
    clips.move = validateSpriteClip(moveValue, 'animation.clips.move', totalFrames, defaultAssetPath);
  } else if (requireMove) {
    throw new Error('animation.clips.move is required');
  }
  const animation: AnimationDef = {
    clips,
    directions,
  };
  const directionOrderValue = value['directionOrder'];
  if (directionOrderValue !== undefined) {
    if (!Array.isArray(directionOrderValue) || directionOrderValue.some((entry) => typeof entry !== 'string')) {
      throw new Error('animation.directionOrder must be an array of strings');
    }
    animation.directionOrder = directionOrderValue;
  }
  if (typeof value['mirrored'] === 'boolean') {
    animation.mirrored = value['mirrored'];
  }
  const mirroredDirectionMapValue = value['mirroredDirectionMap'];
  if (mirroredDirectionMapValue !== undefined) {
    if (!isRecord(mirroredDirectionMapValue)) {
      throw new Error('animation.mirroredDirectionMap must be an object');
    }
    const map: Record<string, string> = {};
    for (const [key, mapped] of Object.entries(mirroredDirectionMapValue)) {
      if (typeof mapped !== 'string') {
        throw new Error('animation.mirroredDirectionMap values must be strings');
      }
      map[key] = mapped;
    }
    animation.mirroredDirectionMap = map;
  }
  const fallbackRulesValue = value['fallbackRules'];
  if (fallbackRulesValue !== undefined) {
    animation.fallbackRules = parseFallbackRules(fallbackRulesValue);
  }
  return animation;
}

function parseFrameRef(value: unknown, label: string): SpriteFrameRef {
  if (Array.isArray(value)) {
    const indexes = value.map((entry, index) => {
      if (typeof entry !== 'number' || !Number.isInteger(entry)) {
        throw new Error(`${label} frameIndexes[${String(index)}] must be an integer`);
      }
      return entry;
    });
    return { kind: 'indexes', indexes };
  }
  if (isRecord(value)) {
    if ('indexes' in value) {
      return parseFrameRef(value['indexes'], label);
    }
    if ('start' in value || 'end' in value) {
      const start = requireNonNegativeInt(value['start'], `${label}.start`);
      const end = requireNonNegativeInt(value['end'], `${label}.end`);
      if (end < start) {
        throw new Error(`${label}.end must be >= start`);
      }
      return { kind: 'range', start, end };
    }
  }
  throw new Error(`${label}.frames must be frame indexes or a range`);
}

function parseFallbackRules(value: unknown): FallbackAnimationRules {
  if (!isRecord(value)) {
    throw new Error('animation.fallbackRules must be an object');
  }
  const rules: FallbackAnimationRules = {};
  const missingClip = value['missingClip'];
  if (missingClip !== undefined) {
    if (missingClip !== 'idle' && missingClip !== 'move') {
      throw new Error('animation.fallbackRules.missingClip must be idle or move');
    }
    rules.missingClip = missingClip;
  }
  const missingDirection = value['missingDirection'];
  if (missingDirection !== undefined) {
    if (typeof missingDirection !== 'string') {
      throw new Error('animation.fallbackRules.missingDirection must be a string');
    }
    rules.missingDirection = missingDirection;
  }
  return rules;
}
