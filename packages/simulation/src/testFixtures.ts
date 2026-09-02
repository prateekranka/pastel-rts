import type { PackV2 } from '@pastel-rts/content-schema';
import { computeContentHash, createInitialRevision } from '@pastel-rts/content-schema';

const testUnitArchetype = {
  schemaVersion: 2 as const,
  id: 'sunweaver-scout',
  displayName: 'Sunweaver Scout',
  enabled: true,
  factionId: 'sunweaver' as const,
  assetPath: 'units/sunweaver-scout/sheet.png',
  sourceWidth: 128,
  sourceHeight: 64,
  frameWidth: 32,
  frameHeight: 32,
  margin: { x: 0, y: 0 },
  spacing: { x: 0, y: 0 },
  bounds: { minX: 4, minY: 2, maxX: 28, maxY: 30 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 1.5,
  selectionRadius: 0.6,
  collisionRadius: 0.45,
  animation: {
    directions: 4 as const,
    mirrored: true,
    clips: {
      idle: {
        frames: { kind: 'range' as const, start: 0, end: 3 },
        fps: 8,
        looping: true,
      },
      move: {
        frames: { kind: 'indexes' as const, indexes: [4, 5, 6, 7] },
        fps: 12,
        looping: true,
      },
    },
  },
  movement: {
    speedSubunitsPerTick: 64,
    accelerationRate: 1,
    turnRateMilli: 3000,
    footprintCategory: 'unit-1x1',
  },
};

const testGravemarkUnit = {
  ...testUnitArchetype,
  id: 'gravemark-raider',
  displayName: 'Gravemark Raider',
  factionId: 'gravemark' as const,
  assetPath: 'units/gravemark-raider/sheet.png',
};

const testBuildingArchetype = {
  schemaVersion: 2 as const,
  id: 'gravemark-bastion',
  displayName: 'Gravemark Bastion',
  enabled: true,
  factionId: 'gravemark' as const,
  assetPath: 'buildings/gravemark-bastion/sprite.png',
  sourceWidth: 96,
  sourceHeight: 96,
  bounds: { minX: 8, minY: 12, maxX: 88, maxY: 92 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 2.4,
  footprint: { kind: 'rect' as const, cellsW: 2, cellsH: 2 },
};

export function createTestPackV2(): PackV2 {
  const packWithoutHash = {
    schemaVersion: 2 as const,
    id: 'sim-test-pack',
    revision: createInitialRevision(),
    factions: [
      { id: 'sunweaver' as const, displayName: 'Sunweaver' },
      { id: 'gravemark' as const, displayName: 'Gravemark' },
      { id: 'neutral' as const, displayName: 'Neutral' },
    ],
    units: [testUnitArchetype, testGravemarkUnit],
    buildings: [testBuildingArchetype],
  };
  return {
    ...packWithoutHash,
    contentHash: computeContentHash(packWithoutHash),
  };
}

export { testUnitArchetype, testGravemarkUnit, testBuildingArchetype };
