import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { DEFAULT_SEED, MAP_WORLD_SIZE } from '../config/constants';
import { palette } from '../config/palette';
import { createMulberry32 } from '../util/seededRng';

const LANDMARK_COUNT = 12;
const _matrix = new Matrix4();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _color = new Color();

/** Sparse oversized monoliths — placeholder landmarks, not gameplay buildings. */
export class LandmarkSystem {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshLambertMaterial;
  private readonly geometry: BoxGeometry;
  private readonly scene: Scene;

  constructor(scene: Scene, seed = DEFAULT_SEED) {
    this.scene = scene;
    this.geometry = new BoxGeometry(1, 1, 1);
    this.material = new MeshLambertMaterial({ color: palette.landmark });
    this.mesh = new InstancedMesh(this.geometry, this.material, LANDMARK_COUNT);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = true;
    const rng = createMulberry32(seed ^ 0x1111);
    const base = new Color(palette.landmark);
    const accent = new Color(palette.landmarkAccent);

    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const x = 12 + rng() * (MAP_WORLD_SIZE - 24);
      const z = 12 + rng() * (MAP_WORLD_SIZE - 24);
      const height = 6 + rng() * 10;
      const width = 1.4 + rng() * 1.8;
      const depth = 1.4 + rng() * 1.8;
      _position.set(x, height / 2, z);
      _quaternion.identity();
      _scale.set(width, height, depth);
      _matrix.compose(_position, _quaternion, _scale);
      this.mesh.setMatrixAt(i, _matrix);
      _color.copy(base).lerp(accent, rng());
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
    scene.add(this.mesh);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
