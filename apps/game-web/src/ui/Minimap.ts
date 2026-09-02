import { MAP_CELLS } from '../config/constants';
import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';
import type { IsometricCamera } from '../camera/IsometricCamera';
import type { PickableEntity } from '../selection/types';

export type MinimapEntityKind = 'friendly' | 'opposing' | 'building' | 'blocker';

export type MinimapMarker = {
  cx: number;
  cz: number;
  kind: MinimapEntityKind;
};

export type MinimapModel = {
  markers: MinimapMarker[];
  cameraLookAtX: number;
  cameraLookAtZ: number;
  viewCellsX: number;
  viewCellsZ: number;
};

export type MinimapHandlers = {
  onCameraMove: (worldX: number, worldZ: number) => void;
};

const MINIMAP_SIZE = MAP_CELLS;
const MINIMAP_STYLES = `
.pastel-minimap {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 20;
  width: ${MIN_TOUCH_TARGET_CSS * 3}px;
  height: ${MIN_TOUCH_TARGET_CSS * 3}px;
  min-width: ${MIN_TOUCH_TARGET_CSS * 3}px;
  min-height: ${MIN_TOUCH_TARGET_CSS * 3}px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(8, 24, 28, 0.82);
  touch-action: none;
  pointer-events: auto;
}
.pastel-minimap canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 8px;
}
`;

/**
 * Full-map minimap with camera viewport. Tap or drag repositions the camera.
 * No fog of war in Milestone 1.
 */
export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private handlers: MinimapHandlers | null = null;
  private dragging = false;
  private model: MinimapModel = {
    markers: [],
    cameraLookAtX: MAP_CELLS / 2,
    cameraLookAtZ: MAP_CELLS / 2,
    viewCellsX: 44,
    viewCellsZ: 28,
  };

  constructor(host: HTMLElement) {
    this.ensureStyles();
    this.root = document.createElement('div');
    this.root.className = 'pastel-minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = MINIMAP_SIZE;
    this.canvas.height = MINIMAP_SIZE;
    this.root.appendChild(this.canvas);
    host.appendChild(this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Minimap 2d context unavailable');
    }
    this.ctx = ctx;

    this.root.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.dragging = true;
      try {
        this.root.setPointerCapture(event.pointerId);
      } catch {
        // jsdom and some browsers omit pointer capture on divs.
      }
      this.moveCameraFromEvent(event);
    });
    this.root.addEventListener('pointermove', (event) => {
      if (!this.dragging) {
        return;
      }
      event.stopPropagation();
      this.moveCameraFromEvent(event);
    });
    this.root.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      this.dragging = false;
      try {
        this.root.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }
    });
    this.root.addEventListener('pointercancel', (event) => {
      this.dragging = false;
      event.stopPropagation();
    });
  }

  setHandlers(handlers: MinimapHandlers): void {
    this.handlers = handlers;
  }

  render(model: MinimapModel): void {
    this.model = model;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = '#1a3d42';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    for (const marker of model.markers) {
      ctx.fillStyle = colorForKind(marker.kind);
      ctx.fillRect(marker.cx, marker.cz, 1, 1);
    }

    const halfW = model.viewCellsX / 2;
    const halfH = model.viewCellsZ / 2;
    const vx = model.cameraLookAtX - halfW;
    const vz = model.cameraLookAtZ - halfH;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vz, model.viewCellsX, model.viewCellsZ);
  }

  getElement(): HTMLElement {
    return this.root;
  }

  /** Maps minimap client coordinates to world X/Z. Exposed for tests. */
  clientToWorld(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.root.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * MAP_CELLS;
    const localZ = ((clientY - rect.top) / rect.height) * MAP_CELLS;
    return {
      x: clamp(localX, 0, MAP_CELLS),
      z: clamp(localZ, 0, MAP_CELLS),
    };
  }

  dispose(): void {
    this.root.remove();
  }

  private moveCameraFromEvent(event: PointerEvent): void {
    const world = this.clientToWorld(event.clientX, event.clientY);
    this.handlers?.onCameraMove(world.x, world.z);
    this.model = {
      ...this.model,
      cameraLookAtX: world.x,
      cameraLookAtZ: world.z,
    };
    this.render(this.model);
  }

  private ensureStyles(): void {
    if (document.getElementById('pastel-minimap-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'pastel-minimap-styles';
    style.textContent = MINIMAP_STYLES;
    document.head.appendChild(style);
  }
}

export function buildMinimapMarkers(
  entities: readonly PickableEntity[],
  blockers: ReadonlyArray<{ cx: number; cz: number }> = [],
): MinimapMarker[] {
  const markers: MinimapMarker[] = [];
  for (const entity of entities) {
    markers.push({
      cx: Math.floor(entity.x),
      cz: Math.floor(entity.z),
      kind: entity.kind === 'building' ? 'building' : entity.relationship === 'opposing' ? 'opposing' : 'friendly',
    });
  }
  for (const cell of blockers) {
    markers.push({ cx: cell.cx, cz: cell.cz, kind: 'blocker' });
  }
  return markers;
}

export function minimapModelFromCamera(
  camera: IsometricCamera,
  markers: MinimapMarker[],
): MinimapModel {
  const view = camera.getGroundView();
  return {
    markers,
    cameraLookAtX: camera.lookAt.x,
    cameraLookAtZ: camera.lookAt.z,
    viewCellsX: view.cellsX,
    viewCellsZ: view.cellsZ,
  };
}

function colorForKind(kind: MinimapEntityKind): string {
  switch (kind) {
    case 'friendly':
      return '#7fd4c3';
    case 'opposing':
      return '#e88888';
    case 'building':
      return '#c9b07a';
    case 'blocker':
      return '#445c60';
    default:
      return '#ffffff';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
