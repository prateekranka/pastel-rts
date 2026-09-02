import { Vector3 } from 'three';
import type { IsometricCamera } from '../camera/IsometricCamera';
import type { DestinationMarker, FormationPreview, LassoRect } from '../selection/types';

const _world = new Vector3();
const _ndc = new Vector3();

/** Visible lasso, formation preview, and destination marker for interaction-lab. */
export class InteractionFeedback {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly lassoEl: HTMLDivElement;
  private readonly destEl: HTMLDivElement;
  private readonly formationEl: HTMLDivElement;
  private destination: DestinationMarker | null = null;
  private formation: FormationPreview | null = null;
  private camera: IsometricCamera | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.host = canvas.parentElement ?? document.body;
    if (getComputedStyle(this.host).position === 'static') {
      this.host.style.position = 'relative';
    }
    this.lassoEl = document.createElement('div');
    this.lassoEl.className = 'pastel-lasso';
    this.lassoEl.dataset.role = 'lasso';
    this.lassoEl.style.display = 'none';
    this.destEl = document.createElement('div');
    this.destEl.className = 'pastel-dest-marker';
    this.destEl.dataset.role = 'destination';
    this.destEl.style.display = 'none';
    this.formationEl = document.createElement('div');
    this.formationEl.className = 'pastel-formation-preview';
    this.formationEl.dataset.role = 'formation';
    this.formationEl.style.display = 'none';
    const style = document.createElement('style');
    style.textContent = `
      .pastel-lasso, .pastel-dest-marker, .pastel-formation-preview {
        position: absolute; pointer-events: none; z-index: 18;
      }
      .pastel-lasso {
        border: 2px dashed rgba(142,227,177,.95); background: rgba(92,225,230,.12);
      }
      .pastel-dest-marker {
        width: 18px; height: 18px; margin-left: -9px; margin-top: -9px;
        border: 2px solid #8ee3b1; border-radius: 50%; background: rgba(224,122,61,.55);
      }
      .pastel-formation-preview {
        border: 2px solid rgba(224,122,61,.9); background: rgba(224,122,61,.18);
        transform-origin: center center;
      }
    `;
    this.host.append(style, this.lassoEl, this.destEl, this.formationEl);
  }

  setCamera(camera: IsometricCamera): void {
    this.camera = camera;
  }

  setLasso(rect: LassoRect | null): void {
    if (!rect) {
      this.lassoEl.style.display = 'none';
      return;
    }
    const origin = this.canvasOffset();
    const left = Math.min(rect.x, rect.x + rect.width);
    const top = Math.min(rect.y, rect.y + rect.height);
    this.lassoEl.style.display = 'block';
    this.lassoEl.style.left = `${String(origin.x + left)}px`;
    this.lassoEl.style.top = `${String(origin.y + top)}px`;
    this.lassoEl.style.width = `${String(Math.abs(rect.width))}px`;
    this.lassoEl.style.height = `${String(Math.abs(rect.height))}px`;
  }

  setDestination(marker: DestinationMarker | null): void {
    this.destination = marker;
    this.destEl.style.display = marker ? 'block' : 'none';
    this.syncWorldOverlays();
  }

  setFormation(preview: FormationPreview | null): void {
    this.formation = preview;
    this.formationEl.style.display = preview ? 'block' : 'none';
    this.syncWorldOverlays();
  }

  update(): void {
    this.syncWorldOverlays();
  }

  dispose(): void {
    this.lassoEl.remove();
    this.destEl.remove();
    this.formationEl.remove();
  }

  private canvasOffset(): { x: number; y: number } {
    const canvasRect = this.canvas.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    return { x: canvasRect.left - hostRect.left, y: canvasRect.top - hostRect.top };
  }

  private project(worldX: number, worldZ: number): { x: number; y: number } | null {
    if (!this.camera) {
      return null;
    }
    _world.set(worldX, 0, worldZ);
    _ndc.copy(_world).project(this.camera.camera);
    const viewport = this.camera.getViewport();
    return {
      x: (_ndc.x * 0.5 + 0.5) * viewport.width,
      y: (-_ndc.y * 0.5 + 0.5) * viewport.height,
    };
  }

  private syncWorldOverlays(): void {
    const origin = this.canvasOffset();
    if (this.destination) {
      const screen = this.project(this.destination.x, this.destination.z);
      if (screen) {
        this.destEl.style.left = `${String(origin.x + screen.x)}px`;
        this.destEl.style.top = `${String(origin.y + screen.y)}px`;
      }
    }
    if (this.formation) {
      const dest = this.project(this.formation.destination.x, this.formation.destination.z);
      if (!dest) {
        return;
      }
      const width = Math.max(24, this.formation.widthWorld * 12);
      const height = this.formation.kind === 'box' ? Math.max(24, width * 0.65) : 16;
      this.formationEl.style.left = `${String(origin.x + dest.x - width / 2)}px`;
      this.formationEl.style.top = `${String(origin.y + dest.y - height / 2)}px`;
      this.formationEl.style.width = `${String(width)}px`;
      this.formationEl.style.height = `${String(height)}px`;
      this.formationEl.style.transform = `rotate(${String(this.formation.facingRadians)}rad)`;
    }
  }
}
