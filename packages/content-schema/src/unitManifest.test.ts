import { describe, expect, it } from 'vitest';
import { createUnitManifest, validateUnitManifest } from './unitManifest';

const valid = {
  schemaVersion: 1,
  id: 'ember-skirmisher',
  displayName: 'Ember Skirmisher',
  enabled: true,
  faction: 'friendly' as const,
  assetPath: 'units/ember-skirmisher/sprite.png',
  sourceWidth: 64,
  sourceHeight: 64,
  bounds: { minX: 8, minY: 4, maxX: 56, maxY: 60 },
  anchor: { x: 0.5, y: 1 },
  worldHeight: 1.6,
  selectionRadius: 0.7,
};

describe('unit manifest schema', () => {
  it('accepts a valid unit', () => {
    const manifest = validateUnitManifest(valid);
    expect(manifest.id).toBe('ember-skirmisher');
    expect(createUnitManifest(valid).displayName).toBe('Ember Skirmisher');
  });

  it('rejects invalid IDs', () => {
    expect(() => validateUnitManifest({ ...valid, id: 'Ember Skirmisher' })).toThrow(/id/i);
    expect(() => validateUnitManifest({ ...valid, id: '-dash' })).toThrow(/id/i);
    expect(() => validateUnitManifest({ ...valid, id: 'Upper' })).toThrow(/id/i);
  });

  it('rejects invalid anchors', () => {
    expect(() => validateUnitManifest({ ...valid, anchor: { x: 1.2, y: 0.5 } })).toThrow(/anchor/i);
    expect(() => validateUnitManifest({ ...valid, anchor: { x: 0.5, y: -0.1 } })).toThrow(/anchor/i);
  });

  it('rejects missing asset paths', () => {
    expect(() => validateUnitManifest({ ...valid, assetPath: '' })).toThrow(/assetPath/);
    expect(() => validateUnitManifest({ ...valid, assetPath: '../secret.png' })).toThrow(/assetPath/);
  });

  it('rejects invalid schema versions', () => {
    expect(() => validateUnitManifest({ ...valid, schemaVersion: 99 })).toThrow(/schemaVersion/);
    expect(() => validateUnitManifest({ ...valid, schemaVersion: '1' })).toThrow(/schemaVersion/);
  });
});
