#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  type MapDef,
  type PackV2,
  type ScenarioDef,
} from '@pastel-rts/content-schema';
import type { StateChecksum } from '@pastel-rts/simulation';

type BundleArgs = {
  scenario: string;
  diagnostics: string;
  output: string;
  steps?: string;
};

type AssetCoverage = 'json-only';

type ScenarioQaArtifact = {
  schemaVersion: 1;
  kind: 'qa-scenario';
  content: {
    pack: PackV2;
    scenario: ScenarioDef;
    map: MapDef;
    assetCoverage: AssetCoverage;
    assetHashes: [];
  };
  identity: {
    packId: string;
    revision: string;
    contentHash: string;
    simulationRulesHash: string;
    visualContentHash: string;
    scenarioId: string;
    scenarioHash: string;
    mapId: string;
    mapHash: string;
    seed: number;
    totalTicks: number;
    assetCoverage: AssetCoverage;
  };
  replay: { commands: CommandEnvelopeV1[]; checksums: StateChecksum[]; commandLogLength: number };
  reproduction: string[];
};

type QaBundleArtifact = {
  schemaVersion: 1;
  kind: 'qa-bundle';
  content: {
    packId: string;
    revision: string;
    contentHash: string;
    simulationRulesHash: string;
    visualContentHash: string;
    pack: PackV2;
    scenarioId: string;
    scenarioHash: string;
    scenario: ScenarioDef;
    mapId: string;
    mapHash: string;
    map: MapDef;
    assetCoverage: AssetCoverage;
    assetHashes: [];
  };
  replay: {
    seed: number;
    totalTicks: number;
    commands: CommandEnvelopeV1[];
    checksums: StateChecksum[];
    commandLogLength: number;
  };
  diagnostics: Record<string, string | number | boolean>;
  reproduction: { steps: string[] };
};

const MAX_COMMANDS = 1024;
const MAX_TICKS = 100_000;
const MAX_CHECKSUMS = 4096;
const MAX_STEPS = 16;
const MAX_DIAGNOSTICS = 32;
const MAX_TEXT = 256;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_ARRAY_ITEMS = 4096;
const ASSET_COVERAGE: AssetCoverage = 'json-only';
const ALLOWED_DIAGNOSTICS = new Set([
  'renderer',
  'rendererBackend',
  'rendererContext',
  'frameP95Ms',
  'frameP99Ms',
  'frameAvgMs',
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
  'checksum',
]);

export async function buildQaBundle(args: BundleArgs): Promise<QaBundleArtifact> {
  const scenario = validateScenarioArtifact(await readJson(args.scenario, 'scenario artifact'));
  const diagnostics = sanitizeDiagnostics(await readJson(args.diagnostics, 'diagnostics'));
  const steps = args.steps
    ? sanitizeSteps(await readJson(args.steps, 'reproduction steps'))
    : sanitizeSteps(scenario.reproduction);
  const artifact: QaBundleArtifact = {
    schemaVersion: 1,
    kind: 'qa-bundle',
    content: {
      packId: scenario.identity.packId,
      revision: scenario.identity.revision,
      contentHash: scenario.identity.contentHash,
      simulationRulesHash: scenario.identity.simulationRulesHash,
      visualContentHash: scenario.identity.visualContentHash,
      pack: scenario.content.pack,
      scenarioId: scenario.identity.scenarioId,
      scenarioHash: scenario.identity.scenarioHash,
      scenario: scenario.content.scenario,
      mapId: scenario.identity.mapId,
      mapHash: scenario.identity.mapHash,
      map: scenario.content.map,
      assetCoverage: ASSET_COVERAGE,
      assetHashes: [],
    },
    replay: {
      seed: scenario.identity.seed,
      totalTicks: scenario.identity.totalTicks,
      commands: scenario.replay.commands,
      checksums: scenario.replay.checksums,
      commandLogLength: scenario.replay.commandLogLength,
    },
    diagnostics,
    reproduction: { steps },
  };
  assertBoundedSafeJson(artifact, 'qa bundle');
  if (Buffer.byteLength(JSON.stringify(artifact), 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new Error('qa bundle exceeds the bounded artifact size');
  }
  return artifact;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const artifact = await buildQaBundle(args);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new Error('qa bundle exceeds the bounded artifact size');
  }
  if (args.output === '-') {
    process.stdout.write(serialized);
    return;
  }
  await mkdir(resolve(args.output, '..'), { recursive: true });
  await writeFile(args.output, serialized, 'utf8');
}

function parseArgs(argv: string[]): BundleArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) {
      throw new Error('Arguments must use explicit --name value pairs');
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }
    if (!['scenario', 'diagnostics', 'output', 'steps'].includes(name)) {
      throw new Error(`Unknown argument --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate argument --${name}`);
    }
    values.set(name, value);
    index += 1;
  }
  const scenario = required(values, 'scenario');
  const diagnostics = required(values, 'diagnostics');
  const output = required(values, 'output');
  assertJsonInputPath(scenario, 'scenario');
  assertJsonInputPath(diagnostics, 'diagnostics');
  if (output !== '-') {
    assertPath(output, 'output');
  }
  const steps = values.get('steps');
  if (steps) {
    assertJsonInputPath(steps, 'steps');
  }
  return { scenario, diagnostics, output, ...(steps ? { steps } : {}) };
}

async function readJson(pathValue: string, label: string): Promise<unknown> {
  try {
    const input = await stat(pathValue);
    if (!input.isFile() || input.size > MAX_INPUT_BYTES) {
      throw new Error('input is not a bounded JSON file');
    }
    return JSON.parse(await readFile(pathValue, 'utf8')) as unknown;
  } catch {
    throw new Error(`Cannot read valid ${label} JSON input`);
  }
}

function validateScenarioArtifact(value: unknown): ScenarioQaArtifact {
  if (!isObject(value) || value.schemaVersion !== 1 || value.kind !== 'qa-scenario') {
    throw new Error('scenario input is not a qa-scenario artifact');
  }
  const content = value.content;
  const identity = value.identity;
  const replay = value.replay;
  if (!isObject(content) || !isObject(identity) || !isObject(replay)) {
    throw new Error('scenario artifact shape is invalid');
  }
  if (content.assetCoverage !== ASSET_COVERAGE || identity.assetCoverage !== ASSET_COVERAGE) {
    throw new Error('scenario artifact must declare json-only asset coverage');
  }
  const pack = validatePackV2(content.pack);
  assertRawPackHash(content.pack, pack);
  assertRawPackRevision(content.pack, pack);
  const scenario = validateScenarioDef(content.scenario);
  const map = validateMapDef(content.map);
  if (!Array.isArray(content.assetHashes) || content.assetHashes.length !== 0) {
    throw new Error('scenario artifact asset hash list is outside the bounded format');
  }
  assertBoundedSafeJson(pack, 'scenario pack');
  assertBoundedSafeJson(scenario, 'scenario definition');
  assertBoundedSafeJson(map, 'map definition');
  if (!Array.isArray(replay.commands) || replay.commands.length > MAX_COMMANDS) {
    throw new Error('scenario artifact command list is invalid');
  }
  const commands = replay.commands.map((command, index) => {
    try {
      return validateCommandEnvelope(command);
    } catch {
      throw new Error(`scenario artifact command ${String(index)} is invalid`);
    }
  });
  assertBoundedSafeJson(commands, 'scenario commands');
  const checksums = validateChecksums(replay.checksums);
  const commandLogLengthValue = replay.commandLogLength;
  if (
    typeof commandLogLengthValue !== 'number' ||
    !Number.isSafeInteger(commandLogLengthValue) ||
    commandLogLengthValue < commands.length ||
    commandLogLengthValue > MAX_COMMANDS * 2
  ) {
    throw new Error('scenario artifact command log length is invalid');
  }
  const commandLogLength = commandLogLengthValue;
  const packId = requireSafeText(identity.packId, 'identity.packId');
  const revision = requireRevision(identity.revision, 'identity.revision');
  const contentHash = requireHash(identity.contentHash, 'identity.contentHash');
  const simulationRulesHash = requireHash(identity.simulationRulesHash, 'identity.simulationRulesHash');
  const visualContentHash = requireHash(identity.visualContentHash, 'identity.visualContentHash');
  const scenarioId = requireSafeText(identity.scenarioId, 'identity.scenarioId');
  const scenarioHash = requireHash(identity.scenarioHash, 'identity.scenarioHash');
  const mapId = requireSafeText(identity.mapId, 'identity.mapId');
  const mapHash = requireHash(identity.mapHash, 'identity.mapHash');
  const seed = requireBoundedSeed(identity.seed);
  const totalTicksValue = identity.totalTicks;
  if (
    typeof totalTicksValue !== 'number' ||
    !Number.isSafeInteger(totalTicksValue) ||
    totalTicksValue < 0 ||
    totalTicksValue > MAX_TICKS
  ) {
    throw new Error('scenario artifact replay controls are invalid');
  }
  const totalTicks = totalTicksValue;
  if (
    packId !== pack.id ||
    revision !== pack.revision ||
    contentHash !== pack.contentHash ||
    scenarioId !== scenario.id ||
    scenarioHash !== computeContentHash(scenario) ||
    mapId !== map.id ||
    mapHash !== computeContentHash(map) ||
    simulationRulesHash !== computeSimulationRulesHash(pack, []) ||
    visualContentHash !== computeVisualContentHash(pack, [])
  ) {
    throw new Error('scenario artifact identity or content hash mismatch');
  }
  assertPublishedReferences(pack, scenario, map);
  const reproduction = value.reproduction === undefined ? [] : sanitizeSteps(value.reproduction);
  const artifact: ScenarioQaArtifact = {
    schemaVersion: 1,
    kind: 'qa-scenario',
    content: { pack, scenario, map, assetCoverage: ASSET_COVERAGE, assetHashes: [] },
    identity: {
      packId,
      revision,
      contentHash,
      simulationRulesHash,
      visualContentHash,
      scenarioId,
      scenarioHash,
      mapId,
      mapHash,
      seed,
      totalTicks,
      assetCoverage: ASSET_COVERAGE,
    },
    replay: { commands, checksums, commandLogLength },
    reproduction,
  };
  assertBoundedSafeJson(artifact, 'scenario artifact');
  return artifact;
}

function validateChecksums(value: unknown): StateChecksum[] {
  if (!Array.isArray(value) || value.length > MAX_CHECKSUMS) {
    throw new Error('scenario artifact checksums are invalid');
  }
  let previousTick = -1;
  return value.map((entry, index) => {
    const tick = isObject(entry) ? entry.tick : undefined;
    const hash = isObject(entry) ? entry.hash : undefined;
    if (
      typeof tick !== 'number' ||
      typeof hash !== 'number' ||
      !Number.isSafeInteger(tick) ||
      !Number.isSafeInteger(hash) ||
      tick < 0 ||
      hash < 0 ||
      tick <= previousTick
    ) {
      throw new Error(`scenario artifact checksum ${String(index)} is invalid`);
    }
    previousTick = tick;
    return { tick, hash };
  });
}

function assertPublishedReferences(pack: PackV2, scenario: ScenarioDef, map: MapDef): void {
  const mapReferences = (pack.maps ?? []).filter((entry) => entry.id === map.id);
  const scenarioReferences = (pack.scenarios ?? []).filter((entry) => entry.id === scenario.id);
  if (mapReferences.length !== 1 || scenarioReferences.length !== 1) {
    throw new Error('scenario artifact references an unknown or duplicate map or scenario');
  }
  const scenarioReference = scenarioReferences[0];
  if (scenario.mapId !== map.id || (scenarioReference.mapId !== undefined && scenarioReference.mapId !== map.id)) {
    throw new Error('scenario artifact scenario/map record mismatch');
  }
}

function requireSafeText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT || hasSensitiveText(value)) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function requireRevision(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidRevision(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireBoundedSeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error('scenario artifact seed is outside the allowed range');
  }
  return value;
}

function assertBoundedSafeJson(value: unknown, label: string, depth = 0): void {
  if (depth > 24) {
    throw new Error(`${label} is too deeply nested`);
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT || hasSensitiveText(value)) {
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
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`${label} contains too many entries`);
    }
    value.forEach((entry, index) => assertBoundedSafeJson(entry, `${label}[${String(index)}]`, depth + 1));
    return;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > MAX_ARRAY_ITEMS) {
      throw new Error(`${label} contains too many fields`);
    }
    for (const key of keys) {
      if (key.length > MAX_TEXT || hasSensitiveText(key)) {
        throw new Error(`${label} contains an unsafe field name`);
      }
      assertBoundedSafeJson(value[key], `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${label} contains unsupported JSON data`);
}

function sanitizeDiagnostics(value: unknown): Record<string, string | number | boolean> {
  if (!isObject(value) || Object.keys(value).length > MAX_DIAGNOSTICS) {
    throw new Error('diagnostics must be a bounded object');
  }
  const output: Record<string, string | number | boolean> = {};
  for (const key of [...ALLOWED_DIAGNOSTICS]) {
    if (!(key in value)) {
      continue;
    }
    const item = value[key];
    if (typeof item === 'string') {
      if (item.length > MAX_TEXT || hasSensitiveText(item)) {
        throw new Error(`diagnostics field ${key} is unsafe`);
      }
      output[key] = item;
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      if (typeof item === 'number' && !Number.isFinite(item)) {
        throw new Error(`diagnostics field ${key} is not finite`);
      }
      output[key] = item;
    } else {
      throw new Error(`diagnostics field ${key} must be scalar`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_DIAGNOSTICS.has(key)) {
      throw new Error(`diagnostics field ${key} is not allowlisted`);
    }
  }
  return output;
}

function sanitizeSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_STEPS) {
    throw new Error(`reproduction steps must contain at most ${String(MAX_STEPS)} strings`);
  }
  return value.map((step, index) => {
    if (typeof step !== 'string' || step.length === 0 || step.length > MAX_TEXT || hasSensitiveText(step)) {
      throw new Error(`reproduction step ${String(index)} is unsafe`);
    }
    return step;
  });
}

function assertRawPackHash(value: unknown, pack: PackV2): void {
  if (!isObject(value) || value.contentHash !== pack.contentHash) {
    throw new Error('Pack v2 content hash mismatch');
  }
}

function assertRawPackRevision(value: unknown, pack: PackV2): void {
  if (!isObject(value) || typeof value.revision !== 'string' || !isValidRevision(value.revision) || value.revision !== pack.revision) {
    throw new Error('Pack v2 revision must be an exact safe string');
  }
}

function hasSensitiveText(value: string): boolean {
  const remoteOrSecret = /(?:\b(?:https?|file|ssh):\/\/|\b(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?|bearer|password|secret|credential|connection\s*string|private\s*key|token)\b)/iu;
  const localPath = /(?:^|[\s"'=:(])(?:~[\\/]|\.{1,2}[\\/]|\/[\\/]|[A-Za-z]:[\\/]|\\\\|\/(?:[^/\s]+\/)+[^/\s]+)/u;
  return remoteOrSecret.test(value) || localPath.test(value);
}

function assertJsonInputPath(value: string, label: string): void {
  assertPath(value, label);
  if (!/\.json$/iu.test(value)) {
    throw new Error(`${label} input must be a JSON file`);
  }
  const segments = value.replaceAll(String.fromCharCode(92), '/').split('/');
  if (segments.some((segment) => /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.config)$/iu.test(segment) || /(?:credentials?|secrets?|passwords?|tokens?)\b/iu.test(segment))) {
    throw new Error(`${label} input path is private`);
  }
}

function assertPath(value: string, label: string): void {
  if (/^(?:https?|file):/iu.test(value) || value.split(/[\\/]/u).some((segment) => segment === '..')) {
    throw new Error(`${label} path must be a local non-traversal path`);
  }
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`qa:bundle failed: ${message}\n`);
    process.exitCode = 1;
  });
}
