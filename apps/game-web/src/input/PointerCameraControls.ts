import { Vector3 } from 'three';
import {
  DEFAULT_ZOOM_STOP,
  MAX_VISIBLE_CELLS_X,
  MIN_VISIBLE_CELLS_X,
  type ZoomStopName,
} from '../config/constants';
import type { IsometricCamera } from '../camera/IsometricCamera';

type PointerRecord = {
  id: number;
  type: string;
  x: number;
  y: number;
};

export type GestureState = 'idle' | 'pan' | 'pinch';

export type TouchDebugSnapshot = {
  pointers: Array<{ id: number; type: string; x: number; y: number }>;
  gesture: GestureState;
  lookAtX: number;
  lookAtZ: number;
  zoomCells: number;
  zoomStop: ZoomStopName;
  recentPanDelta: { x: number; z: number };
  recentPinchScale: number;
};

type Listener = {
  type: string;
  target: EventTarget;
  handler: EventListener;
  options?: AddEventListenerOptions;
};

/**
 * Pointer Events camera: one-finger pan, two-finger pinch, mouse drag + wheel.
 * Lifting one finger during pinch becomes a pan without a look-at jump.
 */
export class PointerCameraControls {
  private readonly pointers = new Map<number, PointerRecord>();
  private gesture: GestureState = 'idle';
  private panLastGround = new Vector3();
  private pinchStartDistance = 0;
  private pinchStartCells = 44;
  private pinchMidGround = new Vector3();
  private recentPanDelta = { x: 0, z: 0 };
  private recentPinchScale = 1;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Listener[] = [];
  private enabled = true;
  private lastDebug: TouchDebugSnapshot | null = null;
  private readonly _scratch = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: IsometricCamera,
  ) {
    this.bind(canvas, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    this.bind(canvas, 'pointermove', (event) => this.onPointerMove(event as PointerEvent));
    this.bind(window, 'pointerup', (event) => this.onPointerUp(event as PointerEvent));
    this.bind(window, 'pointercancel', (event) => this.onPointerUp(event as PointerEvent));
    this.bind(canvas, 'wheel', (event) => this.onWheel(event as WheelEvent), { passive: false });
    this.bind(canvas, 'contextmenu', (event) => event.preventDefault());
    this.bind(canvas, 'dragstart', (event) => event.preventDefault());
    this.bind(canvas, 'gesturestart', (event) => event.preventDefault());
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  dispose(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
    }
    for (const listener of this.listeners) {
      listener.target.removeEventListener(listener.type, listener.handler, listener.options);
    }
    this.listeners.length = 0;
    this.pointers.clear();
  }

  getDebugSnapshot(): TouchDebugSnapshot {
    return (
      this.lastDebug ?? {
        pointers: [],
        gesture: this.gesture,
        lookAtX: this.camera.lookAt.x,
        lookAtZ: this.camera.lookAt.z,
        zoomCells: this.camera.getVisibleCellsX(),
        zoomStop: this.camera.nearestZoomStop(),
        recentPanDelta: { ...this.recentPanDelta },
        recentPinchScale: this.recentPinchScale,
      }
    );
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.enabled) {
      return;
    }
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      type: event.pointerType,
      x: event.clientX,
      y: event.clientY,
    });
    this.recomputeGesture(event);
    this.publishDebug();
  }

  private onPointerMove(event: PointerEvent): void {
    const record = this.pointers.get(event.pointerId);
    if (!record || !this.enabled) {
      return;
    }
    event.preventDefault();
    record.x = event.clientX;
    record.y = event.clientY;
    if (this.gesture === 'pinch') {
      this.updatePinch();
    } else if (this.gesture === 'pan') {
      this.updatePan(record);
    }
    this.publishDebug();
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    this.pointers.delete(event.pointerId);
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released.
    }
    this.recomputeGesture(event);
    if (this.gesture === 'idle') {
      this.queueZoomSettle();
    }
    this.publishDebug();
  }

  private onWheel(event: WheelEvent): void {
    if (!this.enabled) {
      return;
    }
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const before = this.camera.screenToGround(localX, localY, this._scratch.clone());
    const direction = event.deltaY > 0 ? 1.08 : 0.92;
    this.camera.setVisibleCellsX(this.camera.getVisibleCellsX() * direction);
    if (before) {
      const after = this.camera.screenToGround(localX, localY, this._scratch);
      if (after) {
        this.camera.panByGroundDelta(before.x - after.x, before.z - after.z);
      }
    }
    this.recentPinchScale = direction;
    this.queueZoomSettle();
    this.publishDebug();
  }

  private recomputeGesture(_event: PointerEvent): void {
    const touches = [...this.pointers.values()].filter((pointer) => pointer.type !== 'pen');
    const pens = [...this.pointers.values()].filter((pointer) => pointer.type === 'pen');
    const panCandidates = touches.length > 0 ? touches : pens;

    if (touches.length >= 2) {
      this.gesture = 'pinch';
      this.beginPinch(touches[0]!, touches[1]!);
      return;
    }
    if (panCandidates.length === 1) {
      const pointer = panCandidates[0]!;
      const wasPinch = this.gesture === 'pinch';
      this.gesture = 'pan';
      this.beginPan(pointer, wasPinch);
      return;
    }
    this.gesture = 'idle';
  }

  private beginPan(pointer: PointerRecord, fromPinch: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    const ground = this.camera.screenToGround(pointer.x - rect.left, pointer.y - rect.top);
    if (ground) {
      this.panLastGround.copy(ground);
    }
    if (!fromPinch) {
      this.recentPanDelta = { x: 0, z: 0 };
    }
  }

  private updatePan(pointer: PointerRecord): void {
    const rect = this.canvas.getBoundingClientRect();
    const ground = this.camera.screenToGround(pointer.x - rect.left, pointer.y - rect.top);
    if (!ground) {
      return;
    }
    const dx = this.panLastGround.x - ground.x;
    const dz = this.panLastGround.z - ground.z;
    this.camera.panByGroundDelta(dx, dz);
    this.recentPanDelta = { x: dx, z: dz };
    const next = this.camera.screenToGround(pointer.x - rect.left, pointer.y - rect.top);
    if (next) {
      this.panLastGround.copy(next);
    }
  }

  private beginPinch(a: PointerRecord, b: PointerRecord): void {
    this.pinchStartDistance = distance(a, b);
    this.pinchStartCells = this.camera.getVisibleCellsX();
    const rect = this.canvas.getBoundingClientRect();
    const mid = this.camera.screenToGround(
      (a.x + b.x) / 2 - rect.left,
      (a.y + b.y) / 2 - rect.top,
    );
    if (mid) {
      this.pinchMidGround.copy(mid);
    }
    this.recentPinchScale = 1;
  }

  private updatePinch(): void {
    const touches = [...this.pointers.values()].filter((pointer) => pointer.type !== 'pen');
    if (touches.length < 2) {
      return;
    }
    const a = touches[0]!;
    const b = touches[1]!;
    const dist = distance(a, b);
    if (this.pinchStartDistance <= 1) {
      return;
    }
    const scale = dist / this.pinchStartDistance;
    this.recentPinchScale = scale;
    const nextCells = clamp(
      this.pinchStartCells / scale,
      MIN_VISIBLE_CELLS_X,
      MAX_VISIBLE_CELLS_X,
    );
    const rect = this.canvas.getBoundingClientRect();
    this.camera.setVisibleCellsX(nextCells);
    const mid = this.camera.screenToGround(
      (a.x + b.x) / 2 - rect.left,
      (a.y + b.y) / 2 - rect.top,
    );
    if (mid) {
      this.camera.panByGroundDelta(this.pinchMidGround.x - mid.x, this.pinchMidGround.z - mid.z);
    }
  }

  private queueZoomSettle(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => {
      this.camera.settleToNearestStop();
      this.settleTimer = null;
      this.publishDebug();
    }, 140);
  }

  private publishDebug(): void {
    this.lastDebug = {
      pointers: [...this.pointers.values()].map((pointer) => ({ ...pointer })),
      gesture: this.gesture,
      lookAtX: this.camera.lookAt.x,
      lookAtZ: this.camera.lookAt.z,
      zoomCells: this.camera.getVisibleCellsX(),
      zoomStop: this.camera.nearestZoomStop() ?? DEFAULT_ZOOM_STOP,
      recentPanDelta: { ...this.recentPanDelta },
      recentPinchScale: this.recentPinchScale,
    };
  }

  private bind(
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    const wrapped: EventListener = (event) => handler(event);
    target.addEventListener(type, wrapped, options);
    const listener: Listener = { type, target, handler: wrapped };
    if (options) {
      listener.options = options;
    }
    this.listeners.push(listener);
  }
}

function distance(a: PointerRecord, b: PointerRecord): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
