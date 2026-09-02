// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { IsometricCamera } from '../camera/IsometricCamera';
import { MIN_FINGER_RADIUS_CSS, MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';
import { HitTestService, meetsMinimumTouchTarget } from './HitTestService';
import type { PickableEntity } from './types';

function fakeRect(): DOMRectReadOnly {
  return {
    left: 0,
    top: 0,
    width: 800,
    height: 500,
    right: 800,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('HitTestService', () => {
  it('minimum hit target remains finger-friendly', () => {
    expect(MIN_FINGER_RADIUS_CSS * 2).toBe(MIN_TOUCH_TARGET_CSS);
    expect(meetsMinimumTouchTarget(MIN_FINGER_RADIUS_CSS)).toBe(true);
    expect(meetsMinimumTouchTarget(MIN_FINGER_RADIUS_CSS - 1)).toBe(false);
  });

  it('picks entity when pointer is within expanded finger radius', () => {
    const camera = new IsometricCamera();
    camera.setViewport(800, 500);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(80, 80);

    const entities: PickableEntity[] = [
      {
        id: { index: 0, generation: 1 },
        archetypeId: 'a',
        kind: 'unit',
        relationship: 'friendly',
        x: 80,
        z: 80,
        selectionRadius: 0.6,
      },
    ];

    const hitTest = new HitTestService();
    const pick = hitTest.pickAt({ x: 400, y: 250 }, entities, camera, fakeRect(), {
      minRadiusCss: MIN_FINGER_RADIUS_CSS,
    });
    expect(pick?.entity.id.index).toBe(0);
  });
});
