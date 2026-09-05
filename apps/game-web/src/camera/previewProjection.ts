import { Vector3 } from 'three';
import {
  CELL_SIZE,
  DEFAULT_ZOOM_STOP,
  ISO_AZIMUTH,
  MAP_WORLD_SIZE,
  type ZoomStopName,
} from '../config/constants';
import { IsometricCamera } from './IsometricCamera';

export type ScreenPoint = {
  x: number;
  y: number;
  depth: number;
};

export type SpriteProjectionInput = {
  groundX: number;
  groundZ: number;
  worldWidth: number;
  worldHeight: number;
  anchorX: number;
  anchorY: number;
};

export type ProjectedSpriteQuad = {
  topLeft: ScreenPoint;
  topRight: ScreenPoint;
  bottomLeft: ScreenPoint;
  bottomRight: ScreenPoint;
  ground: ScreenPoint;
};

export type ProjectedGroundRadius = {
  center: ScreenPoint;
  radiusX: number;
  radiusY: number;
};

export type RuntimePreviewProjection = {
  camera: IsometricCamera;
  viewport: { width: number; height: number };
  zoom: ZoomStopName;
  projectWorldPoint: (x: number, y: number, z: number) => ScreenPoint;
  projectSpriteQuad: (input: SpriteProjectionInput) => ProjectedSpriteQuad;
  projectGroundRadius: (x: number, z: number, radius: number) => ProjectedGroundRadius;
};

/**
 * Creates the same orthographic camera and sprite plane convention used by the
 * runtime interaction lab. The preview is a projection, not a thumbnail fit.
 */
export function createRuntimePreviewProjection(
  width: number,
  height: number,
  zoom: ZoomStopName = DEFAULT_ZOOM_STOP,
): RuntimePreviewProjection {
  const viewport = {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
  const camera = new IsometricCamera();
  camera.setViewport(viewport.width, viewport.height);
  camera.applyNamedPreset(zoom);
  camera.setLookAt(MAP_WORLD_SIZE / 2, MAP_WORLD_SIZE / 2);

  const projectWorldPoint = (x: number, y: number, z: number): ScreenPoint => {
    const projected = new Vector3(x, y, z).project(camera.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * viewport.width,
      y: (-projected.y * 0.5 + 0.5) * viewport.height,
      depth: projected.z,
    };
  };

  const projectSpriteQuad = (input: SpriteProjectionInput): ProjectedSpriteQuad => {
    const centerX = input.groundX + (0.5 - input.anchorX) * input.worldWidth;
    const centerY = input.worldHeight * (1 - input.anchorY) + input.worldHeight / 2;
    const centerZ = input.groundZ;
    const halfWidth = input.worldWidth / 2;
    const halfHeight = input.worldHeight / 2;
    return {
      topLeft: projectPlanePoint(-halfWidth, halfHeight, centerX, centerY, centerZ),
      topRight: projectPlanePoint(halfWidth, halfHeight, centerX, centerY, centerZ),
      bottomLeft: projectPlanePoint(-halfWidth, -halfHeight, centerX, centerY, centerZ),
      bottomRight: projectPlanePoint(halfWidth, -halfHeight, centerX, centerY, centerZ),
      ground: projectWorldPoint(input.groundX, 0, input.groundZ),
    };
  };

  const projectGroundRadius = (x: number, z: number, radius: number): ProjectedGroundRadius => {
    const center = projectWorldPoint(x, 0, z);
    const worldRadius = radius * CELL_SIZE;
    const worldXEdge = projectWorldPoint(x + worldRadius, 0, z);
    const worldZEdge = projectWorldPoint(x, 0, z + worldRadius);
    return {
      center,
      radiusX: Math.hypot(worldXEdge.x - center.x, worldZEdge.x - center.x),
      radiusY: Math.hypot(worldXEdge.y - center.y, worldZEdge.y - center.y),
    };
  };

  return { camera, viewport, zoom, projectWorldPoint, projectSpriteQuad, projectGroundRadius };

  function projectPlanePoint(localX: number, localY: number, x: number, y: number, z: number): ScreenPoint {
    const rotatedX = Math.cos(ISO_AZIMUTH) * localX;
    const rotatedZ = -Math.sin(ISO_AZIMUTH) * localX;
    return projectWorldPoint(x + rotatedX, y + localY, z + rotatedZ);
  }
}
