import { createUnitManifest, detectOpaqueBounds, type UnitFaction, type UnitManifest } from '@pastel-rts/content-schema';
import { publishUnitV1 } from '../api/contentApi';
import { fileToPngDataUrl, imageToImageData, loadImageFile } from '../png';
import { drawPreview } from '../preview';

export function mountV1ProxyEditor(root: HTMLElement): void {
  root.innerHTML = `
    <h1>Content Foundry</h1>
    <p class="lede">Milestone 0 path: upload one transparent PNG, configure a unit proxy, save it into the development content pack, and hot-reload it into game-web.</p>
    <div class="grid">
      <section>
        <h2>Import</h2>
        <label>Transparent PNG <input id="file" type="file" accept="image/png" /></label>
        <label>Stable unit ID <input id="id" value="foundry-proxy" /></label>
        <label>Display name <input id="name" value="Foundry Proxy" /></label>
        <label>Faction
          <select id="faction">
            <option value="friendly">friendly</option>
            <option value="opposing">opposing</option>
            <option value="neutral">neutral</option>
          </select>
        </label>
        <label>Anchor X (0–1) <input id="anchorX" type="number" min="0" max="1" step="0.05" value="0.5" /></label>
        <label>Anchor Y (0–1) <input id="anchorY" type="number" min="0" max="1" step="0.05" value="1" /></label>
        <label>World height <input id="worldHeight" type="number" min="0.1" step="0.1" value="1.6" /></label>
        <label>Selection radius <input id="radius" type="number" min="0.1" step="0.1" value="0.7" /></label>
        <button id="publish" type="button">Save to dev pack & notify game</button>
        <p class="status" id="status"></p>
      </section>
      <section>
        <h2>Preview</h2>
        <div class="previews">
          <div class="preview-card">
            <div>Source size</div>
            <canvas id="srcNeutral" class="neutral"></canvas>
            <canvas id="srcChecker" class="checker"></canvas>
          </div>
          <div class="preview-card">
            <div>Gameplay size</div>
            <canvas id="gameNeutral" class="neutral"></canvas>
            <canvas id="gameChecker" class="checker"></canvas>
          </div>
          <div class="preview-card">
            <div>70-percent camera</div>
            <canvas id="camNeutral" class="neutral"></canvas>
            <canvas id="camChecker" class="checker"></canvas>
          </div>
        </div>
        <h3>Manifest</h3>
        <pre id="manifest">No PNG loaded</pre>
      </section>
    </div>
  `;

  let pngDataUrl: string | null = null;
  let sourceImage: HTMLImageElement | null = null;
  let currentManifest: UnitManifest | null = null;

  const fileInput = root.querySelector('#file');
  const publish = root.querySelector('#publish');
  for (const id of ['id', 'name', 'faction', 'anchorX', 'anchorY', 'worldHeight', 'radius']) {
    root.querySelector(`#${id}`)?.addEventListener('input', refreshManifest);
  }
  fileInput?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      return;
    }
    try {
      sourceImage = await loadImageFile(input.files[0]);
      pngDataUrl = await fileToPngDataUrl(input.files[0]);
      setStatus('PNG loaded. Bounds detected from non-transparent pixels.', 'ok');
      refreshManifest();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  });
  publish?.addEventListener('click', () => {
    void publishUnit();
  });

  function refreshManifest(): void {
    if (!sourceImage) {
      return;
    }
    try {
      const data = imageToImageData(sourceImage);
      const bounds = detectOpaqueBounds(data.width, data.height, data.data);
      const manifest = createUnitManifest({
        id: str('id'),
        displayName: str('name'),
        enabled: true,
        faction: str('faction') as UnitFaction,
        assetPath: `units/${str('id')}/sprite.png`,
        sourceWidth: sourceImage.naturalWidth,
        sourceHeight: sourceImage.naturalHeight,
        bounds,
        anchor: { x: num('anchorX'), y: num('anchorY') },
        worldHeight: num('worldHeight'),
        selectionRadius: num('radius'),
        tags: ['foundry', 'proxy'],
      });
      currentManifest = manifest;
      const pre = root.querySelector('#manifest');
      if (pre) {
        pre.textContent = JSON.stringify(manifest, null, 2);
      }
      for (const [id, mode, bg] of [
        ['srcNeutral', 'source', 'neutral'],
        ['srcChecker', 'source', 'checker'],
        ['gameNeutral', 'gameplay', 'neutral'],
        ['gameChecker', 'gameplay', 'checker'],
        ['camNeutral', 'seventy', 'neutral'],
        ['camChecker', 'seventy', 'checker'],
      ] as const) {
        const canvas = root.querySelector(`#${id}`);
        if (canvas instanceof HTMLCanvasElement && sourceImage) {
          drawPreview(canvas, sourceImage, bounds, manifest.anchor, mode, bg);
        }
      }
      setStatus('Manifest valid.', 'ok');
    } catch (error) {
      currentManifest = null;
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function publishUnit(): Promise<void> {
    if (!currentManifest || !pngDataUrl) {
      setStatus('Load a valid PNG first.', 'error');
      return;
    }
    try {
      await publishUnitV1(currentManifest, pngDataUrl);
      setStatus(`Saved ${currentManifest.id} to content/dev-pack and notified listeners.`, 'ok');
    } catch (error) {
      setStatus(
        `${error instanceof Error ? error.message : String(error)} — is the content server running on port 8787?`,
        'error',
      );
    }
  }

  function str(id: string): string {
    const el = root.querySelector(`#${id}`);
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';
  }

  function num(id: string): number {
    return Number(str(id));
  }

  function setStatus(text: string, kind: 'ok' | 'error'): void {
    const status = root.querySelector('#status');
    if (status instanceof HTMLElement) {
      status.textContent = text;
      status.className = `status ${kind}`;
    }
  }
}
