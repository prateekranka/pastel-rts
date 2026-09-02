import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePackV2 } from '../pack';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../../content/dev-pack-v2/pack.json');

describe('authored pack fixture', () => {
  it('loads and validates content/dev-pack-v2/pack.json', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;
    const pack = validatePackV2(raw);
    expect(pack.id).toBe('dev-pack-v2');
    expect(pack.units).toHaveLength(2);
    expect(pack.buildings).toHaveLength(2);
    expect(pack.units.some((unit) => unit.factionId === 'sunweaver')).toBe(true);
    expect(pack.units.some((unit) => unit.factionId === 'gravemark')).toBe(true);
    expect(pack.buildings.some((building) => building.factionId === 'sunweaver')).toBe(true);
    expect(pack.buildings.some((building) => building.factionId === 'gravemark')).toBe(true);
    expect(pack.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
