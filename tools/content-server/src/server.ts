import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUnitManifest, type UnitManifest } from '../../../packages/content-schema/src/unitManifest.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const packDir = join(root, 'content/dev-pack');
const unitsDir = join(packDir, 'units');
const PORT = Number(process.env['CONTENT_PORT'] ?? 8787);

mkdirSync(unitsDir, { recursive: true });

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
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
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
      json(res, 200, readPack());
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/units/')) {
      serveUnitFile(url.pathname, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/units') {
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
      const saved = saveUnit(manifest, record['pngBase64']);
      broadcast({ type: 'unit-published', id: saved.id, manifest: saved });
      json(res, 200, { ok: true, manifest: saved });
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 400, { error: message });
  }
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

function broadcast(message: { type: string; id: string; manifest: UnitManifest }): void {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function saveUnit(manifest: UnitManifest, pngBase64: string): UnitManifest {
  const dir = join(unitsDir, manifest.id);
  mkdirSync(dir, { recursive: true });
  const pngPath = join(dir, 'sprite.png');
  const assetPath = `units/${manifest.id}/sprite.png`;
  const buffer = Buffer.from(pngBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
  if (buffer.length < 32 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Uploaded file is not a PNG');
  }
  writeFileSync(pngPath, buffer);
  const saved: UnitManifest = { ...manifest, assetPath };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(saved, null, 2)}\n`);
  writePackIndex();
  return saved;
}

function readPack(): { schemaVersion: number; id: string; units: UnitManifest[] } {
  const units: UnitManifest[] = [];
  if (!existsSync(unitsDir)) {
    return { schemaVersion: 1, id: 'dev-pack', units };
  }
  for (const name of readdirSync(unitsDir)) {
    const file = join(unitsDir, name, 'manifest.json');
    if (!existsSync(file)) {
      continue;
    }
    units.push(validateUnitManifest(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return { schemaVersion: 1, id: 'dev-pack', units };
}

function writePackIndex(): void {
  writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(readPack(), null, 2)}\n`);
}

function serveUnitFile(pathname: string, res: ServerResponse): void {
  const relative = pathname.replace(/^\/units\//, '');
  if (relative.includes('..')) {
    json(res, 400, { error: 'invalid path' });
    return;
  }
  const file = join(unitsDir, relative);
  if (!existsSync(file)) {
    json(res, 404, { error: 'not found' });
    return;
  }
  const data = readFileSync(file);
  const type = file.endsWith('.png') ? 'image/png' : 'application/json';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

writePackIndex();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Content server listening on http://127.0.0.1:${PORT}`);
  console.log(`Writing packs to ${packDir}`);
});
