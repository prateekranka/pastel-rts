import type {
  CommandEnvelopeV1,
  CommandResult,
  EntityId,
  MapDef,
  PackV2,
  ScenarioDef,
} from '@pastel-rts/content-schema';
import {
  computeContentHash,
  isValidRevision,
  validateCommandEnvelope,
  validateMapDef,
  validateScenarioDef,
} from '@pastel-rts/content-schema';
import type { StateChecksum } from '@pastel-rts/simulation';
import {
  runtimeContentFromBundle,
  type LoadedRuntimeContent,
  type RuntimeContentIdentity,
} from '../content/PublishedContentClient';
import type { ScenarioSaveDocument } from './types';
import { applyAlienFantasyObstacles, INTERACTION_LAB_ALIEN_FANTASY_ID } from './mapPresets';

export type ScenarioControllerOptions = {
  pack: PackV2;
  packBaseUrl?: string;
  contentIdentity?: RuntimeContentIdentity;
  loadScenarioJson: (path: string) => Promise<unknown>;
  loadMapJson: (path: string) => Promise<unknown>;
  onInitLab: (params: {
    seed: number;
    pack: PackV2;
    scenario?: ScenarioDef;
    map?: MapDef;
    commandLog?: CommandEnvelopeV1[];
    replayToTick?: number;
  }) => void;
};

/** Loads named lab scenarios and keeps exact content/map identity for replay. */
export class ScenarioController {
  private pack: PackV2;
  private packBaseUrl: string;
  private contentIdentity: RuntimeContentIdentity;
  private readonly loadScenarioJson: (path: string) => Promise<unknown>;
  private readonly loadMapJson: (path: string) => Promise<unknown>;
  private readonly onInitLab: ScenarioControllerOptions['onInitLab'];
  private seed = 1;
  private replayToTick = 0;
  private currentScenario: ScenarioDef | null = null;
  private currentMap: MapDef | null = null;
  private commandLog: CommandEnvelopeV1[] = [];
  private commandResults: CommandResult[] = [];
  private checksums: StateChecksum[] = [];

  constructor(options: ScenarioControllerOptions) {
    this.pack = options.pack;
    this.packBaseUrl = normalizeAssetBaseUrl(options.packBaseUrl ?? './content/dev-pack-v2/');
    this.contentIdentity =
      options.contentIdentity ?? runtimeContentFromBundle(options.pack, this.packBaseUrl).identity;
    this.loadScenarioJson = options.loadScenarioJson;
    this.loadMapJson = options.loadMapJson;
    this.onInitLab = options.onInitLab;
    assertContentIdentity(this.pack, this.contentIdentity);
  }

  getSeed(): number {
    return this.seed;
  }

  setSeed(seed: number): void {
    if (!Number.isSafeInteger(seed)) {
      throw new Error('Scenario seed must be a safe integer');
    }
    this.seed = seed;
  }

  getCurrentScenario(): ScenarioDef | null {
    return this.currentScenario;
  }

  getCurrentMap(): MapDef | null {
    return this.currentMap;
  }

  getPack(): PackV2 {
    return this.pack;
  }

  getScenarioPresets(): ReadonlyArray<{ id: string; path: string; mapId?: string }> {
    return (this.pack.scenarios ?? []).map((entry) => ({ ...entry }));
  }

  getContentIdentity(): RuntimeContentIdentity {
    return { ...this.contentIdentity };
  }

  getReplayToTick(): number {
    return this.replayToTick;
  }

  setReplayToTick(tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new Error('Replay tick must be a non-negative safe integer');
    }
    this.replayToTick = tick;
  }

  /** Update the selected immutable revision without touching authoritative state. */
  setContent(content: LoadedRuntimeContent): void {
    assertContentIdentity(content.pack, content.identity);
    if (this.currentScenario !== null) {
      const scenarioRef = content.pack.scenarios?.find((entry) => entry.id === this.currentScenario!.id);
      if (!scenarioRef) {
        throw new Error(`Content revision does not contain scenario ${this.currentScenario.id}`);
      }
      assertScenarioDependencies(content.pack, this.currentScenario);
    }
    this.pack = content.pack;
    this.packBaseUrl = normalizeAssetBaseUrl(content.assetBaseUrl);
    this.contentIdentity = { ...content.identity };
  }

  recordCommand(envelope: CommandEnvelopeV1): void {
    if (this.commandLog.some((entry) => entry.commandId === envelope.commandId)) {
      return;
    }
    this.commandLog.push(clone(envelope));
  }

  /**
   * Store only results for user commands. Scenario bootstrap results are implicit inputs.
   * The worker can receive a command after the main-thread tick used in its envelope.
   * For replay, the accepted worker tick is the effective execution tick.
   */
  recordCommandResult(result: CommandResult): void {
    const command = this.commandLog.find((entry) => entry.commandId === result.commandId);
    if (!command) {
      return;
    }
    if (this.commandResults.some((entry) => entry.commandId === result.commandId)) {
      return;
    }
    if (result.status === 'accepted' && result.acceptedAtTick !== undefined) {
      command.executeTick = result.acceptedAtTick;
    }
    this.commandResults.push(clone(result));
  }

  recordChecksums(checksums: readonly StateChecksum[]): void {
    this.checksums = checksums.map((checksum) => ({
      tick: checksum.tick,
      hash: checksum.hash,
    }));
  }

  getCommandLog(): readonly CommandEnvelopeV1[] {
    return this.commandLog;
  }

  getCommandResults(): readonly CommandResult[] {
    return this.commandResults;
  }

  getChecksums(): readonly StateChecksum[] {
    return this.checksums;
  }

  async loadNamedScenario(scenarioId: string): Promise<ScenarioDef> {
    const ref = this.pack.scenarios?.find((entry) => entry.id === scenarioId);
    if (!ref) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
    const raw = await this.loadScenarioJson(ref.path);
    const scenario = validateScenarioDef(raw);
    if (scenario.id !== scenarioId) {
      throw new Error(`Scenario id mismatch: expected ${scenarioId}`);
    }
    const mapRef = this.pack.maps?.find((entry) => entry.id === scenario.mapId);
    if (!mapRef) {
      throw new Error(`Scenario ${scenario.id} has no published map ${scenario.mapId}`);
    }
    const mapRaw = await this.loadMapJson(mapRef.path);
    let map = validateMapDef(mapRaw);
    if (map.id !== scenario.mapId) {
      throw new Error(`Map id mismatch: expected ${scenario.mapId}`);
    }
    if (scenarioId === INTERACTION_LAB_ALIEN_FANTASY_ID) {
      map = applyAlienFantasyObstacles(map);
    }
    assertScenarioDependencies(this.pack, scenario);

    this.currentScenario = scenario;
    this.currentMap = map;
    this.commandLog = [];
    this.commandResults = [];
    this.checksums = [];
    this.replayToTick = 0;
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario,
      map,
    });
    return scenario;
  }

  async reloadCurrentScenario(): Promise<void> {
    const scenarioId = this.currentScenario?.id;
    if (!scenarioId) {
      throw new Error('No scenario is loaded');
    }
    await this.loadNamedScenario(scenarioId);
  }

  reset(): void {
    if (!this.currentScenario || !this.currentMap) {
      return;
    }
    this.commandLog = [];
    this.commandResults = [];
    this.checksums = [];
    this.replayToTick = 0;
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario: this.currentScenario,
      map: this.currentMap,
    });
  }

  exportSaveDocument(): ScenarioSaveDocument {
    if (!this.currentScenario || !this.currentMap) {
      throw new Error('No scenario with a published map is loaded');
    }
    const identity = this.contentIdentity;
    return {
      schemaVersion: 1,
      scenarioId: this.currentScenario.id,
      scenario: clone(this.currentScenario),
      mapId: this.currentMap.id,
      map: clone(this.currentMap),
      seed: this.seed,
      replayToTick: this.replayToTick,
      packId: this.pack.id,
      packHash: this.pack.contentHash,
      contentHash: identity.contentHash,
      revision: identity.revision,
      manifestHash: identity.manifestHash,
      visualContentHash: identity.visualContentHash,
      simulationRulesHash: identity.simulationRulesHash,
      mapHash: computeContentHash(this.currentMap),
      scenarioHash: computeContentHash(this.currentScenario),
      commandLog: this.commandLog.map((entry) => clone(entry)),
      commandResults: this.commandResults.map((entry) => clone(entry)),
      checksums: this.checksums.map((entry) => ({ ...entry })),
      contentSource: identity.source,
    };
  }

  /** Validate an imported document before changing any controller or worker state. */
  importSaveDocument(value: unknown): void {
    const doc = validateSaveDocument(value);
    const identity = this.contentIdentity;
    if (
      doc.packId !== this.pack.id ||
      doc.packHash !== this.pack.contentHash ||
      doc.contentHash !== identity.contentHash ||
      doc.packHash !== doc.contentHash
    ) {
      throw new Error('Save content hash does not match the selected Pack v2');
    }
    if (
      doc.revision !== identity.revision ||
      doc.manifestHash !== identity.manifestHash ||
      doc.visualContentHash !== identity.visualContentHash ||
      doc.simulationRulesHash !== identity.simulationRulesHash ||
      doc.contentSource !== identity.source
    ) {
      throw new Error(`Save revision does not match selected content revision ${identity.revision}`);
    }
    if (!this.currentScenario || !this.currentMap) {
      throw new Error('Load a named scenario before importing a save');
    }
    if (doc.scenarioId !== this.currentScenario.id || doc.mapId !== this.currentMap.id) {
      throw new Error('Save scenario or map does not match the active runtime');
    }
    if (doc.mapHash !== computeContentHash(this.currentMap)) {
      throw new Error('Save map does not match the active runtime map');
    }
    if (doc.scenarioHash !== computeContentHash(this.currentScenario)) {
      throw new Error('Save scenario does not match the active runtime scenario');
    }
    const mapRef = this.pack.maps?.find((entry) => entry.id === doc.mapId);
    const scenarioRef = this.pack.scenarios?.find((entry) => entry.id === doc.scenarioId);
    if (!mapRef || !scenarioRef) {
      throw new Error('Save map or scenario is not present in the selected content revision');
    }
    if (doc.scenario.mapId !== doc.mapId) {
      throw new Error('Save scenario map does not match map identity');
    }
    assertScenarioDependencies(this.pack, doc.scenario);
    if (doc.replayToTick < maxCommandTick(doc.commandLog)) {
      throw new Error('Save replay tick ends before a recorded command');
    }
    const commandIds = new Set(doc.commandLog.map((entry) => entry.commandId));
    for (const result of doc.commandResults) {
      if (!commandIds.has(result.commandId)) {
        throw new Error('Save contains a result for an unknown command');
      }
    }

    this.seed = doc.seed;
    this.replayToTick = doc.replayToTick;
    this.currentScenario = clone(doc.scenario);
    this.currentMap = clone(doc.map);
    this.commandLog = doc.commandLog.map((entry) => clone(entry));
    this.commandResults = doc.commandResults.map((entry) => clone(entry));
    this.checksums = doc.checksums.map((entry) => ({ ...entry }));
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario: this.currentScenario,
      map: this.currentMap,
      commandLog: this.commandLog.map((entry) => clone(entry)),
      replayToTick: this.replayToTick,
    });
  }
}

function assertContentIdentity(pack: PackV2, identity: RuntimeContentIdentity): void {
  if (
    identity.packId !== pack.id ||
    identity.contentHash !== pack.contentHash ||
    identity.revision !== pack.revision
  ) {
    throw new Error('Runtime content identity does not match Pack v2');
  }
  if (!/^[a-f0-9]{64}$/.test(identity.contentHash)) {
    throw new Error('Runtime content hash is invalid');
  }
  if (!isValidRevision(identity.revision)) {
    throw new Error('Runtime content revision is invalid');
  }
}

function assertScenarioDependencies(pack: PackV2, scenario: ScenarioDef): void {
  const unitIds = new Set(pack.units.map((unit) => unit.id));
  const buildingIds = new Set(pack.buildings.map((building) => building.id));
  for (const unit of scenario.units) {
    if (!unitIds.has(unit.archetypeId)) {
      throw new Error(`Scenario ${scenario.id} references missing unit ${unit.archetypeId}`);
    }
  }
  for (const building of scenario.buildings) {
    if (!buildingIds.has(building.archetypeId)) {
      throw new Error(`Scenario ${scenario.id} references missing building ${building.archetypeId}`);
    }
  }
}

function validateSaveDocument(value: unknown): ScenarioSaveDocument {
  if (!isRecord(value) || value['schemaVersion'] !== 1) {
    throw new Error('Unsupported save schema');
  }
  const scenario = validateScenarioDef(value['scenario']);
  const map = validateMapDef(value['map']);
  const scenarioId = requireString(value['scenarioId'], 'scenarioId');
  const mapId = requireString(value['mapId'], 'mapId');
  if (scenarioId !== scenario.id || mapId !== map.id) {
    throw new Error('Save id does not match embedded data');
  }
  const seed = requireSafeInteger(value['seed'], 'seed');
  const replayToTick = requireSafeInteger(value['replayToTick'], 'replayToTick');
  if (replayToTick < 0) {
    throw new Error('replayToTick must be non-negative');
  }
  const packId = requireString(value['packId'], 'packId');
  const packHash = requireHash(value['packHash'], 'packHash');
  const contentHash = requireHash(value['contentHash'], 'contentHash');
  const revision = requireString(value['revision'], 'revision');
  if (!isValidRevision(revision)) {
    throw new Error('revision is invalid');
  }
  const manifestHash = value['manifestHash'];
  if (manifestHash !== null && (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash))) {
    throw new Error('manifestHash must be a lowercase SHA-256 hash or null');
  }
  const visualContentHash = requireHash(value['visualContentHash'], 'visualContentHash');
  const simulationRulesHash = requireHash(value['simulationRulesHash'], 'simulationRulesHash');
  const mapHash = requireHash(value['mapHash'], 'mapHash');
  const scenarioHash = requireHash(value['scenarioHash'], 'scenarioHash');
  const contentSource = value['contentSource'];
  if (contentSource !== 'bundle' && contentSource !== 'studio') {
    throw new Error('contentSource is invalid');
  }
  const commandLogValue = value['commandLog'];
  if (!Array.isArray(commandLogValue)) {
    throw new Error('commandLog must be an array');
  }
  const commandLog = commandLogValue.map((entry) => validateCommandEnvelope(entry));
  const commandIds = new Set<string>();
  for (const command of commandLog) {
    if (commandIds.has(command.commandId)) {
      throw new Error('commandLog contains duplicate command ids');
    }
    commandIds.add(command.commandId);
  }
  const commandResults = parseCommandResults(value['commandResults']);
  const checksums = parseChecksums(value['checksums']);
  return {
    schemaVersion: 1,
    scenarioId,
    scenario,
    mapId,
    map,
    seed,
    replayToTick,
    packId,
    packHash,
    contentHash,
    revision,
    manifestHash,
    visualContentHash,
    simulationRulesHash,
    mapHash,
    scenarioHash,
    commandLog,
    commandResults,
    checksums,
    contentSource,
  };
}

function parseCommandResults(value: unknown): CommandResult[] {
  if (!Array.isArray(value)) {
    throw new Error('commandResults must be an array');
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry) || entry['type'] !== 'commandResult') {
      throw new Error(`Invalid command result at index ${String(index)}`);
    }
    const commandId = requireString(entry['commandId'], 'commandResult.commandId');
    if (seen.has(commandId)) {
      throw new Error('Duplicate command result');
    }
    seen.add(commandId);
    const status = entry['status'];
    if (status !== 'accepted' && status !== 'rejected') {
      throw new Error(`Invalid command result status at index ${String(index)}`);
    }
    const result: CommandResult = { type: 'commandResult', commandId, status };
    const acceptedAtTick = entry['acceptedAtTick'];
    if (acceptedAtTick !== undefined) {
      result.acceptedAtTick = requireSafeInteger(acceptedAtTick, 'acceptedAtTick');
    }
    const reason = entry['reason'];
    if (reason !== undefined) {
      if (
        reason !== 'stale-id' &&
        reason !== 'blocked' &&
        reason !== 'unknown-archetype' &&
        reason !== 'out-of-bounds' &&
        reason !== 'capacity'
      ) {
        throw new Error(`Invalid command result reason at index ${String(index)}`);
      }
      result.reason = reason;
    }
    const spawnedId = entry['spawnedId'];
    if (spawnedId !== undefined) {
      result.spawnedId = parseEntityId(spawnedId);
    }
    return result;
  });
}

function parseChecksums(value: unknown): StateChecksum[] {
  if (!Array.isArray(value)) {
    throw new Error('checksums must be an array');
  }
  let previousTick = -1;
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid checksum at index ${String(index)}`);
    }
    const tick = requireSafeInteger(entry['tick'], 'checksum.tick');
    const hash = entry['hash'];
    if (typeof hash !== 'number' || !Number.isSafeInteger(hash) || hash < 0) {
      throw new Error(`Invalid checksum hash at index ${String(index)}`);
    }
    if (tick < previousTick) {
      throw new Error(`Checksum ticks are not ordered at index ${String(index)}`);
    }
    previousTick = tick;
    return { tick, hash };
  });
}

function parseEntityId(value: unknown): EntityId {
  if (!isRecord(value)) {
    throw new Error('spawnedId must be an object');
  }
  const index = requireSafeInteger(value['index'], 'spawnedId.index');
  const generation = requireSafeInteger(value['generation'], 'spawnedId.generation');
  if (index < 0 || generation <= 0) {
    throw new Error('spawnedId is invalid');
  }
  return { index, generation };
}

function maxCommandTick(commands: readonly CommandEnvelopeV1[]): number {
  return commands.reduce((max, command) => Math.max(max, command.executeTick), 0);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAssetBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Invalid content asset base URL');
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
