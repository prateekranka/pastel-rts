import { detectOpaqueBounds, type BuildingArchetype, type FactionId } from '@pastel-rts/content-schema';
import {
  ContentApiError,
  buildSandboxUrl,
  createBuildingV2,
  draftAssetUrl,
  fetchBuildingsV2,
  updateBuildingV2,
} from '../api/contentApi';
import { FoundrySession } from '../app/foundrySession';
import { fileToPngDataUrl, imageToImageData, imageToPngDataUrl, loadImageDataUrl } from '../png';
import { BoundedHistory, cloneEditorSnapshot, type EditorHistorySnapshot, type PendingImageState } from '../editor/history';
import { drawRuntimeGameplayPreview } from '../unit/unitPreviews';
import { mountWorkflowPanel, type WorkflowPanelHandle } from '../workflow/workflowPanel';

const FIELD_IDS = [
  'bld-id', 'bld-name', 'bld-faction', 'cells-w', 'cells-h', 'entrance-x', 'entrance-z',
  'rally-x', 'rally-z', 'bld-anchor-x', 'bld-anchor-y', 'bld-world-height', 'lab-scenario', 'lab-seed',
] as const;

export function mountBuildingEditor(
  root: HTMLElement,
  buildingId: string | null,
  query: URLSearchParams,
  session: FoundrySession,
): void {
  const isNew = buildingId === 'new' || buildingId === null;
  const cloneFrom = query.get('from');
  const presetId = query.get('id') ?? 'new-building';
  const scenarioId = query.get('scenario') ?? session.getSnapshot().scenarioId;
  const seed = Number(query.get('seed') ?? session.getSnapshot().seed);
  session.setScenarioContext(scenarioId, Number.isFinite(seed) ? seed : 1);

  root.innerHTML = `
    <div class="editor-heading"><div><p class="eyebrow">Foundry / runtime content</p><h1>Building Editor</h1><p class="lede">Author a building sprite, footprint, entrance, and rally point. Draft saves preserve the stable ID and retained source revisions.</p></div><div class="editor-actions"><button type="button" id="bld-undo">Undo</button><button type="button" id="bld-redo">Redo</button></div></div>
    <div class="workflow-panel" id="bld-workflow"></div>
    <div class="grid editor-grid">
      <section>
        <h2>Identity and source</h2>
        <label>Stable ID <input id="bld-id" value="${escapeAttribute(presetId)}" ${isNew ? '' : 'readonly'} /></label>
        <p class="field-note">Replacement uses the same stable ID. Published source images remain immutable.</p>
        <label>Display name <input id="bld-name" value="${escapeAttribute(presetId)}" /></label>
        <label>Faction <select id="bld-faction"><option value="sunweaver">sunweaver</option><option value="gravemark">gravemark</option><option value="neutral">neutral</option></select></label>
        <label>Replace source PNG <input id="bld-file" type="file" accept="image/png" /></label>
        <p class="field-note" id="bld-source-dimensions">Source dimensions: —</p>
        <h2>Sandbox context</h2>
        <label>Scenario ID <input id="lab-scenario" value="${escapeAttribute(scenarioId)}" /></label>
        <label>Seed <input id="lab-seed" type="number" value="${String(Number.isFinite(seed) ? seed : 1)}" /></label>
        <h2>Footprint and points</h2>
        <div class="field-pair"><label>Cells W <input id="cells-w" type="number" min="1" value="2" /></label><label>Cells H <input id="cells-h" type="number" min="1" value="2" /></label></div>
        <p class="field-note">Entrance and rally values use simulation subunits. Footprint values use map cells.</p>
        <div class="field-pair"><label>Entrance X (subunits) <input id="entrance-x" type="number" value="512" /></label><label>Entrance Z (subunits) <input id="entrance-z" type="number" value="0" /></label></div>
        <div class="field-pair"><label>Rally X (subunits) <input id="rally-x" type="number" value="1024" /></label><label>Rally Z (subunits) <input id="rally-z" type="number" value="1024" /></label></div>
        <h2>World scale</h2>
        <div class="field-pair"><label>Anchor X <input id="bld-anchor-x" type="number" min="0" max="1" step="0.05" value="0.5" /></label><label>Anchor Y <input id="bld-anchor-y" type="number" min="0" max="1" step="0.05" value="1" /></label></div>
        <label>World height (cells) <input id="bld-world-height" type="number" min="0.1" step="0.1" value="2.4" /></label>
        <h2>Preview overlays</h2>
        <div class="overlay-toggles"><label class="checkbox-label"><input id="bld-show-grid" type="checkbox" checked /> Ground grid</label><label class="checkbox-label"><input id="bld-show-footprints" type="checkbox" checked /> Footprint</label></div>
        <div class="toolbar"><button type="button" id="save-building">Save draft</button><button type="button" id="sandbox-building">Test in Sandbox</button></div>
        <p class="status" id="bld-status" aria-live="polite"></p>
      </section>
      <section>
        <h2>Runtime projection</h2>
        <p class="field-note">Projection uses the shared IsometricCamera and meaningful world units at the runtime gameplay framing.</p>
        <div class="preview-grid"><div class="preview-card"><div>Footprint grid</div><canvas id="footprint-grid" width="240" height="200"></canvas></div><div class="preview-card"><div>Source</div><canvas id="bld-src-neutral" class="neutral"></canvas><canvas id="bld-src-checker" class="checker"></canvas></div><div class="preview-card preview-wide"><div>Gameplay zoom · runtime default</div><canvas id="bld-game-neutral" class="neutral"></canvas></div><div class="preview-card preview-wide"><div>70-percent · runtime camera</div><canvas id="bld-cam-neutral" class="neutral"></canvas></div></div>
        <h3>Draft manifest</h3><pre id="bld-manifest"></pre>
      </section>
    </div>
  `;

  let sourceImage: HTMLImageElement | null = null;
  let originalSourceImage: HTMLImageElement | null = null;
  let pngDataUrl: string | null = null;
  let pendingImage: PendingImageState | null = null;
  let existingId: string | null = isNew ? null : buildingId;
  let loadedArchetype: BuildingArchetype | null = null;
  let blockedMask: boolean[][] = [];
  let imageGeneration = 0;
  let restoring = false;
  let lastSavedDraftRevision = session.getSnapshot().publication?.draftRevision ?? null;
  const history = new BoundedHistory<EditorHistorySnapshot>(40, cloneEditorSnapshot);
  let workflow: WorkflowPanelHandle;

  workflow = mountWorkflowPanel(root.querySelector('#bld-workflow') as HTMLElement, {
    session,
    saveDraft,
    getLastSavedDraftRevision: () => lastSavedDraftRevision,
    previewDraft: () => {
      root.querySelector('#bld-game-neutral')?.scrollIntoView({ block: 'nearest' });
      setStatus('Draft preview refreshed. No publication was created.', 'pending');
    },
    setStatus,
  });

  for (const id of FIELD_IDS) {
    const element = root.querySelector(`#${id}`);
    element?.addEventListener('input', () => {
      if (id === 'lab-scenario') {
        session.setScenarioContext(str('lab-scenario'), num('lab-seed'));
      }
      if (!restoring) {
        session.setDirty(true);
      }
      refresh();
    });
    element?.addEventListener('change', () => {
      if (restoring) {
        return;
      }
      if (id === 'cells-w' || id === 'cells-h') {
        ensureMask(num('cells-w'), num('cells-h'));
      }
      history.push(captureSnapshot());
      session.setDirty(true);
      refresh();
    });
  }
  root.querySelector('#bld-file')?.addEventListener('change', (event) => {
    void replaceImage(event);
  });
  root.querySelector('#save-building')?.addEventListener('click', () => {
    void saveDraft();
  });
  root.querySelector('#sandbox-building')?.addEventListener('click', openSandbox);
  root.querySelector('#bld-undo')?.addEventListener('click', () => void restoreHistory(history.undo()));
  root.querySelector('#bld-redo')?.addEventListener('click', () => void restoreHistory(history.redo()));
  root.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
      return;
    }
    event.preventDefault();
    void restoreHistory(event.shiftKey ? history.redo() : history.undo());
  });
  root.querySelector('#footprint-grid')?.addEventListener('click', (event) => {
    const canvas = root.querySelector('#footprint-grid');
    if (!(canvas instanceof HTMLCanvasElement) || !(event instanceof MouseEvent)) {
      return;
    }
    const cellsW = num('cells-w');
    const cellsH = num('cells-h');
    ensureMask(cellsW, cellsH);
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * cellsW);
    const z = Math.floor(((event.clientY - rect.top) / rect.height) * cellsH);
    if (x >= 0 && x < cellsW && z >= 0 && z < cellsH) {
      blockedMask[z]![x] = !blockedMask[z]![x];
      history.push(captureSnapshot());
      session.setDirty(true);
      refresh();
    }
  });

  history.seed(captureSnapshot());
  void loadExisting();

  async function loadExisting(): Promise<void> {
    try {
      const publication = await session.refreshPublication();
      lastSavedDraftRevision = publication.draftRevision;
      if (isNew && cloneFrom) {
        const buildings = await fetchBuildingsV2();
        const source = buildings.find((entry) => entry.id === cloneFrom);
        if (source) {
          const clone = { ...source, id: presetId, displayName: `${source.displayName} Copy` };
          applyArchetype(clone);
          loadedArchetype = clone;
          await loadDraftImage(clone.assetPath, false);
          adoptLoadedImageAsPending(clone.id);
        }
      } else if (!isNew && buildingId) {
        const buildings = await fetchBuildingsV2();
        const source = buildings.find((entry) => entry.id === buildingId);
        if (!source) {
          throw new Error(`Building ${buildingId} was not found in the draft.`);
        }
        applyArchetype(source);
        loadedArchetype = source;
        await loadDraftImage(source.assetPath, true);
      }
      history.seed(captureSnapshot());
      session.setDirty(false);
      refresh();
    } catch (error) {
      setStatus(formatApiError(error), 'error');
      refresh();
    }
  }

  async function loadDraftImage(assetPath: string, original: boolean): Promise<void> {
    const generation = (imageGeneration += 1);
    const image = await loadImageSource(draftAssetUrl(assetPath));
    if (generation !== imageGeneration) {
      return;
    }
    sourceImage = image;
    if (original) {
      originalSourceImage = image;
      pendingImage = null;
      pngDataUrl = null;
    }
    setSourceDimensions(image.naturalWidth, image.naturalHeight);
  }

  function adoptLoadedImageAsPending(id: string): void {
    if (!sourceImage) {
      return;
    }
    pngDataUrl = imageToPngDataUrl(sourceImage);
    pendingImage = {
      dataUrl: pngDataUrl,
      name: `${id}-source.png`,
      width: sourceImage.naturalWidth,
      height: sourceImage.naturalHeight,
    };
  }

  async function replaceImage(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }
    const file = input.files[0];
    const generation = (imageGeneration += 1);
    try {
      const dataUrl = await fileToPngDataUrl(file);
      const image = await loadImageDataUrl(dataUrl);
      if (generation !== imageGeneration) {
        return;
      }
      sourceImage = image;
      pngDataUrl = dataUrl;
      pendingImage = { dataUrl, name: file.name, width: image.naturalWidth, height: image.naturalHeight };
      setSourceDimensions(image.naturalWidth, image.naturalHeight);
      history.push(captureSnapshot());
      session.setDirty(true);
      setStatus(`Loaded replacement ${file.name}. Stable ID ${str('bld-id')} is unchanged.`, 'ok');
      refresh();
    } catch (error) {
      if (generation === imageGeneration) {
        setStatus(formatApiError(error), 'error');
      }
    }
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
    blockedMask = archetype.blockedCellMask ? archetype.blockedCellMask.map((row) => [...row]) : defaultMask(archetype.footprint.cellsW, archetype.footprint.cellsH);
    setSourceDimensions(archetype.sourceWidth, archetype.sourceHeight);
  }

  function buildArchetype(): BuildingArchetype {
    if (!sourceImage) {
      throw new Error('Load a source PNG first.');
    }
    const data = imageToImageData(sourceImage);
    const cellsW = num('cells-w');
    const cellsH = num('cells-h');
    ensureMask(cellsW, cellsH);
    const id = str('bld-id');
    return {
      ...(loadedArchetype ?? {}),
      schemaVersion: 2,
      id,
      displayName: str('bld-name'),
      enabled: loadedArchetype?.enabled ?? true,
      factionId: str('bld-faction') as FactionId,
      assetPath: `buildings/${id}/sprite.png`,
      sourceWidth: sourceImage.naturalWidth,
      sourceHeight: sourceImage.naturalHeight,
      bounds: detectOpaqueBounds(data.width, data.height, data.data),
      anchor: { x: num('bld-anchor-x'), y: num('bld-anchor-y') },
      worldHeight: num('bld-world-height'),
      footprint: { kind: 'rect', cellsW, cellsH },
      blockedCellMask: blockedMask.map((row) => [...row]),
      selectionFootprint: { kind: 'rect', cellsW, cellsH },
      entrancePoint: { x: num('entrance-x'), z: num('entrance-z') },
      rallyPoint: { x: num('rally-x'), z: num('rally-z') },
    };
  }

  function refresh(): void {
    const manifest = root.querySelector('#bld-manifest');
    drawFootprintGrid(num('cells-w'), num('cells-h'));
    if (!sourceImage) {
      if (manifest instanceof HTMLElement) {
        manifest.textContent = 'No PNG loaded';
      }
      return;
    }
    try {
      const archetype = buildArchetype();
      if (manifest instanceof HTMLElement) {
        manifest.textContent = JSON.stringify(archetype, null, 2);
      }
      drawSourcePreview(mustCanvas('bld-src-neutral'), sourceImage, 'neutral');
      drawSourcePreview(mustCanvas('bld-src-checker'), sourceImage, 'checker');
      const frame = { x: 0, y: 0, w: sourceImage.naturalWidth, h: sourceImage.naturalHeight };
      const flags = { showGroundGrid: checked('bld-show-grid'), showFootprints: checked('bld-show-footprints'), showDirectionOverlay: false };
      drawRuntimeGameplayPreview(mustCanvas('bld-game-neutral'), sourceImage, archetype, frame, 'gameplay', 'neutral', flags, 'Building footprint');
      drawRuntimeGameplayPreview(mustCanvas('bld-cam-neutral'), sourceImage, archetype, frame, 'seventy', 'neutral', flags, 'Building footprint');
      if (!restoring) {
        setStatus('Manifest valid for the current draft fields.', 'ok');
      }
    } catch (error) {
      if (manifest instanceof HTMLElement) {
        manifest.textContent = formatApiError(error);
      }
      if (!restoring) {
        setStatus(formatApiError(error), 'error');
      }
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
    const width = 240;
    const height = 200;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f2c2f';
    ctx.fillRect(0, 0, width, height);
    const cellPx = Math.min(width / Math.max(1, cellsW), height / Math.max(1, cellsH));
    const offsetX = (width - cellPx * cellsW) / 2;
    const offsetY = (height - cellPx * cellsH) / 2;
    for (let z = 0; z < cellsH; z += 1) {
      for (let x = 0; x < cellsW; x += 1) {
        const blocked = blockedMask[z]?.[x] ?? true;
        ctx.fillStyle = blocked ? '#e07a3d88' : '#5ce1e644';
        ctx.fillRect(offsetX + x * cellPx, offsetY + z * cellPx, cellPx - 1, cellPx - 1);
        ctx.strokeStyle = '#f2e6d0';
        ctx.strokeRect(offsetX + x * cellPx, offsetY + z * cellPx, cellPx - 1, cellPx - 1);
      }
    }
  }

  function ensureMask(cellsW: number, cellsH: number): void {
    if (blockedMask.length !== cellsH || blockedMask[0]?.length !== cellsW) {
      blockedMask = defaultMask(cellsW, cellsH);
    }
  }

  async function saveDraft(): Promise<string | null> {
    try {
      const archetype = buildArchetype();
      const expected = session.getSnapshot().publication?.draftRevision;
      if (!expected) {
        throw new Error('Draft revision is unknown. Reconnect before saving.');
      }
      const result = existingId
        ? await updateBuildingV2(existingId, archetype, pngDataUrl ?? undefined, expected)
        : await createBuildingV2(archetype, pngDataUrl ?? undefined, expected);
      if (!result.archetype) {
        throw new Error('Draft save returned no building archetype.');
      }
      loadedArchetype = result.archetype;
      existingId = result.archetype.id;
      setVal('bld-id', result.archetype.id);
      (root.querySelector('#bld-id') as HTMLInputElement | null)?.setAttribute('readonly', 'readonly');
      originalSourceImage = sourceImage;
      pngDataUrl = null;
      pendingImage = null;
      lastSavedDraftRevision = result.publication.draftRevision;
      session.setPublication(result.publication);
      session.setDirty(false);
      workflow.markDraftSaved(lastSavedDraftRevision);
      history.seed(captureSnapshot());
      setStatus(`Saved draft ${result.archetype.id} at draft revision ${lastSavedDraftRevision}. This is not live publish.`, 'ok');
      return lastSavedDraftRevision;
    } catch (error) {
      setStatus(formatApiError(error), 'error');
      return null;
    }
  }

  function openSandbox(): void {
    const snapshot = session.getSnapshot();
    if (!snapshot.publication) {
      setStatus('Test in Sandbox is pending a live publication cursor. Reconnect first.', 'error');
      return;
    }
    const id = str('bld-id');
    const url = buildSandboxUrl({ archetypeId: id, kind: 'building', seed: num('lab-seed'), scenarioId: str('lab-scenario'), publicationRevision: snapshot.publication.currentRevision, debug: true });
    window.open(url, '_blank', 'noopener,noreferrer');
    setStatus(`Sandbox opened for ${id}, ${str('lab-scenario')}, seed ${String(num('lab-seed'))}, published revision ${snapshot.publication.currentRevision}.`, 'ok');
  }

  function captureSnapshot(): EditorHistorySnapshot {
    const fields: Record<string, string | boolean> = {};
    for (const id of FIELD_IDS) {
      const element = root.querySelector(`#${id}`);
      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        fields[id] = element.checked;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        fields[id] = element.value;
      }
    }
    fields['blocked-mask'] = JSON.stringify(blockedMask);
    return { fields, pendingImage: pendingImage ? { ...pendingImage } : null, selectedFrame: 0 };
  }

  async function restoreHistory(snapshot: EditorHistorySnapshot | null): Promise<void> {
    if (!snapshot) {
      return;
    }
    restoring = true;
    try {
      for (const [id, value] of Object.entries(snapshot.fields)) {
        if (id === 'blocked-mask') {
          try {
            const parsed = JSON.parse(String(value)) as unknown;
            if (Array.isArray(parsed) && parsed.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'boolean'))) {
              blockedMask = parsed.map((row) => [...row] as boolean[]);
            }
          } catch {
            // Keep the current mask when an old snapshot has no mask payload.
          }
          continue;
        }
        if (typeof value === 'boolean') {
          setChecked(id, value);
        } else {
          setVal(id, value);
        }
      }
      pendingImage = snapshot.pendingImage ? { ...snapshot.pendingImage } : null;
      const generation = (imageGeneration += 1);
      if (pendingImage) {
        const image = await loadImageDataUrl(pendingImage.dataUrl);
        if (generation !== imageGeneration) {
          return;
        }
        sourceImage = image;
        pngDataUrl = pendingImage.dataUrl;
        setSourceDimensions(image.naturalWidth, image.naturalHeight);
      } else {
        sourceImage = originalSourceImage;
        pngDataUrl = null;
      }
    } finally {
      restoring = false;
    }
    session.setDirty(true);
    refresh();
    setStatus('Local edit restored. Save draft before validation or publish.', 'pending');
  }

  function setStatus(text: string, kind: 'ok' | 'error' | 'pending' = 'ok'): void {
    const status = root.querySelector('#bld-status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }

  function setSourceDimensions(width: number, height: number): void {
    const element = root.querySelector('#bld-source-dimensions');
    if (element instanceof HTMLElement) {
      element.textContent = `Source dimensions: ${String(width)}×${String(height)} px`;
    }
  }

  function str(id: string): string {
    const element = root.querySelector(`#${id}`);
    return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : '';
  }

  function num(id: string): number {
    return Number(str(id));
  }

  function checked(id: string): boolean {
    const element = root.querySelector(`#${id}`);
    return element instanceof HTMLInputElement && element.checked;
  }

  function setVal(id: string, value: string): void {
    const element = root.querySelector(`#${id}`);
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      element.value = value;
    }
  }

  function setChecked(id: string, value: boolean): void {
    const element = root.querySelector(`#${id}`);
    if (element instanceof HTMLInputElement) {
      element.checked = value;
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

function defaultMask(cellsW: number, cellsH: number): boolean[][] {
  return Array.from({ length: cellsH }, () => Array.from({ length: cellsW }, () => true));
}

function drawSourcePreview(canvas: HTMLCanvasElement, image: CanvasImageSource, background: 'checker' | 'neutral'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const width = image instanceof HTMLImageElement ? image.naturalWidth : 128;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : 128;
  const scale = Math.min(1, 320 / Math.max(width, height));
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  canvas.className = background;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background === 'neutral') {
    ctx.fillStyle = '#8aa3a8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function loadImageSource(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load draft asset ${url}`));
    image.src = url;
  });
}

function formatApiError(error: unknown): string {
  if (!(error instanceof ContentApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 409 && error.code === 'revision-conflict') {
    return `${error.message} Local edits were not discarded. Refresh the revision and reconcile deliberately.`;
  }
  return error.message;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
