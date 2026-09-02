import { Vector3 } from 'three';
import type { IsometricCamera } from '../camera/IsometricCamera';
import { MIN_FINGER_RADIUS_CSS } from '../input/gestureConstants';
import type { PickableEntity, ScreenPoint } from './types';

const _world = new Vector3();

export type HitTestOptions = {
  /** Minimum pick radius in CSS points. Defaults to finger-friendly 22pt. */
  minRadiusCss?: number;
};

export type HitTestResult = {
  entity: PickableEntity;
  distanceCss: number;
};

/**
 * Projects entity ground anchors to screen space and picks the nearest
 * eligible target within an expanded finger radius.
 */
export class HitTestService {
  pickAt(
    point: ScreenPoint,
    entities: readonly PickableEntity[],
    camera: IsometricCamera,
    canvasRect: DOMRectReadOnly,
    options: HitTestOptions = {},
  ): HitTestResult | null {
    const minRadius = options.minRadiusCss ?? MIN_FINGER_RADIUS_CSS;
    let best: HitTestResult | null = null;

    for (const entity of entities) {
      const screen = this.projectEntity(entity, camera, canvasRect);
      if (!screen) {
        continue;
      }
      const dx = point.x - screen.x;
      const dy = point.y - screen.y;
      const dist = Math.hypot(dx, dy);
      const pickRadius = Math.max(minRadius, screen.radiusCss);
      if (dist > pickRadius) {
        continue;
      }
      if (!best || dist < best.distanceCss) {
        best = { entity, distanceCss: dist };
      }
    }
    return best;
  }

  entitiesInLasso(
    lasso: { x: number; y: number; width: number; height: number },
    entities: readonly PickableEntity[],
    camera: IsometricCamera,
    canvasRect: DOMRectReadOnly,
    filter?: (entity: PickableEntity) => boolean,
  ): PickableEntity[] {
    const minX = Math.min(lasso.x, lasso.x + lasso.width);
    const maxX = Math.max(lasso.x, lasso.x + lasso.width);
    const minY = Math.min(lasso.y, lasso.y + lasso.height);
    const maxY = Math.max(lasso.y, lasso.y + lasso.height);
    const hits: PickableEntity[] = [];

    for (const entity of entities) {
      if (filter && !filter(entity)) {
        continue;
      }
      const screen = this.projectEntity(entity, camera, canvasRect);
      if (!screen) {
        continue;
      }
      if (screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY) {
        hits.push(entity);
      }
    }
    return hits;
  }

  private projectEntity(
    entity: PickableEntity,
    camera: IsometricCamera,
    canvasRect: DOMRectReadOnly,
  ): { x: number; y: number; radiusCss: number } | null {
    const localX = this.worldToLocalScreen(entity.x, entity.z, camera, canvasRect);
    if (!localX) {
      return null;
    }
    const edge = this.worldToLocalScreen(entity.x + entity.selectionRadius, entity.z, camera, canvasRect);
    const radiusCss = edge
      ? Math.max(MIN_FINGER_RADIUS_CSS * 0.5, Math.hypot(edge.x - localX.x, edge.y - localX.y))
      : MIN_FINGER_RADIUS_CSS;
    return { x: localX.x, y: localX.y, radiusCss };
  }

  private worldToLocalScreen(
    worldX: number,
    worldZ: number,
    camera: IsometricCamera,
    canvasRect: DOMRectReadOnly,
  ): ScreenPoint | null {
    const viewport = camera.getViewport();
    _world.set(worldX, 0, worldZ).project(camera.camera);
    if (_world.z < -1 || _world.z > 1) {
      return null;
    }
    return {
      x: (_world.x * 0.5 + 0.5) * viewport.width + canvasRect.left - canvasRect.left,
      y: (-_world.y * 0.5 + 0.5) * viewport.height + canvasRect.top - canvasRect.top,
    };
  }
}

/** Returns true when the projected pick radius meets the minimum touch target. */
export function meetsMinimumTouchTarget(radiusCss: number): boolean {
  return radiusCss * 2 >= MIN_FINGER_RADIUS_CSS * 2;
}
