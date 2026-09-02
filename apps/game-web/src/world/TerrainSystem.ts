import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
  Scene,
} from 'three';
import {
  CELL_SIZE,
  CHUNK_CELLS,
  CHUNK_COUNT,
  DEFAULT_SEED,
} from '../config/constants';
import { palette } from '../config/palette';
import { hash2 } from '../util/seededRng';
import { type IsometricCamera } from '../camera/IsometricCamera';
import {
  TOTAL_CHUNKS,
  aabbsOverlap,
  chunkFromIndex,
  chunkIndex,
  chunkWorldAabb,
  type WorldAabb,
} from './chunks';

const terrainBase = new Color(palette.terrain);
const terrainDark = new Color(palette.terrainDark);
const terrainLight = new Color(palette.terrainLight);
const resource = new Color(palette.resource);
const _box = new Box3();
const _color = new Color();

type ChunkMesh = {
  mesh: Mesh;
  cx: number;
  cz: number;
  aabb: WorldAabb;
};

/**
 * One Lambert mesh per 16×16 chunk. Cells are not individual meshes.
 */
export class TerrainSystem {
  private readonly chunks: ChunkMesh[] = [];
  private visibleCount = 0;
  private readonly material: MeshLambertMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly seed = DEFAULT_SEED,
  ) {
    this.material = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
    for (let cz = 0; cz < CHUNK_COUNT; cz += 1) {
      for (let cx = 0; cx < CHUNK_COUNT; cx += 1) {
        this.chunks.push(this.createChunk(cx, cz));
      }
    }
    if (this.chunks.length !== TOTAL_CHUNKS) {
      throw new Error(`Expected ${TOTAL_CHUNKS} chunk meshes, got ${this.chunks.length}`);
    }
  }

  getTotalChunks(): number {
    return this.chunks.length;
  }

  getVisibleChunkCount(): number {
    return this.visibleCount;
  }

  updateVisibility(camera: IsometricCamera): void {
    const view = camera.getGroundView();
    let visible = 0;
    for (const chunk of this.chunks) {
      const show = aabbsOverlap(chunk.aabb, view, CELL_SIZE);
      chunk.mesh.visible = show;
      if (show) {
        visible += 1;
      }
    }
    this.visibleCount = visible;
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.material.dispose();
    this.chunks.length = 0;
  }

  private createChunk(cx: number, cz: number): ChunkMesh {
    const geometry = buildChunkGeometry(cx, cz, this.seed);
    const mesh = new Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.position.set(0, 0, 0);
    mesh.updateMatrix();
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    const aabb = chunkWorldAabb(cx, cz);
    _box.setFromObject(mesh);
    return { mesh, cx, cz, aabb };
  }
}

function buildChunkGeometry(cx: number, cz: number, seed: number): BufferGeometry {
  const vertsPerSide = CHUNK_CELLS + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < vertsPerSide; row += 1) {
    for (let col = 0; col < vertsPerSide; col += 1) {
      const cellX = cx * CHUNK_CELLS + col;
      const cellZ = cz * CHUNK_CELLS + row;
      const x = cellX * CELL_SIZE;
      const z = cellZ * CELL_SIZE;
      const nibble = hash2(cellX, cellZ, seed);
      const y = (nibble - 0.5) * 0.04;
      positions.push(x, y, z);
      normals.push(0, 1, 0);

      const resourceCell = hash2(cellX, cellZ, seed ^ 0x91) < 0.018;
      if (resourceCell) {
        _color.copy(resource);
      } else if (nibble < 0.35) {
        _color.copy(terrainDark);
      } else if (nibble > 0.72) {
        _color.copy(terrainLight);
      } else {
        _color.copy(terrainBase);
      }
      colors.push(_color.r, _color.g, _color.b);
    }
  }

  for (let row = 0; row < CHUNK_CELLS; row += 1) {
    for (let col = 0; col < CHUNK_CELLS; col += 1) {
      const i0 = row * vertsPerSide + col;
      const i1 = i0 + 1;
      const i2 = i0 + vertsPerSide;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function expectedChunkIndex(cx: number, cz: number): number {
  return chunkIndex(cx, cz);
}

export { chunkFromIndex };
