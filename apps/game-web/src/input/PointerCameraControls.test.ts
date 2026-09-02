// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IsometricCamera } from '../camera/IsometricCamera';
import { PointerCameraControls } from './PointerCameraControls';

beforeAll(() => {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class TestPointerEvent extends Event {
      pointerId: number;
      pointerType: string;
      clientX: number;
      clientY: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
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
    ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  document.body.append(canvas);
  return canvas;
}

function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: PointerEventInit,
): void {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

describe('pointer camera controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps look-at stable when lifting one finger from a pinch', () => {
    const canvas = fakeCanvas();
    const camera = new IsometricCamera();
    camera.setViewport(800, 500);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(80, 80);
    const controls = new PointerCameraControls(canvas, camera);

    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    pointer(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    pointer(canvas, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 560, clientY: 240 });
    const duringPinch = { x: camera.lookAt.x, z: camera.lookAt.z };
    window.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'touch', clientX: 560, clientY: 240 }),
    );
    expect(Math.hypot(camera.lookAt.x - duringPinch.x, camera.lookAt.z - duringPinch.z)).toBeLessThan(1.5);
    controls.dispose();
  });

  it('does not let a Pencil pointer steal a two-finger pinch', () => {
    const canvas = fakeCanvas();
    const camera = new IsometricCamera();
    camera.setViewport(800, 500);
    camera.applyNamedPreset('70-percent');
    const controls = new PointerCameraControls(canvas, camera);
    pointer(canvas, 'pointerdown', { pointerId: 9, pointerType: 'pen', clientX: 100, clientY: 100 });
    pointer(canvas, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 240 });
    pointer(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 240 });
    expect(controls.getDebugSnapshot().gesture).toBe('pinch');
    expect(controls.getDebugSnapshot().pointers.some((p) => p.type === 'pen')).toBe(true);
    controls.dispose();
  });
});
