#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOOPBACK = '127.0.0.1';
const METHODS = new Set(['OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const config = readConfig(process.env);
const passwordDigest = createHash('sha256').update(config.password, 'utf8').digest();
const server = createServer((req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) {
      sendText(res, 500, 'Internal server error\n');
    } else {
      res.destroy();
    }
  });
});

server.on('error', (error) => {
  console.error(`hosted studio gateway failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
server.listen(config.port, LOOPBACK, () => {
  console.log(`Hosted studio gateway listening on ${LOOPBACK}:${String(config.port)}`);
});

async function handle(req, res) {
  setSecurityHeaders(res);
  if (!authenticate(req, res)) return;
  if (!METHODS.has(req.method ?? '')) {
    res.setHeader('allow', [...METHODS].join(', '));
    sendText(res, 405, 'Method not allowed\n');
    return;
  }

  const rawUrl = req.url ?? '/';
  const decodedPath = decodePathSafely(rawUrl.split('?', 1)[0] ?? '/');
  if (decodedPath === null) {
    sendText(res, 400, 'Invalid path\n');
    return;
  }
  const url = new URL(rawUrl, 'http://127.0.0.1');

  if (decodedPath === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      ready: true,
      gameEntry: isFile(join(config.gameDist, 'index.html')),
      foundryEntry: isFile(join(config.foundryDist, 'index.html')),
    });
    return;
  }
  if (decodedPath === '/dev-content' || decodedPath.startsWith('/dev-content/')) {
    proxyContent(req, res, decodedPath.slice('/dev-content'.length) || '/', url.search);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed\n');
    return;
  }
  if (decodedPath === '/') {
    serveLauncher(res);
    return;
  }
  if (decodedPath === '/favicon.ico') {
    redirect(res, '/game/favicon.svg');
    return;
  }
  if (decodedPath === '/game') {
    redirect(res, '/game/');
    return;
  }
  if (decodedPath === '/foundry') {
    redirect(res, '/foundry/');
    return;
  }
  if (decodedPath.startsWith('/game/')) {
    serveStatic(res, config.gameDist, decodedPath.slice('/game/'.length), decodedPath === '/game/');
    return;
  }
  if (decodedPath.startsWith('/foundry/')) {
    serveStatic(res, config.foundryDist, decodedPath.slice('/foundry/'.length), decodedPath === '/foundry/');
    return;
  }
  sendText(res, 404, 'Not found\n');
}

function readConfig(env) {
  const username = env.STUDIO_USERNAME;
  const password = env.STUDIO_PASSWORD;
  if (!username || !password) {
    throw new Error('STUDIO_USERNAME and STUDIO_PASSWORD are required');
  }
  return {
    port: readPort(env.GATEWAY_PORT, 8788),
    contentOrigin: readLoopbackOrigin(env.CONTENT_SERVER_ORIGIN, 'http://127.0.0.1:8787'),
    gameDist: resolve(env.GAME_DIST_PATH ?? join(REPO_ROOT, 'apps/game-web/dist')),
    foundryDist: resolve(env.FOUNDRY_DIST_PATH ?? join(REPO_ROOT, 'apps/foundry/dist')),
    externalStudioUrl: env.STUDIO_EXTERNAL_URL ?? '',
    username,
    password,
  };
}

function readPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('GATEWAY_PORT must be 1-65535');
  return port;
}

function readLoopbackOrigin(value, fallback) {
  let parsed;
  try { parsed = new URL(value ?? fallback); } catch { throw new Error('CONTENT_SERVER_ORIGIN must be an http URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('CONTENT_SERVER_ORIGIN must point to loopback');
  }
  return parsed;
}

function authenticate(req, res) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return unauthorized(res);
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return unauthorized(res); }
  const separator = decoded.indexOf(':');
  if (separator < 0 || decoded.slice(0, separator) !== config.username) return unauthorized(res);
  const candidate = createHash('sha256').update(decoded.slice(separator + 1), 'utf8').digest();
  if (candidate.length !== passwordDigest.length || !timingSafeEqual(candidate, passwordDigest)) return unauthorized(res);
  return true;
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader('www-authenticate', 'Basic realm="Pastel RTS Hosted Studio"');
  res.end('Authentication required\n');
  return false;
}

function decodePathSafely(pathname) {
  let value = pathname;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { return null; }
    if (decoded === value) break;
    value = decoded;
  }
  if (/%[0-9a-f]{2}/i.test(value) || value.includes('\0') || value.includes('\\')) return null;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) return null;
  return value.startsWith('/') ? value : `/${value}`;
}

function serveLauncher(res) {
  const external = config.externalStudioUrl && safeExternalUrl(config.externalStudioUrl)
    ? `<a href="${escapeHtml(config.externalStudioUrl)}">External studio</a>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="/game/favicon.svg" type="image/svg+xml"><title>Pastel RTS Studio</title><style> :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#101820;color:#f4f0e8}body{margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(92vw,30rem);padding:2rem 1rem}h1{font-size:1.6rem;margin:0 0 .4rem}p{color:#b7c5c9;margin:0 0 1.4rem}nav{display:grid;gap:.75rem}a{display:flex;align-items:center;min-height:3.25rem;padding:0 1rem;border:1px solid #3f6971;border-radius:.7rem;background:#18313a;color:#fff;text-decoration:none;font-weight:650}a:focus-visible{outline:3px solid #f5c96b;outline-offset:3px}</style></head><body><main><h1>Pastel RTS Studio</h1><p>Touch-first tools and runtime.</p><nav><a href="/game/?mode=interaction-lab">Game</a><a href="/foundry/#/library">Library</a><a href="/foundry/#/unit/new">Unit editor</a><a href="/foundry/#/building/new">Building editor</a><a href="/dev-content/health">Service status</a>${external}</nav></main></body></html>`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  sendBody(res, 200, html);
}

function serveStatic(res, root, relativePath, isAppRoot) {
  const target = resolve(root, relativePath || 'index.html');
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel.includes('\0') || !isFile(target)) {
    sendText(res, 404, 'Not found\n');
    return;
  }
  if (isDirectory(target)) {
    sendText(res, 404, 'Not found\n');
    return;
  }
  if (!isAppRoot && relativePath === '') {
    sendText(res, 404, 'Not found\n');
    return;
  }
  res.setHeader('content-type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('cache-control', relativePath === 'index.html' ? 'no-store' : 'private, max-age=3600');
  streamFile(res, target);
}

function proxyContent(req, res, path, search) {
  const target = new URL(path + search, config.contentOrigin);
  const requestHeaders = { ...req.headers, host: target.host };
  delete requestHeaders.authorization;
  delete requestHeaders.connection;
  const requestFunction = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = requestFunction(target, { method: req.method, headers: requestHeaders }, (response) => {
    res.statusCode = response.statusCode ?? 502;
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) res.setHeader(name, value);
    }
    res.setHeader('cache-control', 'no-store');
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) sendText(res, 502, 'Content service unavailable\n');
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function setSecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

function sendJson(res, status, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  sendBody(res, status, JSON.stringify(body));
}
function sendText(res, status, body) { res.setHeader('content-type', 'text/plain; charset=utf-8'); sendBody(res, status, body); }
function sendBody(res, status, body) { res.statusCode = status; if (res.req?.method === 'HEAD') res.end(); else res.end(body); }
function streamFile(res, path) { if (res.req?.method === 'HEAD') res.end(); else createReadStream(path).pipe(res); }
function redirect(res, location) { res.statusCode = 301; res.setHeader('location', location); res.setHeader('cache-control', 'no-store'); res.end(); }
function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }
function isDirectory(path) { try { return statSync(path).isDirectory(); } catch { return false; } }
function safeExternalUrl(value) { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }
function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
