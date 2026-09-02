import type { CellCoord, SubunitCoord } from './coords';
import type { FactionId } from './pack';
import { requireFactionId } from './pack';
import { isRecord, requireContentId, requireInt, requireNonNegativeInt, requireString } from './validation';

export const SCENARIO_SCHEMA_VERSION = 1 as const;

export type ScenarioUnitSpawn = {
  archetypeId: string;
  position: SubunitCoord;
  headingMilli?: number;
  factionId?: FactionId;
};

export type ScenarioBuildingSpawn = {
  archetypeId: string;
  originCell: CellCoord;
  headingMilli?: number;
  factionId?: FactionId;
};

/**
 * On-disk scenario foundation for interaction-lab. Pack v2 references these via
 * `scenarios[].path`. Named lab set-pieces spawn from this document.
 */
export type ScenarioDef = {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  displayName: string;
  mapId: string;
  units: ScenarioUnitSpawn[];
  buildings: ScenarioBuildingSpawn[];
};

export function validateScenarioDef(value: unknown): ScenarioDef {
  if (!isRecord(value)) {
    throw new Error('Scenario must be an object');
  }
  if (value['schemaVersion'] !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value['schemaVersion'])}`);
  }
  const unitsValue = value['units'];
  if (unitsValue !== undefined && !Array.isArray(unitsValue)) {
    throw new Error('units must be an array');
  }
  const buildingsValue = value['buildings'];
  if (buildingsValue !== undefined && !Array.isArray(buildingsValue)) {
    throw new Error('buildings must be an array');
  }
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: requireContentId(value['id'], 'scenario id'),
    displayName: requireString(value['displayName'], 'displayName'),
    mapId: requireContentId(value['mapId'], 'mapId'),
    units: (unitsValue ?? []).map((entry) => parseUnitSpawn(entry)),
    buildings: (buildingsValue ?? []).map((entry) => parseBuildingSpawn(entry)),
  };
}

function parseUnitSpawn(value: unknown): ScenarioUnitSpawn {
  if (!isRecord(value)) {
    throw new Error('scenario unit spawn must be an object');
  }
  const spawn: ScenarioUnitSpawn = {
    archetypeId: requireContentId(value['archetypeId'], 'archetypeId'),
    position: parseSubunitCoord(value['position'], 'position'),
  };
  const headingMilli = value['headingMilli'];
  if (headingMilli !== undefined) {
    spawn.headingMilli = requireInt(headingMilli, 'headingMilli');
  }
  const factionId = value['factionId'];
  if (factionId !== undefined) {
    spawn.factionId = requireFactionId(factionId, 'factionId');
  }
  return spawn;
}

function parseBuildingSpawn(value: unknown): ScenarioBuildingSpawn {
  if (!isRecord(value)) {
    throw new Error('scenario building spawn must be an object');
  }
  const spawn: ScenarioBuildingSpawn = {
    archetypeId: requireContentId(value['archetypeId'], 'archetypeId'),
    originCell: parseCellCoord(value['originCell'], 'originCell'),
  };
  const headingMilli = value['headingMilli'];
  if (headingMilli !== undefined) {
    spawn.headingMilli = requireInt(headingMilli, 'headingMilli');
  }
  const factionId = value['factionId'];
  if (factionId !== undefined) {
    spawn.factionId = requireFactionId(factionId, 'factionId');
  }
  return spawn;
}

function parseSubunitCoord(value: unknown, label: string): SubunitCoord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    x: requireInt(value['x'], `${label}.x`),
    z: requireInt(value['z'], `${label}.z`),
  };
}

function parseCellCoord(value: unknown, label: string): CellCoord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    cx: requireNonNegativeInt(value['cx'], `${label}.cx`),
    cz: requireNonNegativeInt(value['cz'], `${label}.cz`),
  };
}
