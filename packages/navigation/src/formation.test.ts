import { createEntityId } from '@pastel-rts/content-schema';
import { describe, expect, it } from 'vitest';

import { NavigationGrid } from './grid';
import { formationSlotCellsUnique, planFormationSlots } from './formation';

describe('formation planning', () => {
  it('assigns unique slots for line formation', () => {
    const grid = new NavigationGrid();
    grid.resize(16, 16);

    const entityIds = [
      createEntityId(2, 1),
      createEntityId(0, 1),
      createEntityId(1, 1),
    ];
    const destination = { x: 8 * 1024 + 512, z: 8 * 1024 + 512 };
    const slots = planFormationSlots(grid, {
      entityIds,
      destination,
      kind: 'line',
      spacingSubunits: 512,
    });

    expect(slots).toHaveLength(3);
    expect(formationSlotCellsUnique(slots, grid)).toBe(true);
  });

  it('assigns slots deterministically regardless of input entity order', () => {
    const grid = new NavigationGrid();
    grid.resize(16, 16);
    const destination = { x: 8 * 1024 + 512, z: 8 * 1024 + 512 };

    const idsA = [createEntityId(2, 1), createEntityId(0, 1), createEntityId(1, 1)];
    const idsB = [createEntityId(0, 1), createEntityId(1, 1), createEntityId(2, 1)];

    const slotsA = planFormationSlots(grid, { entityIds: idsA, destination, kind: 'box' });
    const slotsB = planFormationSlots(grid, { entityIds: idsB, destination, kind: 'box' });

    expect(slotsA.map((s) => s.target)).toEqual(slotsB.map((s) => s.target));
    expect(slotsA.map((s) => s.entityId)).toEqual(slotsB.map((s) => s.entityId));
  });

  it('projects slots off blockers to nearby legal cells', () => {
    const grid = new NavigationGrid();
    grid.resize(16, 16);
    grid.setBlocked(8, 8, true);
    grid.setBlocked(9, 8, true);

    const slots = planFormationSlots(grid, {
      entityIds: [createEntityId(0, 1), createEntityId(1, 1)],
      destination: { x: 8 * 1024 + 512, z: 8 * 1024 + 512 },
      kind: 'line',
      spacingSubunits: 1024,
    });

    expect(formationSlotCellsUnique(slots, grid)).toBe(true);
    for (const slot of slots) {
      const cx = Math.floor(slot.target.x / 1024);
      const cz = Math.floor(slot.target.z / 1024);
      expect(grid.isWalkable(cx, cz)).toBe(true);
    }
  });

  it('classifies buildable vs non-buildable walkable terrain', () => {
    const grid = new NavigationGrid();
    grid.resize(8, 8);
    grid.setNonBuildableWalkable(3, 3, true);

    expect(grid.classifyCell(3, 3)).toBe('non-buildable-walkable');
    expect(grid.isWalkable(3, 3)).toBe(true);
    expect(grid.isBuildable(3, 3)).toBe(false);
    expect(grid.classifyCell(2, 2)).toBe('buildable');
  });
});
