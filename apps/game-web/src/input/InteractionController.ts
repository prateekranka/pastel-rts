import { worldFloatToSubunit, type EntityId } from '@pastel-rts/content-schema';
import type { IsometricCamera } from '../camera/IsometricCamera';
import type { PointerCameraControls } from '../input/PointerCameraControls';
import {
  DOUBLE_TAP_MS,
  LONG_PRESS_MS,
  PAN_THRESHOLD_CSS,
  TAP_MOVE_THRESHOLD_CSS,
} from './gestureConstants';
import type { CommandClient } from './CommandClient';
import { HitTestService } from '../selection/HitTestService';
import { SelectionController } from '../selection/SelectionController';
import type {
  DestinationMarker,
  FormationPreview,
  LassoRect,
  PickableEntity,
} from '../selection/types';

type PointerTrack = {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
  movedPastTap: boolean;
  movedPastPan: boolean;
};

export type InteractionControllerOptions = {
  canvas: HTMLCanvasElement;
  camera: IsometricCamera;
  cameraControls: PointerCameraControls;
  selection: SelectionController;
  commandClient: CommandClient;
  hitTest?: HitTestService;
  getEntities: () => readonly PickableEntity[];
  getCurrentTick: () => number;
  /** When true, pointer began on a UI element — battlefield commands are suppressed. */
  isUiPointerTarget?: (target: EventTarget | null) => boolean;
  requestHaptic?: (style: 'light' | 'medium' | 'heavy') => void;
  onDestinationMarker?: (marker: DestinationMarker | null) => void;
  onFormationPreview?: (preview: FormationPreview | null) => void;
  onLassoRect?: (rect: LassoRect | null) => void;
  /** Explicit select mode makes lasso easier on touch. */
  selectModeActive?: () => boolean;
};

type Listener = {
  type: string;
  target: EventTarget;
  handler: EventListener;
  options?: AddEventListenerOptions;
};

/**
 * Central gesture arbitration for tap-select, lasso, move commands, and
 * formation drags. Coordinates with {@link PointerCameraControls} via its
 * debug snapshot and setEnabled — does not rewrite pan/pinch logic.
 */
export class InteractionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: IsometricCamera;
  private readonly cameraControls: PointerCameraControls;
  private readonly selection: SelectionController;
  private readonly commandClient: CommandClient;
  private readonly hitTest: HitTestService;
  private readonly getEntities: () => readonly PickableEntity[];
  private readonly getCurrentTick: () => number;
  private readonly isUiPointerTarget: (target: EventTarget | null) => boolean;
  private readonly requestHaptic: (style: 'light' | 'medium' | 'heavy') => void;
  private readonly onDestinationMarker: (marker: DestinationMarker | null) => void;
  private readonly onFormationPreview: (preview: FormationPreview | null) => void;
  private readonly onLassoRect: (rect: LassoRect | null) => void;
  private readonly selectModeActive: () => boolean;

  private readonly pointers = new Map<number, PointerTrack>();
  private readonly listeners: Listener[] = [];
  private enabled = true;
  private activePointerId: number | null = null;
  private uiCaptured = false;
  private sawPinch = false;
  private touchPointerCount = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lassoActive = false;
  private formationActive = false;
  private lastTapTime = 0;
  private lastTapEntityKey: string | null = null;
  private cameraDisabledForGesture = false;

  constructor(options: InteractionControllerOptions) {
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.cameraControls = options.cameraControls;
    this.selection = options.selection;
    this.commandClient = options.commandClient;
    this.hitTest = options.hitTest ?? new HitTestService();
    this.getEntities = options.getEntities;
    this.getCurrentTick = options.getCurrentTick;
    this.isUiPointerTarget = options.isUiPointerTarget ?? (() => false);
    this.requestHaptic = options.requestHaptic ?? (() => undefined);
    this.onDestinationMarker = options.onDestinationMarker ?? (() => undefined);
    this.onFormationPreview = options.onFormationPreview ?? (() => undefined);
    this.onLassoRect = options.onLassoRect ?? (() => undefined);
    this.selectModeActive = options.selectModeActive ?? (() => false);

    this.bind(this.canvas, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    this.bind(this.canvas, 'pointermove', (event) => this.onPointerMove(event as PointerEvent));
    this.bind(window, 'pointerup', (event) => this.onPointerUp(event as PointerEvent));
    this.bind(window, 'pointercancel', (event) => this.onPointerUp(event as PointerEvent));
    this.bind(this.canvas, 'contextmenu', (event) => this.onContextMenu(event as MouseEvent));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  dispose(): void {
    this.clearLongPressTimer();
    for (const listener of this.listeners) {
      listener.target.removeEventListener(listener.type, listener.handler, listener.options);
    }
    this.listeners.length = 0;
    this.pointers.clear();
    this.restoreCamera();
  }

  /** Exposed for tests — last classified gesture label. */
  lastGestureLabel: string | null = null;

  /** Exposed for tests — commands issued during the last pointer cycle. */
  readonly issuedCommands: Array<{ kind: string; entityCount: number }> = [];

  private onPointerDown(event: PointerEvent): void {
    if (!this.enabled) {
      return;
    }
    if (this.isUiPointerTarget(event.target)) {
      this.uiCaptured = true;
      return;
    }
    this.uiCaptured = false;
    if (event.pointerType === 'touch') {
      this.touchPointerCount += 1;
    }
    if (this.touchPointerCount >= 2 || this.cameraControls.getDebugSnapshot().gesture === 'pinch') {
      this.sawPinch = true;
    }
    const rect = this.canvasRect();
    const track: PointerTrack = {
      id: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      startTime: performance.now(),
      movedPastTap: false,
      movedPastPan: false,
    };
    this.pointers.set(event.pointerId, track);
    if (this.activePointerId === null) {
      this.activePointerId = event.pointerId;
      this.scheduleLongPress(event.pointerId);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const track = this.pointers.get(event.pointerId);
    if (!track || !this.enabled) {
      return;
    }
    const rect = this.canvasRect();
    track.x = event.clientX - rect.left;
    track.y = event.clientY - rect.top;
    const dist = Math.hypot(track.x - track.startX, track.y - track.startY);
    if (dist > TAP_MOVE_THRESHOLD_CSS) {
      track.movedPastTap = true;
    }
    if (dist > PAN_THRESHOLD_CSS) {
      track.movedPastPan = true;
      this.clearLongPressTimer();
    }
    if (this.cameraControls.getDebugSnapshot().gesture === 'pinch') {
      this.sawPinch = true;
    }

    if (event.pointerId !== this.activePointerId) {
      return;
    }

    if (this.lassoActive) {
      this.onLassoRect(this.lassoRectFromTrack(track));
      return;
    }

    if (this.formationActive) {
      this.updateFormationPreview(track);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.isUiPointerTarget(event.target)) {
      this.uiCaptured = false;
    }
    if (event.pointerType === 'touch') {
      this.touchPointerCount = Math.max(0, this.touchPointerCount - 1);
    }
    const track = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (!track || !this.enabled) {
      return;
    }

    const wasActive = event.pointerId === this.activePointerId;
    if (wasActive) {
      this.clearLongPressTimer();
    }

    if (this.uiCaptured) {
      this.finishPointerCycle();
      return;
    }

    if (wasActive) {
      if (this.lassoActive) {
        this.commitLasso(track);
      } else if (this.formationActive) {
        this.commitFormation(track);
      } else {
        this.classifyTap(track, event);
      }
    }

    if (this.pointers.size === 0) {
      this.finishPointerCycle();
    } else if (wasActive) {
      const next = this.pointers.values().next().value as PointerTrack | undefined;
      this.activePointerId = next?.id ?? null;
    }
  }

  private onContextMenu(event: MouseEvent): void {
    if (!this.enabled || this.uiCaptured) {
      return;
    }
    event.preventDefault();
    const selected = this.selection.getSelected();
    if (selected.length === 0) {
      return;
    }
    const rect = this.canvasRect();
    const ground = this.groundAt(event.clientX - rect.left, event.clientY - rect.top);
    if (!ground) {
      return;
    }
    this.issueMove(selected, ground.x, ground.z);
    this.lastGestureLabel = 'right-click-move';
  }

  private classifyTap(track: PointerTrack, event: PointerEvent): void {
    const dist = Math.hypot(track.x - track.startX, track.y - track.startY);
    const cameraGesture = this.cameraControls.getDebugSnapshot().gesture;
    const isPanClass = track.movedPastPan || (cameraGesture === 'pan' && dist > PAN_THRESHOLD_CSS);
    if (this.sawPinch || cameraGesture === 'pinch') {
      this.lastGestureLabel = 'pinch-ignored';
      return;
    }
    if (isPanClass) {
      this.lastGestureLabel = 'pan';
      return;
    }
    if (dist > TAP_MOVE_THRESHOLD_CSS) {
      this.lastGestureLabel = 'drag-no-command';
      return;
    }

    const additive = track.pointerType === 'mouse' && event.shiftKey;
    const entity = this.pickEntity(track.x, track.y);
    const now = performance.now();

    if (entity) {
      const key = `${entity.id.index}:${entity.id.generation}`;
      const isDoubleTap =
        now - this.lastTapTime <= DOUBLE_TAP_MS && this.lastTapEntityKey === key;
      this.lastTapTime = now;
      this.lastTapEntityKey = key;
      if (isDoubleTap) {
        this.selection.selectSameArchetype(entity, this.getEntities());
        this.lastGestureLabel = 'double-tap-select';
      } else {
        if (additive) {
          this.selection.toggle(entity.id);
        } else {
          this.selection.select(entity.id, false);
        }
        this.lastGestureLabel = 'tap-select';
      }
      this.requestHaptic('light');
      return;
    }

    this.lastTapTime = now;
    this.lastTapEntityKey = null;
    const selected = this.selection.getSelected();
    if (selected.length > 0) {
      const ground = this.groundAt(track.x, track.y);
      if (ground) {
        this.issueMove(selected, ground.x, ground.z);
        this.onDestinationMarker({ x: ground.x, z: ground.z });
        this.requestHaptic('medium');
        this.lastGestureLabel = 'tap-move';
      }
      return;
    }

    if (track.pointerType === 'mouse' && track.movedPastTap) {
      this.commitMarquee(track);
      return;
    }

    this.lastGestureLabel = 'tap-empty';
  }

  private commitMarquee(track: PointerTrack): void {
    const rect = this.lassoRectFromTrack(track);
    const friendlies = this.hitTest
      .entitiesInLasso(rect, this.getEntities(), this.camera, this.canvasRect(), (entity) =>
        entity.relationship === 'friendly' && entity.kind === 'unit',
      )
      .map((entity) => entity.id);
    if (friendlies.length > 0) {
      this.selection.selectMany(friendlies, false);
      this.lastGestureLabel = 'marquee-select';
    }
  }

  private scheduleLongPress(pointerId: number): void {
    this.clearLongPressTimer();
    this.longPressTimer = setTimeout(() => {
      const track = this.pointers.get(pointerId);
      if (!track || track.movedPastTap) {
        return;
      }
      const onUnit = this.pickEntity(track.startX, track.startY);
      const hasSelection = this.selection.getSelected().length > 0;
      if (onUnit && !this.selectModeActive()) {
        return;
      }
      if (hasSelection && !onUnit) {
        this.formationActive = true;
        this.disableCamera();
        this.updateFormationPreview(track);
        this.lastGestureLabel = 'formation-start';
        return;
      }
      if (!onUnit || this.selectModeActive()) {
        this.lassoActive = true;
        this.disableCamera();
        this.onLassoRect(this.lassoRectFromTrack(track));
        this.lastGestureLabel = 'lasso-start';
      }
    }, LONG_PRESS_MS);
  }

  private commitLasso(track: PointerTrack): void {
    const rect = this.lassoRectFromTrack(track);
    const friendlies = this.hitTest
      .entitiesInLasso(rect, this.getEntities(), this.camera, this.canvasRect(), (entity) =>
        entity.relationship === 'friendly' && entity.kind === 'unit',
      )
      .map((entity) => entity.id);
    if (friendlies.length > 0) {
      this.selection.selectMany(friendlies, false);
      this.requestHaptic('light');
    }
    this.lassoActive = false;
    this.onLassoRect(null);
    this.lastGestureLabel = 'lasso-select';
  }

  private beginFormation(track: PointerTrack): void {
    void track;
    if (this.formationActive) {
      return;
    }
    this.formationActive = true;
    this.disableCamera();
    this.updateFormationPreview(track);
    this.lastGestureLabel = 'formation-start';
  }

  private updateFormationPreview(track: PointerTrack): void {
    const startGround = this.groundAt(track.startX, track.startY);
    const endGround = this.groundAt(track.x, track.y);
    if (!startGround || !endGround) {
      return;
    }
    const dx = endGround.x - startGround.x;
    const dz = endGround.z - startGround.z;
    const facingRadians = Math.atan2(dx, dz);
    const widthWorld = Math.max(1, Math.hypot(dx, dz));
    this.onFormationPreview({
      destination: { x: endGround.x, z: endGround.z },
      facingRadians,
      widthWorld,
      kind: widthWorld > 4 ? 'box' : 'line',
    });
  }

  private commitFormation(track: PointerTrack): void {
    const selected = this.selection.getSelected();
    const endGround = this.groundAt(track.x, track.y);
    if (selected.length > 0 && endGround) {
      const startGround = this.groundAt(track.startX, track.startY);
      const dx = startGround ? endGround.x - startGround.x : 0;
      const dz = startGround ? endGround.z - startGround.z : 1;
      const widthWorld = Math.max(1, Math.hypot(dx, dz));
      this.commandClient.issueMove({
        entityIds: selected,
        destination: {
          x: worldFloatToSubunit(endGround.x),
          z: worldFloatToSubunit(endGround.z),
        },
        issuedAtTick: this.getCurrentTick(),
        executeTick: this.getCurrentTick(),
        formation: {
          kind: widthWorld > 4 ? 'box' : 'line',
          spacingSubunits: 512,
        },
      });
      this.recordCommand('move', selected.length);
      this.onDestinationMarker({ x: endGround.x, z: endGround.z });
      this.requestHaptic('medium');
    }
    this.formationActive = false;
    this.onFormationPreview(null);
    this.lastGestureLabel = 'formation-move';
  }

  private issueMove(entityIds: EntityId[], worldX: number, worldZ: number): void {
    this.commandClient.issueMove({
      entityIds,
      destination: { x: worldFloatToSubunit(worldX), z: worldFloatToSubunit(worldZ) },
      issuedAtTick: this.getCurrentTick(),
      executeTick: this.getCurrentTick(),
    });
    this.recordCommand('move', entityIds.length);
  }

  private recordCommand(kind: string, entityCount: number): void {
    this.issuedCommands.push({ kind, entityCount });
  }

  private pickEntity(localX: number, localY: number): PickableEntity | null {
    return this.hitTest.pickAt({ x: localX, y: localY }, this.getEntities(), this.camera, this.canvasRect())
      ?.entity ?? null;
  }

  private groundAt(localX: number, localY: number): { x: number; z: number } | null {
    const hit = this.camera.screenToGround(localX, localY);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  private lassoRectFromTrack(track: PointerTrack): LassoRect {
    return {
      x: track.startX,
      y: track.startY,
      width: track.x - track.startX,
      height: track.y - track.startY,
    };
  }

  private canvasRect(): DOMRectReadOnly {
    return this.canvas.getBoundingClientRect();
  }

  private finishPointerCycle(): void {
    this.activePointerId = null;
    this.sawPinch = false;
    this.touchPointerCount = 0;
    this.lassoActive = false;
    this.formationActive = false;
    this.onLassoRect(null);
    this.onFormationPreview(null);
    this.restoreCamera();
    this.uiCaptured = false;
  }

  private disableCamera(): void {
    if (!this.cameraDisabledForGesture) {
      this.cameraControls.setEnabled(false);
      this.cameraDisabledForGesture = true;
    }
  }

  private restoreCamera(): void {
    if (this.cameraDisabledForGesture) {
      this.cameraControls.setEnabled(true);
      this.cameraDisabledForGesture = false;
    }
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
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
