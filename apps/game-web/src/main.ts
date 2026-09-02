import { GameApp } from './app/GameApp';
import './styles.css';

const canvas = document.querySelector('#game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing #game-canvas');
}

const app = new GameApp();
void app.start(canvas).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const banner = document.createElement('div');
  banner.textContent = `Runtime failed to start: ${message}`;
  banner.style.cssText =
    'position:fixed;inset:24px;color:#f2e6d0;background:#3d2a63;padding:16px;font:16px/1.4 sans-serif;z-index:20';
  document.body.append(banner);
});

window.addEventListener('pagehide', () => {
  app.dispose();
});
