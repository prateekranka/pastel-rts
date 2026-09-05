import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateBuildingArchetype,
  validateUnitArchetype,
  validateUnitManifest,
} from '@pastel-rts/content-schema';
import {
  ContentNotFoundError,
  DependencyConflictError,
  PackStore,
  RevisionConflictError,
  type HotReloadEvent,
} from './packStore';

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
  if (hasEncodedTraversal(rawUrl)) {
    json(res, 400, { error: 'invalid path', code: 'invalid-path' });
    return;
  }
  const url = new URL(rawUrl, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, publication: store.getPublicationStatus() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      attachSse(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/pack') {
      if (url.searchParams.get('schema') === '2') {
        json(res, 200, store.readPublishedPackV2());
        return;
      }
      json(res, 200, store.readPublishedPackV1());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/publication') {
      json(res, 200, store.getPublicationStatus());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/revisions') {
      const publication = store.getPublicationStatus();
      json(res, 200, {
        schemaVersion: 1,
        currentRevision: publication.currentRevision,
        draftRevision: publication.draftRevision,
        current: publication.current,
        revisions: store.listRevisionMetadata(),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v2/revisions/')) {
      const revision = decodePathSegment(url.pathname.replace(/^\/v2\/revisions\//, ''));
      json(res, 200, store.getRevisionMetadata(revision));
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
      const publication = store.getPublicationStatus();
      json(res, 200, {
        units: store.listUnitArchetypesFromDisk(),
        revision: store.readPackV2().revision,
        draftRevision: publication.draftRevision,
        publishedRevision: publication.currentRevision,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v2/units/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, ''));
      json(res, 200, store.getUnitArchetype(id));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/buildings') {
      const publication = store.getPublicationStatus();
      json(res, 200, {
        buildings: store.listBuildingArchetypesFromDisk(),
        revision: store.readPackV2().revision,
        draftRevision: publication.draftRevision,
        publishedRevision: publication.currentRevision,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v2/buildings/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, ''));
      json(res, 200, store.getBuildingArchetype(id));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v2/references') {
      json(res, 200, { references: store.listReferenceAttachments() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/units') {
      await handlePostUnitV1(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/publish') {
      await handlePublish(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/revert') {
      await handleRevert(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/references') {
      await handlePostReference(req, res);
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v2/references/')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/references\//, ''));
      const result = store.deleteReferenceAttachment(id);
      json(res, 200, { ok: true, ...result });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v2/units') {
      await handlePostUnitV2(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/v2/units/') && url.pathname.endsWith('/duplicate')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/units\//, '').replace(/\/duplicate$/, ''));
      await handleDuplicateUnitV2(req, res, id);
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
    if (req.method === 'POST' && url.pathname.startsWith('/v2/buildings/') && url.pathname.endsWith('/duplicate')) {
      const id = decodePathSegment(url.pathname.replace(/^\/v2\/buildings\//, '').replace(/\/duplicate$/, ''));
      await handleDuplicateBuildingV2(req, res, id);
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
    json(res, 404, { error: 'not found', code: 'not-found' });
  } catch (error) {
    sendError(res, error);
  }
}

async function handlePostUnitV1(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonObject(req);
  const manifest = validateUnitManifest(body['manifest']);
  const pngBase64 = requireString(body['pngBase64'], 'pngBase64');
  const expectedRevision = optionalExpectedRevision(body);
  const saved = store.saveUnitV1(manifest, pngBase64, expectedRevision);
  const compatibilityPublication = store.publishLegacyV1Compatibility();
  broadcast({ type: 'unit-published', id: saved.id, manifest: saved });
  json(res, 200, {
    ok: true,
    manifest: saved,
    publication: store.getPublicationStatus(),
    ...(compatibilityPublication ? { published: compatibilityPublication.metadata } : {}),
  });
}

async function handlePostUnitV2(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateUnitArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.createUnitArchetype(archetype, pngBase64, optionalExpectedRevision(record));
  broadcast({ type: 'unit-archetype-published', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePutUnitV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateUnitArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.updateUnitArchetype(id, archetype, pngBase64, optionalExpectedRevision(record));
  broadcast({ type: 'unit-archetype-updated', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePatchUnitV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  if (typeof record['enabled'] !== 'boolean') {
    throw new Error('enabled boolean is required');
  }
  const saved = store.setUnitArchetypeEnabled(id, record['enabled'], optionalExpectedRevision(record));
  broadcast({ type: 'unit-archetype-enabled', id: saved.id, enabled: saved.enabled });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handleDeleteUnitV2(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  url: URL,
): Promise<void> {
  const record = await readJsonObject(req);
  const force = url.searchParams.get('force') === 'true';
  const result = store.deleteUnitArchetype(id, force, optionalExpectedRevision(record));
  broadcast({ type: 'unit-archetype-deleted', id });
  jsonDraftMutation(res, { ok: true, ...result });
}

async function handleDuplicateUnitV2(req: IncomingMessage, res: ServerResponse, sourceId: string): Promise<void> {
  const record = await readJsonObject(req);
  const newId = requireString(record['newId'] ?? record['id'], 'newId');
  const displayName = typeof record['displayName'] === 'string' ? record['displayName'] : undefined;
  const saved = store.duplicateUnitArchetype(sourceId, newId, displayName, optionalExpectedRevision(record));
  broadcast({ type: 'unit-archetype-published', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePostBuildingV2(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateBuildingArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.createBuildingArchetype(archetype, pngBase64, optionalExpectedRevision(record));
  broadcast({ type: 'building-archetype-published', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePutBuildingV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  const archetype = validateBuildingArchetype(record['archetype']);
  const pngBase64 = typeof record['pngBase64'] === 'string' ? record['pngBase64'] : undefined;
  const saved = store.updateBuildingArchetype(id, archetype, pngBase64, optionalExpectedRevision(record));
  broadcast({ type: 'building-archetype-updated', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePatchBuildingV2(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const record = await readJsonObject(req);
  if (typeof record['enabled'] !== 'boolean') {
    throw new Error('enabled boolean is required');
  }
  const saved = store.setBuildingArchetypeEnabled(id, record['enabled'], optionalExpectedRevision(record));
  broadcast({ type: 'building-archetype-enabled', id: saved.id, enabled: saved.enabled });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handleDeleteBuildingV2(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  url: URL,
): Promise<void> {
  const record = await readJsonObject(req);
  const force = url.searchParams.get('force') === 'true';
  const result = store.deleteBuildingArchetype(id, force, optionalExpectedRevision(record));
  broadcast({ type: 'building-archetype-deleted', id });
  jsonDraftMutation(res, { ok: true, ...result });
}

async function handleDuplicateBuildingV2(req: IncomingMessage, res: ServerResponse, sourceId: string): Promise<void> {
  const record = await readJsonObject(req);
  const newId = requireString(record['newId'] ?? record['id'], 'newId');
  const displayName = typeof record['displayName'] === 'string' ? record['displayName'] : undefined;
  const saved = store.duplicateBuildingArchetype(sourceId, newId, displayName, optionalExpectedRevision(record));
  broadcast({ type: 'building-archetype-published', id: saved.id, archetype: saved });
  jsonDraftMutation(res, { ok: true, archetype: saved });
}

async function handlePublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const expectedRevision = requiredExpectedRevision(record, 'expectedRevision');
  const result = store.publish(expectedRevision);
  broadcast({
    type: 'publication-published',
    revision: result.metadata.revision,
    previousRevision: result.previousRevision,
    restartRequired: result.metadata.restartRequired,
  });
  json(res, 200, {
    ok: true,
    revision: result.metadata.revision,
    metadata: result.metadata,
    pack: result.pack,
    publication: store.getPublicationStatus(),
  });
}

async function handleRevert(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const targetRevision = requiredExpectedRevision(record, 'targetRevision');
  const expectedCurrentRevision = requiredExpectedRevision(record, 'expectedCurrentRevision');
  const result = store.revert(targetRevision, expectedCurrentRevision);
  broadcast({
    type: 'publication-reverted',
    revision: result.metadata.revision,
    sourceRevision: targetRevision,
    restartRequired: result.metadata.restartRequired,
  });
  json(res, 200, {
    ok: true,
    revision: result.metadata.revision,
    metadata: result.metadata,
    pack: result.pack,
    publication: store.getPublicationStatus(),
  });
}

async function handlePostReference(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = await readJsonObject(req);
  const id = requireString(record['id'], 'id');
  const displayName = requireString(record['displayName'] ?? record['name'], 'displayName');
  const pngBase64 = requireString(record['pngBase64'], 'pngBase64');
  const reference = store.createReferenceAttachment({ id, displayName }, pngBase64);
  json(res, 200, { ok: true, reference });
}

function jsonDraftMutation(res: ServerResponse, body: Record<string, unknown>): void {
  json(res, 200, {
    ...body,
    draft: store.readPackV2(),
    publication: store.getPublicationStatus(),
  });
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
    const file = store.resolveUnitFilePath(relative);
    sendFile(res, file);
  } catch (error) {
    sendError(res, error);
  }
}

function serveAsset(pathname: string, res: ServerResponse): void {
  const relative = pathname.replace(/^\/assets\//, '');
  try {
    const file = store.resolveAssetPath(relative);
    sendFile(res, file);
  } catch (error) {
    sendError(res, error);
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

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof RevisionConflictError) {
    json(res, 409, {
      error: error.message,
      code: error.code,
      scope: error.scope,
      expectedRevision: error.expectedRevision,
      currentRevision: error.actualRevision,
      currentPublicationRevision: error.current.revision,
      current: error.current,
    });
    return;
  }
  if (error instanceof DependencyConflictError) {
    json(res, 409, {
      error: error.message,
      code: error.code,
      dependencies: error.dependencies,
    });
    return;
  }
  if (error instanceof ContentNotFoundError) {
    json(res, 404, { error: error.message, code: error.code });
    return;
  }
  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 400;
  const message = error instanceof Error ? error.message : String(error);
  json(res, status, { error: message });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        reject(new Error('request body exceeds the 16777216 byte limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('valid JSON is required');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON object required');
  }
  return parsed as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requiredExpectedRevision(record: Record<string, unknown>, field: string): string {
  return requireString(record[field], field);
}

function optionalExpectedRevision(record: Record<string, unknown>): string | undefined {
  const value = record['expectedRevision'] ?? record['expectedDraftRevision'];
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, 'expectedRevision');
}

function decodePathSegment(segment: string): string {
  let decoded = segment;
  let stable = false;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (!stable || decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) {
    throw new Error('invalid id');
  }
  return decoded;
}

function hasEncodedTraversal(rawUrl: string): boolean {
  const rawPath = rawUrl.split('?')[0] ?? '';
  let decoded = rawPath;
  let stable = false;
  for (let pass = 0; pass < 8; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (!stable) {
    return true;
  }
  return decoded.split('/').some((segment) => segment === '..') || decoded.includes('\\') || decoded.includes('\u0000');
}

store.writePackV1Index();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Content server listening on http://127.0.0.1:${PORT}`);
  console.log(`Writing packs to ${packDir}`);
});

export { store, server, PORT, packDir };
