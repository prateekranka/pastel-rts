import { describe, expect, it } from 'vitest';
import { NavigationService } from '@pastel-rts/navigation';
import { createTestPackV2 } from '@pastel-rts/simulation';
import { validateBuildingPlacement } from '../buildings/placementValidation';

describe('building placement validation', () => {
  const pack = createTestPackV2();
  const nav = new NavigationService(160, 160);

  it('accepts valid open placement', () => {
    const result = validateBuildingPlacement({
      pack,
      nav,
      archetypeId: 'gravemark-bastion',
      originCell: { cx: 10, cz: 10 },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects out-of-bounds footprint', () => {
    const result = validateBuildingPlacement({
      pack,
      nav,
      archetypeId: 'gravemark-bastion',
      originCell: { cx: 159, cz: 159 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('out-of-bounds');
    }
  });

  it('rejects overlap on blocked cells', () => {
    nav.setFootprintBlocked({ cx: 20, cz: 20 }, 2, 2, true);
    const result = validateBuildingPlacement({
      pack,
      nav,
      archetypeId: 'gravemark-bastion',
      originCell: { cx: 20, cz: 20 },
    });
    expect(result.valid).toBe(false);
  });

  it('ignores unmasked cells in an L-shaped footprint', () => {
    const lPack = structuredClone(pack);
    const building = lPack.buildings[0];
    if (!building) {
      throw new Error('missing building');
    }
    building.blockedCellMask = [
      [true, false],
      [true, true],
    ];
    const blockedNav = new NavigationService(160, 160);
    blockedNav.setBlocked(21, 20, true);
    const result = validateBuildingPlacement({
      pack: lPack,
      nav: blockedNav,
      archetypeId: 'gravemark-bastion',
      originCell: { cx: 20, cz: 20 },
    });
    expect(result.valid).toBe(true);
  });
});
