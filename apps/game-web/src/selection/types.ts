import type { EntityId } from '@pastel-rts/content-schema';

/** Relationship to the local player (M0 snapshot channel 5). */
export type EntityRelationship = 'friendly' | 'opposing' | 'neutral';

export type PickableEntityKind = 'unit' | 'building';

/** Entity record used for hit testing and selection on the main thread. */
export type PickableEntity = {
  id: EntityId;
  archetypeId: string;
  kind: PickableEntityKind;
  relationship: EntityRelationship;
  /** World-space ground position (render floats). */
  x: number;
  z: number;
  /** Selection radius in world units (cells). */
  selectionRadius: number;
  /** Optional sprite height for projected bounds. */
  worldHeight?: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LassoRect = ScreenRect;

export type FormationPreview = {
  destination: { x: number; z: number };
  /** Facing in radians around +Y. */
  facingRadians: number;
  widthWorld: number;
  kind: 'line' | 'box';
};

export type DestinationMarker = {
  x: number;
  z: number;
};

export type ArchetypeAggregate = {
  archetypeId: string;
  count: number;
};
