import { describe, expect, it } from 'vitest';
import { createEntityId } from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { getBenchmarkPreset, M1_BENCHMARK_PRESETS } from './benchmarks';

describe('M1 movement and pathfinding benchmarks', () => {
  it('exposes the required lab presets', () => {
    expect(M1_BENCHMARK_PRESETS.map((preset) => preset.id)).toEqual(
      expect.arrayContaining([
        '120-unit-crossing',
        '40-unit-formation',
        'dynamic-blocker-replan',
        'selection-stress',
        'animation-stress',
      ]),
    );
    expect(getBenchmarkPreset('40-unit-formation')?.unitCount).toBe(40);
  });

  it('paths 40 units on 160x160 within a desktop budget', () => {
    const nav = new NavigationService(160, 160);
    nav.setFootprintBlocked({ cx: 70, cz: 70 }, 12, 8, true);
    const started = performance.now();
    for (let index = 0; index < 40; index += 1) {
      const id = createEntityId(index, 1);
      nav.requestPath(
        id,
        { x: (8 + (index % 8)) * 1024, z: (8 + Math.floor(index / 8)) * 1024 },
        { x: (140 - (index % 8)) * 1024, z: (140 - Math.floor(index / 8)) * 1024 },
      );
    }
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(2_000);
    const debug = nav.debugSnapshot();
    expect(debug.paths.length).toBe(40);
    const goals = new Set(
      debug.paths.map((path) => {
        const last = path.cells[path.cells.length - 1];
        return last ? `${String(last.cx)},${String(last.cz)}` : '';
      }),
    );
    expect(goals.size).toBeGreaterThan(1);
  });
});
