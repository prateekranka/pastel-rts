import { describe, expect, it } from 'vitest';
import { blankBuildingTemplate, blankUnitTemplate, filterLibraryEntries, type LibraryEntry } from './contentLibrary';

describe('content library filtering', () => {
  const entries: LibraryEntry[] = [
    { kind: 'unit', archetype: { ...blankUnitTemplate('sunweaver-scout', 'sunweaver'), displayName: 'Scout', tags: ['animated'] } },
    { kind: 'unit', archetype: { ...blankUnitTemplate('gravemark-walker', 'gravemark'), displayName: 'Walker Proxy', enabled: false, tags: ['proxy'] } },
    { kind: 'building', archetype: { ...blankBuildingTemplate('sunweaver-sanctum', 'sunweaver'), displayName: 'Sanctum' } },
  ];

  it('searches stable ID, display name, faction, type, and tags', () => {
    expect(filterLibraryEntries(entries, 'proxy', 'all', true).map((entry) => entry.archetype.id)).toEqual(['gravemark-walker']);
    expect(filterLibraryEntries(entries, 'sunweaver', 'unit', true).map((entry) => entry.archetype.id)).toEqual(['sunweaver-scout']);
    expect(filterLibraryEntries(entries, 'building', 'all', true).map((entry) => entry.archetype.id)).toEqual(['sunweaver-sanctum']);
  });

  it('hides disabled entries unless explicitly requested', () => {
    expect(filterLibraryEntries(entries, '', 'all', false).map((entry) => entry.archetype.id)).toEqual([
      'sunweaver-scout',
      'sunweaver-sanctum',
    ]);
    expect(filterLibraryEntries(entries, '', 'all', true)).toHaveLength(3);
  });
});
