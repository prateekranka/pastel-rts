import { detectOpaqueBounds, type BuildingArchetype, type FactionId } from '@pastel-rts/content-schema';
import {
  assetUrl,
  buildSandboxUrl,
  createBuildingV2,
  fetchBuildingsV2,
  updateBuildingV2,
} from '../api/contentApi';
import { fileToPngDataUrl, imageToImageData, loadImageFile } from '../png';
import { drawScaledGameplayPreview } from '../unit/unitPreviews';

export function mountBuildingEditor(root: HTMLElement, buildingId: string | null, query: URLSearchParams): void {
  const isNew = buildingId === 'new' || buildingId === null;
  const cloneFrom = query.get('from');
  const presetId = query.get('id') ?? 'new-building';

  root.innerHTML = `
    <h1>Building Editor</h1>
    <p class="lede">Author building sprites with footprint, blocked cells, entrance, and rally points on an isometric cell grid.</p>
    <div class="grid editor-grid">
      <section>
        <h2>Identity</h2>
        <label>ID <input id="bld-id" value="${presetId}" ${isNew ? '' : 'readonly'} /></label>
        <label>Display name <input id="bld-name" value="${presetId}" /></label>
        <label>Faction
          <select id="bld-faction">
            <option value="sunweaver">sunweaver</option>
            <option value="gravemark">gravemark</option>
            <option value="neutral">neutral</option>
          </select>
        </label>
        <label>PNG or idle sheet <input id="bld-file" type="file" accept="image/png" /></label>
        <h2>Footprint</h2>
        <label>Cells W <input id="cells-w" type="number" min="1" value="2" /></label>
        <label>Cells H <input id="cells-h" type="number" min="1" value="2" /></label>
        <label>Entrance X (subunits) <input id="entrance-x" type="number" value="512" /></label>
        <label>Entrance Z (subunits) <input id="entrance-z" type="number" value="0" /></label>
        <label>Rally X (subunits) <input id="rally-x" type="number" value="1024" /></label>
        <label>Rally Z (subunits) <input id="rally-z" type="number" value="1024" /></label>
        <h2>Anchor</h2>
        <label>Anchor X <input id="bld-anchor-x" type="number" min="0" max="1" step="0.05" value="0.5" /></label>
        <label>Anchor Y <input id="bld-anchor-y" type="number" min="0" max="1" step="0.05" value="1" /></label>
        <label>World height <input id="bld-world-height" type="number" min="0.1" step="0.1" value="2.4" /></label>
        <div class="toolbar">
          <button type="button" id="save-building">Save building</button>
          <button type="button" id="sandbox-building">Test in sandbox</button>
        </div>
        <p class="status" id="bld-status"></p>
      </section>
      <section>
        <h2>Footprint grid</h2>
        <canvas id="footprint-grid" width="200" height="200"></canvas>
        <h2>Preview</h2>
        <div class="preview-grid">
          <div class="preview-card"><div>Source</div><canvas id="bld-src-neutral" class="neutral"></canvas><canvas id="bld-src-checker" class="checker"></canvas></div>
          <div class="preview-card"><div>Gameplay</div><canvas id="bld-game-neutral" class="neutral"></canvas></div>
        </div>
        <h3>Manifest</h3>
        <pre id="bld-manifest"></pre>
      </section>
    </div>
  `;

  let sourceImage: HTMLImageElement | null = null;
  let pngDataUrl: string | null = null;
  let existingId: string | null = isNew ? null : buildingId;
  let blockedMask: boolean[][] = [];

  void loadExisting();

  for (const id of [
    'bld-id', 'bld-name', 'bld-faction', 'cells-w', 'cells-h',
    'entrance-x', 'entrance-z', 'rally-x', 'rally-z',
    'bld-anchor-x', 'bld-anchor-y', 'bld-world-height',
  ]) {
    root.querySelector(`#${id}`)?.addEventListener('input', () => refresh());
  }

  root.querySelector('#bld-file')?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }
    try {
      sourceImage = await loadImageFile(input.files[0]);
      pngDataUrl = await fileToPngDataUrl(input.files[0]);
      setStatus('PNG loaded.', 'ok');
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  });

  root.querySelector('#save-building')?.addEventListener('click', () => {
    void saveBuilding();
  });
  root.querySelector('#sandbox-building')?.addEventListener('click', () => {
    window.open(buildSandboxUrl({ archetypeId: str('bld-id'), kind: 'building', seed: 1, debug: true }), '_blank');
  });

  const footprintCanvas = root.querySelector('#footprint-grid');
  footprintCanvas?.addEventListener('click', (event) => {
    if (!(footprintCanvas instanceof HTMLCanvasElement) || !(event instanceof MouseEvent)) {
      return;
    }
    const cellsW = num('cells-w');
    const cellsH = num('cells-h');
    ensureMask(cellsW, cellsH);
    const rect = footprintCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * cellsW);
    const z = Math.floor(((event.clientY - rect.top) / rect.height) * cellsH);
    if (x >= 0 && x < cellsW && z >= 0 && z < cellsH) {
      const row = blockedMask[z];
      if (row) {
        row[x] = !row[x];
      }
      refresh();
    }
  });

  async function loadExisting(): Promise<void> {
    if (isNew && cloneFrom) {
      const buildings = await fetchBuildingsV2();
      const source = buildings.find((entry) => entry.id === cloneFrom);
      if (source) {
        applyArchetype({ ...source, id: presetId, displayName: `${source.displayName} Copy` });
        existingId = null;
      }
    } else if (!isNew && buildingId) {
      const buildings = await fetchBuildingsV2();
      const source = buildings.find((entry) => entry.id === buildingId);
      if (source) {
        applyArchetype(source);
        const img = new Image();
        img.onload = () => {
          sourceImage = img;
          refresh();
        };
        img.src = assetUrl(source.assetPath);
      }
    }
    refresh();
  }

  function applyArchetype(archetype: BuildingArchetype): void {
    setVal('bld-id', archetype.id);
    setVal('bld-name', archetype.displayName);
    setVal('bld-faction', archetype.factionId);
    setVal('cells-w', String(archetype.footprint.cellsW));
    setVal('cells-h', String(archetype.footprint.cellsH));
    setVal('bld-anchor-x', String(archetype.anchor.x));
    setVal('bld-anchor-y', String(archetype.anchor.y));
    setVal('bld-world-height', String(archetype.worldHeight));
    if (archetype.entrancePoint) {
      setVal('entrance-x', String(archetype.entrancePoint.x));
      setVal('entrance-z', String(archetype.entrancePoint.z));
    }
    if (archetype.rallyPoint) {
      setVal('rally-x', String(archetype.rallyPoint.x));
      setVal('rally-z', String(archetype.rallyPoint.z));
    }
    blockedMask = archetype.blockedCellMask ?? defaultMask(archetype.footprint.cellsW, archetype.footprint.cellsH);
  }

  function buildArchetype(): BuildingArchetype {
    if (!sourceImage) {
      throw new Error('Load a PNG first');
    }
    const data = imageToImageData(sourceImage);
    const bounds = detectOpaqueBounds(data.width, data.height, data.data);
    const cellsW = num('cells-w');
    const cellsH = num('cells-h');
    ensureMask(cellsW, cellsH);
    const id = str('bld-id');
    return {
      schemaVersion: 2,
      id,
      displayName: str('bld-name'),
      enabled: true,
      factionId: str('bld-faction') as FactionId,
      assetPath: `buildings/${id}/sprite.png`,
      sourceWidth: sourceImage.naturalWidth,
      sourceHeight: sourceImage.naturalHeight,
      bounds,
      anchor: { x: num('bld-anchor-x'), y: num('bld-anchor-y') },
      worldHeight: num('bld-world-height'),
      footprint: { kind: 'rect', cellsW, cellsH },
      blockedCellMask: blockedMask,
      selectionFootprint: { kind: 'rect', cellsW, cellsH },
      entrancePoint: { x: num('entrance-x'), z: num('entrance-z') },
      rallyPoint: { x: num('rally-x'), z: num('rally-z') },
    };
  }

  function refresh(): void {
    const manifestEl = root.querySelector('#bld-manifest');
    if (!sourceImage) {
      if (manifestEl) {
        manifestEl.textContent = 'No PNG loaded';
      }
      drawFootprintGrid(num('cells-w'), num('cells-h'));
      return;
    }
    try {
      const archetype = buildArchetype();
      if (manifestEl) {
        manifestEl.textContent = JSON.stringify(archetype, null, 2);
      }
      drawFootprintGrid(archetype.footprint.cellsW, archetype.footprint.cellsH);
      drawScaledGameplayPreview(mustCanvas('bld-src-neutral'), sourceImage, archetype.bounds, archetype.anchor, 'gameplay', 'neutral');
      drawScaledGameplayPreview(mustCanvas('bld-src-checker'), sourceImage, archetype.bounds, archetype.anchor, 'gameplay', 'checker');
      drawScaledGameplayPreview(mustCanvas('bld-game-neutral'), sourceImage, archetype.bounds, archetype.anchor, 'gameplay', 'neutral');
      setStatus('Manifest valid.', 'ok');
    } catch (error) {
      if (manifestEl) {
        manifestEl.textContent = error instanceof Error ? error.message : String(error);
      }
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function drawFootprintGrid(cellsW: number, cellsH: number): void {
    const canvas = root.querySelector('#footprint-grid');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }
    ensureMask(cellsW, cellsH);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);
    const cellPx = size / Math.max(cellsW, cellsH);
    for (let z = 0; z < cellsH; z += 1) {
      for (let x = 0; x < cellsW; x += 1) {
        const row = blockedMask[z];
        const blocked = row?.[x] ?? true;
        ctx.fillStyle = blocked ? '#e07a3d88' : '#5ce1e644';
        ctx.fillRect(x * cellPx, z * cellPx, cellPx - 1, cellPx - 1);
        ctx.strokeStyle = '#f2e6d0';
        ctx.strokeRect(x * cellPx, z * cellPx, cellPx - 1, cellPx - 1);
      }
    }
    ctx.strokeStyle = '#8ee3b1';
    ctx.beginPath();
    ctx.moveTo(cellPx * 0.5, 0);
    ctx.lineTo(cellPx * 0.5, cellsH * cellPx);
    ctx.stroke();
  }

  function ensureMask(cellsW: number, cellsH: number): void {
    if (blockedMask.length !== cellsH || blockedMask[0]?.length !== cellsW) {
      blockedMask = defaultMask(cellsW, cellsH);
    }
  }

  async function saveBuilding(): Promise<void> {
    try {
      const archetype = buildArchetype();
      if (existingId) {
        await updateBuildingV2(existingId, archetype, pngDataUrl ?? undefined);
        setStatus(`Updated ${archetype.id}.`, 'ok');
      } else {
        if (!pngDataUrl) {
          throw new Error('PNG required for new buildings');
        }
        await createBuildingV2(archetype, pngDataUrl);
        existingId = archetype.id;
        setVal('bld-id', archetype.id);
        (root.querySelector('#bld-id') as HTMLInputElement | null)?.setAttribute('readonly', 'readonly');
        setStatus(`Created ${archetype.id}.`, 'ok');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function defaultMask(cellsW: number, cellsH: number): boolean[][] {
    return Array.from({ length: cellsH }, () => Array.from({ length: cellsW }, () => true));
  }

  function str(id: string): string {
    const el = root.querySelector(`#${id}`);
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';
  }

  function num(id: string): number {
    return Number(str(id));
  }

  function setVal(id: string, value: string): void {
    const el = root.querySelector(`#${id}`);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      el.value = value;
    }
  }

  function setStatus(text: string, kind: 'ok' | 'error'): void {
    const status = root.querySelector('#bld-status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }

  function mustCanvas(id: string): HTMLCanvasElement {
    const canvas = root.querySelector(`#${id}`);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Missing canvas #${id}`);
    }
    return canvas;
  }
}
