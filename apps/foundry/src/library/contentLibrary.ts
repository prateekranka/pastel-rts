import type { BuildingArchetype, FactionId, UnitArchetype } from '@pastel-rts/content-schema';
import {
  buildSandboxUrl,
  deleteBuildingV2,
  deleteUnitV2,
  fetchBuildingsV2,
  fetchPackV2,
  fetchUnitsV2,
  setBuildingEnabledV2,
  setUnitEnabledV2,
} from '../api/contentApi';

type LibraryEntry =
  | { kind: 'unit'; archetype: UnitArchetype }
  | { kind: 'building'; archetype: BuildingArchetype };

export function mountContentLibrary(root: HTMLElement, navigate: (path: string) => void): void {
  root.innerHTML = `
    <h1>Content Library</h1>
    <p class="lede">Browse pack v2 units and buildings. Revision and content hash reflect the on-disk pack index.</p>
    <div class="toolbar">
      <button type="button" id="new-unit">New unit</button>
      <button type="button" id="new-building">New building</button>
      <button type="button" id="refresh">Refresh</button>
    </div>
    <p class="status" id="library-status"></p>
    <div class="pack-meta" id="pack-meta"></div>
    <table class="library-table">
      <thead>
        <tr><th>Kind</th><th>ID</th><th>Name</th><th>Faction</th><th>Enabled</th><th>Modified</th><th>Actions</th></tr>
      </thead>
      <tbody id="library-body"></tbody>
    </table>
  `;

  root.querySelector('#new-unit')?.addEventListener('click', () => navigate('#/unit/new'));
  root.querySelector('#new-building')?.addEventListener('click', () => navigate('#/building/new'));
  root.querySelector('#refresh')?.addEventListener('click', () => {
    void refresh();
  });

  void refresh();

  async function refresh(): Promise<void> {
    setStatus('Loading…', 'ok');
    try {
      const [pack, units, buildings] = await Promise.all([fetchPackV2(), fetchUnitsV2(), fetchBuildingsV2()]);
      const meta = root.querySelector('#pack-meta');
      if (meta) {
        meta.innerHTML = `
          <span>Pack <code>${pack.id}</code></span>
          <span>Revision <code>${pack.revision}</code></span>
          <span>Hash <code>${pack.contentHash.slice(0, 12)}…</code></span>
        `;
      }
      const entries: LibraryEntry[] = [
        ...units.map((archetype) => ({ kind: 'unit' as const, archetype })),
        ...buildings.map((archetype) => ({ kind: 'building' as const, archetype })),
      ].sort((a, b) => a.archetype.id.localeCompare(b.archetype.id));
      renderRows(entries);
      setStatus(`${entries.length} entries loaded.`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function renderRows(entries: LibraryEntry[]): void {
    const body = root.querySelector('#library-body');
    if (!body) {
      return;
    }
    body.innerHTML = '';
    for (const entry of entries) {
      const row = document.createElement('tr');
      if (!entry.archetype.enabled) {
        row.className = 'disabled-row';
      }
      row.innerHTML = `
        <td>${entry.kind}</td>
        <td><code>${entry.archetype.id}</code></td>
        <td>${entry.archetype.displayName}</td>
        <td>${entry.archetype.factionId}</td>
        <td>${entry.archetype.enabled ? 'yes' : 'no'}</td>
        <td>—</td>
        <td class="actions"></td>
      `;
      const actions = row.querySelector('.actions');
      if (actions) {
        addAction(actions, 'Edit', () =>
          navigate(entry.kind === 'unit' ? `#/unit/${entry.archetype.id}` : `#/building/${entry.archetype.id}`),
        );
        addAction(actions, 'Duplicate', () => {
          const cloneId = `${entry.archetype.id}-copy`;
          navigate(
            entry.kind === 'unit'
              ? `#/unit/new?from=${entry.archetype.id}&id=${cloneId}`
              : `#/building/new?from=${entry.archetype.id}&id=${cloneId}`,
          );
        });
        addAction(actions, entry.archetype.enabled ? 'Disable' : 'Enable', () => {
          void toggleEnabled(entry);
        });
        addAction(actions, 'Sandbox', () => {
          window.open(
            buildSandboxUrl({ archetypeId: entry.archetype.id, kind: entry.kind, seed: 1, debug: true }),
            '_blank',
          );
        });
        addAction(actions, 'Delete', () => {
          void deleteEntry(entry);
        });
      }
      body.appendChild(row);
    }
  }

  async function toggleEnabled(entry: LibraryEntry): Promise<void> {
    try {
      if (entry.kind === 'unit') {
        await setUnitEnabledV2(entry.archetype.id, !entry.archetype.enabled);
      } else {
        await setBuildingEnabledV2(entry.archetype.id, !entry.archetype.enabled);
      }
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function deleteEntry(entry: LibraryEntry): Promise<void> {
    const force = window.confirm(
      `Delete ${entry.archetype.id}? If referenced by scenarios you will be prompted to force delete.`,
    );
    if (!force) {
      return;
    }
    try {
      const result =
        entry.kind === 'unit'
          ? await deleteUnitV2(entry.archetype.id, false)
          : await deleteBuildingV2(entry.archetype.id, false);
      if (result.warning) {
        setStatus(result.warning, 'ok');
      }
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('referenced') && window.confirm(`${message}\nForce delete anyway?`)) {
        const forced =
          entry.kind === 'unit'
            ? await deleteUnitV2(entry.archetype.id, true)
            : await deleteBuildingV2(entry.archetype.id, true);
        setStatus(forced.warning ?? 'Deleted.', 'ok');
        await refresh();
        return;
      }
      setStatus(message, 'error');
    }
  }

  function setStatus(text: string, kind: 'ok' | 'error'): void {
    const status = root.querySelector('#library-status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }
}

function addAction(container: Element, label: string, handler: () => void): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'action-btn';
  button.addEventListener('click', handler);
  container.appendChild(button);
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
