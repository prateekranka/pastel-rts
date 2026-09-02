// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IsometricCamera } from '../camera/IsometricCamera';
import { PointerCameraControls } from './PointerCameraControls';
import { InteractionController } from './InteractionController';
import { CommandClient, type WorkerCommandPort } from './CommandClient';
import { SelectionController } from '../selection/SelectionController';
import { HitTestService } from '../selection/HitTestService';
import { PAN_THRESHOLD_CSS, TAP_MOVE_THRESHOLD_CSS } from './gestureConstants';
import type { PickableEntity } from '../selection/types';
import { isMatchUiTarget } from '../ui/touchTargets';

beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class TestPointerEvent extends Event {
      pointerId: number;
      pointerType: string;
      clientX: number;
      clientY: number;
      shiftKey: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
        this.shiftKey = init.shiftKey ?? false;
      }
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
});

function fakeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  Object.defineProperty(canvas, 'clientWidth', { value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { value: 500 });
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 800,
      height: 500,
      right: 800,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  document.body.append(canvas);
  return canvas;
}

function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: PointerEventInit,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

function makeEntities(): PickableEntity[] {
  return [
    {
      id: { index: 0, generation: 1 },
      archetypeId: 'spear',
      kind: 'unit',
      relationship: 'friendly',
      x: 80,
      z: 80,
      selectionRadius: 2,
    },
    {
      id: { index: 1, generation: 1 },
      archetypeId: 'spear',
      kind: 'unit',
      relationship: 'friendly',
      x: 82,
      z: 82,
      selectionRadius: 2,
    },
    {
      id: { index: 2, generation: 1 },
      archetypeId: 'spear',
      kind: 'unit',
      relationship: 'opposing',
      x: 84,
      z: 84,
      selectionRadius: 2,
    },
  ];
}

type LabSetup = {
  canvas: HTMLCanvasElement;
  camera: IsometricCamera;
  controls: PointerCameraControls;
  selection: SelectionController;
  commandPort: WorkerCommandPort & { messages: unknown[] };
  interaction: InteractionController;
  haptic: ReturnType<typeof vi.fn>;
};

function createLab(entities = makeEntities()): LabSetup {
  const canvas = fakeCanvas();
  const camera = new IsometricCamera();
  camera.setViewport(800, 500);
  camera.applyNamedPreset('70-percent');
  camera.setLookAt(entities[0]?.x ?? 80, entities[0]?.z ?? 80);
  const controls = new PointerCameraControls(canvas, camera);
  const selection = new SelectionController();
  const commandPort: WorkerCommandPort & { messages: unknown[] } = {
    messages: [],
    postMessage: (message) => {
      commandPort.messages.push(message);
    },
  };
  const commandClient = new CommandClient({ port: commandPort, createCommandId: () => 'test-cmd' });
  const haptic = vi.fn();
  const hitTest = new HitTestService();
  const interaction = new InteractionController({
    canvas,
    camera,
    cameraControls: controls,
    selection,
    commandClient,
    hitTest,
    getEntities: () => entities,
    getCurrentTick: () => 5,
    requestHaptic: haptic,
    isUiPointerTarget: isMatchUiTarget,
  });
  return { canvas, camera, controls, selection, commandPort, interaction, haptic };
}

describe('InteractionController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tap is not classified as pan', () => {
    const { canvas, interaction, selection, haptic } = createLab();
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    expect(interaction.lastGestureLabel).toBe('tap-select');
    expect(selection.getSelected()).toHaveLength(1);
    expect(haptic).toHaveBeenCalledWith('light');
    interaction.dispose();
  });

  it('pan does not emit move command', () => {
    const { canvas, interaction, selection, commandPort } = createLab();
    selection.select({ index: 0, generation: 1 }, false);
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
    pointer(canvas, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 200 + PAN_THRESHOLD_CSS + 4,
      clientY: 200 + PAN_THRESHOLD_CSS + 4,
    });
    pointer(window, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 200 + PAN_THRESHOLD_CSS + 4,
      clientY: 200 + PAN_THRESHOLD_CSS + 4,
    });
    expect(interaction.lastGestureLabel).toBe('pan');
    expect(commandPort.messages).toHaveLength(0);
    interaction.dispose();
  });

  it('pinch does not emit selection', () => {
    const { canvas, interaction, selection } = createLab();
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    pointer(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    pointer(window, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    expect(selection.getSelected()).toHaveLength(0);
    expect(interaction.lastGestureLabel).toBe('pinch-ignored');
    interaction.dispose();
  });

  it('long-press during pinch does not start lasso or disable camera', async () => {
    vi.useFakeTimers();
    const { canvas, interaction, selection, controls } = createLab();
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    pointer(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    await vi.advanceTimersByTimeAsync(500);
    expect(interaction.lastGestureLabel).toBeNull();
    expect(selection.getSelected()).toHaveLength(0);
    pointer(window, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    expect(interaction.lastGestureLabel).toBe('pinch-ignored');
    expect(controls.getDebugSnapshot().gesture).toBe('idle');
    vi.useRealTimers();
    interaction.dispose();
  });

  it('pinch-to-one-finger transition remains stable without selection', () => {
    const { canvas, camera, controls, interaction, selection } = createLab();
    const before = { x: camera.lookAt.x, z: camera.lookAt.z };
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    pointer(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    pointer(canvas, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 560, clientY: 240 });
    pointer(window, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 560, clientY: 240 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    expect(Math.hypot(camera.lookAt.x - before.x, camera.lookAt.z - before.z)).toBeLessThan(2);
    expect(selection.getSelected()).toHaveLength(0);
    expect(controls.getDebugSnapshot().gesture).toBe('idle');
    interaction.dispose();
  });

  it('double-tap selects same archetype friendlies', () => {
    const { canvas, interaction, selection } = createLab();
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    expect(interaction.lastGestureLabel).toBe('double-tap-select');
    expect(selection.getSelected()).toEqual([
      { index: 0, generation: 1 },
      { index: 1, generation: 1 },
    ]);
    interaction.dispose();
  });

  it('lasso selects only eligible friendlies', async () => {
    vi.useFakeTimers();
    const entities = makeEntities();
    const { canvas, interaction, selection } = createLab(entities);
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    await vi.advanceTimersByTimeAsync(500);
    pointer(canvas, 'pointermove', { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 400 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 700, clientY: 400 });
    expect(interaction.lastGestureLabel).toBe('lasso-select');
    expect(selection.getSelected().every((id) => id.index === 0 || id.index === 1)).toBe(true);
    vi.useRealTimers();
    interaction.dispose();
  });

  it('formation drag emits facing in move command', async () => {
    vi.useFakeTimers();
    const { canvas, interaction, selection, commandPort } = createLab();
    selection.select({ index: 0, generation: 1 }, false);
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 300 });
    await vi.advanceTimersByTimeAsync(500);
    pointer(canvas, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100 + PAN_THRESHOLD_CSS + 20,
      clientY: 300,
    });
    pointer(window, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100 + PAN_THRESHOLD_CSS + 40,
      clientY: 280,
    });
    expect(interaction.lastGestureLabel).toBe('formation-move');
    expect(commandPort.messages).toHaveLength(1);
    const msg = commandPort.messages[0] as {
      envelope: { payload: { formation?: { kind: string; facingMilli?: number } } };
    };
    expect(msg.envelope.payload.formation?.kind).toBeDefined();
    expect(msg.envelope.payload.formation?.facingMilli).toEqual(expect.any(Number));
    vi.useRealTimers();
    interaction.dispose();
  });

  it('tap empty terrain with selection issues move when movement stays within tap threshold', () => {
    const { canvas, interaction, selection, commandPort } = createLab();
    selection.select({ index: 0, generation: 1 }, false);
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 300 });
    pointer(window, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 600 + TAP_MOVE_THRESHOLD_CSS - 2,
      clientY: 300,
    });
    expect(interaction.lastGestureLabel).toBe('tap-move');
    expect(commandPort.messages).toHaveLength(1);
    interaction.dispose();
  });

  it('tap selects only friendly units', () => {
    const opposing = makeEntities().filter((entity) => entity.relationship === 'opposing');
    const { canvas, interaction, selection } = createLab(opposing);
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    pointer(window, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250 });
    expect(selection.getSelected()).toHaveLength(0);
    expect(interaction.lastGestureLabel).toBe('tap-empty');
    interaction.dispose();
  });
});

describe('UI pointer isolation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('UI pointer does not leak into battlefield command', () => {
    const { interaction, selection, commandPort } = createLab();
    selection.select({ index: 0, generation: 1 }, false);
    const hud = document.createElement('div');
    hud.className = 'pastel-match-hud';
    const btn = document.createElement('button');
    btn.type = 'button';
    hud.appendChild(btn);
    document.body.appendChild(hud);

    pointer(btn, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 10 });
    pointer(window, 'pointerup', { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 10 });

    expect(commandPort.messages).toHaveLength(0);
    expect(selection.getSelected()).toHaveLength(1);
    interaction.dispose();
  });
});
