import {
  detectOpaqueBounds,
  type DirectionCount,
  type FactionId,
  type UnitArchetype,
} from '@pastel-rts/content-schema';
import {
  ContentApiError,
  buildSandboxUrl,
  createUnitV2,
  draftAssetUrl,
  fetchUnitsV2,
  updateUnitV2,
} from '../api/contentApi';
import { FoundrySession } from '../app/foundrySession';
import { fileToPngDataUrl, imageToImageData, imageToPngDataUrl, loadImageDataUrl } from '../png';
import { BoundedHistory, cloneEditorSnapshot, type EditorHistorySnapshot, type PendingImageState } from '../editor/history';
import { drawRuntimeGameplayPreview, drawFramePreview, drawSheetGridOverlay } from './unitPreviews';
import {
  chooseBestSheetConfig,
  directionLabels,
  frameRect,
  totalFrames,
  type SheetConfig,
} from './spriteSheet';
import { mountWorkflowPanel, type WorkflowPanelHandle } from '../workflow/workflowPanel';

const FIELD_IDS = [
  'unit-id', 'unit-name', 'unit-faction', 'sheet-layout', 'frame-w', 'frame-h',
  'margin-x', 'margin-y', 'spacing-x', 'spacing-y', 'grid-cols', 'grid-rows',
  'directions', 'mirrored', 'idle-fps', 'move-fps', 'idle-frames', 'move-frames',
  'idle-loop', 'move-loop', 'anchor-x', 'anchor-y', 'world-height', 'sel-radius',
  'col-radius', 'speed', 'lab-scenario', 'lab-seed',
] as const;

export function mountUnitEditor(
  root: HTMLElement,
  unitId: string | null,
  query: URLSearchParams,
  session: FoundrySession,
): void {
  const isNew = unitId === 'new' || unitId === null;
  const cloneFrom = query.get('from');
  const presetId = query.get('id') ?? 'new-unit';
  const scenarioId = query.get('scenario') ?? session.getSnapshot().scenarioId;
  const seed = Number(query.get('seed') ?? session.getSnapshot().seed);
  session.setScenarioContext(scenarioId, Number.isFinite(seed) ? seed : 1);

  root.innerHTML = `
    <div class="editor-heading">
      <div><p class="eyebrow">Foundry / runtime content</p><h1>Unit Editor</h1><p class="lede">Replace a sprite sheet without changing its stable ID. Draft edits stay local to the content service until you publish a revision.</p></div>
      <div class="editor-actions"><button type="button" id="unit-undo" title="Undo (Cmd/Ctrl+Z)">Undo</button><button type="button" id="unit-redo" title="Redo (Cmd/Ctrl+Shift+Z)">Redo</button></div>
    </div>
    <div class="workflow-panel" id="unit-workflow"></div>
    <div class="grid editor-grid">
      <section>
        <h2>Identity and source</h2>
        <label>Stable ID <input id="unit-id" value="${escapeAttribute(presetId)}" ${isNew ? '' : 'readonly'} /></label>
        <p class="field-note">The stable ID is the runtime identity. Replacement keeps this ID and preserves retained publication sources.</p>
        <label>Display name <input id="unit-name" value="${escapeAttribute(presetId)}" /></label>
        <label>Faction
          <select id="unit-faction"><option value="sunweaver">sunweaver</option><option value="gravemark">gravemark</option><option value="neutral">neutral</option></select>
        </label>
        <label>Replace source PNG <input id="unit-file" type="file" accept="image/png" /></label>
        <p class="field-note" id="source-dimensions">Source dimensions: —</p>

        <h2>Sandbox context</h2>
        <label>Scenario ID <input id="lab-scenario" value="${escapeAttribute(scenarioId)}" /></label>
        <label>Seed <input id="lab-seed" type="number" value="${String(Number.isFinite(seed) ? seed : 1)}" /></label>

        <h2>Sheet layout</h2>
        <label>Layout
          <select id="sheet-layout"><option value="single">One frame</option><option value="horizontal">Horizontal strip</option><option value="grid">Regular grid</option></select>
        </label>
        <div class="field-pair"><label>Frame width (px) <input id="frame-w" type="number" min="1" value="32" /></label><label>Frame height (px) <input id="frame-h" type="number" min="1" value="32" /></label></div>
        <div class="field-pair"><label>Margin X (px) <input id="margin-x" type="number" min="0" value="0" /></label><label>Margin Y (px) <input id="margin-y" type="number" min="0" value="0" /></label></div>
        <div class="field-pair"><label>Spacing X (px) <input id="spacing-x" type="number" min="0" value="0" /></label><label>Spacing Y (px) <input id="spacing-y" type="number" min="0" value="0" /></label></div>
        <div class="field-pair"><label>Grid columns <input id="grid-cols" type="number" min="1" value="1" /></label><label>Grid rows <input id="grid-rows" type="number" min="1" value="1" /></label></div>

        <h2>Animation</h2>
        <label>Directions
          <select id="directions"><option value="1">1 (billboard)</option><option value="4">4 (N/E/S/W)</option><option value="8">8 (octants)</option></select>
        </label>
        <label class="checkbox-label"><input id="mirrored" type="checkbox" /> Mirror west facings</label>
        <div class="field-pair"><label>Idle FPS <input id="idle-fps" type="number" min="1" value="8" /></label><label>Move FPS <input id="move-fps" type="number" min="1" value="12" /></label></div>
        <label>Idle frame indexes <input id="idle-frames" value="0" /></label>
        <label>Move frame indexes <input id="move-frames" value="0" /></label>
        <div class="field-pair"><label class="checkbox-label"><input id="idle-loop" type="checkbox" checked /> Idle loop</label><label class="checkbox-label"><input id="move-loop" type="checkbox" checked /> Move loop</label></div>

        <h2>World scale and selection</h2>
        <div class="field-pair"><label>Anchor X <input id="anchor-x" type="number" min="0" max="1" step="0.05" value="0.5" /></label><label>Anchor Y <input id="anchor-y" type="number" min="0" max="1" step="0.05" value="1" /></label></div>
        <label>World height (cells) <input id="world-height" type="number" min="0.1" step="0.1" value="1.5" /></label>
        <div class="field-pair"><label>Selection radius (cells) <input id="sel-radius" type="number" min="0.1" step="0.1" value="0.6" /></label><label>Collision radius (cells) <input id="col-radius" type="number" min="0.1" step="0.1" value="0.45" /></label></div>
        <label>Speed (subunits/tick) <input id="speed" type="number" min="1" value="64" /></label>

        <h2>Preview overlays</h2>
        <div class="overlay-toggles"><label class="checkbox-label"><input id="show-frame-grid" type="checkbox" checked /> Frame grid</label><label class="checkbox-label"><input id="show-footprints" type="checkbox" checked /> Ground/footprints</label><label class="checkbox-label"><input id="show-direction-overlays" type="checkbox" checked /> Direction labels</label></div>
        <div class="toolbar"><button type="button" id="save-unit">Save draft</button><button type="button" id="sandbox-unit">Test in Sandbox</button></div>
        <p class="status" id="unit-status" aria-live="polite"></p>
      </section>
      <section>
        <h2>Runtime projection</h2>
        <p class="field-note">These previews use the runtime IsometricCamera, world height, anchor, and footprint units. They are not square thumbnail fits.</p>
        <div class="preview-grid">
          <div class="preview-card"><div>Source + frame grid</div><canvas id="pv-grid" class="checker"></canvas></div>
          <div class="preview-card"><div>Selected frame</div><canvas id="pv-frame-neutral" class="neutral"></canvas><canvas id="pv-frame-checker" class="checker"></canvas></div>
          <div class="preview-card"><div>Idle</div><canvas id="pv-idle" class="neutral"></canvas></div>
          <div class="preview-card"><div>Move</div><canvas id="pv-move" class="neutral"></canvas></div>
          <div class="preview-card"><div>Directions</div><div id="pv-directions" class="direction-row"></div></div>
          <div class="preview-card preview-wide"><div>Gameplay zoom · runtime default</div><canvas id="pv-game-neutral" class="neutral"></canvas><canvas id="pv-game-checker" class="checker"></canvas></div>
          <div class="preview-card preview-wide"><div>70-percent · runtime camera</div><canvas id="pv-cam-neutral" class="neutral"></canvas><canvas id="pv-cam-checker" class="checker"></canvas></div>
        </div>
        <h3>Draft manifest</h3>
        <pre id="unit-manifest"></pre>
      </section>
    </div>
  `;

  let sourceImage: HTMLImageElement | null = null;
  let originalSourceImage: HTMLImageElement | null = null;
  let pngDataUrl: string | null = null;
  let pendingImage: PendingImageState | null = null;
  let existingId: string | null = isNew ? null : unitId;
  let selectedFrame = 0;
  let loadedArchetype: UnitArchetype | null = null;
  let imageGeneration = 0;
  let restoring = false;
  let lastSavedDraftRevision = session.getSnapshot().publication?.draftRevision ?? null;
  const history = new BoundedHistory<EditorHistorySnapshot>(40, cloneEditorSnapshot);
  let workflow: WorkflowPanelHandle;

  workflow = mountWorkflowPanel(root.querySelector('#unit-workflow') as HTMLElement, {
    session,
    saveDraft,
    getLastSavedDraftRevision: () => lastSavedDraftRevision,
    previewDraft: () => {
      root.querySelector('#pv-game-neutral')?.scrollIntoView({ block: 'nearest' });
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
      history.push(captureSnapshot());
      session.setDirty(true);
      refresh();
    });
  }

  root.querySelector('#unit-file')?.addEventListener('change', (event) => {
    void replaceImage(event);
  });
  root.querySelector('#save-unit')?.addEventListener('click', () => {
    void saveDraft();
  });
  root.querySelector('#sandbox-unit')?.addEventListener('click', openSandbox);
  root.querySelector('#unit-undo')?.addEventListener('click', () => {
    void restoreHistory(history.undo());
  });
  root.querySelector('#unit-redo')?.addEventListener('click', () => {
    void restoreHistory(history.redo());
  });
  root.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') {
      return;
    }
    event.preventDefault();
    void restoreHistory(event.shiftKey ? history.redo() : history.undo());
  });

  history.seed(captureSnapshot());
  void loadExisting();

  async function loadExisting(): Promise<void> {
    try {
      const publication = await session.refreshPublication();
      lastSavedDraftRevision = publication.draftRevision;
      if (isNew && cloneFrom) {
        const units = await fetchUnitsV2();
        const source = units.find((entry) => entry.id === cloneFrom);
        if (source) {
          const clone = { ...source, id: presetId, displayName: `${source.displayName} Copy` };
          applyArchetype(clone);
          loadedArchetype = clone;
          existingId = null;
          await loadDraftImage(clone.assetPath, false);
          adoptLoadedImageAsPending(clone.id);
        }
      } else if (!isNew && unitId) {
        const units = await fetchUnitsV2();
        const source = units.find((entry) => entry.id === unitId);
        if (!source) {
          throw new Error(`Unit ${unitId} was not found in the draft.`);
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
      pngDataUrl = null;
      pendingImage = null;
    }
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
      applySheetConfig(chooseBestSheetConfig(image.naturalWidth, image.naturalHeight));
      setSourceDimensions(image.naturalWidth, image.naturalHeight);
      history.push(captureSnapshot());
      session.setDirty(true);
      setStatus(`Loaded replacement ${file.name}. Stable ID ${str('unit-id')} is unchanged.`, 'ok');
      refresh();
    } catch (error) {
      if (generation === imageGeneration) {
        setStatus(formatApiError(error), 'error');
      }
    }
  }

  function applyArchetype(archetype: UnitArchetype): void {
    setVal('unit-id', archetype.id);
    setVal('unit-name', archetype.displayName);
    setVal('unit-faction', archetype.factionId);
    setVal('frame-w', String(archetype.frameWidth));
    setVal('frame-h', String(archetype.frameHeight));
    setVal('margin-x', String(archetype.margin.x));
    setVal('margin-y', String(archetype.margin.y));
    setVal('spacing-x', String(archetype.spacing.x));
    setVal('spacing-y', String(archetype.spacing.y));
    setVal('sheet-layout', archetype.frameWidth === archetype.sourceWidth && archetype.frameHeight === archetype.sourceHeight ? 'single' : 'grid');
    const columns = Math.max(1, Math.floor((archetype.sourceWidth - archetype.margin.x + archetype.spacing.x) / (archetype.frameWidth + archetype.spacing.x)));
    const rows = Math.max(1, Math.floor((archetype.sourceHeight - archetype.margin.y + archetype.spacing.y) / (archetype.frameHeight + archetype.spacing.y)));
    setVal('grid-cols', String(columns));
    setVal('grid-rows', String(rows));
    setVal('directions', String(archetype.animation.directions));
    setChecked('mirrored', Boolean(archetype.animation.mirrored));
    setVal('idle-fps', String(archetype.animation.clips.idle.fps));
    setVal('move-fps', String(archetype.animation.clips.move.fps));
    setVal('idle-frames', framesToCsv(archetype.animation.clips.idle.frames));
    setVal('move-frames', framesToCsv(archetype.animation.clips.move.frames));
    setChecked('idle-loop', archetype.animation.clips.idle.looping);
    setChecked('move-loop', archetype.animation.clips.move.looping);
    setVal('anchor-x', String(archetype.anchor.x));
    setVal('anchor-y', String(archetype.anchor.y));
    setVal('world-height', String(archetype.worldHeight));
    setVal('sel-radius', String(archetype.selectionRadius));
    setVal('col-radius', String(archetype.collisionRadius));
    setVal('speed', String(archetype.movement.speedSubunitsPerTick));
    setSourceDimensions(archetype.sourceWidth, archetype.sourceHeight);
  }

  function applySheetConfig(config: SheetConfig): void {
    setVal('sheet-layout', config.layout);
    setVal('frame-w', String(config.frameWidth));
    setVal('frame-h', String(config.frameHeight));
    setVal('margin-x', String(config.marginX));
    setVal('margin-y', String(config.marginY));
    setVal('spacing-x', String(config.spacingX));
    setVal('spacing-y', String(config.spacingY));
    setVal('grid-cols', String(config.columns));
    setVal('grid-rows', String(config.rows));
    selectedFrame = 0;
    // Programmatic values do not emit input/change. Refresh only after all
    // dimensions are written so the manifest cannot retain stale sheet data.
    queueMicrotask(refresh);
  }

  function readSheetConfig(): SheetConfig {
    return {
      layout: str('sheet-layout') as SheetConfig['layout'],
      frameWidth: num('frame-w'),
      frameHeight: num('frame-h'),
      marginX: num('margin-x'),
      marginY: num('margin-y'),
      spacingX: num('spacing-x'),
      spacingY: num('spacing-y'),
      columns: num('grid-cols'),
      rows: num('grid-rows'),
    };
  }

  function buildArchetype(): UnitArchetype {
    if (!sourceImage) {
      throw new Error('Load a source PNG first.');
    }
    const config = readSheetConfig();
    const selected = frameRect(selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight);
    if (!selected) {
      throw new Error('Selected frame is outside the inferred sheet dimensions.');
    }
    const data = imageToImageData(sourceImage);
    const bounds = detectFrameBounds(data, selected);
    const frames = totalFrames(config, sourceImage.naturalWidth, sourceImage.naturalHeight);
    const id = str('unit-id');
    const assetPath = `units/${id}/sheet.png`;
    const directions = Number(str('directions')) as DirectionCount;
    const archetype: UnitArchetype = {
      schemaVersion: 2,
      id,
      displayName: str('unit-name'),
      enabled: loadedArchetype?.enabled ?? true,
      factionId: str('unit-faction') as FactionId,
      assetPath,
      sourceWidth: sourceImage.naturalWidth,
      sourceHeight: sourceImage.naturalHeight,
      frameWidth: config.frameWidth,
      frameHeight: config.frameHeight,
      margin: { x: config.marginX, y: config.marginY },
      spacing: { x: config.spacingX, y: config.spacingY },
      bounds,
      anchor: { x: num('anchor-x'), y: num('anchor-y') },
      worldHeight: num('world-height'),
      selectionRadius: num('sel-radius'),
      collisionRadius: num('col-radius'),
      animation: {
        directions,
        mirrored: checked('mirrored'),
        clips: {
          idle: { frames: { kind: 'indexes', indexes: parseFrameCsv(str('idle-frames'), frames) }, fps: num('idle-fps'), looping: checked('idle-loop'), assetPath },
          move: { frames: { kind: 'indexes', indexes: parseFrameCsv(str('move-frames'), frames) }, fps: num('move-fps'), looping: checked('move-loop'), assetPath },
        },
      },
      movement: {
        speedSubunitsPerTick: num('speed'),
        accelerationRate: 1,
        turnRateMilli: 3000,
        footprintCategory: 'unit-1x1',
      },
    };
    if (loadedArchetype?.shadow) {
      archetype.shadow = loadedArchetype.shadow;
    }
    if (loadedArchetype?.tags) {
      archetype.tags = loadedArchetype.tags;
    }
    return archetype;
  }

  function refresh(): void {
    const manifest = root.querySelector('#unit-manifest');
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
      const config = readSheetConfig();
      const frames = totalFrames(config, sourceImage.naturalWidth, sourceImage.naturalHeight);
      selectedFrame = Math.min(selectedFrame, Math.max(0, frames - 1));
      const selected = frameRect(selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight);
      if (!selected) {
        throw new Error('Frame dimensions do not fit the source image.');
      }
      if (checked('show-frame-grid')) {
        drawSheetGridOverlay(mustCanvas('pv-grid'), sourceImage, config, sourceImage.naturalWidth, sourceImage.naturalHeight, selectedFrame);
      } else {
        drawPlainSource(mustCanvas('pv-grid'), sourceImage);
      }
      const overlay = {
        anchorX: archetype.anchor.x,
        anchorY: archetype.anchor.y,
        selectionRadius: archetype.selectionRadius,
        collisionRadius: archetype.collisionRadius,
        worldHeight: archetype.worldHeight,
        bounds: archetype.bounds,
      };
      drawFramePreview(mustCanvas('pv-frame-neutral'), sourceImage, selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral', overlay);
      drawFramePreview(mustCanvas('pv-frame-checker'), sourceImage, selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'checker', overlay);
      const idleFrame = parseFrameCsv(str('idle-frames'), frames)[0] ?? 0;
      const moveFrame = parseFrameCsv(str('move-frames'), frames)[0] ?? 0;
      drawFramePreview(mustCanvas('pv-idle'), sourceImage, idleFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
      drawFramePreview(mustCanvas('pv-move'), sourceImage, moveFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
      const flags = {
        showGroundGrid: checked('show-frame-grid'),
        showFootprints: checked('show-footprints'),
        showDirectionOverlay: checked('show-direction-overlays'),
      };
      const directionText = archetype.tags?.includes('proxy') || archetype.displayName.toLowerCase().includes('proxy')
        ? 'Proxy / missing directions'
        : archetype.animation.directions > 1 && frames < archetype.animation.directions
          ? 'Missing authored directions'
          : 'Facing: authored';
      drawRuntimeGameplayPreview(mustCanvas('pv-game-neutral'), sourceImage, archetype, selected, 'gameplay', 'neutral', flags, directionText);
      drawRuntimeGameplayPreview(mustCanvas('pv-game-checker'), sourceImage, archetype, selected, 'gameplay', 'checker', flags, directionText);
      drawRuntimeGameplayPreview(mustCanvas('pv-cam-neutral'), sourceImage, archetype, selected, 'seventy', 'neutral', flags, directionText);
      drawRuntimeGameplayPreview(mustCanvas('pv-cam-checker'), sourceImage, archetype, selected, 'seventy', 'checker', flags, directionText);
      renderDirectionPreviews(archetype, config, frames);
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

  function renderDirectionPreviews(archetype: UnitArchetype, config: SheetConfig, frames: number): void {
    const container = root.querySelector('#pv-directions');
    if (!(container instanceof HTMLElement) || !sourceImage) {
      return;
    }
    container.innerHTML = '';
    const labels = directionLabels(archetype.animation.directions);
    const base = parseFrameCsv(str('idle-frames'), frames)[0] ?? 0;
    const framesPerDirection = Math.floor(frames / Math.max(1, archetype.animation.directions));
    for (let index = 0; index < labels.length; index += 1) {
      const wrap = document.createElement('div');
      wrap.className = 'direction-cell';
      const label = document.createElement('span');
      label.textContent = labels[index] ?? '';
      wrap.appendChild(label);
      if (archetype.animation.directions === 1 || framesPerDirection > 0) {
        const frame = base + index * Math.max(1, framesPerDirection);
        const rect = frameRect(frame, config, sourceImage.naturalWidth, sourceImage.naturalHeight);
        if (rect && (archetype.animation.directions === 1 || frame < frames)) {
          const canvas = document.createElement('canvas');
          canvas.className = 'neutral';
          drawFramePreview(canvas, sourceImage, frame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
          wrap.appendChild(canvas);
        } else {
          appendMissingFrame(wrap);
        }
      } else {
        appendMissingFrame(wrap);
      }
      container.appendChild(wrap);
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
        ? await updateUnitV2(existingId, archetype, pngDataUrl ?? undefined, expected)
        : await createUnitV2(archetype, pngDataUrl ?? undefined, expected);
      const saved = result.archetype;
      if (!saved) {
        throw new Error('Draft save returned no unit archetype.');
      }
      loadedArchetype = saved;
      existingId = saved.id;
      setVal('unit-id', saved.id);
      (root.querySelector('#unit-id') as HTMLInputElement | null)?.setAttribute('readonly', 'readonly');
      originalSourceImage = sourceImage;
      pendingImage = null;
      pngDataUrl = null;
      lastSavedDraftRevision = result.publication.draftRevision;
      session.setPublication(result.publication);
      session.setDirty(false);
      workflow.markDraftSaved(lastSavedDraftRevision);
      setStatus(`Saved draft ${saved.id} at draft revision ${lastSavedDraftRevision}. This is not live publish.`, 'ok');
      history.seed(captureSnapshot());
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
    const id = str('unit-id');
    const url = buildSandboxUrl({
      archetypeId: id,
      kind: 'unit',
      seed: num('lab-seed'),
      scenarioId: str('lab-scenario'),
      publicationRevision: snapshot.publication.currentRevision,
      debug: true,
    });
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
    return { fields, pendingImage: pendingImage ? { ...pendingImage } : null, selectedFrame };
  }

  async function restoreHistory(snapshot: EditorHistorySnapshot | null): Promise<void> {
    if (!snapshot) {
      return;
    }
    restoring = true;
    try {
      for (const [id, value] of Object.entries(snapshot.fields)) {
        if (typeof value === 'boolean') {
          setChecked(id, value);
        } else {
          setVal(id, value);
        }
      }
      selectedFrame = snapshot.selectedFrame;
      pendingImage = snapshot.pendingImage ? { ...snapshot.pendingImage } : null;
      const generation = (imageGeneration += 1);
      if (pendingImage) {
        const restoredImage = await loadImageDataUrl(pendingImage.dataUrl);
        if (generation !== imageGeneration) {
          return;
        }
        sourceImage = restoredImage;
        pngDataUrl = pendingImage.dataUrl;
        setSourceDimensions(restoredImage.naturalWidth, restoredImage.naturalHeight);
      } else {
        sourceImage = originalSourceImage;
        pngDataUrl = null;
        if (sourceImage) {
          setSourceDimensions(sourceImage.naturalWidth, sourceImage.naturalHeight);
        }
      }
    } finally {
      restoring = false;
    }
    session.setDirty(true);
    refresh();
    setStatus('Local edit restored. Save draft before validation or publish.', 'pending');
  }

  function setStatus(text: string, kind: 'ok' | 'error' | 'pending' = 'ok'): void {
    const status = root.querySelector('#unit-status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }

  function setSourceDimensions(width: number, height: number): void {
    const element = root.querySelector('#source-dimensions');
    if (element instanceof HTMLElement) {
      element.textContent = `Source dimensions: ${String(width)}×${String(height)} px`;
    }
  }

  function mustCanvas(id: string): HTMLCanvasElement {
    const canvas = root.querySelector(`#${id}`);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Missing canvas #${id}`);
    }
    return canvas;
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
}

function detectFrameBounds(data: ImageData, frame: { x: number; y: number; w: number; h: number }): { minX: number; minY: number; maxX: number; maxY: number } {
  const rgba = new Uint8ClampedArray(frame.w * frame.h * 4);
  for (let y = 0; y < frame.h; y += 1) {
    for (let x = 0; x < frame.w; x += 1) {
      const source = ((frame.y + y) * data.width + frame.x + x) * 4;
      const target = (y * frame.w + x) * 4;
      rgba[target] = data.data[source] ?? 0;
      rgba[target + 1] = data.data[source + 1] ?? 0;
      rgba[target + 2] = data.data[source + 2] ?? 0;
      rgba[target + 3] = data.data[source + 3] ?? 0;
    }
  }
  return detectOpaqueBounds(frame.w, frame.h, rgba);
}

function parseFrameCsv(raw: string, maxFrame: number): number[] {
  const parts = raw.split(',').map((part) => Number(part.trim())).filter((value) => Number.isInteger(value));
  if (parts.length === 0) {
    return [0];
  }
  return parts.map((value) => Math.min(Math.max(0, value), Math.max(0, maxFrame - 1)));
}

function framesToCsv(frames: { kind: string; indexes?: number[]; start?: number; end?: number }): string {
  if (frames.kind === 'indexes' && frames.indexes) {
    return frames.indexes.join(',');
  }
  if (frames.kind === 'range' && frames.start !== undefined && frames.end !== undefined) {
    const values: number[] = [];
    for (let index = frames.start; index <= frames.end; index += 1) {
      values.push(index);
    }
    return values.join(',');
  }
  return '0';
}

function drawPlainSource(canvas: HTMLCanvasElement, image: CanvasImageSource): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : 128;
  const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : 128;
  const scale = Math.min(1, 320 / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.ceil(sourceWidth * scale));
  canvas.height = Math.max(1, Math.ceil(sourceHeight * scale));
  canvas.className = 'checker';
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function appendMissingFrame(parent: HTMLElement): void {
  const missing = document.createElement('span');
  missing.className = 'missing-frame';
  missing.textContent = 'Missing frame';
  parent.appendChild(missing);
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
