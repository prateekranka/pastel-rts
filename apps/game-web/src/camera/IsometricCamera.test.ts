import { describe, expect, it } from 'vitest';
import {
  CHUNK_CELLS,
  CHUNK_COUNT,
  MAP_CELLS,
  PRESET_70_VISIBLE_CELLS_X,
} from '../config/constants';
import { IsometricCamera, isPresetViewBounded } from './IsometricCamera';

describe('IsometricCamera 70-percent preset', () => {
  it('keeps a bounded valid view matching the named framing', () => {
    const camera = new IsometricCamera();
    camera.setViewport(1280, 800);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(80, 80);

    const view = camera.getGroundView();
    expect(view.cellsX).toBeGreaterThan(PRESET_70_VISIBLE_CELLS_X - 2);
    expect(view.cellsX).toBeLessThan(PRESET_70_VISIBLE_CELLS_X + 2);
    expect(isPresetViewBounded(view, 1280 / 800)).toBe(true);
    expect(view.width).toBeLessThan(MAP_CELLS);
    expect(view.depth).toBeLessThan(MAP_CELLS);
    expect(view.maxX - view.minX).toBeGreaterThan(30);
  });

  it('does not rotate; aspect-only resize preserves world scale', () => {
    const camera = new IsometricCamera();
    camera.setViewport(1280, 800);
    camera.applyNamedPreset('70-percent');
    const before = camera.camera.rotation.clone();
    const cellsBefore = camera.getVisibleCellsX();

    camera.setViewport(1600, 900);
    expect(camera.camera.rotation.x).toBeCloseTo(before.x, 8);
    expect(camera.camera.rotation.y).toBeCloseTo(before.y, 8);
    expect(camera.camera.rotation.z).toBeCloseTo(before.z, 8);
    expect(camera.getVisibleCellsX()).toBe(cellsBefore);

    const view = camera.getGroundView();
    expect(view.cellsX).toBeGreaterThan(PRESET_70_VISIBLE_CELLS_X - 2);
    expect(view.cellsX).toBeLessThan(PRESET_70_VISIBLE_CELLS_X + 2);
  });

  it('clamps look-at so the battlefield cannot be panned away', () => {
    const camera = new IsometricCamera();
    camera.setViewport(1280, 800);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(-400, -400);
    expect(camera.lookAt.x).toBeGreaterThan(0);
    expect(camera.lookAt.z).toBeGreaterThan(0);
    camera.setLookAt(900, 900);
    expect(camera.lookAt.x).toBeLessThan(MAP_CELLS);
    expect(camera.lookAt.z).toBeLessThan(MAP_CELLS);
  });
});

describe('map chunk layout', () => {
  it('is 160 cells with 10×10 chunks of 16', () => {
    expect(MAP_CELLS).toBe(160);
    expect(CHUNK_CELLS).toBe(16);
    expect(CHUNK_COUNT).toBe(10);
  });
});
