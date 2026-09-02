import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateBuildingArchetype,
  validateUnitArchetype,
  validateUnitManifest,
} from '@pastel-rts/content-schema';
import { PackStore, type HotReloadEvent, sanitizeRelativePath } from './packStore';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const packDir = process.env['CONTENT_PACK_DIR']
  ? process.env['CONTENT_PACK_DIR']
  : join(root, 'content/dev-pack');
const PORT = Number(process.env['CONTENT_PORT'] ?? 8787);

const store = new PackStore({ packDir });
const sseClients = new Set<ServerResponse>();

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const rawUrl = req.url ?? '/';
  if (rawUrl.includes('..')) {
    json(res, 400, { error: 'invalid path' });
    return;
  }
  const url = new URL(rawUrl, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      attachSse(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/pack') {
      if (url.searchParams.get('schema') === '2') {
        json(res, 200, store.readPackV2());
        return;
      }
      json(res, 200, store.readPackV1());
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/units/')) {
      serveUnitFile(url.pathname, res);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      serveAsset(url.pathname, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/units') {
      json(res, 200, { units: store.listUnitArchetypesFromDisk() });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v2/units/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, ''));
      json(res, 200, store.getUnitArchetype(id));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/buildings') {
      json(res, 200, { buildings: store.listBuildingArchetypesFromDisk() });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v2/buildings/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, ''));
      json(res, 200, store.getBuildingArchetype(id));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/units') {
      await handlePostUnitV1(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/units') {
      await handlePostUnitV2(req, res);
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/v2/units/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, ''));
      await handlePutUnitV2(req, res, id);
      return;
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/v2/units/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, ''));
      await handlePatchUnitV2(req, res, id);
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v2/units/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, ''));
      await handleDeleteUnitV2(req, res, id, url);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/buildings') {
      await handlePostBuildingV2(req, res);
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/v2/buildings/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, ''));
      await handlePutBuildingV2(req, res, id);
      return;
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/v2/buildings/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, ''));
      await handlePatchBuildingV2(req, res, id);
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v2/buildings/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, ''));
      await handleDeleteBuildingV2(req, res, id, url);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 400, { error: message });
  }
}

async function handlePostUnitV1(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON object required');
  }
  const record = parsed as Record<string, unknown>;
  const manifest = validateUnitManifest(record['manifest']);
  if (typeof record['pngBase64'] !== 'string' || record['pngBase64'].length < 32) {
    throw new Error('pngBase64 is required');
  }
  const saved = store.saveUnitV1(manifest, record['pngBase64']);
  broadcast({ type: 'unit-published', id: saved.id, manifest: saved });
  json(res, 200, { ok: true, manifest: saved });
}

async function handlePostUnitV2(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateUnitArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.createUnitArchetype(archetype, pngBase64);
  broadcast({ type: 'unit-archetype-published', id: saved.id, archetype: saved });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handlePutUnitV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateUnitArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.updateUnitArchetype(id, archetype, pngBase64);
  broadcast({ type: 'unit-archetype-updated', id: saved.id, archetype: saved });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handlePatchUnitV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  if (typeof record['enabled'] !== 'boolean') {
    throw new Error('enabled boolean is required');
  }
  const saved = store.setUnitArchetypeEnabled(id, record['enabled']);
  broadcast({ type: 'unit-archetype-enabled', id: saved.id, enabled: saved.enabled });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handleDeleteUnitV2(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  url: URL,
): Promise<void> {
  const force = url.searchParams.get('force') === 'true';
  const result = store.deleteUnitArchetype(id, force);
  broadcast({ type: 'unit-archetype-deleted', id });
  json(res, 200, { ok: true, ...result, pack: store.readPackV2() });
}

async function handlePostBuildingV2(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateBuildingArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.createBuildingArchetype(archetype, pngBase64);
  broadcast({ type: 'building-archetype-published', id: saved.id, archetype: saved });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handlePutBuildingV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateBuildingArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.updateBuildingArchetype(id, archetype, pngBase64);
  broadcast({ type: 'building-archetype-updated', id: saved.id, archetype: saved });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handlePatchBuildingV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  if (typeof record['enabled'] !== 'boolean') {
    throw new Error('enabled boolean is required');
  }
  const saved = store.setBuildingArchetypeEnabled(id, record['enabled']);
  broadcast({ type: 'building-archetype-enabled', id: saved.id, enabled: saved.enabled });
  json(res, 200, { ok: true, archetype: saved, pack: store.readPackV2() });
}

async function handleDeleteBuildingV2(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  url: URL,
): Promise<void> {
  const force = url.searchParams.get('force') === 'true';
  const result = store.deleteBuildingArchetype(id, force);
  broadcast({ type: 'building-archetype-deleted', id });
  json(res, 200, { ok: true, ...result, pack: store.readPackV2() });
}

function attachSse(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(message: HotReloadEvent): void {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function serveUnitFile(pathname: string, res: ServerResponse): void {
  const relative = pathname.replace(/^\/units\//, '');
  try {
    sanitizeRelativePath(relative);
  } catch {
    json(res, 400, { error: 'invalid path' });
    return;
  }
  const file = store.resolveUnitFilePath(relative);
  if (!existsSync(file)) {
    json(res, 404, { error: 'not found' });
    return;
  }
  sendFile(res, file);
}

function serveAsset(pathname: string, res: ServerResponse): void {
  const relative = pathname.replace(/^\/assets\//, '');
  try {
    const file = store.resolveAssetPath(relative);
    sendFile(res, file);
  } catch {
    json(res, 400, { error: 'invalid path' });
  }
}

function sendFile(res: ServerResponse, file: string): void {
  const data = readFileSync(file);
  const type = file.endsWith('.png') ? 'image/png' : 'application/json';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON object required');
  }
  return parsed as Record<string, unknown>;
}

function decodePathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  if (decoded.includes('/') || decoded.includes('..')) {
    throw new Error('invalid id');
  }
  return decoded;
}

store.writePackV1Index();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Content server listening on http://127.0.0.1:${PORT}`);
  console.log(`Writing packs to ${packDir}`);
});

export { store, server, PORT, packDir };
