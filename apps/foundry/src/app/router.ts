import { mountContentLibrary } from '../library/contentLibrary';
import { mountBuildingEditor } from '../building/buildingEditor';
import { mountUnitEditor } from '../unit/unitEditor';
import { mountV1ProxyEditor } from '../v1/proxyEditor';

export function createRouter(app: HTMLElement): void {
  const nav = document.createElement('nav');
  nav.className = 'foundry-nav';
  nav.innerHTML = `
    <a href="#" data-route="">V1 proxy</a>
    <a href="#/library" data-route="library">Library</a>
    <a href="#/unit/new" data-route="unit">Unit editor</a>
    <a href="#/building/new" data-route="building">Building editor</a>
  `;
  const main = document.createElement('main');
  main.id = 'foundry-main';
  app.innerHTML = '';
  app.appendChild(nav);
  app.appendChild(main);

  nav.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLAnchorElement && target.dataset['route'] !== undefined) {
      event.preventDefault();
      if (target.dataset['route'] === '') {
        location.hash = '';
      } else if (target.dataset['route'] === 'library') {
        location.hash = '#/library';
      } else if (target.dataset['route'] === 'unit') {
        location.hash = '#/unit/new';
      } else if (target.dataset['route'] === 'building') {
        location.hash = '#/building/new';
      }
    }
  });

  window.addEventListener('hashchange', render);
  render();
}

function render(): void {
  const main = document.querySelector('#foundry-main');
  if (!(main instanceof HTMLElement)) {
    return;
  }
  const hash = location.hash.replace(/^#\/?/, '');
  const navigate = (path: string) => {
    location.hash = path.startsWith('#') ? path : `#${path}`;
  };

  if (hash === '' || hash === 'v1') {
    mountV1ProxyEditor(main);
    return;
  }
  if (hash === 'library') {
    mountContentLibrary(main, navigate);
    return;
  }
  const unitMatch = /^unit\/(.+)$/.exec(hash);
  if (unitMatch) {
    const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
    mountUnitEditor(main, unitMatch[1] ?? null, query);
    return;
  }
  const buildingMatch = /^building\/(.+)$/.exec(hash);
  if (buildingMatch) {
    const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
    mountBuildingEditor(main, buildingMatch[1] ?? null, query);
    return;
  }
  mountV1ProxyEditor(main);
}
