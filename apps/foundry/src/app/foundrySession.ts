import {
  fetchAcknowledgements,
  fetchHealth,
  fetchPublicationStatus,
  type Acknowledgement,
  type PublicationStatus,
} from '../api/contentApi';

export type ConnectionState = 'connecting' | 'connected' | 'offline';

export type SessionSnapshot = {
  connection: ConnectionState;
  publication: PublicationStatus | null;
  acknowledgements: Acknowledgement[];
  acknowledgementError: string | null;
  dirty: boolean;
  scenarioId: string;
  seed: number;
};

const DEFAULT_SCENARIO = 'interaction-lab-alien-fantasy';
const ACK_POLL_MS = 4000;
const ACK_REQUEST_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 2500;

export class FoundrySession {
  private snapshot: SessionSnapshot = {
    connection: 'connecting',
    publication: null,
    acknowledgements: [],
    acknowledgementError: null,
    dirty: false,
    scenarioId: DEFAULT_SCENARIO,
    seed: 1,
  };
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private ackTimer: number | null = null;
  private disposed = false;
  private requestController: AbortController | null = null;
  private acknowledgementController: AbortController | null = null;
  private readonly pagehideHandler = (): void => this.dispose();

  start(): void {
    if (this.ackTimer !== null || this.disposed) {
      return;
    }
    window.addEventListener('pagehide', this.pagehideHandler, { once: true });
    void this.refreshConnection();
    void this.refreshAcknowledgements();
    this.ackTimer = window.setInterval(() => {
      void this.refreshAcknowledgements();
    }, ACK_POLL_MS);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.ackTimer !== null) {
      window.clearInterval(this.ackTimer);
      this.ackTimer = null;
    }
    this.requestController?.abort();
    this.requestController = null;
    this.acknowledgementController?.abort();
    this.acknowledgementController = null;
    this.listeners.clear();
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  isDirty(): boolean {
    return this.snapshot.dirty;
  }

  setDirty(dirty: boolean): void {
    if (this.snapshot.dirty === dirty) {
      return;
    }
    this.update({ dirty });
  }

  setScenarioContext(scenarioId: string, seed: number): void {
    this.update({ scenarioId, seed });
  }

  setPublication(publication: PublicationStatus): void {
    this.update({ publication, connection: 'connected' });
  }

  async refreshPublication(): Promise<PublicationStatus> {
    const publication = await fetchPublicationStatus();
    this.setPublication(publication);
    return publication;
  }

  async refreshConnection(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.update({ connection: 'connecting' });
    try {
      const health = await fetchHealth(controller.signal);
      if (health.publication) {
        this.setPublication(health.publication);
      } else {
        this.update({ connection: health.ok ? 'connected' : 'offline' });
      }
    } catch {
      this.update({ connection: 'offline' });
    } finally {
      window.clearTimeout(timer);
      if (this.requestController === controller) {
        this.requestController = null;
      }
    }
  }

  async refreshAcknowledgements(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.acknowledgementController?.abort();
    const controller = new AbortController();
    this.acknowledgementController = controller;
    const timer = window.setTimeout(() => controller.abort(), ACK_REQUEST_TIMEOUT_MS);
    try {
      const acknowledgements = await fetchAcknowledgements(controller.signal);
      if (this.disposed || this.acknowledgementController !== controller) {
        return;
      }
      this.update({ acknowledgements, acknowledgementError: null });
    } catch (error) {
      if (this.disposed || this.acknowledgementController !== controller) {
        return;
      }
      this.update({
        acknowledgementError: controller.signal.aborted
          ? 'Acknowledgement request timed out.'
          : error instanceof Error ? error.message : String(error),
      });
    } finally {
      window.clearTimeout(timer);
      if (this.acknowledgementController === controller) {
        this.acknowledgementController = null;
      }
    }
  }

  matchingAcknowledgement(): Acknowledgement | null {
    const { publication, acknowledgements, scenarioId } = this.snapshot;
    if (!publication) {
      return null;
    }
    const matches = acknowledgements
      .filter((ack) => ack.revision === publication.currentRevision && ack.scenarioId === scenarioId)
      .filter((ack) => ack.simulationRulesHash === publication.current.simulationRulesHash)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return matches[0] ?? null;
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export function requestTimeoutMs(): number {
  return REQUEST_TIMEOUT_MS;
}

export { DEFAULT_SCENARIO };
