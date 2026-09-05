import type { BuildingArchetype, FactionId, UnitArchetype } from '@pastel-rts/content-schema';
import {
  ContentApiError,
  buildSandboxUrl,
  createReference,
  deleteBuildingV2,
  deleteReference,
  deleteUnitV2,
  duplicateBuildingV2,
  duplicateUnitV2,
  fetchBuildingListV2,
  fetchPublicationStatus,
  fetchReferences,
  fetchUnitListV2,
  referenceImageUrl,
  setBuildingEnabledV2,
  setUnitEnabledV2,
  type ReferenceAttachment,
} from '../api/contentApi';
import { FoundrySession } from '../app/foundrySession';
import { fileToPngDataUrl } from '../png';

export type LibraryEntry =
  | { kind: 'unit'; archetype: UnitArchetype }
  | { kind: 'building'; archetype: BuildingArchetype };

export function mountContentLibrary(
  root: HTMLElement,
  navigate: (path: string) => void,
  session: FoundrySession,
): void {
  root.innerHTML = `
    <h1>Content Library</h1>
    <p class="lede">Search draft content by stable ID, name, faction, type, or tag. Runtime art and reference art are separate.</p>
    <div class="library-toolbar">
      <label class="search-field">Search <input id="library-search" type="search" placeholder="stable ID or name" /></label>
      <label>Type
        <select id="library-kind"><option value="all">All</option><option value="unit">Units</option><option value="building">Buildings</option></select>
      </label>
      <label class="checkbox-label"><input id="library-disabled" type="checkbox" /> Show disabled</label>
      <button type="button" id="new-unit">New unit</button>
      <button type="button" id="new-building">New building</button>
      <button type="button" id="refresh">Refresh</button>
    </div>
    <p class="status" id="library-status" aria-live="polite"></p>
    <div class="pack-meta" id="pack-meta"></div>
    <table class="library-table">
      <thead><tr><th>Kind</th><th>Stable ID</th><th>Name</th><th>Faction</th><th>Enabled</th><th>Actions</th></tr></thead>
      <tbody id="library-body"></tbody>
    </table>
    <section class="reference-panel">
      <div class="section-heading"><div><h2>Reference attachments</h2><p>Reference art is review material only. It never enters PackV2 or the game runtime.</p></div></div>
      <div class="toolbar">
        <label>Reference PNG <input id="reference-file" type="file" accept="image/png" /></label>
        <button type="button" id="upload-reference">Attach reference</button>
      </div>
      <div id="reference-list" class="reference-grid"></div>
    </section>
  `;

  let entries: LibraryEntry[] = [];
  let references: ReferenceAttachment[] = [];
  let loadGeneration = 0;
  let referenceFile: File | null = null;

  root.querySelector('#new-unit')?.addEventListener('click', () => navigate('#/unit/new'));
  root.querySelector('#new-building')?.addEventListener('click', () => navigate('#/building/new'));
  root.querySelector('#refresh')?.addEventListener('click', () => {
    void refresh();
  });
  root.querySelector('#library-search')?.addEventListener('input', renderFilteredRows);
  root.querySelector('#library-kind')?.addEventListener('change', renderFilteredRows);
  root.querySelector('#library-disabled')?.addEventListener('change', renderFilteredRows);
  root.querySelector('#reference-file')?.addEventListener('change', (event) => {
    const input = event.target;
    referenceFile = input instanceof HTMLInputElement ? input.files?.[0] ?? null : null;
  });
  root.querySelector('#upload-reference')?.addEventListener('click', () => {
    void uploadReference();
  });

  void refresh();

  async function refresh(): Promise<void> {
    const generation = (loadGeneration += 1);
    setStatus('Loading draft library…', 'pending');
    try {
      const [publication, unitList, buildingList, referenceList] = await Promise.all([
        fetchPublicationStatus(),
        fetchUnitListV2(),
        fetchBuildingListV2(),
        fetchReferences(),
      ]);
      if (generation !== loadGeneration) {
        return;
      }
      session.setPublication(publication);
      entries = [
        ...unitList.items.map((archetype) => ({ kind: 'unit' as const, archetype })),
        ...buildingList.items.map((archetype) => ({ kind: 'building' as const, archetype })),
      ].sort((left, right) => left.archetype.id.localeCompare(right.archetype.id));
      references = referenceList;
      const meta = root.querySelector('#pack-meta');
      if (meta) {
        meta.textContent = `Draft revision ${publication.draftRevision} · Published revision ${publication.currentRevision} · ${entries.length} runtime entries`;
      }
      renderFilteredRows();
      renderReferences();
      setStatus(`${entries.length} runtime entries loaded.`, 'ok');
    } catch (error) {
      if (generation !== loadGeneration) {
        return;
      }
      setStatus(formatApiError(error), 'error');
    }
  }

  function renderFilteredRows(): void {
    const search = valueOf('#library-search').trim().toLowerCase();
    const kind = valueOf('#library-kind');
    const showDisabled = checked('#library-disabled');
    const filtered = filterLibraryEntries(entries, search, kind === 'unit' || kind === 'building' ? kind : 'all', showDisabled);
    renderRows(filtered);
  }

  function renderRows(filtered: LibraryEntry[]): void {
    const body = root.querySelector('#library-body');
    if (!(body instanceof HTMLElement)) {
      return;
    }
    body.innerHTML = '';
    if (filtered.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No runtime content matches the current filter.';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const entry of filtered) {
      const row = document.createElement('tr');
      if (!entry.archetype.enabled) {
        row.className = 'disabled-row';
      }
      appendTextCell(row, entry.kind);
      appendCodeCell(row, entry.archetype.id);
      appendTextCell(row, entry.archetype.displayName);
      appendTextCell(row, entry.archetype.factionId);
      appendTextCell(row, entry.archetype.enabled ? 'yes' : 'no');
      const actions = document.createElement('td');
      actions.className = 'actions';
      addAction(actions, 'Edit', () => navigate(entry.kind === 'unit' ? `#/unit/${entry.archetype.id}` : `#/building/${entry.archetype.id}`));
      addAction(actions, 'Duplicate', () => {
        void duplicateEntry(entry);
      });
      addAction(actions, entry.archetype.enabled ? 'Disable' : 'Enable', () => {
        void toggleEnabled(entry);
      });
      addAction(actions, 'Sandbox', () => {
        const snapshot = session.getSnapshot();
        window.open(buildSandboxUrl({
          archetypeId: entry.archetype.id,
          kind: entry.kind,
          seed: snapshot.seed,
          scenarioId: snapshot.scenarioId,
          publicationRevision: snapshot.publication?.currentRevision,
          debug: true,
        }), '_blank', 'noopener,noreferrer');
      });
      addAction(actions, 'Remove', () => {
        void removeEntry(entry);
      });
      row.appendChild(actions);
      body.appendChild(row);
    }
  }

  function renderReferences(): void {
    const container = root.querySelector('#reference-list');
    if (!(container instanceof HTMLElement)) {
      return;
    }
    container.innerHTML = '';
    if (references.length === 0) {
      container.textContent = 'No reference attachments.';
      return;
    }
    for (const reference of references) {
      const card = document.createElement('article');
      card.className = 'reference-card';
      const image = document.createElement('img');
      image.src = referenceImageUrl(reference.id);
      image.alt = `${reference.displayName} reference only`;
      image.loading = 'lazy';
      const title = document.createElement('strong');
      title.textContent = reference.displayName;
      const note = document.createElement('span');
      note.textContent = `Reference only · ${reference.width}×${reference.height}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'action-btn';
      remove.textContent = 'Remove attachment';
      remove.addEventListener('click', () => {
        void removeReference(reference);
      });
      card.append(image, title, note, remove);
      container.appendChild(card);
    }
  }

  async function toggleEnabled(entry: LibraryEntry): Promise<void> {
    const expected = expectedDraftRevision();
    if (!expected) {
      return;
    }
    try {
      const result = entry.kind === 'unit'
        ? await setUnitEnabledV2(entry.archetype.id, !entry.archetype.enabled, expected)
        : await setBuildingEnabledV2(entry.archetype.id, !entry.archetype.enabled, expected);
      session.setPublication(result.publication);
      await refresh();
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function duplicateEntry(entry: LibraryEntry): Promise<void> {
    const defaultId = `${entry.archetype.id}-copy`;
    const newId = window.prompt('New stable ID for the duplicate:', defaultId)?.trim();
    if (!newId) {
      return;
    }
    const expected = expectedDraftRevision();
    if (!expected) {
      return;
    }
    try {
      const result = entry.kind === 'unit'
        ? await duplicateUnitV2(entry.archetype.id, newId, `${entry.archetype.displayName} Copy`, expected)
        : await duplicateBuildingV2(entry.archetype.id, newId, `${entry.archetype.displayName} Copy`, expected);
      session.setPublication(result.publication);
      setStatus(`Duplicated ${entry.archetype.id} as ${newId}.`, 'ok');
      await refresh();
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function removeEntry(entry: LibraryEntry): Promise<void> {
    if (!window.confirm(`Remove ${entry.archetype.id} from the draft? Retained published sources are not deleted.`)) {
      return;
    }
    const expected = expectedDraftRevision();
    if (!expected) {
      return;
    }
    try {
      const result = entry.kind === 'unit'
        ? await deleteUnitV2(entry.archetype.id, expected)
        : await deleteBuildingV2(entry.archetype.id, expected);
      session.setPublication(result.publication);
      setStatus(`${entry.archetype.id} removed from the draft.`, 'ok');
      await refresh();
    } catch (error) {
      if (error instanceof ContentApiError && error.code === 'dependency-conflict') {
        const dependencies = error.dependencies.join(', ');
        if (window.confirm(`${error.message}\nDependencies: ${dependencies}\nForce removal? Publication will still reject missing references.`)) {
          try {
            const forced = entry.kind === 'unit'
              ? await deleteUnitV2(entry.archetype.id, expected, true)
              : await deleteBuildingV2(entry.archetype.id, expected, true);
            session.setPublication(forced.publication);
            setStatus(forced.warning ?? `${entry.archetype.id} removed with a dependency warning.`, 'ok');
            await refresh();
          } catch (forcedError) {
            setStatus(formatApiError(forcedError), 'error');
          }
        }
        return;
      }
      setStatus(formatApiError(error), 'error');
    }
  }

  async function uploadReference(): Promise<void> {
    if (!referenceFile) {
      setStatus('Choose a PNG reference first.', 'error');
      return;
    }
    const defaultId = referenceFile.name.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'reference';
    const id = window.prompt('Reference stable ID:', defaultId)?.trim();
    if (!id) {
      return;
    }
    const displayName = window.prompt('Reference display name:', referenceFile.name.replace(/\.png$/i, ''))?.trim();
    if (!displayName) {
      return;
    }
    try {
      const dataUrl = await fileToPngDataUrl(referenceFile);
      const reference = await createReference(id, displayName, dataUrl);
      references = [...references.filter((item) => item.id !== reference.id), reference].sort((a, b) => a.id.localeCompare(b.id));
      renderReferences();
      referenceFile = null;
      const input = root.querySelector('#reference-file');
      if (input instanceof HTMLInputElement) {
        input.value = '';
      }
      setStatus(`Attached ${reference.displayName} as reference art. It is not runtime content.`, 'ok');
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function removeReference(reference: ReferenceAttachment): Promise<void> {
    if (!window.confirm(`Remove reference attachment ${reference.displayName}? Retained bytes remain content-addressed.`)) {
      return;
    }
    try {
      await deleteReference(reference.id);
      references = references.filter((item) => item.id !== reference.id);
      renderReferences();
      setStatus(`Removed reference metadata for ${reference.id}. Runtime content was not changed.`, 'ok');
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  function expectedDraftRevision(): string | null {
    const revision = session.getSnapshot().publication?.draftRevision;
    if (!revision) {
      setStatus('Draft revision is unknown. Reconnect to the content server before editing.', 'error');
    }
    return revision ?? null;
  }

  function setStatus(text: string, kind: 'ok' | 'error' | 'pending'): void {
    const status = root.querySelector('#library-status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }
}

export function filterLibraryEntries(
  entries: readonly LibraryEntry[],
  search: string,
  kind: 'all' | 'unit' | 'building',
  showDisabled: boolean,
): LibraryEntry[] {
  const needle = search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (kind !== 'all' && entry.kind !== kind) {
      return false;
    }
    if (!showDisabled && !entry.archetype.enabled) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const tags = entry.archetype.tags?.join(' ') ?? '';
    const haystack = `${entry.kind} ${entry.archetype.id} ${entry.archetype.displayName} ${entry.archetype.factionId} ${tags}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function blankUnitTemplate(id: string, factionId: FactionId): UnitArchetype {
  return {
    schemaVersion: 2,
    id,
    displayName: id,
    enabled: true,
    factionId,
    assetPath: `units/${id}/sheet.png`,
    sourceWidth: 32,
    sourceHeight: 32,
    frameWidth: 32,
    frameHeight: 32,
    margin: { x: 0, y: 0 },
    spacing: { x: 0, y: 0 },
    bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
    anchor: { x: 0.5, y: 1 },
    worldHeight: 1.5,
    selectionRadius: 0.6,
    collisionRadius: 0.45,
    animation: {
      directions: 1,
      mirrored: false,
      clips: {
        idle: { frames: { kind: 'indexes', indexes: [0] }, fps: 8, looping: true },
        move: { frames: { kind: 'indexes', indexes: [0] }, fps: 12, looping: true },
      },
    },
    movement: {
      speedSubunitsPerTick: 64,
      accelerationRate: 1,
      turnRateMilli: 3000,
      footprintCategory: 'unit-1x1',
    },
  };
}

export function blankBuildingTemplate(id: string, factionId: FactionId): BuildingArchetype {
  return {
    schemaVersion: 2,
    id,
    displayName: id,
    enabled: true,
    factionId,
    assetPath: `buildings/${id}/sprite.png`,
    sourceWidth: 32,
    sourceHeight: 32,
    bounds: { minX: 4, minY: 4, maxX: 28, maxY: 28 },
    anchor: { x: 0.5, y: 1 },
    worldHeight: 2.4,
    footprint: { kind: 'rect', cellsW: 2, cellsH: 2 },
  };
}

function addAction(container: Element, label: string, handler: () => void): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'action-btn';
  button.addEventListener('click', handler);
  container.appendChild(button);
}

function appendTextCell(row: HTMLTableRowElement, text: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.appendChild(cell);
}

function appendCodeCell(row: HTMLTableRowElement, text: string): void {
  const cell = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = text;
  cell.appendChild(code);
  row.appendChild(cell);
}

function valueOf(selector: string): string {
  const element = document.querySelector(selector);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : '';
}

function checked(selector: string): boolean {
  const element = document.querySelector(selector);
  return element instanceof HTMLInputElement && element.checked;
}

function formatApiError(error: unknown): string {
  if (!(error instanceof ContentApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 409 && error.code === 'revision-conflict') {
    return `${error.message} Local editor values were not changed. Refresh and reconcile.`;
  }
  return error.message;
}
