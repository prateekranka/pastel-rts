import { mountBuildingEditor } from '../building/buildingEditor';
import { mountContentLibrary } from '../library/contentLibrary';
import { mountUnitEditor } from '../unit/unitEditor';
import { mountV1ProxyEditor } from '../v1/proxyEditor';
import { FoundrySession } from './foundrySession';
import { mountStatusStrip } from './statusStrip';

export function createRouter(app: HTMLElement): void {
  const session = new FoundrySession();
  const nav = document.createElement('nav');
  nav.className = 'foundry-nav';
  nav.innerHTML = `
    <a href="#" data-route="">V1 proxy</a>
    <a href="#/library" data-route="library">Library</a>
    <a href="#/unit/new" data-route="unit">Unit editor</a>
    <a href="#/building/new" data-route="building">Building editor</a>
  `;
  const status = document.createElement('header');
  status.className = 'foundry-status-strip';
  const main = document.createElement('main');
  main.id = 'foundry-main';
  app.innerHTML = '';
  app.appendChild(nav);
  app.appendChild(status);
  app.appendChild(main);

  mountStatusStrip(status, session);
  session.start();

  let lastRenderedHash = location.hash;
  nav.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement) || target.dataset['route'] === undefined) {
      return;
    }
    event.preventDefault();
    const route = target.dataset['route'];
    navigate(route === '' ? '#' : `#/${route}`);
  });

  window.addEventListener('hashchange', () => {
    if (location.hash !== lastRenderedHash && session.isDirty()) {
      if (!window.confirm('You have unsaved local edits. Leave this editor and discard them?')) {
        location.hash = lastRenderedHash || '#';
        return;
      }
      session.setDirty(false);
    }
    render();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!session.isDirty()) {
      return;
    }
    event.preventDefault();
    event.returnValue = 'Unsaved Foundry edits will be lost.';
  });

  render();

  function navigate(next: string): void {
    if (session.isDirty() && next !== lastRenderedHash) {
      if (!window.confirm('You have unsaved local edits. Leave this editor and discard them?')) {
        return;
      }
      session.setDirty(false);
    }
    location.hash = next;
  }

  function render(): void {
    lastRenderedHash = location.hash;
    const hash = location.hash.replace(/^#\/?/, '');
    const queryIndex = hash.indexOf('?');
    const path = queryIndex >= 0 ? hash.slice(0, queryIndex) : hash;
    const query = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
    const childNavigate = (next: string): void => navigate(next.startsWith('#') ? next : `#${next}`);

    if (path === '' || path === 'v1') {
      mountV1ProxyEditor(main);
      return;
    }
    if (path === 'library') {
      mountContentLibrary(main, childNavigate, session);
      return;
    }
    const unitMatch = /^unit\/(.+)$/.exec(path);
    if (unitMatch) {
      mountUnitEditor(main, unitMatch[1] ?? null, query, session);
      return;
    }
    const buildingMatch = /^building\/(.+)$/.exec(path);
    if (buildingMatch) {
      mountBuildingEditor(main, buildingMatch[1] ?? null, query, session);
      return;
    }
    mountV1ProxyEditor(main);
  }
}
