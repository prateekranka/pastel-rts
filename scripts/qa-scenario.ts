#!/usr/bin/env node
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
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
import { NavigationService } from '@pastel-rts/navigation';
import { runSimulationReplay, type StateChecksum } from '@pastel-rts/simulation';

type CliArgs = {
  pack: string;
  scenario: string;
  map: string;
  commands: string;
  output: string;
  seed: number;
  ticks: number;
  revision?: string;
  contentHash?: string;
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
  replay: {
    commands: CommandEnvelopeV1[];
    checksums: StateChecksum[];
    commandLogLength: number;
  };
  reproduction: string[];
};

const MAX_COMMANDS = 1024;
const MAX_TICKS = 100_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 256;
const MAX_ARRAY_ITEMS = 4096;
const ASSET_COVERAGE: AssetCoverage = 'json-only';

export async function buildScenarioArtifact(args: CliArgs): Promise<ScenarioQaArtifact> {
  const rawPack = await readJson(args.pack, 'pack');
  const pack = validatePackV2(rawPack);
  assertRawPackHash(rawPack, pack);
  assertRawPackRevision(rawPack, pack);
  if (!isValidRevision(pack.revision)) {
    throw new Error('Pack revision is not a safe revision identifier');
  }
  if (args.revision !== undefined && args.revision !== pack.revision) {
    throw new Error('Requested revision does not match the Pack v2 revision');
  }
  if (args.contentHash !== undefined && args.contentHash !== pack.contentHash) {
    throw new Error('Requested content hash does not match the Pack v2 content hash');
  }

  const scenario = validateScenarioDef(await readJson(args.scenario, 'scenario'));
  const map = validateMapDef(await readJson(args.map, 'map'));
  await assertScenarioReferences(pack, scenario, map, args.pack, args.scenario, args.map);
  assertBoundedSafeJson(pack, 'pack');
  assertBoundedSafeJson(scenario, 'scenario');
  assertBoundedSafeJson(map, 'map');
  const commands = await readCommands(args.commands);
  assertBoundedSafeJson(commands, 'commands');
  const replay = runSimulationReplay({
    pack,
    scenario,
    map,
    commands,
    totalTicks: args.ticks,
    navFactory: () => new NavigationService(),
    simulationConfig: { seed: args.seed },
  });
  const assetHashes: [] = [];
  const artifact: ScenarioQaArtifact = {
    schemaVersion: 1,
    kind: 'qa-scenario',
    content: { pack, scenario, map, assetCoverage: ASSET_COVERAGE, assetHashes },
    identity: {
      packId: pack.id,
      revision: pack.revision,
      contentHash: pack.contentHash,
      simulationRulesHash: computeSimulationRulesHash(pack, assetHashes),
      visualContentHash: computeVisualContentHash(pack, assetHashes),
      scenarioId: scenario.id,
      scenarioHash: computeContentHash(scenario),
      mapId: map.id,
      mapHash: computeContentHash(map),
      seed: args.seed,
      totalTicks: args.ticks,
      assetCoverage: ASSET_COVERAGE,
    },
    replay: {
      commands,
      checksums: replay.checksums,
      commandLogLength: replay.commandLogLength,
    },
    reproduction: [
      `Load Pack v2 ${pack.id} revision ${pack.revision}.`,
      `Load scenario ${scenario.id} on map ${map.id}.`,
      `Run seed ${String(args.seed)} for ${String(args.ticks)} deterministic ticks.`,
      'Compare the recorded checksum sequence before changing content or replay inputs.',
    ],
  };
  assertBoundedSafeJson(artifact, 'scenario artifact');
  if (Buffer.byteLength(JSON.stringify(artifact), 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new Error('scenario artifact exceeds the bounded artifact size');
  }
  return artifact;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const artifact = await buildScenarioArtifact(args);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new Error('scenario artifact exceeds the bounded artifact size');
  }
  if (args.output === '-') {
    process.stdout.write(serialized);
    return;
  }
  await mkdir(resolve(args.output, '..'), { recursive: true });
  await writeFile(args.output, serialized, 'utf8');
}

function parseArgs(argv: string[]): CliArgs {
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
    if (
      !['pack', 'scenario', 'map', 'commands', 'output', 'seed', 'ticks', 'revision', 'content-hash'].includes(name)
    ) {
      throw new Error(`Unknown argument --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate argument --${name}`);
    }
    values.set(name, value);
    index += 1;
  }
  const pack = requiredPath(values, 'pack');
  const scenario = requiredPath(values, 'scenario');
  const map = requiredPath(values, 'map');
  const commands = requiredPath(values, 'commands');
  const output = values.get('output');
  if (!output) {
    throw new Error('Missing required --output');
  }
  assertJsonInputPath(pack, 'pack');
  assertJsonInputPath(scenario, 'scenario');
  assertJsonInputPath(map, 'map');
  assertJsonInputPath(commands, 'commands');
  if (output !== '-') {
    assertPathArgument(output, 'output');
  }
  const seed = parseBoundedInteger(values.get('seed'), 'seed', -0x80000000, 0x7fffffff);
  const ticks = parseBoundedInteger(values.get('ticks'), 'ticks', 0, MAX_TICKS);
  const revision = values.get('revision');
  if (revision !== undefined && !isValidRevision(revision)) {
    throw new Error('revision must be a safe revision identifier');
  }
  const contentHash = values.get('content-hash');
  if (contentHash !== undefined && !HASH_PATTERN.test(contentHash)) {
    throw new Error('content-hash must be a lowercase SHA-256 hash');
  }
  return { pack, scenario, map, commands, output, seed, ticks, ...(revision ? { revision } : {}), ...(contentHash ? { contentHash } : {}) };
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

async function readCommands(pathValue: string): Promise<CommandEnvelopeV1[]> {
  const value = await readJson(pathValue, 'commands');
  if (!Array.isArray(value) || value.length > MAX_COMMANDS) {
    throw new Error(`commands must be an array of at most ${String(MAX_COMMANDS)} entries`);
  }
  const commands = value.map((entry, index) => {
    try {
      return validateCommandEnvelope(entry);
    } catch {
      throw new Error(`command ${String(index)} is invalid`);
    }
  });
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.commandId)) {
      throw new Error('commands contain a duplicate commandId');
    }
    ids.add(command.commandId);
  }
  return commands;
}

function assertRawPackHash(value: unknown, pack: PackV2): void {
  if (!isObject(value) || typeof value.contentHash !== 'string' || value.contentHash !== pack.contentHash) {
    throw new Error('Pack v2 content hash mismatch');
  }
}

function assertRawPackRevision(value: unknown, pack: PackV2): void {
  if (!isObject(value) || typeof value.revision !== 'string' || !isValidRevision(value.revision) || value.revision !== pack.revision) {
    throw new Error('Pack v2 revision must be an exact safe string');
  }
}

async function assertScenarioReferences(
  pack: PackV2,
  scenario: ScenarioDef,
  map: MapDef,
  packPath: string,
  scenarioPath: string,
  mapPath: string,
): Promise<void> {
  const mapReferences = (pack.maps ?? []).filter((entry) => entry.id === map.id);
  const scenarioReferences = (pack.scenarios ?? []).filter((entry) => entry.id === scenario.id);
  if (mapReferences.length !== 1 || scenarioReferences.length !== 1) {
    throw new Error('Scenario or map is unknown or duplicated in this Pack v2 revision');
  }
  const mapReference = mapReferences[0];
  const scenarioReference = scenarioReferences[0];
  if (scenario.mapId !== map.id || (scenarioReference.mapId !== undefined && scenarioReference.mapId !== map.id)) {
    throw new Error('Scenario and map identities do not match');
  }
  const packRoot = dirname(await realpath(resolve(packPath)));
  const selectedScenarioPath = toPosixPath(relative(packRoot, await realpath(resolve(scenarioPath))));
  const selectedMapPath = toPosixPath(relative(packRoot, await realpath(resolve(mapPath))));
  if (selectedScenarioPath !== scenarioReference.path || selectedMapPath !== mapReference.path) {
    throw new Error('Scenario or map file does not match the selected Pack v2 record');
  }
  for (const unit of scenario.units) {
    if (!pack.units.some((archetype) => archetype.id === unit.archetypeId && archetype.enabled)) {
      throw new Error('Scenario references an unknown unit archetype');
    }
  }
  for (const building of scenario.buildings) {
    if (!pack.buildings.some((archetype) => archetype.id === building.archetypeId && archetype.enabled)) {
      throw new Error('Scenario references an unknown building archetype');
    }
  }
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

function hasSensitiveText(value: string): boolean {
  const remoteOrSecret = /(?:\b(?:https?|file|ssh):\/\/|\b(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?|bearer|password|secret|credential|connection\s*string|private\s*key|token)\b)/iu;
  const localPath = /(?:^|[\s"'=:(])(?:~[\\/]|\.{1,2}[\\/]|\/[\\/]|[A-Za-z]:[\\/]|\\\\|\/(?:[^/\s]+\/)+[^/\s]+)/u;
  return remoteOrSecret.test(value) || localPath.test(value);
}

function toPosixPath(value: string): string {
  return value.replaceAll(String.fromCharCode(92), '/');
}

function requiredPath(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function parseBoundedInteger(value: string | undefined, label: string, min: number, max: number): number {
  if (value === undefined || !/^-?\d+$/u.test(value)) {
    throw new Error(`${label} must be an explicit integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} is outside the allowed range`);
  }
  return parsed;
}

function assertJsonInputPath(value: string, label: string): void {
  assertPathArgument(value, label);
  if (!/\.json$/iu.test(value)) {
    throw new Error(`${label} input must be a JSON file`);
  }
  const segments = toPosixPath(value).split('/');
  if (segments.some((segment) => /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.config)$/iu.test(segment) || /(?:credentials?|secrets?|passwords?|tokens?)\b/iu.test(segment))) {
    throw new Error(`${label} input path is private`);
  }
}

function assertPathArgument(value: string, label: string): void {
  if (/^(?:https?|file):/iu.test(value) || value.split(/[\\/]/u).some((segment) => segment === '..')) {
    throw new Error(`${label} path must be a local non-traversal path`);
  }
  if (!isAbsolute(value) && value.trim().length === 0) {
    throw new Error(`${label} path is empty`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`qa:scenario failed: ${message}\n`);
    process.exitCode = 1;
  });
}
