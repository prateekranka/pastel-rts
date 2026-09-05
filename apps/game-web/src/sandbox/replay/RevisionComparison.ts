import {
  computeContentHash,
  type CommandEnvelopeV1,
  type MapDef,
  type PackV2,
  type ScenarioDef,
} from '@pastel-rts/content-schema';
import { NavigationService, type NavigationService as NavigationServiceType } from '@pastel-rts/navigation';
import { runSimulationReplay, type ReplayResult } from '@pastel-rts/simulation';
import type { RuntimeContentIdentity } from '../../content/PublishedContentClient';

export type RevisionReplayInput = {
  identity: RuntimeContentIdentity;
  pack: PackV2;
  scenario: ScenarioDef;
  map: MapDef;
  seed: number;
  commands: readonly CommandEnvelopeV1[];
  totalTicks: number;
};

export type RevisionReplayOutcome = 'identical' | 'rules-differ' | 'visual-or-runtime-differ';

export type RevisionComparisonResult = {
  schemaVersion: 1;
  inputs: {
    scenarioId: string;
    scenarioHash: string;
    mapId: string;
    mapHash: string;
    seed: number;
    totalTicks: number;
    commandLogHash: string;
    commandCount: number;
  };
  a: RevisionReplayIdentityResult;
  b: RevisionReplayIdentityResult;
  checksumsEqual: boolean;
  commandLogLengthsEqual: boolean;
  rulesDiffer: boolean;
  outcome: RevisionReplayOutcome;
  firstMismatch: { tick: number; aHash: number | null; bHash: number | null } | null;
};

type RevisionReplayIdentityResult = {
  revision: string;
  packId: string;
  contentHash: string;
  visualContentHash: string;
  simulationRulesHash: string;
  checksums: Array<{ tick: number; hash: number }>;
  commandLogLength: number;
};

/**
 * Run two immutable revisions with exactly one shared scene/map/seed/command
 * input. A rules hash difference is reported, not turned into an equality claim.
 */
export function compareRevisionReplays(
  a: RevisionReplayInput,
  b: RevisionReplayInput,
  navFactory: () => NavigationServiceType = () => new NavigationService(),
): RevisionComparisonResult {
  validateInput(a, 'A');
  validateInput(b, 'B');
  const shared = sharedInput(a, b);
  const first = runReplay(a, navFactory);
  const second = runReplay(b, navFactory);
  const checksumsEqual = equalChecksums(first, second);
  const commandLogLengthsEqual = first.commandLogLength === second.commandLogLength;
  const rulesDiffer = a.identity.simulationRulesHash !== b.identity.simulationRulesHash;
  const firstMismatch = findFirstMismatch(first, second);
  const outcome: RevisionReplayOutcome = checksumsEqual && commandLogLengthsEqual
    ? 'identical'
    : rulesDiffer
      ? 'rules-differ'
      : 'visual-or-runtime-differ';

  return {
    schemaVersion: 1,
    inputs: shared,
    a: resultIdentity(a, first),
    b: resultIdentity(b, second),
    checksumsEqual,
    commandLogLengthsEqual,
    rulesDiffer,
    outcome,
    firstMismatch,
  };
}

export const runRevisionComparison = compareRevisionReplays;
export const compareRevisions = compareRevisionReplays;

function runReplay(input: RevisionReplayInput, navFactory: () => NavigationServiceType): ReplayResult {
  return runSimulationReplay({
    pack: input.pack,
    navFactory,
    scenario: input.scenario,
    map: input.map,
    commands: [...input.commands],
    totalTicks: input.totalTicks,
    simulationConfig: { seed: input.seed },
  });
}

function resultIdentity(input: RevisionReplayInput, result: ReplayResult): RevisionReplayIdentityResult {
  return {
    revision: input.identity.revision,
    packId: input.identity.packId,
    contentHash: input.identity.contentHash,
    visualContentHash: input.identity.visualContentHash,
    simulationRulesHash: input.identity.simulationRulesHash,
    checksums: result.checksums.map((checksum) => ({ ...checksum })),
    commandLogLength: result.commandLogLength,
  };
}

function sharedInput(a: RevisionReplayInput, b: RevisionReplayInput): RevisionComparisonResult['inputs'] {
  const aScenarioHash = computeContentHash(a.scenario);
  const bScenarioHash = computeContentHash(b.scenario);
  const aMapHash = computeContentHash(a.map);
  const bMapHash = computeContentHash(b.map);
  const aCommandHash = computeContentHash(a.commands);
  const bCommandHash = computeContentHash(b.commands);
  if (
    a.scenario.id !== b.scenario.id ||
    aScenarioHash !== bScenarioHash ||
    a.map.id !== b.map.id ||
    aMapHash !== bMapHash ||
    a.seed !== b.seed ||
    a.totalTicks !== b.totalTicks ||
    aCommandHash !== bCommandHash
  ) {
    throw new Error('Revision comparison inputs are not identical');
  }
  return {
    scenarioId: a.scenario.id,
    scenarioHash: aScenarioHash,
    mapId: a.map.id,
    mapHash: aMapHash,
    seed: a.seed,
    totalTicks: a.totalTicks,
    commandLogHash: aCommandHash,
    commandCount: a.commands.length,
  };
}

function validateInput(input: RevisionReplayInput, label: string): void {
  if (!Number.isSafeInteger(input.seed) || !Number.isSafeInteger(input.totalTicks) || input.totalTicks < 0) {
    throw new Error(`Revision ${label} replay inputs are invalid`);
  }
  if (
    input.identity.packId !== input.pack.id ||
    input.identity.contentHash !== input.pack.contentHash ||
    input.identity.revision !== input.pack.revision
  ) {
    throw new Error(`Revision ${label} identity does not match its Pack v2`);
  }
  if (computeContentHash(input.pack) !== input.pack.contentHash) {
    throw new Error(`Revision ${label} Pack v2 hash is invalid`);
  }
}

function equalChecksums(a: ReplayResult, b: ReplayResult): boolean {
  return (
    a.checksums.length === b.checksums.length &&
    a.checksums.every(
      (checksum, index) =>
        checksum.tick === b.checksums[index]?.tick && checksum.hash === b.checksums[index]?.hash,
    )
  );
}

function findFirstMismatch(a: ReplayResult, b: ReplayResult): RevisionComparisonResult['firstMismatch'] {
  const length = Math.max(a.checksums.length, b.checksums.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.checksums[index];
    const right = b.checksums[index];
    if (left?.tick !== right?.tick || left?.hash !== right?.hash) {
      return {
        tick: left?.tick ?? right?.tick ?? 0,
        aHash: left?.hash ?? null,
        bHash: right?.hash ?? null,
      };
    }
  }
  return null;
}
