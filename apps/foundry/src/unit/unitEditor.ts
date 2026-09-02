import {
  detectOpaqueBounds,
  type DirectionCount,
  type FactionId,
  type UnitArchetype,
} from '@pastel-rts/content-schema';
import {
  assetUrl,
  buildSandboxUrl,
  createUnitV2,
  fetchUnitsV2,
  updateUnitV2,
} from '../api/contentApi';
import { fileToPngDataUrl, imageToImageData, loadImageFile } from '../png';
import {
  defaultSheetConfig,
  directionLabels,
  facingFrameIndex,
  inferSheetConfig,
  totalFrames,
  type SheetConfig,
} from './spriteSheet';
import { drawFramePreview, drawScaledGameplayPreview, drawSheetGridOverlay } from './unitPreviews';

export function mountUnitEditor(root: HTMLElement, unitId: string | null, query: URLSearchParams): void {
  const isNew = unitId === 'new' || unitId === null;
  const cloneFrom = query.get('from');
  const presetId = query.get('id') ?? 'new-unit';

  root.innerHTML = `
    <h1>Unit Editor</h1>
    <p class="lede">Import sprite sheets (single PNG, horizontal strip, or grid). Configure animation clips, facings, and anchor tooling.</p>
    <div class="grid editor-grid">
      <section>
        <h2>Identity</h2>
        <label>ID <input id="unit-id" value="${presetId}" ${isNew ? '' : 'readonly'} /></label>
        <label>Display name <input id="unit-name" value="${presetId}" /></label>
        <label>Faction
          <select id="unit-faction">
            <option value="sunweaver">sunweaver</option>
            <option value="gravemark">gravemark</option>
            <option value="neutral">neutral</option>
          </select>
        </label>
        <label>Sprite sheet PNG <input id="unit-file" type="file" accept="image/png" /></label>
        <h2>Sheet layout</h2>
        <label>Layout
          <select id="sheet-layout">
            <option value="single">One frame</option>
            <option value="horizontal">Horizontal strip</option>
            <option value="grid">Regular grid</option>
          </select>
        </label>
        <label>Frame width <input id="frame-w" type="number" min="1" value="32" /></label>
        <label>Frame height <input id="frame-h" type="number" min="1" value="32" /></label>
        <label>Margin X <input id="margin-x" type="number" min="0" value="0" /></label>
        <label>Margin Y <input id="margin-y" type="number" min="0" value="0" /></label>
        <label>Spacing X <input id="spacing-x" type="number" min="0" value="0" /></label>
        <label>Spacing Y <input id="spacing-y" type="number" min="0" value="0" /></label>
        <label>Grid columns <input id="grid-cols" type="number" min="1" value="1" /></label>
        <label>Grid rows <input id="grid-rows" type="number" min="1" value="1" /></label>
        <h2>Animation</h2>
        <label>Directions
          <select id="directions">
            <option value="1">1 (billboard)</option>
            <option value="4">4 (N/E/S/W)</option>
            <option value="8">8 (octants)</option>
          </select>
        </label>
        <label><input id="mirrored" type="checkbox" /> Mirror west facings</label>
        <label>Idle FPS <input id="idle-fps" type="number" min="1" value="8" /></label>
        <label>Move FPS <input id="move-fps" type="number" min="1" value="12" /></label>
        <label>Idle frames (comma indexes) <input id="idle-frames" value="0" /></label>
        <label>Move frames (comma indexes) <input id="move-frames" value="0" /></label>
        <label><input id="idle-loop" type="checkbox" checked /> Idle loop</label>
        <label><input id="move-loop" type="checkbox" checked /> Move loop</label>
        <h2>Anchor & collision</h2>
        <label>Anchor X <input id="anchor-x" type="number" min="0" max="1" step="0.05" value="0.5" /></label>
        <label>Anchor Y <input id="anchor-y" type="number" min="0" max="1" step="0.05" value="1" /></label>
        <label>World height <input id="world-height" type="number" min="0.1" step="0.1" value="1.5" /></label>
        <label>Selection radius <input id="sel-radius" type="number" min="0.1" step="0.1" value="0.6" /></label>
        <label>Collision radius <input id="col-radius" type="number" min="0.1" step="0.1" value="0.45" /></label>
        <label>Speed (subunits/tick) <input id="speed" type="number" min="1" value="64" /></label>
        <div class="toolbar">
          <button type="button" id="save-unit">Save unit</button>
          <button type="button" id="sandbox-unit">Test in sandbox</button>
        </div>
        <p class="status" id="unit-status"></p>
      </section>
      <section>
        <h2>Previews</h2>
        <div class="preview-grid">
          <div class="preview-card"><div>Source + grid</div><canvas id="pv-grid" class="checker"></canvas></div>
          <div class="preview-card"><div>Selected frame</div><canvas id="pv-frame-neutral" class="neutral"></canvas><canvas id="pv-frame-checker" class="checker"></canvas></div>
          <div class="preview-card"><div>Idle</div><canvas id="pv-idle" class="neutral"></canvas></div>
          <div class="preview-card"><div>Move</div><canvas id="pv-move" class="neutral"></canvas></div>
          <div class="preview-card"><div>Directions</div><div id="pv-directions" class="direction-row"></div></div>
          <div class="preview-card"><div>Gameplay</div><canvas id="pv-game-neutral" class="neutral"></canvas><canvas id="pv-game-checker" class="checker"></canvas></div>
          <div class="preview-card"><div>70-percent</div><canvas id="pv-cam-neutral" class="neutral"></canvas><canvas id="pv-cam-checker" class="checker"></canvas></div>
        </div>
        <h3>Manifest</h3>
        <pre id="unit-manifest"></pre>
      </section>
    </div>
  `;

  let sourceImage: HTMLImageElement | null = null;
  let pngDataUrl: string | null = null;
  let existingId: string | null = isNew ? null : unitId;
  let selectedFrame = 0;
  let loadedArchetype: UnitArchetype | null = null;

  void loadExisting();

  for (const id of [
    'unit-id', 'unit-name', 'unit-faction', 'sheet-layout', 'frame-w', 'frame-h',
    'margin-x', 'margin-y', 'spacing-x', 'spacing-y', 'grid-cols', 'grid-rows',
    'directions', 'mirrored', 'idle-fps', 'move-fps', 'idle-frames', 'move-frames',
    'idle-loop', 'move-loop', 'anchor-x', 'anchor-y', 'world-height', 'sel-radius',
    'col-radius', 'speed',
  ]) {
    root.querySelector(`#${id}`)?.addEventListener('input', () => refresh());
    root.querySelector(`#${id}`)?.addEventListener('change', () => refresh());
  }

  root.querySelector('#unit-file')?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }
    try {
      sourceImage = await loadImageFile(input.files[0]);
      pngDataUrl = await fileToPngDataUrl(input.files[0]);
      const configs = inferSheetConfig(sourceImage.naturalWidth, sourceImage.naturalHeight);
      applySheetConfig(configs[0] ?? defaultSheetConfig(sourceImage.naturalWidth, sourceImage.naturalHeight));
      setStatus('PNG loaded.', 'ok');
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  });

  root.querySelector('#save-unit')?.addEventListener('click', () => {
    void saveUnit();
  });
  root.querySelector('#sandbox-unit')?.addEventListener('click', () => {
    const id = str('unit-id');
    window.open(buildSandboxUrl({ archetypeId: id, kind: 'unit', seed: 1, debug: true }), '_blank');
  });

  async function loadExisting(): Promise<void> {
    if (isNew && cloneFrom) {
      try {
        const units = await fetchUnitsV2();
        const source = units.find((entry) => entry.id === cloneFrom);
        if (source) {
          applyArchetype({ ...source, id: presetId, displayName: `${source.displayName} Copy` });
          loadedArchetype = { ...source, id: presetId, displayName: `${source.displayName} Copy` };
          existingId = null;
        }
      } catch {
        /* fresh new unit */
      }
    } else if (!isNew && unitId) {
      try {
        const units = await fetchUnitsV2();
        const source = units.find((entry) => entry.id === unitId);
        if (source) {
          applyArchetype(source);
          loadedArchetype = source;
          const img = new Image();
          img.onload = () => {
            sourceImage = img;
            refresh();
          };
          img.src = assetUrl(source.assetPath);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    }
    refresh();
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
      throw new Error('Load a PNG first');
    }
    const data = imageToImageData(sourceImage);
    const bounds = detectOpaqueBounds(data.width, data.height, data.data);
    const config = readSheetConfig();
    const id = str('unit-id');
    const assetPath = `units/${id}/sheet.png`;
    const frames = totalFrames(config, sourceImage.naturalWidth, sourceImage.naturalHeight);
    const idleIndexes = parseFrameCsv(str('idle-frames'), frames);
    const moveIndexes = parseFrameCsv(str('move-frames'), frames);
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
          idle: {
            frames: { kind: 'indexes', indexes: idleIndexes },
            fps: num('idle-fps'),
            looping: checked('idle-loop'),
            assetPath,
          },
          move: {
            frames: { kind: 'indexes', indexes: moveIndexes },
            fps: num('move-fps'),
            looping: checked('move-loop'),
            assetPath,
          },
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
    const manifestEl = root.querySelector('#unit-manifest');
    if (!sourceImage) {
      if (manifestEl) {
        manifestEl.textContent = 'No PNG loaded';
      }
      return;
    }
    try {
      const archetype = buildArchetype();
      if (manifestEl) {
        manifestEl.textContent = JSON.stringify(archetype, null, 2);
      }
      const config = readSheetConfig();
      const frames = totalFrames(config, sourceImage.naturalWidth, sourceImage.naturalHeight);
      const overlay = {
        anchorX: archetype.anchor.x,
        anchorY: archetype.anchor.y,
        selectionRadius: archetype.selectionRadius,
        collisionRadius: archetype.collisionRadius,
        worldHeight: archetype.worldHeight,
        bounds: archetype.bounds,
      };
      drawSheetGridOverlay(
        mustCanvas('pv-grid'),
        sourceImage,
        config,
        sourceImage.naturalWidth,
        sourceImage.naturalHeight,
        selectedFrame,
      );
      const idleFrame = parseFrameCsv(str('idle-frames'), frames)[0] ?? 0;
      const moveFrame = parseFrameCsv(str('move-frames'), frames)[0] ?? 0;
      drawFramePreview(mustCanvas('pv-frame-neutral'), sourceImage, selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral', overlay);
      drawFramePreview(mustCanvas('pv-frame-checker'), sourceImage, selectedFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'checker', overlay);
      drawFramePreview(mustCanvas('pv-idle'), sourceImage, idleFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
      drawFramePreview(mustCanvas('pv-move'), sourceImage, moveFrame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
      drawScaledGameplayPreview(mustCanvas('pv-game-neutral'), sourceImage, archetype.bounds, archetype.anchor, 'gameplay', 'neutral');
      drawScaledGameplayPreview(mustCanvas('pv-game-checker'), sourceImage, archetype.bounds, archetype.anchor, 'gameplay', 'checker');
      drawScaledGameplayPreview(mustCanvas('pv-cam-neutral'), sourceImage, archetype.bounds, archetype.anchor, 'seventy', 'neutral');
      drawScaledGameplayPreview(mustCanvas('pv-cam-checker'), sourceImage, archetype.bounds, archetype.anchor, 'seventy', 'checker');
      renderDirectionPreviews(archetype, config);
      setStatus('Manifest valid.', 'ok');
    } catch (error) {
      if (manifestEl) {
        manifestEl.textContent = error instanceof Error ? error.message : String(error);
      }
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function renderDirectionPreviews(archetype: UnitArchetype, config: SheetConfig): void {
    const container = root.querySelector('#pv-directions');
    if (!container || !sourceImage) {
      return;
    }
    container.innerHTML = '';
    const labels = directionLabels(archetype.animation.directions);
    const idleFrames = parseFrameCsv(
      str('idle-frames'),
      totalFrames(config, sourceImage.naturalWidth, sourceImage.naturalHeight),
    );
    const base = idleFrames[0] ?? 0;
    for (let i = 0; i < labels.length; i += 1) {
      const wrap = document.createElement('div');
      wrap.className = 'direction-cell';
      wrap.textContent = labels[i] ?? '';
      const canvas = document.createElement('canvas');
      canvas.className = 'neutral';
      wrap.appendChild(canvas);
      const frame = facingFrameIndex(i, 1, base);
      drawFramePreview(canvas, sourceImage, frame, config, sourceImage.naturalWidth, sourceImage.naturalHeight, 'neutral');
      container.appendChild(wrap);
    }
  }

  async function saveUnit(): Promise<void> {
    try {
      const archetype = buildArchetype();
      if (existingId) {
        await updateUnitV2(existingId, archetype, pngDataUrl ?? undefined);
        setStatus(`Updated ${archetype.id}.`, 'ok');
      } else {
        if (!pngDataUrl) {
          throw new Error('PNG required for new units');
        }
        await createUnitV2(archetype, pngDataUrl);
        existingId = archetype.id;
        setVal('unit-id', archetype.id);
        (root.querySelector('#unit-id') as HTMLInputElement | null)?.setAttribute('readonly', 'readonly');
        setStatus(`Created ${archetype.id}.`, 'ok');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function str(id: string): string {
    const el = root.querySelector(`#${id}`);
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';
  }

  function num(id: string): number {
    return Number(str(id));
  }

  function checked(id: string): boolean {
    const el = root.querySelector(`#${id}`);
    return el instanceof HTMLInputElement ? el.checked : false;
  }

  function setVal(id: string, value: string): void {
    const el = root.querySelector(`#${id}`);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      el.value = value;
    }
  }

  function setChecked(id: string, value: boolean): void {
    const el = root.querySelector(`#${id}`);
    if (el instanceof HTMLInputElement) {
      el.checked = value;
    }
  }

  function setStatus(text: string, kind: 'ok' | 'error'): void {
    const status = root.querySelector('#unit-status');
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

function parseFrameCsv(raw: string, maxFrame: number): number[] {
  const parts = raw.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n));
  if (parts.length === 0) {
    return [0];
  }
  return parts.map((index) => Math.min(Math.max(0, index), Math.max(0, maxFrame - 1)));
}

function framesToCsv(frames: { kind: string; indexes?: number[]; start?: number; end?: number }): string {
  if (frames.kind === 'indexes' && frames.indexes) {
    return frames.indexes.join(',');
  }
  if (frames.kind === 'range' && frames.start !== undefined && frames.end !== undefined) {
    const list: number[] = [];
    for (let i = frames.start; i <= frames.end; i += 1) {
      list.push(i);
    }
    return list.join(',');
  }
  return '0';
}
