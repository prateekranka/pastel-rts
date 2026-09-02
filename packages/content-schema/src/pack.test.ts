import { describe, expect, it } from 'vitest';
import {
  computeContentHash,
  upgradePackV1ToV2,
  validateBuildingArchetype,
  validatePackV2,
  validateUnitArchetype,
} from './pack';
import { validateUnitManifest } from './unitManifest';

const validUnitArchetype = {
  schemaVersion: 2,
  id: 'sunweaver-scout',
  displayName: 'Sunweaver Scout',
  enabled: true,
  factionId: 'sunweaver',
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
    directions: 4,
    mirrored: true,
    directionOrder: ['n', 'e', 's', 'w'],
    clips: {
      idle: {
        frames: { kind: 'range', start: 0, end: 3 },
        fps: 8,
        looping: true,
      },
      move: {
        frames: { indexes: [4, 5, 6, 7] },
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

const validBuildingArchetype = {
  schemaVersion: 2,
  id: 'gravemark-bastion',
  displayName: 'Gravemark Bastion',
  enabled: true,
  factionId: 'gravemark',
  assetPath: 'buildings/gravemark-bastion/sprite.png',
  sourceWidth: 96,
  sourceHeight: 96,
  bounds: { minX: 8, minY: 12, maxX: 88, maxY: 92 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 2.4,
  footprint: { kind: 'rect', cellsW: 2, cellsH: 2 },
  blockedCellMask: [
    [true, true],
    [true, true],
  ],
  buildableTerrain: {
    allowedTerrain: ['grass', 'dirt'],
  },
  selectionFootprint: { kind: 'rect', cellsW: 2, cellsH: 2 },
  entrancePoint: { x: 512, z: 0 },
  rallyPoint: { x: 1024, z: 1024 },
};

describe('unit archetype v2', () => {
  it('accepts a valid unit manifest v2', () => {
    const unit = validateUnitArchetype(validUnitArchetype);
    expect(unit.id).toBe('sunweaver-scout');
    expect(unit.factionId).toBe('sunweaver');
    expect(unit.animation.clips.move.frames).toEqual({ kind: 'indexes', indexes: [4, 5, 6, 7] });
  });

  it('rejects invalid direction count', () => {
    expect(() =>
      validateUnitArchetype({
        ...validUnitArchetype,
        animation: { ...validUnitArchetype.animation, directions: 6 },
      }),
    ).toThrow(/direction count/i);
  });

  it('rejects animation references to missing frames', () => {
    expect(() =>
      validateUnitArchetype({
        ...validUnitArchetype,
        animation: {
          ...validUnitArchetype.animation,
          clips: {
            idle: { frames: { indexes: [99] }, fps: 8, looping: true },
            move: { frames: { indexes: [0] }, fps: 12, looping: true },
          },
        },
      }),
    ).toThrow(/missing frame/i);
  });

  it('rejects unsafe asset paths', () => {
    expect(() =>
      validateUnitArchetype({
        ...validUnitArchetype,
        assetPath: '../escape.png',
      }),
    ).toThrow(/asset path/i);
    expect(() =>
      validateUnitArchetype({
        ...validUnitArchetype,
        assetPath: '/absolute.png',
      }),
    ).toThrow(/asset path/i);
  });

  it('rejects invalid faction IDs', () => {
    expect(() =>
      validateUnitArchetype({
        ...validUnitArchetype,
        factionId: 'ember-court',
      }),
    ).toThrow(/faction/i);
  });
});

describe('building archetype v2', () => {
  it('accepts a valid building manifest', () => {
    const building = validateBuildingArchetype(validBuildingArchetype);
    expect(building.id).toBe('gravemark-bastion');
    expect(building.footprint).toEqual({ kind: 'rect', cellsW: 2, cellsH: 2 });
  });

  it('rejects invalid footprint', () => {
    expect(() =>
      validateBuildingArchetype({
        ...validBuildingArchetype,
        footprint: { kind: 'rect', cellsW: 0, cellsH: 2 },
      }),
    ).toThrow(/footprint/i);
    expect(() =>
      validateBuildingArchetype({
        ...validBuildingArchetype,
        footprint: { kind: 'mask', cellsW: 2, cellsH: 2, mask: [[true]] },
      }),
    ).toThrow(/footprint/i);
  });
});

describe('pack v2 migration and hash', () => {
  const v1Manifest = {
    schemaVersion: 1,
    id: 'ember-skirmisher',
    displayName: 'Ember Skirmisher',
    enabled: true,
    faction: 'friendly',
    assetPath: 'units/ember-skirmisher/sprite.png',
    sourceWidth: 64,
    sourceHeight: 64,
    bounds: { minX: 8, minY: 4, maxX: 56, maxY: 60 },
    anchor: { x: 0.5, y: 1 },
    worldHeight: 1.6,
    selectionRadius: 0.7,
  };

  it('migrates v1 units to expected v2 data', () => {
    const pack = upgradePackV1ToV2({
      schemaVersion: 1,
      id: 'dev-pack',
      units: [v1Manifest, { ...v1Manifest, id: 'shade-hunter', faction: 'opposing' }],
    });
    expect(pack.schemaVersion).toBe(2);
    expect(pack.units[0]?.factionId).toBe('sunweaver');
    expect(pack.units[1]?.factionId).toBe('gravemark');
    expect(pack.factions.map((faction) => faction.id)).toEqual(['sunweaver', 'gravemark', 'neutral']);
    expect(pack.units[0]?.movement.speedSubunitsPerTick).toBe(64);
    expect(pack.units[0]?.animation.directions).toBe(1);
    validateUnitManifest(v1Manifest);
  });

  it('changes content hash when content changes', () => {
    const base = {
      schemaVersion: 2,
      id: 'fixture-pack',
      revision: '1',
      factions: [{ id: 'sunweaver', displayName: 'Sunweaver' }],
      units: [validUnitArchetype],
      buildings: [validBuildingArchetype],
    };
    const first = validatePackV2(base);
    const second = validatePackV2({
      ...base,
      units: [{ ...validUnitArchetype, displayName: 'Changed Scout' }],
    });
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('keeps content hash stable for equivalent canonical content', () => {
    const packA = validatePackV2({
      schemaVersion: 2,
      id: 'fixture-pack',
      revision: '1',
      factions: [{ id: 'sunweaver', displayName: 'Sunweaver' }],
      units: [validUnitArchetype],
      buildings: [],
    });
    const packB = validatePackV2({
      schemaVersion: 2,
      id: 'fixture-pack',
      revision: '1',
      factions: [{ id: 'sunweaver', displayName: 'Sunweaver' }],
      units: [validUnitArchetype],
      buildings: [],
      contentHash: 'ignored-author-field',
    });
    expect(packA.contentHash).toBe(packB.contentHash);
    expect(computeContentHash(packA)).toBe(packA.contentHash);
  });
});
