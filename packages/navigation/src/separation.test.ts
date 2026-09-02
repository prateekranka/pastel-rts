import { createEntityId } from '@pastel-rts/content-schema';
import { describe, expect, it } from 'vitest';

import { NavigationGrid } from './grid';
import { applyLocalSeparation, separationRespectsBlockers } from './separation';

describe('local separation', () => {
  it('does not push units through blockers', () => {
    const grid = new NavigationGrid();
    grid.resize(8, 8);
    grid.setBlocked(4, 4, true);
    grid.setBlocked(4, 5, true);
    grid.setBlocked(5, 4, true);
    grid.setBlocked(5, 5, true);

    const units = [
      {
        entityId: createEntityId(0, 1),
        position: { x: 3 * 1024 + 900, z: 4 * 1024 + 512 },
        radiusSubunits: 400,
      },
      {
        entityId: createEntityId(1, 1),
        position: { x: 3 * 1024 + 100, z: 4 * 1024 + 512 },
        radiusSubunits: 400,
      },
    ];

    const results = applyLocalSeparation(grid, units, 4);
    expect(separationRespectsBlockers(grid, results)).toBe(true);
    for (const result of results) {
      const cx = Math.floor(result.position.x / 1024);
      const cz = Math.floor(result.position.z / 1024);
      expect(grid.isWalkable(cx, cz)).toBe(true);
    }
  });

  it('is deterministic for a fixed unit ordering', () => {
    const grid = new NavigationGrid();
    grid.resize(12, 12);

    const units = [
      { entityId: createEntityId(0, 1), position: { x: 5120, z: 5120 }, radiusSubunits: 300 },
      { entityId: createEntityId(1, 1), position: { x: 5200, z: 5120 }, radiusSubunits: 300 },
      { entityId: createEntityId(2, 1), position: { x: 5160, z: 5180 }, radiusSubunits: 300 },
    ];

    const first = applyLocalSeparation(grid, units, 3);
    const second = applyLocalSeparation(grid, units, 3);
    expect(first.map((r) => r.position)).toEqual(second.map((r) => r.position));
  });
});
