import {
  CELL_SIZE,
  CHUNK_CELLS,
  CHUNK_COUNT,
  MAP_CELLS,
  MAP_WORLD_SIZE,
} from '../config/constants';

export type ChunkCoord = {
  cx: number;
  cz: number;
};

export type WorldAabb = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function assertChunkLayout(): void {
  if (CHUNK_COUNT !== 10) {
    throw new Error(`Expected 10×10 chunks, got CHUNK_COUNT=${CHUNK_COUNT}`);
  }
  if (CHUNK_CELLS * CHUNK_COUNT !== MAP_CELLS) {
    throw new Error('Chunk grid does not cover the logical map');
  }
}

export function chunkIndex(cx: number, cz: number): number {
  return cz * CHUNK_COUNT + cx;
}

export function chunkFromIndex(index: number): ChunkCoord {
  return {
    cx: index % CHUNK_COUNT,
    cz: Math.floor(index / CHUNK_COUNT),
  };
}

export function cellToChunk(cellX: number, cellZ: number): ChunkCoord {
  return {
    cx: Math.min(CHUNK_COUNT - 1, Math.max(0, Math.floor(cellX / CHUNK_CELLS))),
    cz: Math.min(CHUNK_COUNT - 1, Math.max(0, Math.floor(cellZ / CHUNK_CELLS))),
  };
}

export function worldToCell(x: number, z: number): { cellX: number; cellZ: number } {
  return {
    cellX: Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(x / CELL_SIZE))),
    cellZ: Math.min(MAP_CELLS - 1, Math.max(0, Math.floor(z / CELL_SIZE))),
  };
}

export function chunkWorldAabb(cx: number, cz: number): WorldAabb {
  return {
    minX: cx * CHUNK_CELLS * CELL_SIZE,
    maxX: (cx + 1) * CHUNK_CELLS * CELL_SIZE,
    minZ: cz * CHUNK_CELLS * CELL_SIZE,
    maxZ: (cz + 1) * CHUNK_CELLS * CELL_SIZE,
  };
}

export function aabbsOverlap(a: WorldAabb, b: WorldAabb, pad = 0): boolean {
  return (
    a.minX <= b.maxX + pad &&
    a.maxX >= b.minX - pad &&
    a.minZ <= b.maxZ + pad &&
    a.maxZ >= b.minZ - pad
  );
}

export function mapWorldAabb(): WorldAabb {
  return { minX: 0, maxX: MAP_WORLD_SIZE, minZ: 0, maxZ: MAP_WORLD_SIZE };
}

export const TOTAL_CHUNKS = CHUNK_COUNT * CHUNK_COUNT;
