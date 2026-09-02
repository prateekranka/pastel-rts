import {
  resolveFrameIndexes,
  type AnimClipId,
  type UnitAnimationDef,
  type UnitArchetype,
} from '@pastel-rts/content-schema';
import { resolveDirection, sampleClipFrame, type DirectionResolution } from './direction';

export type ResolvedSpriteFrame = DirectionResolution & {
  clipId: AnimClipId;
  sheetFrameIndex: number;
  mirrorX: boolean;
};

/** Resolve idle/move clip and sheet frame for a unit snapshot row. */
export function resolveUnitSpriteFrame(
  archetype: UnitArchetype,
  animState: 'idle' | 'move',
  headingRadians: number,
  animPhase: number,
): ResolvedSpriteFrame {
  const animation = archetype.animation as UnitAnimationDef;
  const clipId: AnimClipId = animState === 'move' ? 'move' : 'idle';
  const clip = animation.clips[clipId];
  const direction = resolveDirection(
    headingRadians,
    animation.directions,
    animation.mirrored ?? false,
  );
  const baseFrames = resolveFrameIndexes(clip.frames);
  const framesPerDirection = Math.max(1, Math.floor(baseFrames.length / animation.directions));
  const directionOffset = direction.directionIndex * framesPerDirection;
  const directionFrames = baseFrames.slice(directionOffset, directionOffset + framesPerDirection);
  const sheetFrameIndex = sampleClipFrame(
    directionFrames.length > 0 ? directionFrames : baseFrames,
    animPhase,
    clip.looping,
  );
  return {
    ...direction,
    clipId,
    sheetFrameIndex,
  };
}

/** True when move clip should be used (moving state only). */
export function shouldUseMoveClip(animState: 'idle' | 'move'): boolean {
  return animState === 'move';
}
