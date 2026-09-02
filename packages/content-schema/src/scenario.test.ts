import { describe, expect, it } from 'vitest';
import { validateScenarioDef } from './scenario';

const validScenario = {
  schemaVersion: 1,
  id: 'lab-skirmish',
  displayName: 'Lab Skirmish',
  mapId: 'lab-grid',
  units: [
    {
      archetypeId: 'sunweaver-scout',
      position: { x: 1024, z: 2048 },
      factionId: 'sunweaver',
    },
  ],
  buildings: [
    {
      archetypeId: 'sunweaver-sanctum',
      originCell: { cx: 10, cz: 12 },
      factionId: 'sunweaver',
    },
  ],
};

describe('scenario schema foundation', () => {
  it('accepts a named lab set-piece stub', () => {
    const scenario = validateScenarioDef(validScenario);
    expect(scenario.mapId).toBe('lab-grid');
    expect(scenario.units).toHaveLength(1);
    expect(scenario.buildings).toHaveLength(1);
  });

  it('defaults missing spawn arrays to empty', () => {
    const scenario = validateScenarioDef({
      schemaVersion: 1,
      id: 'empty-lab',
      displayName: 'Empty',
      mapId: 'lab-grid',
    });
    expect(scenario.units).toEqual([]);
    expect(scenario.buildings).toEqual([]);
  });

  it('rejects invalid faction ids on spawns', () => {
    expect(() =>
      validateScenarioDef({
        ...validScenario,
        units: [{ archetypeId: 'sunweaver-scout', position: { x: 0, z: 0 }, factionId: 'ember-court' }],
      }),
    ).toThrow(/faction/i);
  });
});
