import {
  Frustum,
  Matrix4,
  OrthographicCamera,
  Plane,
  Ray,
  Vector2,
  Vector3,
} from 'three';
import {
  CAMERA_DISTANCE,
  CAMERA_FAR,
  CAMERA_NEAR,
  CELL_SIZE,
  DEFAULT_ZOOM_STOP,
  ISO_AZIMUTH,
  ISO_ELEVATION,
  MAP_WORLD_SIZE,
  MAX_VISIBLE_CELLS_X,
  MIN_VISIBLE_CELLS_X,
  PRESET_70_VISIBLE_CELLS_X,
  PRESET_70_VISIBLE_CELLS_Y,
  ZOOM_STOPS,
  type ZoomStopName,
} from '../config/constants';
import type { WorldAabb } from '../world/chunks';

const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const _ndc = new Vector2();
const _origin = new Vector3();
const _dir = new Vector3();
const _hit = new Vector3();
const _ray = new Ray();
const _proj = new Matrix4();
const _frustum = new Frustum();
const _corner = new Vector3();

export type GroundView = WorldAabb & {
  width: number;
  depth: number;
  cellsX: number;
  cellsZ: number;
};

/**
 * Fixed-isometric orthographic camera. Azimuth and elevation never change.
 * Zoom is expressed as visible ground AABB width in logical cells.
 */
export class IsometricCamera {
  readonly camera: OrthographicCamera;
  readonly lookAt = new Vector3(MAP_WORLD_SIZE / 2, 0, MAP_WORLD_SIZE / 2);

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private visibleCellsX = PRESET_70_VISIBLE_CELLS_X;
  private frustumHalfWidth = 22;
  private frustumHalfHeight = 14;

  constructor() {
    this.camera = new OrthographicCamera(-22, 22, 14, -14, CAMERA_NEAR, CAMERA_FAR);
    this.camera.rotation.order = 'YXZ';
    this.applyPose();
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.syncFrustum();
  }

  getViewport(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  getAspect(): number {
    return this.viewportWidth / this.viewportHeight;
  }

  setVisibleCellsX(cells: number): void {
    this.visibleCellsX = clampVisibleCells(cells);
    this.syncFrustum();
    this.clampLookAtToMap();
  }

  getVisibleCellsX(): number {
    return this.visibleCellsX;
  }

  applyNamedPreset(name: ZoomStopName): void {
    const stop = ZOOM_STOPS.find((item) => item.name === name) ?? ZOOM_STOPS[1];
    if (!stop) {
      return;
    }
    this.setVisibleCellsX(stop.visibleCellsX);
  }

  nearestZoomStop(): ZoomStopName {
    let best: ZoomStopName = DEFAULT_ZOOM_STOP;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const stop of ZOOM_STOPS) {
      const dist = Math.abs(stop.visibleCellsX - this.visibleCellsX);
      if (dist < bestDist) {
        best = stop.name;
        bestDist = dist;
      }
    }
    return best;
  }

  settleToNearestStop(): void {
    this.applyNamedPreset(this.nearestZoomStop());
  }

  setLookAt(x: number, z: number): void {
    this.lookAt.set(x, 0, z);
    this.clampLookAtToMap();
    this.applyPose();
  }

  panByGroundDelta(dx: number, dz: number): void {
    this.setLookAt(this.lookAt.x + dx, this.lookAt.z + dz);
  }

  screenToGround(clientX: number, clientY: number, out = new Vector3()): Vector3 | null {
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) {
      return null;
    }
    _ndc.set(
      (clientX / this.viewportWidth) * 2 - 1,
      -(clientY / this.viewportHeight) * 2 + 1,
    );
    _origin.set(_ndc.x, _ndc.y, -1).unproject(this.camera);
    _dir.set(_ndc.x, _ndc.y, 1).unproject(this.camera).sub(_origin).normalize();
    _ray.set(_origin, _dir);
    const hit = _ray.intersectPlane(groundPlane, _hit);
    if (!hit) {
      return null;
    }
    return out.copy(hit);
  }

  getGroundView(): GroundView {
    const corners = this.groundCorners();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minZ = Math.min(minZ, corner.z);
      maxZ = Math.max(maxZ, corner.z);
    }
    const width = maxX - minX;
    const depth = maxZ - minZ;
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      width,
      depth,
      cellsX: width / CELL_SIZE,
      cellsZ: depth / CELL_SIZE,
    };
  }

  getFrustum(target = _frustum): Frustum {
    _proj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    return target.setFromProjectionMatrix(_proj);
  }

  groundCorners(): Vector3[] {
    const pts: Array<[number, number]> = [
      [0, 0],
      [this.viewportWidth, 0],
      [this.viewportWidth, this.viewportHeight],
      [0, this.viewportHeight],
    ];
    const result: Vector3[] = [];
    for (const [x, y] of pts) {
      const hit = this.screenToGround(x, y, new Vector3());
      if (hit) {
        result.push(hit);
      }
    }
    return result;
  }

  private syncFrustum(): void {
    const aspect = this.getAspect();
    this.frustumHalfWidth = (this.visibleCellsX * CELL_SIZE) / 2;
    this.frustumHalfHeight = this.frustumHalfWidth / aspect;
    this.camera.left = -this.frustumHalfWidth;
    this.camera.right = this.frustumHalfWidth;
    this.camera.top = this.frustumHalfHeight;
    this.camera.bottom = -this.frustumHalfHeight;
    this.camera.updateProjectionMatrix();
    this.refineFrustumToGroundWidth();
  }

  /**
   * Orthographic frustum width is in view space. Tune it so the ground AABB
   * width matches the requested cell count after isometric projection.
   */
  private refineFrustumToGroundWidth(): void {
    const target = this.visibleCellsX * CELL_SIZE;
    for (let i = 0; i < 6; i += 1) {
      const view = this.getGroundView();
      if (view.width <= 1e-4) {
        return;
      }
      const scale = target / view.width;
      this.frustumHalfWidth *= scale;
      this.frustumHalfHeight = this.frustumHalfWidth / this.getAspect();
      this.camera.left = -this.frustumHalfWidth;
      this.camera.right = this.frustumHalfWidth;
      this.camera.top = this.frustumHalfHeight;
      this.camera.bottom = -this.frustumHalfHeight;
      this.camera.updateProjectionMatrix();
    }
  }

  private clampLookAtToMap(): void {
    const view = this.getGroundView();
    const halfW = view.width / 2;
    const halfD = view.depth / 2;
    const minX = halfW;
    const maxX = MAP_WORLD_SIZE - halfW;
    const minZ = halfD;
    const maxZ = MAP_WORLD_SIZE - halfD;
    const x = maxX < minX ? MAP_WORLD_SIZE / 2 : clamp(this.lookAt.x, minX, maxX);
    const z = maxZ < minZ ? MAP_WORLD_SIZE / 2 : clamp(this.lookAt.z, minZ, maxZ);
    this.lookAt.set(x, 0, z);
    this.applyPose();
  }

  private applyPose(): void {
    const cosE = Math.cos(ISO_ELEVATION);
    const sinE = Math.sin(ISO_ELEVATION);
    const sinA = Math.sin(ISO_AZIMUTH);
    const cosA = Math.cos(ISO_AZIMUTH);
    this.camera.position.set(
      this.lookAt.x + CAMERA_DISTANCE * cosE * sinA,
      this.lookAt.y + CAMERA_DISTANCE * sinE,
      this.lookAt.z + CAMERA_DISTANCE * cosE * cosA,
    );
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    void _corner;
  }
}

export function clampVisibleCells(cells: number): number {
  return Math.min(MAX_VISIBLE_CELLS_X, Math.max(MIN_VISIBLE_CELLS_X, cells));
}

export function zoomStopVisibleCells(name: ZoomStopName): number {
  return ZOOM_STOPS.find((stop) => stop.name === name)?.visibleCellsX ?? PRESET_70_VISIBLE_CELLS_X;
}

/**
 * Validates the 70-percent framing.
 *
 * `visibleCellsX` is tuned so the ground AABB width is ~44 cells. The isometric
 * diamond's Z AABB is similar in magnitude, while the 28-cell figure is the
 * landscape screen target (44 / typical iPad landscape aspect ≈ 28).
 */
export function isPresetViewBounded(view: GroundView, aspect: number): boolean {
  const widthOk =
    view.cellsX > PRESET_70_VISIBLE_CELLS_X - 3 && view.cellsX < PRESET_70_VISIBLE_CELLS_X + 3;
  const expectedScreenCellsY = PRESET_70_VISIBLE_CELLS_X / aspect;
  const screenTargetOk =
    Math.abs(expectedScreenCellsY - PRESET_70_VISIBLE_CELLS_Y) < 8 || aspect < 1.2 || aspect > 1.8;
  const depthOk = view.cellsZ > 16 && view.cellsZ < MAP_WORLD_SIZE && Number.isFinite(view.cellsZ);
  const smallerThanMap = view.width < MAP_WORLD_SIZE - 8 && view.depth < MAP_WORLD_SIZE - 8;
  const insideMap =
    view.maxX > 0 && view.minX < MAP_WORLD_SIZE && view.maxZ > 0 && view.minZ < MAP_WORLD_SIZE;
  return widthOk && depthOk && smallerThanMap && insideMap && screenTargetOk;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
