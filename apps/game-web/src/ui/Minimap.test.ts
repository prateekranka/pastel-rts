// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IsometricCamera } from '../camera/IsometricCamera';
import { Minimap, buildMinimapMarkers, minimapModelFromCamera } from './Minimap';
import type { PickableEntity } from '../selection/types';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  if (typeof globalThis.PointerEvent === 'undefined') {
    class TestPointerEvent extends Event {
      pointerId: number;
      clientX: number;
      clientY: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
      }
    }
    globalThis.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  }
});

describe('Minimap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('maps client coordinates to world space', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const minimap = new Minimap(host);
    minimap.getElement().getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 132,
        height: 132,
        right: 232,
        bottom: 182,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;
    const world = minimap.clientToWorld(166, 116);
    expect(world.x).toBeCloseTo(80, 0);
    expect(world.z).toBeCloseTo(80, 0);
    minimap.dispose();
  });

  it('tap moves camera via handler without fog', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const minimap = new Minimap(host);
    const onCameraMove = vi.fn();
    minimap.setHandlers({ onCameraMove });
    const el = minimap.getElement();
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 132,
        height: 132,
        right: 132,
        bottom: 132,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      }),
    );
    expect(onCameraMove).toHaveBeenCalled();
    minimap.dispose();
  });

  it('buildMinimapMarkers includes friendly, opposing, and buildings', () => {
    const entities: PickableEntity[] = [
      {
        id: { index: 0, generation: 1 },
        archetypeId: 'a',
        kind: 'unit',
        relationship: 'friendly',
        x: 10,
        z: 20,
        selectionRadius: 0.6,
      },
      {
        id: { index: 1, generation: 1 },
        archetypeId: 'b',
        kind: 'unit',
        relationship: 'opposing',
        x: 30,
        z: 40,
        selectionRadius: 0.6,
      },
      {
        id: { index: 2, generation: 1 },
        archetypeId: 'c',
        kind: 'building',
        relationship: 'friendly',
        x: 50,
        z: 60,
        selectionRadius: 1,
      },
    ];
    const markers = buildMinimapMarkers(entities, [{ cx: 1, cz: 2 }]);
    expect(markers.map((m) => m.kind)).toEqual(['friendly', 'opposing', 'building', 'blocker']);
  });

  it('minimapModelFromCamera exposes viewport dimensions', () => {
    const camera = new IsometricCamera();
    camera.setViewport(800, 500);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(80, 80);
    const model = minimapModelFromCamera(camera, []);
    expect(model.viewCellsX).toBeGreaterThan(0);
    expect(model.cameraLookAtX).toBe(80);
  });
});
