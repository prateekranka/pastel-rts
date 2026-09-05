import { buildSandboxUrl, sandboxOrigin } from '../api/contentApi';
import { FoundrySession, type SessionSnapshot } from './foundrySession';

export function mountStatusStrip(root: HTMLElement, session: FoundrySession): void {
  const gameUrl = buildSandboxUrl({
    archetypeId: 'sunweaver-scout',
    kind: 'unit',
    seed: session.getSnapshot().seed,
    scenarioId: session.getSnapshot().scenarioId,
    publicationRevision: session.getSnapshot().publication?.currentRevision,
  });
  root.innerHTML = `
    <div class="status-links" aria-label="Studio connections">
      <span class="status-link-label">Studio</span>
      <a id="status-game-link" href="${escapeAttribute(gameUrl)}" target="_blank" rel="noreferrer">Game</a>
      <a id="status-foundry-link" href="#/library">Foundry</a>
      <a id="status-content-link" href="${escapeAttribute(`${window.location.origin}/dev-content/health`)}" target="_blank" rel="noreferrer">Content</a>
    </div>
    <div class="status-connection" id="status-connection" aria-live="polite"></div>
    <div class="status-revisions" id="status-revisions"></div>
    <div class="status-runtime" id="status-runtime"></div>
  `;
  session.subscribe((snapshot) => renderStatus(root, session, snapshot));
}

function renderStatus(root: HTMLElement, session: FoundrySession, snapshot: SessionSnapshot): void {
  const connection = root.querySelector('#status-connection');
  if (connection instanceof HTMLElement) {
    connection.textContent = snapshot.connection === 'connected'
      ? 'Content connected'
      : snapshot.connection === 'connecting'
        ? 'Connecting to content…'
        : 'Content offline';
    connection.className = `status-connection ${snapshot.connection}`;
  }

  const revisions = root.querySelector('#status-revisions');
  if (revisions instanceof HTMLElement) {
    if (snapshot.publication) {
      const restart = snapshot.publication.current.restartRequired ? 'Rules change: restart/retest required' : 'Rules unchanged';
      revisions.textContent = `Published ${snapshot.publication.currentRevision} · Draft ${snapshot.publication.draftRevision} · ${restart}`;
    } else {
      revisions.textContent = 'Published — · Draft — · Rules state pending';
    }
  }

  const runtime = root.querySelector('#status-runtime');
  if (runtime instanceof HTMLElement) {
    const acknowledgement = session.matchingAcknowledgement();
    if (acknowledgement) {
      runtime.textContent = `Runtime acknowledged: ${acknowledgement.runtimeId} / ${acknowledgement.scenarioId} / revision ${acknowledgement.revision}`;
      runtime.className = 'status-runtime acknowledged';
    } else if (snapshot.acknowledgementError) {
      runtime.textContent = `Runtime acknowledgement unavailable: ${snapshot.acknowledgementError}`;
      runtime.className = 'status-runtime error';
    } else {
      runtime.textContent = `Runtime pending: ${snapshot.scenarioId} has not acknowledged revision ${snapshot.publication?.currentRevision ?? '—'}`;
      runtime.className = 'status-runtime pending';
    }
  }

  const link = root.querySelector('#status-game-link');
  if (link instanceof HTMLAnchorElement) {
    const nextUrl = buildSandboxUrl({
      archetypeId: 'sunweaver-scout',
      kind: 'unit',
      seed: snapshot.seed,
      scenarioId: snapshot.scenarioId,
      publicationRevision: snapshot.publication?.currentRevision,
    });
    link.href = nextUrl;
  }
  void sandboxOrigin;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
