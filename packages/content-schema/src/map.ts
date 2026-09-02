import {
  isRecord,
  requireContentId,
  requirePositiveInt,
  requireString,
} from './validation';

export const MAP_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAP_CELLS = 160;
export const DEFAULT_CHUNK_SIZE = 16;

/**
 * On-disk map foundation for interaction-lab. Pack v2 references these via
 * `maps[].path`. Terrain layers and authored heightmaps are later milestones.
 */
export type MapDef = {
  schemaVersion: typeof MAP_SCHEMA_VERSION;
  id: string;
  displayName: string;
  cellsX: number;
  cellsZ: number;
  chunkSize: number;
  /** Row-major `cellsZ` rows of `cellsX` booleans. `true` means blocked. */
  blockedCells?: boolean[][];
};

export function validateMapDef(value: unknown): MapDef {
  if (!isRecord(value)) {
    throw new Error('Map must be an object');
  }
  if (value['schemaVersion'] !== MAP_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const cellsX = requirePositiveInt(value['cellsX'], 'cellsX');
  const cellsZ = requirePositiveInt(value['cellsZ'], 'cellsZ');
  const chunkSize = requirePositiveInt(value['chunkSize'], 'chunkSize');
  if (cellsX % chunkSize !== 0 || cellsZ % chunkSize !== 0) {
    throw new Error('map dimensions must be divisible by chunkSize');
  }
  const map: MapDef = {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: requireContentId(value['id'], 'map id'),
    displayName: requireString(value['displayName'], 'displayName'),
    cellsX,
    cellsZ,
    chunkSize,
  };
  const blockedCells = parseOptionalBlockedCells(value['blockedCells'], cellsX, cellsZ);
  if (blockedCells !== undefined) {
    map.blockedCells = blockedCells;
  }
  return map;
}

function parseOptionalBlockedCells(value: unknown, cellsX: number, cellsZ: number): boolean[][] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== cellsZ) {
    throw new Error('blockedCells must have cellsZ rows');
  }
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== cellsX) {
      throw new Error(`blockedCells row ${String(rowIndex)} must have cellsX columns`);
    }
    return row.map((cell) => {
      if (typeof cell !== 'boolean') {
        throw new Error('blockedCells cells must be booleans');
      }
      return cell;
    });
  });
}
