import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePackV2 } from '../../../packages/content-schema/src/pack.ts';
import { PackStore, sanitizeRelativePath } from './packStore.ts';

/** 1×1 PNG */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const validUnitArchetype = {
  schemaVersion: 2 as const,
  id: 'test-scout',
  displayName: 'Test Scout',
  enabled: true,
  factionId: 'sunweaver' as const,
  assetPath: 'units/test-scout/sheet.png',
  sourceWidth: 32,
  sourceHeight: 32,
  frameWidth: 32,
  frameHeight: 32,
  margin: { x: 0, y: 0 },
  spacing: { x: 0, y: 0 },
  bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 1.5,
  selectionRadius: 0.6,
  collisionRadius: 0.45,
  animation: {
    directions: 1 as const,
    mirrored: false,
    clips: {
      idle: { frames: { kind: 'indexes' as const, indexes: [0] }, fps: 8, looping: true },
      move: { frames: { kind: 'indexes' as const, indexes: [0] }, fps: 12, looping: true },
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
  schemaVersion: 2 as const,
  id: 'test-bastion',
  displayName: 'Test Bastion',
  enabled: true,
  factionId: 'gravemark' as const,
  assetPath: 'buildings/test-bastion/sprite.png',
  sourceWidth: 32,
  sourceHeight: 32,
  bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 2.4,
  footprint: { kind: 'rect' as const, cellsW: 2, cellsH: 2 },
};

let tempDir: string;
let store: PackStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pastel-pack-'));
  store = new PackStore({ packDir: tempDir });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('sanitizeRelativePath', () => {
  it('rejects traversal paths', () => {
    expect(() => sanitizeRelativePath('../units/secret.png')).toThrow(/invalid path/i);
    expect(() => sanitizeRelativePath('units/../../etc/passwd')).toThrow(/invalid path/i);
    expect(() => sanitizeRelativePath('/absolute.png')).toThrow(/invalid path/i);
  });

  it('accepts safe relative paths', () => {
    expect(sanitizeRelativePath('units/foo/sprite.png')).toBe('units/foo/sprite.png');
  });
});

describe('PackStore v2 operations', () => {
  it('creates unit and building archetypes with validated pack index', () => {
    const unit = store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    expect(unit.id).toBe('test-scout');
    expect(existsSync(join(tempDir, 'units/test-scout/sheet.png'))).toBe(true);

    const building = store.createBuildingArchetype(validBuildingArchetype, TINY_PNG_BASE64);
    expect(building.id).toBe('test-bastion');

    const pack = validatePackV2(JSON.parse(readFileSync(store.v2IndexPath, 'utf8')));
    expect(pack.schemaVersion).toBe(2);
    expect(pack.units.some((entry) => entry.id === 'test-scout')).toBe(true);
    expect(pack.buildings.some((entry) => entry.id === 'test-bastion')).toBe(true);
    expect(pack.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.parseInt(pack.revision, 10)).toBeGreaterThanOrEqual(1);
  });

  it('increments revision on update', () => {
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const first = store.readPackV2();
    store.updateUnitArchetype('test-scout', { ...validUnitArchetype, displayName: 'Updated Scout' });
    const second = store.readPackV2();
    expect(Number.parseInt(second.revision, 10)).toBeGreaterThan(Number.parseInt(first.revision, 10));
  });

  it('does not leave partial pack index when manifest write fails validation', () => {
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const before = readFileSync(store.v2IndexPath, 'utf8');
    expect(() =>
      store.updateUnitArchetype('test-scout', {
        ...validUnitArchetype,
        animation: {
          directions: 1,
          mirrored: false,
          clips: {
            idle: { frames: { kind: 'indexes', indexes: [99] }, fps: 8, looping: true },
            move: { frames: { kind: 'indexes', indexes: [0] }, fps: 12, looping: true },
          },
        },
      }),
    ).toThrow(/missing frame/i);
    const after = readFileSync(store.v2IndexPath, 'utf8');
    expect(after).toBe(before);
  });

  it('blocks deletion when referenced by scenario unless forced', () => {
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const scenariosDir = join(tempDir, 'scenarios');
    const scenario = {
      schemaVersion: 1,
      id: 'lab-skirmish',
      displayName: 'Lab Skirmish',
      mapId: 'lab-grid',
      units: [{ archetypeId: 'test-scout', position: { x: 1024, z: 1024 } }],
      buildings: [],
    };
    mkdirSync(scenariosDir, { recursive: true });
    writeFileSync(join(scenariosDir, 'lab-skirmish.json'), JSON.stringify(scenario));

    expect(() => store.deleteUnitArchetype('test-scout')).toThrow(/referenced/i);
    const forced = store.deleteUnitArchetype('test-scout', true);
    expect(forced.deleted).toBe(true);
    expect(forced.warning).toMatch(/lab-skirmish/);
  });

  it('resolveAssetPath rejects unsafe paths', () => {
    expect(() => store.resolveAssetPath('../pack.json')).toThrow(/invalid path/i);
  });
});

describe('PackStore v1 compatibility', () => {
  it('readPackV1 ignores v2 manifests', () => {
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const v1 = store.readPackV1();
    expect(v1.schemaVersion).toBe(1);
    expect(v1.units).toHaveLength(0);
  });
});
