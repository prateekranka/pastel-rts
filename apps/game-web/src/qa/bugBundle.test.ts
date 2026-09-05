import { describe, expect, it } from 'vitest';
import {
  computeContentHash,
  computeSimulationRulesHash,
  computeVisualContentHash,
  type CommandEnvelopeV1,
  type CommandResult,
  type MapDef,
  type PackV2,
  type ScenarioDef,
  validatePackV2,
} from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { createTestPackV2, runSimulationReplay } from '@pastel-rts/simulation';
import type { RuntimeContentIdentity } from '../content/PublishedContentClient';
import type { ScenarioSaveDocument } from '../sandbox/types';
import {
  BUG_BUNDLE_ASSET_COVERAGE,
  BUG_BUNDLE_LIMITS,
  assertBugBundleMatchesRuntime,
  exportBugBundle,
  importAndReproduceBugBundle,
  parseBugBundle,
  replayBugBundle,
  type BugBundle,
  type BugBundleRuntime,
  type BugBundleRuntimeContent,
} from './bugBundle';

function createFixture(): {
  pack: PackV2;
  scenario: ScenarioDef;
  map: MapDef;
  identity: RuntimeContentIdentity;
  runtime: BugBundleRuntime;
  save: ScenarioSaveDocument;
} {
  const packBase = createTestPackV2();
  const packWithReferences = {
    ...packBase,
    maps: [{ id: 'lab-map', path: 'maps/lab-map.json' }],
    scenarios: [{ id: 'lab-scenario', path: 'scenarios/lab-scenario.json', mapId: 'lab-map' }],
  };
  const pack: PackV2 = validatePackV2(packWithReferences);
  const scenario: ScenarioDef = {
    schemaVersion: 1,
    id: 'lab-scenario',
    displayName: 'Lab Scenario',
    mapId: 'lab-map',
    units: [
      {
        archetypeId: 'sunweaver-scout',
        position: { x: 4096, z: 4096 },
        factionId: 'sunweaver',
      },
    ],
    buildings: [],
  };
  const map: MapDef = {
    schemaVersion: 1,
    id: 'lab-map',
    displayName: 'Lab Map',
    cellsX: 32,
    cellsZ: 32,
    chunkSize: 16,
  };
  const commands: CommandEnvelopeV1[] = [
    {
      protocolVersion: 1,
      commandId: 'lab-stop-1',
      sequence: 0,
      issuedAtTick: 1,
      executeTick: 1,
      playerId: 'lab-local',
      kind: 'stop',
      payload: { kind: 'stop', entityIds: [{ index: 0, generation: 1 }] },
    },
  ];
  const replay = runSimulationReplay({
    pack,
    navFactory: () => new NavigationService(),
    scenario,
    map,
    commands,
    totalTicks: 12,
    simulationConfig: { seed: 42 },
  });
  const identity: RuntimeContentIdentity = {
    source: 'bundle',
    packId: pack.id,
    revision: pack.revision,
    contentHash: pack.contentHash,
    manifestHash: null,
    visualContentHash: computeVisualContentHash(pack),
    simulationRulesHash: computeSimulationRulesHash(pack),
  };
  const commandResults: CommandResult[] = [
    {
      type: 'commandResult',
      commandId: 'lab-stop-1',
      status: 'accepted',
      acceptedAtTick: 1,
    },
  ];
  const save: ScenarioSaveDocument = {
    schemaVersion: 1,
    scenarioId: scenario.id,
    scenario,
    mapId: map.id,
    map,
    seed: 42,
    replayToTick: 12,
    packId: pack.id,
    packHash: pack.contentHash,
    contentHash: pack.contentHash,
    revision: pack.revision,
    manifestHash: null,
    visualContentHash: identity.visualContentHash,
    simulationRulesHash: identity.simulationRulesHash,
    mapHash: computeContentHash(map),
    scenarioHash: computeContentHash(scenario),
    commandLog: commands,
    commandResults,
    checksums: replay.checksums,
    contentSource: 'bundle',
  };
  return {
    pack,
    scenario,
    map,
    identity,
    runtime: {
      renderer: 'webgl',
      viewport: { width: 1280, height: 800 },
      dpr: 1,
      mode: 'interaction-lab',
    },
    save,
  };
}

function createBundle(): { bundle: BugBundle; fixture: ReturnType<typeof createFixture> } {
  const fixture = createFixture();
  const bundle = exportBugBundle({
    pack: fixture.pack,
    save: fixture.save,
    runtime: fixture.runtime,
    diagnostics: {
      activeRevision: fixture.identity.revision,
      contentHash: fixture.identity.contentHash,
      simulationRulesHash: fixture.identity.simulationRulesHash,
      scenarioId: fixture.scenario.id,
      seed: fixture.save.seed,
      tick: fixture.save.replayToTick,
      checksum: fixture.save.checksums.at(-1)?.hash ?? 0,
    },
  });
  return { bundle, fixture };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('runtime bug bundle', () => {
  it('exports the validated scene identity, ordered replay and default steps', () => {
    const { bundle, fixture } = createBundle();

    expect(bundle.content.assetCoverage).toBe(BUG_BUNDLE_ASSET_COVERAGE);
    expect(bundle.content.assetHashes).toEqual([]);
    expect(bundle.content.pack).toEqual(fixture.pack);
    expect(bundle.content.scenario).toEqual(fixture.scenario);
    expect(bundle.content.map).toEqual(fixture.map);
    expect(bundle.identity.revision).toBe(fixture.identity.revision);
    expect(bundle.identity.scenarioHash).toBe(computeContentHash(fixture.scenario));
    expect(bundle.identity.mapHash).toBe(computeContentHash(fixture.map));
    expect(bundle.replay.tickRange).toEqual({ startTick: 0, endTick: 12 });
    expect(bundle.replay.commands).toEqual(fixture.save.commandLog);
    expect(bundle.replay.checksums).toEqual(fixture.save.checksums);
    expect(bundle.reproduction.steps.length).toBeGreaterThan(0);
    expect(bundle.reproduction.steps.join(' ')).toContain('checksum');
    expect(parseBugBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it('refuses excess commands and steps instead of truncating replay data', () => {
    const fixture = createFixture();
    const tooManyCommands: CommandEnvelopeV1[] = Array.from(
      { length: BUG_BUNDLE_LIMITS.maxCommands + 1 },
      (_, index) => ({
        protocolVersion: 1,
        commandId: `lab-stop-${String(index)}`,
        sequence: index,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: 'lab-local',
        kind: 'stop' as const,
        payload: { kind: 'stop' as const, entityIds: [{ index: 0, generation: 1 }] },
      }),
    );
    expect(() =>
      exportBugBundle({
        pack: fixture.pack,
        save: { ...fixture.save, commandLog: tooManyCommands },
        runtime: fixture.runtime,
        diagnostics: {},
      }),
    ).toThrow(/at most 1024/);
    expect(() =>
      exportBugBundle({
        pack: fixture.pack,
        save: fixture.save,
        runtime: fixture.runtime,
        diagnostics: {},
        reproductionSteps: Array.from(
          { length: BUG_BUNDLE_LIMITS.maxSteps + 1 },
          () => 'Repeat the recorded lab action.',
        ),
      }),
    ).toThrow(/reproduction steps/);
  });

  it('rejects identity tampering and active content mismatch', () => {
    const { bundle, fixture } = createBundle();
    const tamperedRevision = clone(bundle) as unknown as Record<string, unknown>;
    const identity = tamperedRevision['identity'] as Record<string, unknown>;
    identity['revision'] = '999';
    expect(() => parseBugBundle(tamperedRevision)).toThrow(/identity does not match/);

    const mismatchedRuntime: BugBundleRuntimeContent = {
      pack: fixture.pack,
      identity: { ...fixture.identity, visualContentHash: 'a'.repeat(64) },
      scenario: fixture.scenario,
      map: fixture.map,
    };
    expect(() => assertBugBundleMatchesRuntime(bundle, mismatchedRuntime)).toThrow(
      /tampered or does not match/,
    );
  });

  it('rejects unsafe diagnostics, unknown diagnostics and private reproduction steps', () => {
    const fixture = createFixture();
    expect(() =>
      exportBugBundle({
        pack: fixture.pack,
        save: fixture.save,
        runtime: fixture.runtime,
        diagnostics: { renderer: 'file:///home/bobbyranka/private' },
      }),
    ).toThrow(/diagnostics field renderer is unsafe/);
    expect(() =>
      exportBugBundle({
        pack: fixture.pack,
        save: fixture.save,
        runtime: fixture.runtime,
        diagnostics: { privatePath: 'not allowed' },
      }),
    ).toThrow(/not allowlisted/);
    expect(() =>
      exportBugBundle({
        pack: fixture.pack,
        save: fixture.save,
        runtime: fixture.runtime,
        diagnostics: {},
        reproductionSteps: ['Open /home/bobbyranka/private bundle data.'],
      }),
    ).toThrow(/unsafe/);
  });

  it('returns the exact actual checksum sequence and identifies a mismatch', () => {
    const { bundle } = createBundle();
    const matched = replayBugBundle(bundle);
    expect(matched.matched).toBe(true);
    expect(matched.actual).toEqual(matched.expected);
    expect(matched.firstMismatch).toBeNull();

    const changed = clone(bundle);
    const first = changed.replay.checksums[0];
    if (!first) {
      throw new Error('fixture must produce a checksum');
    }
    first.hash += 1;
    const mismatch = replayBugBundle(changed);
    expect(mismatch.matched).toBe(false);
    expect(mismatch.firstMismatch?.index).toBe(0);
    expect(mismatch.firstMismatch?.expected?.hash).toBe(first.hash);
    expect(mismatch.firstMismatch?.actual?.hash).not.toBe(first.hash);
  });

  it('preserves the prior target save when an apply failure occurs', () => {
    const { bundle, fixture } = createBundle();
    const prior = { ...fixture.save, seed: 7 };
    let active = clone(prior);
    let importCount = 0;
    const result = () =>
      importAndReproduceBugBundle(bundle, {
        getRuntimeContent: () => ({
          pack: fixture.pack,
          identity: fixture.identity,
          scenario: fixture.scenario,
          map: fixture.map,
        }),
        exportSave: () => clone(active),
        importSave: (next) => {
          active = clone(next);
          importCount += 1;
          if (importCount === 1) {
            throw new Error('simulated apply failure');
          }
        },
      });

    expect(result).toThrow('simulated apply failure');
    expect(active.seed).toBe(prior.seed);
    expect(importCount).toBe(2);
  });
});
