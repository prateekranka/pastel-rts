import {
  computeContentHash,
  computeSimulationRulesHash,
  computeVisualContentHash,
  isValidRevision,
  validatePackV2,
  validateRevisionMetadata,
  type PackV2,
  type RevisionMetadata,
} from '@pastel-rts/content-schema';

export type RuntimeContentSource = 'bundle' | 'studio';

export type RuntimeContentIdentity = {
  source: RuntimeContentSource;
  packId: string;
  revision: string;
  contentHash: string;
  manifestHash: string | null;
  visualContentHash: string;
  simulationRulesHash: string;
};

export type LoadedRuntimeContent = {
  source: RuntimeContentSource;
  pack: PackV2;
  assetBaseUrl: string;
  identity: RuntimeContentIdentity;
  metadata: RevisionMetadata | null;
};

export type ContentClientPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'reconnecting'
  | 'restart-required'
  | 'failed';

export type ContentClientStatus = {
  phase: ContentClientPhase;
  source: RuntimeContentSource;
  activeRevision: string | null;
  activeContentHash: string | null;
  activeSimulationRulesHash: string | null;
  pendingRevision: string | null;
  pendingSimulationRulesHash: string | null;
  availableRevision: string | null;
  error: string | null;
  reconnectAttempt: number;
};

export type PublicationStatusResponse = {
  currentRevision: string;
  draftRevision: string;
  current: RevisionMetadata;
};

/** The narrow EventSource surface makes reconnect behavior testable without a browser. */
export interface ContentEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export type PublishedContentClientOptions = {
  apiBaseUrl?: string;
  runtimeId?: string;
  fetchImpl?: typeof fetch;
  eventSourceFactory?: (url: string) => ContentEventSource;
  onInstall?: (content: LoadedRuntimeContent, reason: ContentInstallReason) => void | Promise<void>;
  onStatus?: (status: ContentClientStatus) => void;
  maxReconnectDelayMs?: number;
};

export type ContentInstallReason = 'initial' | 'refresh' | 'reconnect' | 'revision-select' | 'restart';

type PublicationEvent = {
  type?: string;
  revision?: string;
};

const DEFAULT_API_BASE = '/dev-content';
const DEFAULT_RUNTIME_ID = 'game-web-interaction-lab';
const DEFAULT_MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_ATTEMPT = 8;

/**
 * Client boundary for immutable Foundry publications.
 *
 * Studio mode has no bundled fallback. A failed candidate remains visible in
 * status and leaves the last installed revision untouched.
 */
export class PublishedContentClient {
  private readonly apiBaseUrl: string;
  private readonly runtimeId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceFactory: ((url: string) => ContentEventSource) | null;
  private readonly onInstall: ((content: LoadedRuntimeContent, reason: ContentInstallReason) => void | Promise<void>) | null;
  private readonly onStatus: ((status: ContentClientStatus) => void) | null;
  private readonly maxReconnectDelayMs: number;
  private eventSource: ContentEventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private requestGeneration = 0;
  private disposed = false;
  private started = false;
  private selectedRevision: string | null = null;
  private active: LoadedRuntimeContent | null = null;
  private pending: LoadedRuntimeContent | null = null;
  private availableRevision: string | null = null;
  private phase: ContentClientPhase = 'idle';
  private error: string | null = null;

  constructor(options: PublishedContentClientOptions = {}) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl ?? DEFAULT_API_BASE);
    this.runtimeId = boundedRuntimeId(options.runtimeId ?? DEFAULT_RUNTIME_ID);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.eventSourceFactory = options.eventSourceFactory ?? defaultEventSourceFactory();
    this.onInstall = options.onInstall ?? null;
    this.onStatus = options.onStatus ?? null;
    this.maxReconnectDelayMs = Math.max(250, options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS);
  }

  getStatus(): ContentClientStatus {
    return {
      phase: this.phase,
      source: 'studio',
      activeRevision: this.active?.identity.revision ?? null,
      activeContentHash: this.active?.identity.contentHash ?? null,
      activeSimulationRulesHash: this.active?.identity.simulationRulesHash ?? null,
      pendingRevision: this.pending?.identity.revision ?? null,
      pendingSimulationRulesHash: this.pending?.identity.simulationRulesHash ?? null,
      availableRevision: this.availableRevision,
      error: this.error,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  getActive(): LoadedRuntimeContent | null {
    return this.active;
  }

  getPending(): LoadedRuntimeContent | null {
    return this.pending;
  }

  getSelectedRevision(): string | null {
    return this.selectedRevision;
  }

  async start(selectedRevision?: string | null): Promise<LoadedRuntimeContent> {
    this.assertUsable();
    this.started = true;
    this.selectedRevision = validateOptionalRevision(selectedRevision);
    this.setPhase('loading', null);
    const content = await this.sync('initial');
    if (content === null) {
      throw new Error('Content load was superseded or disposed');
    }
    this.connectEventSource();
    return content;
  }

  async refresh(): Promise<LoadedRuntimeContent | null> {
    if (this.disposed) {
      return null;
    }
    return this.sync('refresh');
  }

  async selectRevision(revision: string): Promise<LoadedRuntimeContent | null> {
    this.assertUsable();
    this.selectedRevision = validateRequiredRevision(revision);
    this.availableRevision = null;
    this.setPhase('loading', null);
    return this.sync('revision-select');
  }

  /** Install the pending rules revision only after the runtime explicitly restarts. */
  async restartToPending(): Promise<LoadedRuntimeContent | null> {
    if (this.disposed) {
      return null;
    }
    const candidate = this.pending;
    if (!candidate) {
      return null;
    }
    const generation = ++this.requestGeneration;
    try {
      await this.install(candidate, 'restart');
      if (generation !== this.requestGeneration || this.disposed) {
        return null;
      }
      this.pending = null;
      this.availableRevision = null;
      this.error = null;
      this.setPhase('ready', null);
      return candidate;
    } catch (reason) {
      this.fail(reason);
      return null;
    }
  }

  /** The acknowledgement endpoint is intentionally not treated as simulation state. */
  async acknowledge(scenarioId: string, restartRequired = false): Promise<unknown> {
    this.assertUsable();
    const active = this.active;
    if (!active || active.metadata === null) {
      throw new Error('Studio publication is not installed');
    }
    const safeScenarioId = boundedIdentifier(scenarioId, 'scenarioId');
    const response = await this.fetchImpl(this.url('/v2/acknowledgements'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeId: this.runtimeId,
        scenarioId: safeScenarioId,
        revision: active.identity.revision,
        simulationRulesHash: active.identity.simulationRulesHash,
        restartRequired,
      }),
    });
    if (!response.ok) {
      throw new Error(`Acknowledgement failed (${String(response.status)})`);
    }
    return response.json() as Promise<unknown>;
  }

  async readAcknowledgements(): Promise<unknown> {
    this.assertUsable();
    const response = await this.fetchImpl(this.url('/v2/acknowledgements'));
    if (!response.ok) {
      throw new Error(`Acknowledgement status failed (${String(response.status)})`);
    }
    return response.json() as Promise<unknown>;
  }

  dispose(): void {
    this.disposed = true;
    this.started = false;
    this.requestGeneration += 1;
    this.clearReconnectTimer();
    this.eventSource?.close();
    this.eventSource = null;
    this.onStatus?.(this.getStatus());
  }

  private async sync(reason: Exclude<ContentInstallReason, 'restart'>): Promise<LoadedRuntimeContent | null> {
    const generation = ++this.requestGeneration;
    try {
      const publication = await this.readPublicationStatus();
      const revision = this.selectedRevision ?? publication.currentRevision;
      const candidate = await this.loadRevision(revision);
      if (generation !== this.requestGeneration || this.disposed) {
        return null;
      }
      await this.considerCandidate(candidate, reason);
      return candidate;
    } catch (caught) {
      if (generation === this.requestGeneration && !this.disposed) {
        this.fail(caught);
      }
      throw toError(caught);
    }
  }

  private async considerCandidate(
    candidate: LoadedRuntimeContent,
    reason: Exclude<ContentInstallReason, 'restart'>,
  ): Promise<void> {
    if (this.active?.identity.revision === candidate.identity.revision) {
      if (this.active.identity.contentHash !== candidate.identity.contentHash) {
        throw new Error(`Immutable revision ${candidate.identity.revision} changed content hash`);
      }
      this.error = null;
      this.pending = null;
      this.availableRevision = null;
      this.setPhase('ready', null);
      return;
    }

    if (
      this.active !== null &&
      this.active.identity.simulationRulesHash !== candidate.identity.simulationRulesHash
    ) {
      this.pending = candidate;
      this.availableRevision = candidate.identity.revision;
      this.error = null;
      this.setPhase('restart-required', null);
      return;
    }

    await this.install(candidate, reason);
    this.pending = null;
    this.availableRevision = null;
    this.error = null;
    this.setPhase('ready', null);
  }

  private async install(candidate: LoadedRuntimeContent, reason: ContentInstallReason): Promise<void> {
    // The callback is the transaction boundary. Active content changes only after
    // rendering/runtime replacement succeeds, so a failed candidate cannot poison
    // the last good revision.
    await this.onInstall?.(candidate, reason);
    if (this.disposed) {
      return;
    }
    this.active = candidate;
  }

  private async readPublicationStatus(): Promise<PublicationStatusResponse> {
    const value = await this.getJson('/v2/publication');
    if (!isRecord(value)) {
      throw new Error('Publication response must be an object');
    }
    const currentRevision = validateRequiredRevision(value['currentRevision']);
    const draftRevision = validateRequiredRevision(value['draftRevision']);
    const current = validateRevisionMetadata(value['current']);
    if (current.revision !== currentRevision) {
      throw new Error(`Publication current revision mismatch: ${currentRevision}`);
    }
    return { currentRevision, draftRevision, current };
  }

  /** Load one immutable revision. Every identity check happens before install. */
  async loadRevision(revision: string): Promise<LoadedRuntimeContent> {
    const safeRevision = validateRequiredRevision(revision);
    const metadata = validateRevisionMetadata(
      await this.getJson(`/v2/revisions/${encodeURIComponent(safeRevision)}`),
    );
    if (metadata.revision !== safeRevision) {
      throw new Error(`Revision metadata mismatch: ${safeRevision}`);
    }

    const rawPack = await this.getJson(`/v2/revisions/${encodeURIComponent(safeRevision)}/pack`);
    const pack = validatePackV2(rawPack);
    if (!isRecord(rawPack) || rawPack['contentHash'] !== pack.contentHash) {
      throw new Error(`Published pack content hash mismatch: ${safeRevision}`);
    }
    if (pack.revision !== metadata.revision) {
      throw new Error(`Published pack revision mismatch: ${metadata.revision}`);
    }
    if (pack.id !== metadata.packId) {
      throw new Error(`Published pack id mismatch: ${metadata.packId}`);
    }
    if (computeContentHash(pack) !== pack.contentHash) {
      throw new Error(`Published pack canonical hash mismatch: ${metadata.revision}`);
    }

    const visualContentHash = computeVisualContentHash(pack, metadata.assets);
    if (visualContentHash !== metadata.visualContentHash) {
      throw new Error(`Published visual content hash mismatch: ${metadata.revision}`);
    }
    const simulationRulesHash = computeSimulationRulesHash(pack, metadata.assets);
    if (simulationRulesHash !== metadata.simulationRulesHash) {
      throw new Error(`Published simulation rules hash mismatch: ${metadata.revision}`);
    }

    return {
      source: 'studio',
      pack,
      assetBaseUrl: this.url(`/v2/revisions/${encodeURIComponent(safeRevision)}/assets/`),
      identity: {
        source: 'studio',
        packId: pack.id,
        revision: pack.revision,
        contentHash: pack.contentHash,
        manifestHash: metadata.manifestHash,
        visualContentHash,
        simulationRulesHash,
      },
      metadata,
    };
  }

  private connectEventSource(): void {
    if (this.disposed || !this.started || this.eventSourceFactory === null || this.eventSource !== null) {
      return;
    }
    try {
      const source = this.eventSourceFactory(this.url('/events'));
      this.eventSource = source;
      source.onopen = () => {
        const wasReconnect = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;
        if (wasReconnect) {
          void this.sync('reconnect').catch(() => undefined);
        }
        this.onStatus?.(this.getStatus());
      };
      source.onmessage = (event) => this.handleEvent(event.data);
      source.onerror = () => this.handleEventSourceError(source);
    } catch (caught) {
      this.handleEventSourceError(null);
      this.fail(caught, 'reconnecting');
    }
  }

  private handleEvent(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed)) {
      return;
    }
    const event = parsed as PublicationEvent;
    if (event.type !== 'publication-published' && event.type !== 'publication-reverted') {
      return;
    }
    const revision = typeof event.revision === 'string' && isValidRevision(event.revision)
      ? event.revision
      : null;
    if (revision === null) {
      return;
    }
    if (this.selectedRevision !== null) {
      if (revision !== this.selectedRevision) {
        this.availableRevision = revision;
        this.onStatus?.(this.getStatus());
      }
      return;
    }
    void this.sync('refresh').catch(() => undefined);
  }

  private handleEventSourceError(source: ContentEventSource | null): void {
    if (source !== null && this.eventSource !== source) {
      return;
    }
    this.eventSource?.close();
    this.eventSource = null;
    if (this.disposed || !this.started) {
      return;
    }
    this.reconnectAttempt = Math.min(MAX_RECONNECT_ATTEMPT, this.reconnectAttempt + 1);
    this.fail(new Error('Content event stream disconnected'), 'reconnecting');
    this.clearReconnectTimer();
    const delay = Math.min(
      this.maxReconnectDelayMs,
      250 * 2 ** Math.max(0, this.reconnectAttempt - 1),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectEventSource();
    }, delay);
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(this.url(path));
    if (!response.ok) {
      throw new Error(`Content request failed (${String(response.status)}): ${path}`);
    }
    return response.json() as Promise<unknown>;
  }

  private url(path: string): string {
    if (path.startsWith('/')) {
      return `${this.apiBaseUrl}${path}`;
    }
    return `${this.apiBaseUrl}/${path}`;
  }

  private setPhase(phase: ContentClientPhase, error: string | null): void {
    this.phase = phase;
    this.error = error;
    this.onStatus?.(this.getStatus());
  }

  private fail(caught: unknown, phase: ContentClientPhase = 'failed'): void {
    this.setPhase(phase, toError(caught).message);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('Content client is disposed');
    }
  }
}

export function runtimeContentFromBundle(pack: PackV2, assetBaseUrl: string): LoadedRuntimeContent {
  const normalizedBase = normalizeAssetBaseUrl(assetBaseUrl);
  return {
    source: 'bundle',
    pack,
    assetBaseUrl: normalizedBase,
    identity: {
      source: 'bundle',
      packId: pack.id,
      revision: pack.revision,
      contentHash: pack.contentHash,
      manifestHash: null,
      visualContentHash: computeVisualContentHash(pack),
      simulationRulesHash: computeSimulationRulesHash(pack),
    },
    metadata: null,
  };
}

function defaultEventSourceFactory(): ((url: string) => ContentEventSource) | null {
  if (typeof EventSource !== 'function') {
    return null;
  }
  return (url) => new EventSource(url) as unknown as ContentEventSource;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('file:')
  ) {
    throw new Error('Invalid content API base URL');
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeAssetBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Invalid content asset base URL');
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function boundedRuntimeId(value: string): string {
  return boundedIdentifier(value, 'runtimeId');
}

function boundedIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a bounded identifier`);
  }
  return value;
}

function validateRequiredRevision(value: unknown): string {
  if (typeof value !== 'string' || !isValidRevision(value)) {
    throw new Error('revision must be a safe identifier');
  }
  return value;
}

function validateOptionalRevision(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.length === 0) {
    return null;
  }
  return validateRequiredRevision(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
