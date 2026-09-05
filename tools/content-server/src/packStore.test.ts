import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePackV2 } from '@pastel-rts/content-schema';
import { PackStore, sanitizeRelativePath } from './packStore';

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

function pngWithText(text: string): string {
  const source = Buffer.from(TINY_PNG_BASE64, 'base64');
  const data = Buffer.from(`note\0${text}`, 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from('tEXt', 'ascii'), data])), 8 + data.length);
  return Buffer.concat([source.subarray(0, source.length - 12), chunk, source.subarray(source.length - 12)]).toString('base64');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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

  it('reads and writes canonical pack.json for v2 packs', () => {
    const v2Pack = {
      schemaVersion: 2,
      id: 'dev-pack-v2',
      revision: '1',
      factions: [
        { id: 'sunweaver', displayName: 'Sunweaver' },
        { id: 'gravemark', displayName: 'Gravemark' },
        { id: 'neutral', displayName: 'Neutral' },
      ],
      units: [validUnitArchetype],
      buildings: [],
    };
    writeFileSync(join(tempDir, 'pack.json'), `${JSON.stringify(v2Pack, null, 2)}\n`);
    const v2Store = new PackStore({ packDir: tempDir });
    const loaded = v2Store.readPackV2();
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.units.some((unit) => unit.id === 'test-scout')).toBe(true);
    expect(existsSync(join(tempDir, 'pack-v2.json'))).toBe(false);

    v2Store.createBuildingArchetype(validBuildingArchetype, TINY_PNG_BASE64);
    expect(existsSync(join(tempDir, 'pack-v2.json'))).toBe(false);
    const rewritten = JSON.parse(readFileSync(join(tempDir, 'pack.json'), 'utf8')) as {
      schemaVersion: number;
      buildings: Array<{ id: string }>;
    };
    expect(rewritten.schemaVersion).toBe(2);
    expect(rewritten.buildings.some((building) => building.id === 'test-bastion')).toBe(true);
  });

  it('rejects stale draft mutations after another save', () => {
    const before = store.getPublicationStatus();
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64, before.draftRevision);
    const after = store.getPublicationStatus();
    expect(after.draftRevision).not.toBe(before.draftRevision);
    expect(() => store.createBuildingArchetype(validBuildingArchetype, TINY_PNG_BASE64, before.draftRevision)).toThrow(
      /stale draft revision/i,
    );
    expect(store.getPublicationStatus().draftRevision).toBe(after.draftRevision);
  });

  it('keeps published source bytes immutable across replacement, revert, and restart', () => {
    const initial = store.getPublicationStatus();
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64, initial.draftRevision);
    const firstPublication = store.publish(initial.currentRevision);
    const firstRevision = firstPublication.metadata.revision;
    expect(() => store.publish(initial.currentRevision)).toThrow(/stale publication revision/i);
    const firstAsset = firstPublication.metadata.assets.find((asset) => asset.assetPath === 'units/test-scout/sheet.png');
    expect(firstAsset).toBeDefined();
    const firstBytes = readFileSync(join(tempDir, firstAsset!.storagePath));

    const draftAfterFirstPublish = store.getPublicationStatus();
    store.updateUnitArchetype(
      'test-scout',
      { ...validUnitArchetype, displayName: 'Replacement Scout' },
      pngWithText('replacement'),
      draftAfterFirstPublish.draftRevision,
    );
    expect(store.readPublishedPackV2().units[0]?.displayName).toBe('Test Scout');

    const secondPublication = store.publish(firstRevision);
    expect(secondPublication.metadata.revision).not.toBe(firstRevision);
    const secondAsset = secondPublication.metadata.assets.find((asset) => asset.assetPath === 'units/test-scout/sheet.png');
    expect(secondAsset).toBeDefined();
    expect(readFileSync(join(tempDir, firstAsset!.storagePath))).toEqual(firstBytes);
    expect(readFileSync(join(tempDir, secondAsset!.storagePath))).not.toEqual(firstBytes);

    const reverted = store.revert(firstRevision, secondPublication.metadata.revision);
    expect(reverted.metadata.sourceRevision).toBe(firstRevision);
    expect(reverted.pack.units[0]?.displayName).toBe('Test Scout');
    expect(store.readPublishedPackV2().units[0]?.displayName).toBe('Test Scout');
    expect(readFileSync(join(tempDir, firstAsset!.storagePath))).toEqual(firstBytes);

    const restarted = new PackStore({ packDir: tempDir });
    expect(restarted.getPublicationStatus().currentRevision).toBe(reverted.metadata.revision);
    expect(restarted.readPublishedPackV2().units[0]?.displayName).toBe('Test Scout');
  });

  it('keeps reference attachments outside runtime publication assets', () => {
    const reference = store.createReferenceAttachment({ id: 'concept-scout', displayName: 'Concept Scout' }, TINY_PNG_BASE64);
    expect(reference.assetPath).toMatch(/^references\/concept-scout\/[a-f0-9]{64}\.png$/);
    expect(store.listReferenceAttachments()).toEqual([reference]);
    expect(store.getPublicationStatus().current.assets).toEqual([]);
    expect(existsSync(join(tempDir, reference.storagePath))).toBe(true);
    store.deleteReferenceAttachment(reference.id);
    expect(store.listReferenceAttachments()).toEqual([]);
    expect(existsSync(join(tempDir, reference.storagePath))).toBe(true);
  });

  it('leaves the last good publication readable when validation fails', () => {
    const initial = store.getPublicationStatus();
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64, initial.draftRevision);
    const published = store.publish(initial.currentRevision);
    const badScenario = {
      schemaVersion: 1,
      id: 'bad-scenario',
      displayName: 'Bad Scenario',
      mapId: 'lab-grid',
      units: [{ archetypeId: 'missing-unit', position: { x: 1024, z: 1024 } }],
      buildings: [],
    };
    writeFileSync(join(tempDir, 'scenarios/bad-scenario.json'), JSON.stringify(badScenario));
    const draft = store.readPackV2();
    const badDraft = { ...draft, scenarios: [{ id: 'bad-scenario', path: 'scenarios/bad-scenario.json' }] };
    writeFileSync(store.draftPackPath, `${JSON.stringify(badDraft, null, 2)}\n`);
    writeFileSync(store.v2IndexPath, `${JSON.stringify(badDraft, null, 2)}\n`);

    expect(() => store.publish(published.metadata.revision)).toThrow(/missing unit/i);
    expect(store.getPublicationStatus().currentRevision).toBe(published.metadata.revision);
    expect(store.readPublishedPackV2().units[0]?.id).toBe('test-scout');
  });

  it('rejects corrupt PNGs, oversize manifests, and encoded traversal', () => {
    const corrupt = Buffer.from(TINY_PNG_BASE64, 'base64');
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
    expect(() => store.createUnitArchetype(validUnitArchetype, corrupt.toString('base64'))).toThrow(/PNG|corrupt|CRC/i);
    expect(() =>
      store.createUnitArchetype(
        { ...validUnitArchetype, sourceWidth: 4097, bounds: { minX: 4, minY: 4, maxX: 4096, maxY: 28 } },
        TINY_PNG_BASE64,
      ),
    ).toThrow(/image dimensions/i);
    expect(() => sanitizeRelativePath('units/a/%2e%2e/secret.png')).toThrow(/invalid path/i);
    expect(() => sanitizeRelativePath('units/a/../secret.png')).toThrow(/invalid path/i);
  });
});

describe('PackStore v1 compatibility', () => {
  it('readPackV1 ignores v2 manifests', () => {
    store.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const v1 = store.readPackV1();
    expect(v1.schemaVersion).toBe(1);
    expect(v1.units).toHaveLength(0);
  });

  it('preserves an existing v1 pack.json when authoring v2 units', () => {
    const v1Index = { schemaVersion: 1, id: 'dev-pack', units: [] };
    writeFileSync(join(tempDir, 'pack.json'), `${JSON.stringify(v1Index, null, 2)}\n`);
    const mixed = new PackStore({ packDir: tempDir });
    mixed.createUnitArchetype(validUnitArchetype, TINY_PNG_BASE64);
    const onDisk = JSON.parse(readFileSync(join(tempDir, 'pack.json'), 'utf8')) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(1);
    expect(existsSync(join(tempDir, 'pack-v2.json'))).toBe(false);
    expect(mixed.readPackV2().units.some((unit) => unit.id === 'test-scout')).toBe(true);
  });
});
