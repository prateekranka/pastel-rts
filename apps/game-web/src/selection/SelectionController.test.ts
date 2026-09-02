import { describe, expect, it } from 'vitest';
import { SelectionController } from './SelectionController';
import type { PickableEntity } from './types';

const unit = (index: number, archetypeId: string, relationship: PickableEntity['relationship']): PickableEntity => ({
  id: { index, generation: 1 },
  archetypeId,
  kind: 'unit',
  relationship,
  x: index,
  z: index,
  selectionRadius: 0.6,
});

describe('SelectionController', () => {
  it('double-tap selects same archetype visible friendlies up to cap', () => {
    const selection = new SelectionController();
    const visible = [
      unit(0, 'spear', 'friendly'),
      unit(1, 'spear', 'friendly'),
      unit(2, 'bow', 'friendly'),
      unit(3, 'spear', 'opposing'),
    ];
    selection.selectSameArchetype(visible[0]!, visible, 10);
    expect(selection.getSelected()).toEqual([
      { index: 0, generation: 1 },
      { index: 1, generation: 1 },
    ]);
  });

  it('does not mix opposing units into friendly double-tap selection', () => {
    const selection = new SelectionController();
    const tapped = unit(5, 'spear', 'friendly');
    const visible = [tapped, unit(6, 'spear', 'opposing')];
    selection.selectSameArchetype(tapped, visible);
    expect(selection.getSelected()).toEqual([{ index: 5, generation: 1 }]);
  });
});
