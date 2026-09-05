import {
  computeContentHash,
  computeSimulationRulesHash,
  computeVisualContentHash,
  isValidRevision,
  validateCommandEnvelope,
  validateMapDef,
  validatePackV2,
  validateScenarioDef,
  type CommandEnvelopeV1,
  type CommandResult,
  type MapDef,
  type PackV2,
  type ScenarioDef,
} from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { runSimulationReplay, type StateChecksum } from '@pastel-rts/simulation';
import type { RuntimeContentIdentity } from '../content/PublishedContentClient';
import type { ScenarioSaveDocument } from '../sandbox/types';

export const BUG_BUNDLE_SCHEMA_VERSION = 1 as const;
export const BUG_BUNDLE_KIND = 'qa-bug-bundle' as const;
export const BUG_BUNDLE_ASSET_COVERAGE = 'json-only' as const;

export const BUG_BUNDLE_LIMITS = {
  maxCommands: 1024,
  maxCommandResults: 1024,
  maxChecksums: 4096,
  maxSteps: 16,
  maxDiagnostics: 32,
  maxTicks: 100_000,
  maxText: 256,
  maxJsonDepth: 24,
  maxArrayItems: 4096,
  maxObjectKeys: 128,
  maxArtifactBytes: 2 * 1024 * 1024,
  maxViewportDimension: 8192,
  maxDpr: 8,
  maxEntityIndex: 1_000_000,
} as const;

type AssetCoverage = typeof BUG_BUNDLE_ASSET_COVERAGE;
export type BugDiagnosticValue = string | number | boolean;
export type BugDiagnostics = Record<string, BugDiagnosticValue>;

export type BugBundleRuntime = {
  renderer: string;
  viewport: { width: number; height: number };
  dpr: number;
  mode: 'interaction-lab';
};

export type BugBundleContent = {
  pack: PackV2;
  scenario: ScenarioDef;
  map: MapDef;
  assetCoverage: AssetCoverage;
  assetHashes: [];
};

export type BugBundleIdentity = {
  packId: string;
  /** Legacy alias retained to make the Pack v2 identity obvious to older tooling. */
  packHash: string;
  revision: string;
  contentHash: string;
  manifestHash: string | null;
  visualContentHash: string;
  simulationRulesHash: string;
  scenarioId: string;
  scenarioHash: string;
  mapId: string;
  mapHash: string;
  contentSource: RuntimeContentIdentity['source'];
};

export type BugBundleReplay = {
  seed: number;
  tickRange: { startTick: 0; endTick: number };
  commands: CommandEnvelopeV1[];
  commandResults: CommandResult[];
  checksums: StateChecksum[];
  commandLogLength: number;
};

export type BugBundle = {
  schemaVersion: typeof BUG_BUNDLE_SCHEMA_VERSION;
  kind: typeof BUG_BUNDLE_KIND;
  exportedAt: string;
  content: BugBundleContent;
  identity: BugBundleIdentity;
  replay: BugBundleReplay;
  runtime: BugBundleRuntime;
  diagnostics: BugDiagnostics;
  reproduction: { steps: string[] };
};

/** The controller and content client remain the authoritative runtime state. */
export type BugBundleRuntimeContent = {
  pack: PackV2;
  identity: RuntimeContentIdentity;
  scenario: ScenarioDef | null;
  map: MapDef | null;
};

export type BugBundleInput = {
  pack: PackV2;
  save: ScenarioSaveDocument;
  runtime: BugBundleRuntime;
  diagnostics: Record<string, unknown>;
  reproductionSteps?: readonly string[];
};

export type BugBundleChecksumMismatch = {
  index: number;
  expected: StateChecksum | null;
  actual: StateChecksum | null;
};

export type BugBundleReplayResult = {
  bundle: BugBundle;
  expected: StateChecksum[];
  actual: StateChecksum[];
  actualCommandLogLength: number;
  matched: boolean;
  firstMismatch: BugBundleChecksumMismatch | null;
};

export type BugBundleImportTarget = {
  getRuntimeContent: () => BugBundleRuntimeContent;
  exportSave: () => ScenarioSaveDocument;
  importSave: (save: ScenarioSaveDocument) => void;
};

const ALLOWED_DIAGNOSTICS = new Set([
  'renderer',
  'rendererBackend',
  'rendererContext',
  'frameAvgMs',
  'frameP95Ms',
  'frameP99Ms',
  'avgFps',
  'onePercentLowFps',
  'avgSimTimeMs',
  'maxSimTimeMs',
  'avgSnapshotLatencyMs',
  'simTickMs',
  'navTickMs',
  'snapshotLatencyMs',
  'drawCalls',
  'triangles',
  'textures',
  'geometries',
  'activeRevision',
  'contentHash',
  'simulationRulesHash',
  'scenarioId',
  'seed',
  'tick',
  'entityCount',
  'commandCount',
  'checksumCount',
  'checksum',
  'missingUnitAssets',
  'missingBuildingAssets',
  'contentPhase',
  'error',
]);

/** Build a bounded runtime artifact from the ScenarioController save document. */
export function exportBugBundle(input: BugBundleInput): BugBundle {
  if (input.save.schemaVersion !== 1) {
    throw new Error('Bug bundle requires a schemaVersion 1 scenario save');
  }
  const pack = validatePackV2(input.pack);
  assertPackCanonicalIdentity(pack);
  const scenario = validateScenarioDef(input.save.scenario);
  const map = validateMapDef(input.save.map);
  assertPublishedReferences(pack, scenario, map);

  const identity: BugBundleIdentity = {
    packId: input.save.packId,
    packHash: input.save.packHash,
    revision: input.save.revision,
    contentHash: input.save.contentHash,
    manifestHash: input.save.manifestHash,
    visualContentHash: input.save.visualContentHash,
    simulationRulesHash: input.save.simulationRulesHash,
    scenarioId: input.save.scenarioId,
    scenarioHash: input.save.scenarioHash,
    mapId: input.save.mapId,
    mapHash: input.save.mapHash,
    contentSource: input.save.contentSource,
  };
  const steps = input.reproductionSteps === undefined
    ? sanitizeSteps(defaultReproductionSteps(identity, input.save.seed, input.save.replayToTick))
    : sanitizeSteps([...input.reproductionSteps]);
  const artifact: BugBundle = {
    schemaVersion: BUG_BUNDLE_SCHEMA_VERSION,
    kind: BUG_BUNDLE_KIND,
    exportedAt: new Date().toISOString(),
    content: {
      pack,
      scenario,
      map,
      assetCoverage: BUG_BUNDLE_ASSET_COVERAGE,
      assetHashes: [],
    },
    identity,
    replay: {
      seed: input.save.seed,
      tickRange: { startTick: 0, endTick: input.save.replayToTick },
      commands: input.save.commandLog.map((command) => clone(command)),
      commandResults: input.save.commandResults.map((result) => clone(result)),
      checksums: input.save.checksums.map((checksum) => ({ ...checksum })),
      commandLogLength: input.save.commandLog.length,
    },
    runtime: {
      renderer: input.runtime.renderer,
      viewport: { ...input.runtime.viewport },
      dpr: input.runtime.dpr,
      mode: 'interaction-lab',
    },
    diagnostics: sanitizeDiagnostics(input.diagnostics),
    reproduction: { steps },
  };
  return parseBugBundle(artifact);
}

/** Parse and validate a bundle before any runtime state can be changed. */
export function parseBugBundle(value: unknown): BugBundle {
  assertBoundedJson(value, 'bug bundle');
  const root = requireRecord(value, 'bug bundle');
  assertObjectKeys(root, [
    'schemaVersion',
    'kind',
    'exportedAt',
    'content',
    'identity',
    'replay',
    'runtime',
    'diagnostics',
    'reproduction',
  ], 'bug bundle');
  if (root['schemaVersion'] !== BUG_BUNDLE_SCHEMA_VERSION || root['kind'] !== BUG_BUNDLE_KIND) {
    throw new Error('Unsupported bug bundle schema');
  }
  const exportedAt = requireTimestamp(root['exportedAt']);
  const content = parseContent(root['content']);
  const identity = parseIdentity(root['identity'], content);
  const replay = parseReplay(root['replay'], identity, content);
  const runtime = parseRuntime(root['runtime']);
  const diagnostics = sanitizeDiagnostics(root['diagnostics']);
  const reproduction = parseReproduction(root['reproduction']);
  const artifact: BugBundle = {
    schemaVersion: BUG_BUNDLE_SCHEMA_VERSION,
    kind: BUG_BUNDLE_KIND,
    exportedAt,
    content,
    identity,
    replay,
    runtime,
    diagnostics,
    reproduction,
  };
  assertArtifactSize(artifact);
  return artifact;
}

export const validateBugBundle = parseBugBundle;

/** Confirm that a bundle describes the currently installed immutable content and scene. */
export function assertBugBundleMatchesRuntime(
  value: unknown,
  runtimeContent: BugBundleRuntimeContent,
): BugBundle {
  const bundle = parseBugBundle(value);
  const activeIdentity = runtimeContent.identity;
  if (bundle.identity.revision !== activeIdentity.revision) {
    throw new Error(
      `Bug bundle revision ${bundle.identity.revision} is not active; active validated revision is ${activeIdentity.revision}. Load that immutable revision before reproducing.`,
    );
  }
  if (
    activeIdentity.source !== bundle.identity.contentSource ||
    activeIdentity.packId !== bundle.identity.packId ||
    activeIdentity.revision !== bundle.identity.revision ||
    activeIdentity.contentHash !== bundle.identity.contentHash ||
    activeIdentity.manifestHash !== bundle.identity.manifestHash ||
    activeIdentity.visualContentHash !== bundle.identity.visualContentHash ||
    activeIdentity.simulationRulesHash !== bundle.identity.simulationRulesHash
  ) {
    throw new Error('Bug bundle content identity is tampered or does not match the active validated content');
  }
  assertPackCanonicalIdentity(runtimeContent.pack);
  if (
    runtimeContent.pack.id !== bundle.content.pack.id ||
    runtimeContent.pack.revision !== bundle.content.pack.revision ||
    computeContentHash(runtimeContent.pack) !== computeContentHash(bundle.content.pack)
  ) {
    throw new Error('Bug bundle Pack v2 snapshot does not match the active validated content');
  }
  if (runtimeContent.scenario === null || runtimeContent.map === null) {
    throw new Error('Bug bundle requires an active named scenario and map');
  }
  if (
    runtimeContent.scenario.id !== bundle.identity.scenarioId ||
    runtimeContent.map.id !== bundle.identity.mapId ||
    computeContentHash(runtimeContent.scenario) !== bundle.identity.scenarioHash ||
    computeContentHash(runtimeContent.map) !== bundle.identity.mapHash ||
    computeContentHash(runtimeContent.scenario) !== computeContentHash(bundle.content.scenario) ||
    computeContentHash(runtimeContent.map) !== computeContentHash(bundle.content.map)
  ) {
    throw new Error('Bug bundle scenario or map snapshot does not match the active scene');
  }
  return bundle;
}

/** Replay from the embedded snapshot and return the actual checksum sequence. */
export function replayBugBundle(
  value: unknown,
  options: {
    runtimeContent?: BugBundleRuntimeContent;
    navFactory?: () => NavigationService;
  } = {},
): BugBundleReplayResult {
  const bundle = options.runtimeContent
    ? assertBugBundleMatchesRuntime(value, options.runtimeContent)
    : parseBugBundle(value);
  const pack = options.runtimeContent?.pack ?? bundle.content.pack;
  const replay = runSimulationReplay({
    pack,
    navFactory: options.navFactory ?? (() => new NavigationService()),
    scenario: bundle.content.scenario,
    map: bundle.content.map,
    commands: bundle.replay.commands.map((command) => clone(command)),
    totalTicks: bundle.replay.tickRange.endTick,
    simulationConfig: { seed: bundle.replay.seed },
  });
  const actual = replay.checksums.map((checksum) => ({ ...checksum }));
  const expected = bundle.replay.checksums.map((checksum) => ({ ...checksum }));
  const firstMismatch = findFirstMismatch(expected, actual);
  return {
    bundle,
    expected,
    actual,
    actualCommandLogLength: replay.commandLogLength,
    matched: firstMismatch === null,
    firstMismatch,
  };
}

/** Import only after exact replay succeeds. Restore the prior save on an apply error. */
export function importAndReproduceBugBundle(
  value: unknown,
  target: BugBundleImportTarget,
): BugBundleReplayResult {
  const result = replayBugBundle(value, { runtimeContent: target.getRuntimeContent() });
  if (!result.matched) {
    throw new Error(formatReplayMismatch(result.firstMismatch));
  }

  const previous = target.exportSave();
  let importStarted = false;
  try {
    importStarted = true;
    target.importSave(bugBundleToScenarioSaveDocument(result.bundle));
  } catch (error) {
    if (importStarted) {
      try {
        target.importSave(previous);
      } catch (restoreError) {
        throw new Error(
          `Bug bundle import failed and active state could not be restored: ${errorMessage(restoreError)}`,
        );
      }
    }
    throw error;
  }
  return result;
}

export const importBugBundle = importAndReproduceBugBundle;

/** Convert the validated bundle to the controller's existing save format. */
export function bugBundleToScenarioSaveDocument(bundle: BugBundle): ScenarioSaveDocument {
  const validated = parseBugBundle(bundle);
  return {
    schemaVersion: 1,
    scenarioId: validated.identity.scenarioId,
    scenario: clone(validated.content.scenario),
    mapId: validated.identity.mapId,
    map: clone(validated.content.map),
    seed: validated.replay.seed,
    replayToTick: validated.replay.tickRange.endTick,
    packId: validated.identity.packId,
    packHash: validated.identity.packHash,
    contentHash: validated.identity.contentHash,
    revision: validated.identity.revision,
    manifestHash: validated.identity.manifestHash,
    visualContentHash: validated.identity.visualContentHash,
    simulationRulesHash: validated.identity.simulationRulesHash,
    mapHash: validated.identity.mapHash,
    scenarioHash: validated.identity.scenarioHash,
    commandLog: validated.replay.commands.map((command) => clone(command)),
    commandResults: validated.replay.commandResults.map((result) => clone(result)),
    checksums: validated.replay.checksums.map((checksum) => ({ ...checksum })),
    contentSource: validated.identity.contentSource,
  };
}

export function sanitizeBugDiagnostics(value: unknown): BugDiagnostics {
  return sanitizeDiagnostics(value);
}

/** Download only a validated JSON bundle with a safe basename. */
export function downloadBugBundle(
  bundle: BugBundle,
  filename = 'pastel-lab-bug-bundle.json',
): void {
  const validated = parseBugBundle(bundle);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(filename) || filename.includes('..')) {
    throw new Error('Bug bundle download filename is unsafe');
  }
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  if (textByteLength(serialized) > BUG_BUNDLE_LIMITS.maxArtifactBytes) {
    throw new Error('Bug bundle exceeds the bounded artifact size');
  }
  const blob = new Blob([serialized], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseContent(value: unknown): BugBundleContent {
  const content = requireRecord(value, 'bug bundle content');
  assertObjectKeys(content, ['pack', 'scenario', 'map', 'assetCoverage', 'assetHashes'], 'bug bundle content');
  if (content['assetCoverage'] !== BUG_BUNDLE_ASSET_COVERAGE) {
    throw new Error('Bug bundle must declare json-only asset coverage');
  }
  const assetHashes = content['assetHashes'];
  if (!Array.isArray(assetHashes) || assetHashes.length !== 0) {
    throw new Error('Bug bundle asset hashes must be empty for JSON-only coverage');
  }
  const pack = validatePackV2(content['pack']);
  assertPackRawHash(content['pack'], pack);
  assertPackCanonicalIdentity(pack);
  const scenario = validateScenarioDef(content['scenario']);
  const map = validateMapDef(content['map']);
  assertPublishedReferences(pack, scenario, map);
  assertContentArrayBounds(pack, scenario, map);
  return { pack, scenario, map, assetCoverage: BUG_BUNDLE_ASSET_COVERAGE, assetHashes: [] };
}

function parseIdentity(value: unknown, content: BugBundleContent): BugBundleIdentity {
  const identity = requireRecord(value, 'bug bundle identity');
  assertObjectKeys(identity, [
    'packId',
    'packHash',
    'revision',
    'contentHash',
    'manifestHash',
    'visualContentHash',
    'simulationRulesHash',
    'scenarioId',
    'scenarioHash',
    'mapId',
    'mapHash',
    'contentSource',
  ], 'bug bundle identity');
  const parsed: BugBundleIdentity = {
    packId: requireSafeText(identity['packId'], 'identity.packId'),
    packHash: requireHash(identity['packHash'], 'identity.packHash'),
    revision: requireRevision(identity['revision'], 'identity.revision'),
    contentHash: requireHash(identity['contentHash'], 'identity.contentHash'),
    manifestHash: parseNullableHash(identity['manifestHash'], 'identity.manifestHash'),
    visualContentHash: requireHash(identity['visualContentHash'], 'identity.visualContentHash'),
    simulationRulesHash: requireHash(identity['simulationRulesHash'], 'identity.simulationRulesHash'),
    scenarioId: requireSafeText(identity['scenarioId'], 'identity.scenarioId'),
    scenarioHash: requireHash(identity['scenarioHash'], 'identity.scenarioHash'),
    mapId: requireSafeText(identity['mapId'], 'identity.mapId'),
    mapHash: requireHash(identity['mapHash'], 'identity.mapHash'),
    contentSource: parseContentSource(identity['contentSource']),
  };
  if (
    parsed.packId !== content.pack.id ||
    parsed.packHash !== content.pack.contentHash ||
    parsed.contentHash !== content.pack.contentHash ||
    parsed.revision !== content.pack.revision ||
    parsed.scenarioId !== content.scenario.id ||
    parsed.scenarioHash !== computeContentHash(content.scenario) ||
    parsed.mapId !== content.map.id ||
    parsed.mapHash !== computeContentHash(content.map)
  ) {
    throw new Error('Bug bundle identity does not match its embedded content snapshot');
  }
  if (parsed.contentSource === 'bundle') {
    if (
      parsed.manifestHash !== null ||
      parsed.visualContentHash !== computeVisualContentHash(content.pack) ||
      parsed.simulationRulesHash !== computeSimulationRulesHash(content.pack)
    ) {
      throw new Error('Bundled content identity does not match JSON-only Pack v2 hashes');
    }
  } else if (parsed.manifestHash === null) {
    throw new Error('Studio content identity requires a manifest hash');
  }
  return parsed;
}

function parseReplay(
  value: unknown,
  identity: BugBundleIdentity,
  content: BugBundleContent,
): BugBundleReplay {
  const replay = requireRecord(value, 'bug bundle replay');
  assertObjectKeys(replay, [
    'seed',
    'tickRange',
    'commands',
    'commandResults',
    'checksums',
    'commandLogLength',
  ], 'bug bundle replay');
  const tickRange = parseTickRange(replay['tickRange']);
  const seed = requireBoundedSeed(replay['seed'], 'replay.seed');
  const commands = parseCommands(replay['commands'], tickRange.endTick);
  const commandResults = parseCommandResults(replay['commandResults'], tickRange.endTick);
  const commandIds = new Set(commands.map((command) => command.commandId));
  for (const result of commandResults) {
    if (!commandIds.has(result.commandId)) {
      throw new Error(`Command result ${result.commandId} has no recorded command`);
    }
  }
  const checksums = parseChecksums(replay['checksums'], tickRange);
  const commandLogLength = requireBoundedInteger(
    replay['commandLogLength'],
    'replay.commandLogLength',
    0,
    BUG_BUNDLE_LIMITS.maxCommandResults * 2,
  );
  if (commandLogLength < commands.length) {
    throw new Error('replay.commandLogLength is shorter than the ordered command list');
  }
  if (identity.scenarioId !== content.scenario.id || identity.mapId !== content.map.id) {
    throw new Error('Replay scene identity does not match the bundle content');
  }
  return { seed, tickRange, commands, commandResults, checksums, commandLogLength };
}

function parseTickRange(value: unknown): { startTick: 0; endTick: number } {
  const range = requireRecord(value, 'replay.tickRange');
  assertObjectKeys(range, ['startTick', 'endTick'], 'replay.tickRange');
  if (range['startTick'] !== 0) {
    throw new Error('replay.tickRange.startTick must be zero');
  }
  const endTick = requireBoundedInteger(range['endTick'], 'replay.tickRange.endTick', 0, BUG_BUNDLE_LIMITS.maxTicks);
  return { startTick: 0, endTick };
}

function parseCommands(value: unknown, endTick: number): CommandEnvelopeV1[] {
  if (!Array.isArray(value) || value.length > BUG_BUNDLE_LIMITS.maxCommands) {
    throw new Error(`replay.commands must contain at most ${String(BUG_BUNDLE_LIMITS.maxCommands)} entries`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    let command: CommandEnvelopeV1;
    try {
      command = validateCommandEnvelope(entry);
    } catch {
      throw new Error(`replay command ${String(index)} is invalid`);
    }
    if (ids.has(command.commandId)) {
      throw new Error(`replay command ${command.commandId} is duplicated`);
    }
    if (command.executeTick > endTick) {
      throw new Error(`replay command ${command.commandId} executes outside the tick range`);
    }
    ids.add(command.commandId);
    return clone(command);
  });
}

function parseCommandResults(value: unknown, endTick: number): CommandResult[] {
  if (!Array.isArray(value) || value.length > BUG_BUNDLE_LIMITS.maxCommandResults) {
    throw new Error(
      `replay.commandResults must contain at most ${String(BUG_BUNDLE_LIMITS.maxCommandResults)} entries`,
    );
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = requireRecord(entry, `replay command result ${String(index)}`);
    assertObjectKeys(record, ['type', 'commandId', 'status', 'acceptedAtTick', 'reason', 'spawnedId'], `replay command result ${String(index)}`);
    if (record['type'] !== 'commandResult') {
      throw new Error(`replay command result ${String(index)} has an invalid type`);
    }
    const commandId = requireSafeText(record['commandId'], 'commandResult.commandId');
    if (ids.has(commandId)) {
      throw new Error(`replay command result ${commandId} is duplicated`);
    }
    ids.add(commandId);
    const status = record['status'];
    if (status !== 'accepted' && status !== 'rejected') {
      throw new Error(`replay command result ${String(index)} has an invalid status`);
    }
    const result: CommandResult = { type: 'commandResult', commandId, status };
    if (record['acceptedAtTick'] !== undefined) {
      const acceptedAtTick = requireBoundedInteger(
        record['acceptedAtTick'],
        'commandResult.acceptedAtTick',
        0,
        endTick,
      );
      result.acceptedAtTick = acceptedAtTick;
    }
    if (record['reason'] !== undefined) {
      const reason = record['reason'];
      if (
        reason !== 'stale-id' &&
        reason !== 'blocked' &&
        reason !== 'unknown-archetype' &&
        reason !== 'out-of-bounds' &&
        reason !== 'capacity'
      ) {
        throw new Error(`replay command result ${String(index)} has an invalid reason`);
      }
      result.reason = reason;
    }
    if (record['spawnedId'] !== undefined) {
      result.spawnedId = parseEntityId(record['spawnedId']);
    }
    return result;
  });
}

function parseChecksums(
  value: unknown,
  tickRange: { startTick: 0; endTick: number },
): StateChecksum[] {
  if (!Array.isArray(value) || value.length > BUG_BUNDLE_LIMITS.maxChecksums) {
    throw new Error(`replay.checksums must contain at most ${String(BUG_BUNDLE_LIMITS.maxChecksums)} entries`);
  }
  let previousTick = tickRange.startTick - 1;
  return value.map((entry, index) => {
    const record = requireRecord(entry, `replay checksum ${String(index)}`);
    assertObjectKeys(record, ['tick', 'hash'], `replay checksum ${String(index)}`);
    const tick = requireBoundedInteger(record['tick'], 'checksum.tick', tickRange.startTick, BUG_BUNDLE_LIMITS.maxTicks);
    const hash = requireBoundedInteger(record['hash'], 'checksum.hash', 0, 0xffffffff);
    if (tick <= previousTick || tick >= tickRange.endTick) {
      throw new Error(`replay checksum ${String(index)} is outside the ordered tick range`);
    }
    previousTick = tick;
    return { tick, hash };
  });
}

function parseRuntime(value: unknown): BugBundleRuntime {
  const runtime = requireRecord(value, 'bug bundle runtime');
  assertObjectKeys(runtime, ['renderer', 'viewport', 'dpr', 'mode'], 'bug bundle runtime');
  const viewport = requireRecord(runtime['viewport'], 'runtime.viewport');
  assertObjectKeys(viewport, ['width', 'height'], 'runtime.viewport');
  const mode = runtime['mode'];
  if (mode !== 'interaction-lab') {
    throw new Error('runtime.mode must be interaction-lab');
  }
  const dpr = runtime['dpr'];
  if (
    typeof dpr !== 'number' ||
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    dpr > BUG_BUNDLE_LIMITS.maxDpr
  ) {
    throw new Error('runtime.dpr is outside the bounded range');
  }
  return {
    renderer: requireSafeText(runtime['renderer'], 'runtime.renderer'),
    viewport: {
      width: requireBoundedInteger(
        viewport['width'],
        'runtime.viewport.width',
        1,
        BUG_BUNDLE_LIMITS.maxViewportDimension,
      ),
      height: requireBoundedInteger(
        viewport['height'],
        'runtime.viewport.height',
        1,
        BUG_BUNDLE_LIMITS.maxViewportDimension,
      ),
    },
    dpr,
    mode,
  };
}

function parseReproduction(value: unknown): { steps: string[] } {
  const reproduction = requireRecord(value, 'bug bundle reproduction');
  assertObjectKeys(reproduction, ['steps'], 'bug bundle reproduction');
  return { steps: sanitizeSteps(reproduction['steps']) };
}

function sanitizeDiagnostics(value: unknown): BugDiagnostics {
  const diagnostics = requireRecord(value, 'bug bundle diagnostics');
  const keys = Object.keys(diagnostics);
  if (keys.length > BUG_BUNDLE_LIMITS.maxDiagnostics) {
    throw new Error(`diagnostics must contain at most ${String(BUG_BUNDLE_LIMITS.maxDiagnostics)} fields`);
  }
  const output: BugDiagnostics = {};
  for (const key of keys) {
    if (!ALLOWED_DIAGNOSTICS.has(key)) {
      throw new Error(`diagnostics field ${key} is not allowlisted`);
    }
    const valueForKey = diagnostics[key];
    if (typeof valueForKey === 'string') {
      if (valueForKey.length > BUG_BUNDLE_LIMITS.maxText || hasSensitiveText(valueForKey)) {
        throw new Error(`diagnostics field ${key} is unsafe`);
      }
      output[key] = valueForKey;
    } else if (typeof valueForKey === 'number' || typeof valueForKey === 'boolean') {
      if (typeof valueForKey === 'number' && !Number.isFinite(valueForKey)) {
        throw new Error(`diagnostics field ${key} is not finite`);
      }
      output[key] = valueForKey;
    } else {
      throw new Error(`diagnostics field ${key} must be scalar`);
    }
  }
  return output;
}

function sanitizeSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > BUG_BUNDLE_LIMITS.maxSteps) {
    throw new Error(
      `reproduction steps must contain 1 to ${String(BUG_BUNDLE_LIMITS.maxSteps)} strings`,
    );
  }
  return value.map((step, index) => {
    if (
      typeof step !== 'string' ||
      step.length === 0 ||
      step.length > BUG_BUNDLE_LIMITS.maxText ||
      hasSensitiveText(step)
    ) {
      throw new Error(`reproduction step ${String(index)} is unsafe`);
    }
    return step;
  });
}

function defaultReproductionSteps(
  identity: BugBundleIdentity,
  seed: number,
  endTick: number,
): string[] {
  return [
    `Open the interaction lab at content revision ${identity.revision}.`,
    `Load scenario ${identity.scenarioId} on map ${identity.mapId}.`,
    `Set seed ${String(seed)} and replay the recorded commands through tick ${String(endTick)}.`,
    'Compare the complete checksum sequence before changing content or commands.',
  ];
}

function assertPublishedReferences(pack: PackV2, scenario: ScenarioDef, map: MapDef): void {
  const mapReferences = (pack.maps ?? []).filter((entry) => entry.id === map.id);
  const scenarioReferences = (pack.scenarios ?? []).filter((entry) => entry.id === scenario.id);
  if (mapReferences.length !== 1 || scenarioReferences.length !== 1) {
    throw new Error('Bug bundle scenario or map is not a unique Pack v2 reference');
  }
  const scenarioReference = scenarioReferences[0];
  if (
    scenario.mapId !== map.id ||
    (scenarioReference?.mapId !== undefined && scenarioReference.mapId !== map.id)
  ) {
    throw new Error('Bug bundle scenario and map identities do not match');
  }
  for (const unit of scenario.units) {
    if (!pack.units.some((archetype) => archetype.id === unit.archetypeId && archetype.enabled)) {
      throw new Error(`Bug bundle scenario references unknown unit ${unit.archetypeId}`);
    }
  }
  for (const building of scenario.buildings) {
    if (!pack.buildings.some((archetype) => archetype.id === building.archetypeId && archetype.enabled)) {
      throw new Error(`Bug bundle scenario references unknown building ${building.archetypeId}`);
    }
  }
}

function assertContentArrayBounds(pack: PackV2, scenario: ScenarioDef, map: MapDef): void {
  if (
    pack.factions.length > BUG_BUNDLE_LIMITS.maxArrayItems ||
    pack.units.length > BUG_BUNDLE_LIMITS.maxArrayItems ||
    pack.buildings.length > BUG_BUNDLE_LIMITS.maxArrayItems ||
    (pack.maps?.length ?? 0) > BUG_BUNDLE_LIMITS.maxArrayItems ||
    (pack.scenarios?.length ?? 0) > BUG_BUNDLE_LIMITS.maxArrayItems ||
    scenario.units.length > BUG_BUNDLE_LIMITS.maxArrayItems ||
    scenario.buildings.length > BUG_BUNDLE_LIMITS.maxArrayItems ||
    (map.blockedCells?.length ?? 0) > BUG_BUNDLE_LIMITS.maxArrayItems
  ) {
    throw new Error('Bug bundle content snapshot exceeds bounded array limits');
  }
}

function assertPackRawHash(value: unknown, pack: PackV2): void {
  const raw = requireRecord(value, 'Pack v2 snapshot');
  if (raw['contentHash'] !== pack.contentHash) {
    throw new Error('Bug bundle Pack v2 content hash mismatch');
  }
}

function assertPackCanonicalIdentity(pack: PackV2): void {
  if (computeContentHash(pack) !== pack.contentHash || !isValidRevision(pack.revision)) {
    throw new Error('Bug bundle Pack v2 identity is invalid');
  }
}

function parseContentSource(value: unknown): RuntimeContentIdentity['source'] {
  if (value !== 'bundle' && value !== 'studio') {
    throw new Error('identity.contentSource is invalid');
  }
  return value;
}

function parseNullableHash(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return requireHash(value, label);
}

function parseEntityId(value: unknown): { index: number; generation: number } {
  const record = requireRecord(value, 'commandResult.spawnedId');
  assertObjectKeys(record, ['index', 'generation'], 'commandResult.spawnedId');
  return {
    index: requireBoundedInteger(record['index'], 'spawnedId.index', 0, BUG_BUNDLE_LIMITS.maxEntityIndex),
    generation: requireBoundedInteger(record['generation'], 'spawnedId.generation', 1, 0xffffffff),
  };
}

function requireTimestamp(value: unknown): string {
  const text = requireSafeText(value, 'exportedAt');
  if (Number.isNaN(Date.parse(text))) {
    throw new Error('exportedAt must be an ISO timestamp');
  }
  return text;
}

function requireRevision(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidRevision(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function requireSafeText(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > BUG_BUNDLE_LIMITS.maxText ||
    hasSensitiveText(value)
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function requireBoundedSeed(value: unknown, label: string): number {
  return requireBoundedInteger(value, label, -0x80000000, 0x7fffffff);
}

function requireBoundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} is outside the allowed range`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertObjectKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${label} contains unsupported field ${key}`);
    }
  }
}

function assertBoundedJson(value: unknown, label: string, depth = 0): void {
  if (depth > BUG_BUNDLE_LIMITS.maxJsonDepth) {
    throw new Error(`${label} is too deeply nested`);
  }
  if (typeof value === 'string') {
    if (value.length > BUG_BUNDLE_LIMITS.maxText || hasSensitiveText(value)) {
      throw new Error(`${label} contains unsafe text`);
    }
    return;
  }
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > BUG_BUNDLE_LIMITS.maxArrayItems) {
      throw new Error(`${label} contains too many entries`);
    }
    value.forEach((entry, index) => assertBoundedJson(entry, `${label}[${String(index)}]`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > BUG_BUNDLE_LIMITS.maxObjectKeys) {
      throw new Error(`${label} contains too many fields`);
    }
    for (const key of keys) {
      if (key.length > BUG_BUNDLE_LIMITS.maxText || hasSensitiveText(key)) {
        throw new Error(`${label} contains an unsafe field name`);
      }
      assertBoundedJson(record[key], `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${label} contains unsupported data`);
}

function hasSensitiveText(value: string): boolean {
  const remoteOrSecret = /(?:\b(?:https?|file|ssh):\/\/|\b(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?|bearer|password|secret|credential|connection\s*string|private\s*key|token)\b)/iu;
  const absolutePath = /(?:^|[\s"'=:(])(?:~[\\/]|\.{1,2}[\\/]|\/(?:[^/\s]+\/)+|[A-Za-z]:[\\/]|\\\\)/u;
  return remoteOrSecret.test(value) || absolutePath.test(value);
}

function assertArtifactSize(value: BugBundle): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || textByteLength(serialized) > BUG_BUNDLE_LIMITS.maxArtifactBytes) {
    throw new Error('Bug bundle exceeds the bounded artifact size');
  }
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function findFirstMismatch(
  expected: readonly StateChecksum[],
  actual: readonly StateChecksum[],
): BugBundleChecksumMismatch | null {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const left = expected[index] ?? null;
    const right = actual[index] ?? null;
    if (left === null || right === null || left.tick !== right.tick || left.hash !== right.hash) {
      return { index, expected: left, actual: right };
    }
  }
  return null;
}

function formatReplayMismatch(mismatch: BugBundleChecksumMismatch | null): string {
  if (mismatch === null) {
    return 'Bug bundle replay checksum sequence did not match';
  }
  const expected = mismatch.expected === null
    ? 'missing'
    : `${String(mismatch.expected.tick)}:${String(mismatch.expected.hash)}`;
  const actual = mismatch.actual === null
    ? 'missing'
    : `${String(mismatch.actual.tick)}:${String(mismatch.actual.hash)}`;
  return `Bug bundle replay checksum mismatch at sequence ${String(mismatch.index)} (expected ${expected}, actual ${actual})`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
