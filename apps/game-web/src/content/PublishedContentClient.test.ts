import { describe, expect, it } from 'vitest';
import {
  COMMAND_PROTOCOL_VERSION,
  computeContentHash,
  computeSimulationRulesHash,
  computeVisualContentHash,
  type CommandEnvelopeV1,
  type MapDef,
  type PackV2,
  type RevisionMetadata,
  type ScenarioDef,
  validatePackV2,
} from '@pastel-rts/content-schema';
import { createTestPackV2 } from '@pastel-rts/simulation';
import { compareRevisionReplays } from '../sandbox/replay/RevisionComparison';
import {
  PublishedContentClient,
  type PublishedContentClientOptions,
  runtimeContentFromBundle,
  type ContentEventSource,
} from './PublishedContentClient';

type RevisionRecord = {
  pack: PackV2;
  metadata: RevisionMetadata;
};

class TestEventSource implements ContentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

type ClientHarness = {
  client: PublishedContentClient;
  records: Map<string, RevisionRecord>;
  sources: TestEventSource[];
  requests: string[];
  setCurrent: (revision: string) => void;
};

describe('PublishedContentClient', () => {
  it('loads the published identity and exact revision asset prefix', async () => {
    const harness = createClientHarness();

    const content = await harness.client.start();

    expect(content.identity.revision).toBe('1');
    expect(content.identity.packId).toBe(content.pack.id);
    expect(content.identity.contentHash).toBe(content.pack.contentHash);
    expect(content.identity.manifestHash).toBe(harness.records.get('1')?.metadata.manifestHash);
    expect(content.assetBaseUrl).toBe('/dev-content/v2/revisions/1/assets/');
    expect(harness.client.getStatus()).toMatchObject({
      phase: 'ready',
      selectedRevision: null,
      activeRevision: '1',
      activeManifestHash: harness.records.get('1')?.metadata.manifestHash,
      activeVisualContentHash: harness.records.get('1')?.metadata.visualContentHash,
      activeSimulationRulesHash: harness.records.get('1')?.metadata.simulationRulesHash,
      activeAssetBaseUrl: '/dev-content/v2/revisions/1/assets/',
    });
    expect(harness.requests).toEqual([
      '/dev-content/v2/publication',
      '/dev-content/v2/revisions/1',
      '/dev-content/v2/revisions/1/pack',
    ]);
  });

  it('rejects a metadata asset identity drift without replacing active content', async () => {
    const harness = createClientHarness();
    await harness.client.start();
    const revisionTwo = harness.records.get('2');
    if (!revisionTwo) {
      throw new Error('test revision 2 is missing');
    }
    harness.records.set('2', {
      ...revisionTwo,
      metadata: {
        ...revisionTwo.metadata,
        assets: revisionTwo.metadata.assets.slice(0, -1),
        visualContentHash: computeVisualContentHash(
          revisionTwo.pack,
          revisionTwo.metadata.assets.slice(0, -1),
        ),
        simulationRulesHash: computeSimulationRulesHash(
          revisionTwo.pack,
          revisionTwo.metadata.assets.slice(0, -1),
        ),
      },
    });
    harness.setCurrent('2');

    await expect(harness.client.refresh()).rejects.toThrow(/asset manifest is missing/i);

    expect(harness.client.getActive()?.identity.revision).toBe('1');
    expect(harness.client.getStatus()).toMatchObject({ phase: 'failed', activeRevision: '1' });
    expect(harness.client.getStatus().error).toMatch(/asset manifest/i);
  });

  it('installs cosmetic replacement after render and acknowledges after the new revision is active', async () => {
    const installed: Array<{
      revision: string;
      activeRevision: string | null;
      reason: string;
    }> = [];
    const clientHolder: { client?: PublishedContentClient } = {};
    const harness = createClientHarness({
      onInstalled: async (content, reason) => {
        installed.push({
          revision: content.identity.revision,
          activeRevision: clientHolder.client?.getActive()?.identity.revision ?? null,
          reason,
        });
      },
    });
    clientHolder.client = harness.client;
    await harness.client.start();
    installed.length = 0;
    harness.setCurrent('2');

    await expect(harness.client.refresh()).resolves.toMatchObject({ identity: { revision: '2' } });

    expect(harness.client.getActive()?.identity.revision).toBe('2');
    expect(harness.client.getActive()?.identity.simulationRulesHash)
      .toBe(harness.records.get('1')?.metadata.simulationRulesHash);
    expect(harness.client.getActive()?.identity.visualContentHash)
      .toBe(harness.records.get('2')?.metadata.visualContentHash);
    expect(installed).toEqual([
      { revision: '2', activeRevision: '2', reason: 'refresh' },
    ]);
  });

  it('holds a rules change pending until explicit restart', async () => {
    const installReasons: string[] = [];
    const harness = createClientHarness({
      onInstall: async (_content, reason) => {
        installReasons.push(reason);
      },
    });
    await harness.client.start();
    harness.setCurrent('3');

    await expect(harness.client.refresh()).resolves.toMatchObject({ identity: { revision: '3' } });
    expect(harness.client.getStatus()).toMatchObject({
      phase: 'restart-required',
      activeRevision: '1',
      pendingRevision: '3',
      availableRevision: '3',
    });
    expect(installReasons).toEqual(['initial']);

    await expect(harness.client.restartToPending()).resolves.toMatchObject({ identity: { revision: '3' } });
    expect(harness.client.getStatus()).toMatchObject({
      phase: 'ready',
      activeRevision: '3',
      pendingRevision: null,
      availableRevision: null,
    });
    expect(installReasons).toEqual(['initial', 'restart']);
  });

  it('reconnects and resynchronizes the exact newest published revision', async () => {
    const harness = createClientHarness();
    await harness.client.start();
    harness.setCurrent('2');
    harness.sources[0]?.onerror?.();

    await waitFor(() => harness.sources.length === 2);
    const reconnected = harness.sources[1];
    if (!reconnected) {
      throw new Error('reconnect EventSource was not created');
    }
    reconnected.onopen?.();
    await waitFor(() => harness.client.getActive()?.identity.revision === '2');

    expect(harness.client.getStatus()).toMatchObject({
      phase: 'ready',
      activeRevision: '2',
      reconnectAttempt: 0,
    });
    expect(harness.requests).toContain('/dev-content/v2/revisions/2');
    expect(harness.requests).toContain('/dev-content/v2/revisions/2/pack');
    expect(harness.client.getActive()?.identity.revision).not.toBe('1');
  });

  it('keeps a historical revision pinned when newer publication events arrive', async () => {
    const harness = createClientHarness();
    await harness.client.start();
    await harness.client.selectRevision('1');
    harness.sources[0]?.onmessage?.({
      data: JSON.stringify({ type: 'publication-published', revision: '3' }),
    });
    harness.sources[0]?.onmessage?.({
      data: JSON.stringify({ type: 'publication-published', revision: '2' }),
    });

    await waitFor(() => harness.client.getStatus().availableRevision === '3');
    expect(harness.client.getStatus()).toMatchObject({
      selectedRevision: '1',
      activeRevision: '1',
      availableRevision: '3',
    });
  });

  it('does not commit an in-flight replacement after disposal', async () => {
    const release = { install: (): void => undefined };
    const started = { install: (): void => undefined };
    const installEntered = new Promise<void>((resolve) => {
      started.install = resolve;
    });
    const installGate = new Promise<void>((resolve) => {
      release.install = resolve;
    });
    const harness = createClientHarness({
      onInstall: async (_content, reason) => {
        if (reason === 'refresh') {
          started.install();
          await installGate;
        }
      },
    });
    await harness.client.start();
    harness.setCurrent('2');
    const refresh = harness.client.refresh();
    await installEntered;
    harness.client.dispose();
    release.install();

    await expect(refresh).resolves.toBeNull();
    expect(harness.client.getActive()?.identity.revision).toBe('1');
    expect(harness.sources[0]?.closed).toBe(true);
  });
});

describe('revision A/B replay identity', () => {
  it('uses one shared seed and command log, reports equal checksums, and refuses divergent inputs', () => {
    const packA = validatePackV2(createTestPackV2());
    const packB = withPackChanges(packA, '2', {
      units: packA.units.map((unit, index) => index === 0 ? { ...unit, displayName: 'Cosmetic B' } : unit),
    });
    const packRules = withPackChanges(packA, '3', {
      units: packA.units.map((unit, index) => index === 0
        ? { ...unit, movement: { ...unit.movement, speedSubunitsPerTick: unit.movement.speedSubunitsPerTick + 1 } }
        : unit),
    });
    const scenario: ScenarioDef = {
      schemaVersion: 1,
      id: 'replay-scenario',
      displayName: 'Replay Scenario',
      mapId: 'replay-map',
      units: [{ archetypeId: 'sunweaver-scout', position: { x: 8192, z: 8192 } }],
      buildings: [],
    };
    const map: MapDef = {
      schemaVersion: 1,
      id: 'replay-map',
      displayName: 'Replay Map',
      cellsX: 32,
      cellsZ: 32,
      chunkSize: 16,
    };
    const commands: CommandEnvelopeV1[] = [
      {
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        commandId: 'replay-spawn-1',
        sequence: 0,
        issuedAtTick: 0,
        executeTick: 0,
        playerId: 'lab-local',
        kind: 'spawnUnit',
        payload: {
          kind: 'spawnUnit',
          archetypeId: 'sunweaver-scout',
          position: { x: 16384, z: 16384 },
        },
      },
      {
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        commandId: 'replay-move-1',
        sequence: 1,
        issuedAtTick: 1,
        executeTick: 1,
        playerId: 'lab-local',
        kind: 'move',
        payload: {
          kind: 'move',
          entityIds: [{ index: 0, generation: 1 }],
          destination: { x: 24576, z: 24576 },
        },
      },
    ];
    const contentA = runtimeContentFromBundle(packA, '/assets/');
    const contentB = runtimeContentFromBundle(packB, '/assets/');
    const contentRules = runtimeContentFromBundle(packRules, '/assets/');

    const identical = compareRevisionReplays(
      { identity: contentA.identity, pack: packA, scenario, map, seed: 42, commands, totalTicks: 20 },
      { identity: contentB.identity, pack: packB, scenario, map, seed: 42, commands, totalTicks: 20 },
    );
    expect(identical.inputs).toMatchObject({ seed: 42, commandCount: 2 });
    expect(identical.checksumsEqual).toBe(true);
    expect(identical.commandLogLengthsEqual).toBe(true);
    expect(identical.rulesDiffer).toBe(false);
    expect(identical.outcome).toBe('identical');
    expect(identical.a.revision).toBe('1');
    expect(identical.b.revision).toBe('2');
    expect(identical.a.visualContentHash).not.toBe(identical.b.visualContentHash);

    const rulesDiffer = compareRevisionReplays(
      { identity: contentA.identity, pack: packA, scenario, map, seed: 42, commands, totalTicks: 20 },
      { identity: contentRules.identity, pack: packRules, scenario, map, seed: 42, commands, totalTicks: 20 },
    );
    expect(rulesDiffer.rulesDiffer).toBe(true);
    expect(rulesDiffer.outcome).toBe('rules-differ');

    expect(() => compareRevisionReplays(
      { identity: contentA.identity, pack: packA, scenario, map, seed: 42, commands, totalTicks: 20 },
      { identity: contentB.identity, pack: packB, scenario, map, seed: 43, commands, totalTicks: 20 },
    )).toThrow(/inputs are not identical/i);
  });
});

function createClientHarness(options: {
  onInstall?: PublishedContentClientOptions['onInstall'];
  onInstalled?: PublishedContentClientOptions['onInstalled'];
} = {}): ClientHarness {
  const packA = validatePackV2(createTestPackV2());
  const packB = withPackChanges(packA, '2', {
    units: packA.units.map((unit, index) => index === 0 ? { ...unit, displayName: 'Cosmetic B' } : unit),
  });
  const packC = withPackChanges(packA, '3', {
    units: packA.units.map((unit, index) => index === 0
      ? { ...unit, movement: { ...unit.movement, speedSubunitsPerTick: unit.movement.speedSubunitsPerTick + 1 } }
      : unit),
  });
  const records = new Map<string, RevisionRecord>([
    ['1', createRevisionRecord(packA, false)],
    ['2', createRevisionRecord(packB, false)],
    ['3', createRevisionRecord(packC, true)],
  ]);
  let currentRevision = '1';
  const sources: TestEventSource[] = [];
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input);
    requests.push(path);
    if (path === '/dev-content/v2/publication') {
      const current = records.get(currentRevision);
      if (!current) {
        return jsonResponse({ error: 'current revision missing' }, 404);
      }
      return jsonResponse({ currentRevision, draftRevision: currentRevision, current: current.metadata });
    }
    if (path === '/dev-content/v2/acknowledgements' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({
        ok: true,
        acknowledgement: {
          ...body,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });
    }
    const metadataMatch = path.match(/^\/dev-content\/v2\/revisions\/([^/]+)$/);
    if (metadataMatch) {
      const record = records.get(decodeURIComponent(metadataMatch[1] ?? ''));
      return record ? jsonResponse(record.metadata) : jsonResponse({ error: 'revision missing' }, 404);
    }
    const packMatch = path.match(/^\/dev-content\/v2\/revisions\/([^/]+)\/pack$/);
    if (packMatch) {
      const record = records.get(decodeURIComponent(packMatch[1] ?? ''));
      return record ? jsonResponse(record.pack) : jsonResponse({ error: 'pack missing' }, 404);
    }
    return jsonResponse({ error: `unhandled test path ${path}` }, 404);
  };
  const clientOptions: PublishedContentClientOptions = {
    apiBaseUrl: '/dev-content',
    fetchImpl,
    eventSourceFactory: () => {
      const source = new TestEventSource();
      sources.push(source);
      return source;
    },
    maxReconnectDelayMs: 250,
    ...(options.onInstall ? { onInstall: options.onInstall } : {}),
    ...(options.onInstalled ? { onInstalled: options.onInstalled } : {}),
  };
  const client = new PublishedContentClient(clientOptions);
  return {
    client,
    records,
    sources,
    requests,
    setCurrent: (revision) => {
      if (!records.has(revision)) {
        throw new Error(`missing test revision ${revision}`);
      }
      currentRevision = revision;
    },
  };
}

function createRevisionRecord(pack: PackV2, restartRequired: boolean): RevisionRecord {
  const assets = [...assetPaths(pack)].map((assetPath, index) => ({
    kind: 'runtime' as const,
    assetPath,
    storagePath: `assets/${assetPath}`,
    sha256: `${index.toString(16).padStart(2, '0')}${'0'.repeat(62)}`,
    byteLength: index + 1,
  }));
  return {
    pack,
    metadata: {
      schemaVersion: 1,
      revision: pack.revision,
      packId: pack.id,
      manifestPath: 'pack.json',
      manifestHash: 'f'.repeat(64),
      visualContentHash: computeVisualContentHash(pack, assets),
      simulationRulesHash: computeSimulationRulesHash(pack, assets),
      restartRequired,
      assets,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function* assetPaths(pack: PackV2): Generator<string> {
  const paths = new Set<string>();
  for (const unit of pack.units) {
    paths.add(unit.assetPath);
  }
  for (const building of pack.buildings) {
    paths.add(building.assetPath);
  }
  for (const path of paths) {
    yield path;
  }
}

function withPackChanges(
  pack: PackV2,
  revision: string,
  changes: Pick<Partial<PackV2>, 'units' | 'buildings'>,
): PackV2 {
  const next = { ...pack, revision, ...changes };
  const { contentHash: _contentHash, ...withoutHash } = next;
  return { ...withoutHash, contentHash: computeContentHash(withoutHash) };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for client state');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}
