import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_SIZE, DEFAULT_MAP_CELLS, validateMapDef } from './map';

const validMap = {
  schemaVersion: 1,
  id: 'lab-grid',
  displayName: 'Lab Grid',
  cellsX: DEFAULT_MAP_CELLS,
  cellsZ: DEFAULT_MAP_CELLS,
  chunkSize: DEFAULT_CHUNK_SIZE,
};

describe('map schema foundation', () => {
  it('accepts the default 160x160 lab map stub', () => {
    const map = validateMapDef(validMap);
    expect(map.cellsX).toBe(160);
    expect(map.cellsZ).toBe(160);
    expect(map.chunkSize).toBe(16);
  });

  it('accepts an optional blocked-cell mask', () => {
    const map = validateMapDef({
      schemaVersion: 1,
      id: 'tiny',
      displayName: 'Tiny',
      cellsX: 2,
      cellsZ: 2,
      chunkSize: 2,
      blockedCells: [
        [false, true],
        [false, false],
      ],
    });
    expect(map.blockedCells?.[0]?.[1]).toBe(true);
  });

  it('rejects dimensions that are not chunk-aligned', () => {
    expect(() => validateMapDef({ ...validMap, cellsX: 161 })).toThrow(/chunkSize/i);
  });

  it('rejects a blocked mask with the wrong size', () => {
    expect(() =>
      validateMapDef({
        schemaVersion: 1,
        id: 'tiny',
        displayName: 'Tiny',
        cellsX: 2,
        cellsZ: 2,
        chunkSize: 2,
        blockedCells: [[true]],
      }),
    ).toThrow(/blockedCells/i);
  });
});
