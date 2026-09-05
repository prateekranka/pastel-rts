#!/usr/bin/env -S npx tsx

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  computeContentHash,
  countSpriteSheetFrames,
  resolveFrameIndexes,
  validateMapDef,
  validatePackV2,
  validateScenarioDef,
  type BuildingArchetype,
  type PackV2,
  type UnitArchetype,
} from '@pastel-rts/content-schema';

const DEFAULT_PACK_DIR = 'content/dev-pack-v2';
const MAX_FILES = 256;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_PACK_JSON_BYTES = 512 * 1024;
const MAX_DOCUMENT_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2048;
const MAX_IMAGE_PIXELS = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = makeCrcTable();

type DecodedPng = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

type PackFileStats = {
  files: number;
  bytes: number;
};

type ParsedArgs = {
  packDir: string;
  help: boolean;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const packDir = resolve(args.packDir);
  const issues: string[] = [];
  let stats: PackFileStats = { files: 0, bytes: 0 };
  try {
    await assertPackRoot(packDir);
    stats = await scanPackTree(packDir);
  } catch (error) {
    issues.push(issueText(error));
  }

  let rawPack: unknown;
  let pack: PackV2 | undefined;
  if (issues.length === 0) {
    try {
      rawPack = await readJsonFile(packDir, 'pack.json', MAX_PACK_JSON_BYTES);
      if (!isRecord(rawPack)) {
        throw new Error('pack.json must contain a contentHash');
      }
      pack = validatePackV2(rawPack);
      if (typeof rawPack['contentHash'] !== 'string') {
        throw new Error('pack.json must contain a contentHash');
      }
      if (!/^[a-f0-9]{64}$/.test(rawPack['contentHash'])) {
        throw new Error('pack.json contentHash must be a lowercase SHA-256 hex string');
      }
      const expectedHash = computeContentHash(rawPack);
      if (rawPack['contentHash'] !== expectedHash) {
        throw new Error(`contentHash mismatch (expected ${expectedHash})`);
      }
    } catch (error) {
      issues.push(`pack.json: ${issueText(error)}`);
    }
  }

  if (pack && issues.length === 0) {
    await validatePackContents(packDir, pack, issues);
  }

  if (issues.length > 0) {
    console.error(`INVALID content pack: ${packDir}`);
    for (const message of issues) {
      console.error(`  - ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!pack) {
    console.error(`INVALID content pack: ${packDir}`);
    console.error('  - pack.json did not produce a validated Pack v2 value');
    process.exitCode = 1;
    return;
  }

  const animatedUnits = pack.units.filter((unit) => !isProxy(unit));
  const proxies = pack.units.filter(isProxy);
  console.log(`VALID content pack: ${packDir}`);
  console.log(`  id=${pack.id} revision=${pack.revision} hash=${pack.contentHash}`);
  console.log(`  units=${pack.units.length} animated=${animatedUnits.length} proxies=${proxies.length} buildings=${pack.buildings.length}`);
  console.log(`  maps=${pack.maps?.length ?? 0} scenarios=${pack.scenarios?.length ?? 0} files=${stats.files} bytes=${stats.bytes}`);
  console.log('  PNG assets decoded, referenced frames checked, and scenario dependencies resolved');
}

async function validatePackContents(packDir: string, pack: PackV2, issues: string[]): Promise<void> {
  const unitIds = new Set(pack.units.map((unit) => unit.id));
  const buildingIds = new Set(pack.buildings.map((building) => building.id));
  const mapIds = new Set<string>();
  const assetCache = new Map<string, DecodedPng>();
  const animatedUnitIds = new Set<string>();
  const proxyUnits = pack.units.filter(isProxy);

  if (pack.units.length < 2) {
    issues.push('pack must contain at least two unit archetypes');
  }
  if (pack.buildings.length < 2) {
    issues.push('pack must contain at least two building archetypes');
  }
  if (proxyUnits.length === 0) {
    issues.push('pack must contain an explicitly tagged proxy unit');
  }

  for (const unit of pack.units) {
    const png = await loadReferencedPng(packDir, unit.assetPath, `unit ${unit.id}`, assetCache, issues);
    if (!png) {
      continue;
    }
    validateImageDimensions(unit.assetPath, png, unit.sourceWidth, unit.sourceHeight, `unit ${unit.id}`, issues);
    const totalFrames = countSpriteSheetFrames(
      unit.sourceWidth,
      unit.sourceHeight,
      unit.frameWidth,
      unit.frameHeight,
      unit.margin.x,
      unit.margin.y,
      unit.spacing.x,
      unit.spacing.y,
    );
    const moveIndexes = resolveFrameIndexes(unit.animation.clips.move.frames);
    if (!isProxy(unit)) {
      if (moveIndexes.length < 2) {
        issues.push(`unit ${unit.id}: animated move clip must reference at least two frames`);
      } else {
        const signatures = new Set(
          moveIndexes.map((frameIndex) => frameSignature(png, unit, frameIndex, totalFrames)),
        );
        if (signatures.size < 2) {
          issues.push(`unit ${unit.id}: move clip frames are pixel-identical; animation is not genuine`);
        } else {
          animatedUnitIds.add(unit.id);
        }
      }
    } else {
      if (!hasTag(unit, 'proxy')) {
        issues.push(`unit ${unit.id}: proxy mode must include the exact "proxy" tag`);
      }
      if (unit.animation.fallbackRules?.missingDirection === undefined) {
        issues.push(`unit ${unit.id}: proxy mode must declare animation.fallbackRules.missingDirection`);
      }
    }
    if (unit.id.includes('walker') && !isProxy(unit)) {
      issues.push(`unit ${unit.id}: walker entries must be explicitly marked as proxy until authored facing exists`);
    }
  }

  if (animatedUnitIds.size < 2) {
    issues.push(`pack must contain at least two genuinely animated units; found ${animatedUnitIds.size}`);
  }

  for (const building of pack.buildings) {
    const png = await loadReferencedPng(packDir, building.assetPath, `building ${building.id}`, assetCache, issues);
    if (!png) {
      continue;
    }
    validateImageDimensions(building.assetPath, png, building.sourceWidth, building.sourceHeight, `building ${building.id}`, issues);
    if (building.animation) {
      const totalFrames = countSpriteSheetFrames(
        building.sourceWidth,
        building.sourceHeight,
        buildingFrameWidth(building),
        buildingFrameHeight(building),
        buildingMargin(building).x,
        buildingMargin(building).y,
        buildingSpacing(building).x,
        buildingSpacing(building).y,
      );
      const clips = [building.animation.clips.idle];
      if (building.animation.clips.move) {
        clips.push(building.animation.clips.move);
      }
      for (const clip of clips) {
        for (const frameIndex of resolveFrameIndexes(clip.frames)) {
          if (frameIndex < 0 || frameIndex >= totalFrames) {
            issues.push(`building ${building.id}: animation references missing frame index ${frameIndex}`);
          }
        }
      }
    }
  }

  const mapReferences = pack.maps ?? [];
  for (const reference of mapReferences) {
    if (mapIds.has(reference.id)) {
      issues.push(`duplicate map reference id: ${reference.id}`);
      continue;
    }
    mapIds.add(reference.id);
    try {
      const raw = await readJsonFile(packDir, reference.path, MAX_DOCUMENT_JSON_BYTES);
      const map = validateMapDef(raw);
      if (map.id !== reference.id) {
        issues.push(`map reference ${reference.id}: document id is ${map.id}`);
      }
    } catch (error) {
      issues.push(`map ${reference.id}: ${issueText(error)}`);
    }
  }

  const scenarioIds = new Set<string>();
  for (const reference of pack.scenarios ?? []) {
    if (scenarioIds.has(reference.id)) {
      issues.push(`duplicate scenario reference id: ${reference.id}`);
      continue;
    }
    scenarioIds.add(reference.id);
    try {
      const raw = await readJsonFile(packDir, reference.path, MAX_DOCUMENT_JSON_BYTES);
      const scenario = validateScenarioDef(raw);
      if (scenario.id !== reference.id) {
        issues.push(`scenario reference ${reference.id}: document id is ${scenario.id}`);
      }
      if (reference.mapId !== undefined && reference.mapId !== scenario.mapId) {
        issues.push(`scenario ${reference.id}: reference mapId does not match document mapId`);
      }
      if (!mapIds.has(scenario.mapId)) {
        issues.push(`scenario ${scenario.id}: missing map reference ${scenario.mapId}`);
      }
      for (const spawn of scenario.units) {
        if (!unitIds.has(spawn.archetypeId)) {
          issues.push(`scenario ${scenario.id}: missing unit archetype ${spawn.archetypeId}`);
        }
      }
      for (const spawn of scenario.buildings) {
        if (!buildingIds.has(spawn.archetypeId)) {
          issues.push(`scenario ${scenario.id}: missing building archetype ${spawn.archetypeId}`);
        }
      }
    } catch (error) {
      issues.push(`scenario ${reference.id}: ${issueText(error)}`);
    }
  }

  if (!pack.scenarios?.some((reference) => reference.id === 'm11-fixture-gallery')) {
    issues.push('pack must reference the deterministic m11-fixture-gallery scenario');
  }
}

async function loadReferencedPng(
  packDir: string,
  path: string,
  label: string,
  cache: Map<string, DecodedPng>,
  issues: string[],
): Promise<DecodedPng | undefined> {
  if (extname(path).toLowerCase() !== '.png') {
    issues.push(`${label}: asset path must end in .png (${path})`);
    return undefined;
  }
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  try {
    const buffer = await readBinaryFile(packDir, path, MAX_ASSET_BYTES);
    const png = decodePng(buffer);
    cache.set(path, png);
    return png;
  } catch (error) {
    issues.push(`${label} asset ${path}: ${issueText(error)}`);
    return undefined;
  }
}

function validateImageDimensions(
  path: string,
  png: DecodedPng,
  expectedWidth: number,
  expectedHeight: number,
  label: string,
  issues: string[],
): void {
  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    issues.push(`${label}: ${path} decodes to ${png.width}x${png.height}, metadata requires ${expectedWidth}x${expectedHeight}`);
  }
}

function frameSignature(png: DecodedPng, unit: UnitArchetype, frameIndex: number, totalFrames: number): string {
  if (frameIndex < 0 || frameIndex >= totalFrames) {
    return `missing:${frameIndex}`;
  }
  const cols = Math.max(1, Math.floor((unit.sourceWidth - unit.margin.x) / (unit.frameWidth + unit.spacing.x)));
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);
  const x = unit.margin.x + col * (unit.frameWidth + unit.spacing.x);
  const y = unit.margin.y + row * (unit.frameHeight + unit.spacing.y);
  const frame = Buffer.alloc(unit.frameWidth * unit.frameHeight * 4);
  let offset = 0;
  for (let py = 0; py < unit.frameHeight; py += 1) {
    const start = ((y + py) * png.width + x) * 4;
    const end = start + unit.frameWidth * 4;
    frame.set(png.rgba.subarray(start, end), offset);
    offset += unit.frameWidth * 4;
  }
  return createHash('sha256').update(frame).digest('hex');
}

function buildingFrameWidth(building: BuildingArchetype): number {
  return numberField(building, 'frameWidth', building.sourceWidth);
}

function buildingFrameHeight(building: BuildingArchetype): number {
  return numberField(building, 'frameHeight', building.sourceHeight);
}

function buildingMargin(building: BuildingArchetype): { x: number; y: number } {
  return objectField(building, 'margin', { x: 0, y: 0 });
}

function buildingSpacing(building: BuildingArchetype): { x: number; y: number } {
  return objectField(building, 'spacing', { x: 0, y: 0 });
}

function numberField(value: BuildingArchetype, key: string, fallback: number): number {
  const candidate = (value as unknown as Record<string, unknown>)[key];
  return typeof candidate === 'number' ? candidate : fallback;
}

function objectField(value: BuildingArchetype, key: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const candidate = (value as unknown as Record<string, unknown>)[key];
  if (isRecord(candidate) && typeof candidate['x'] === 'number' && typeof candidate['y'] === 'number') {
    return { x: candidate['x'], y: candidate['y'] };
  }
  return fallback;
}

function isProxy(unit: UnitArchetype): boolean {
  return hasTag(unit, 'proxy') || unit.displayName.toLowerCase().includes('proxy');
}

function hasTag(unit: UnitArchetype, tag: string): boolean {
  return unit.tags?.some((candidate) => candidate.toLowerCase() === tag) ?? false;
}

async function assertPackRoot(packDir: string): Promise<void> {
  const rootStat = await lstat(packDir);
  if (rootStat.isSymbolicLink()) {
    throw new Error('selected pack directory must not be a symbolic link');
  }
  if (!rootStat.isDirectory()) {
    throw new Error('selected pack path is not a directory');
  }
}

async function scanPackTree(packDir: string): Promise<PackFileStats> {
  const stats: PackFileStats = { files: 0, bytes: 0 };
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic link is not allowed inside selected pack: ${relative(packDir, path)}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`unsupported directory entry: ${relative(packDir, path)}`);
      }
      const fileStat = await lstat(path);
      stats.files += 1;
      stats.bytes += fileStat.size;
      if (stats.files > MAX_FILES) {
        throw new Error(`pack exceeds file limit (${MAX_FILES})`);
      }
      if (stats.bytes > MAX_TOTAL_BYTES) {
        throw new Error(`pack exceeds decoded-source byte limit (${MAX_TOTAL_BYTES} bytes)`);
      }
    }
  }
  await visit(packDir);
  return stats;
}

async function readJsonFile(packDir: string, path: string, maxBytes: number): Promise<unknown> {
  const buffer = await readBinaryFile(packDir, path, maxBytes);
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function readBinaryFile(packDir: string, path: string, maxBytes: number): Promise<Buffer> {
  const target = safePackTarget(packDir, path);
  await assertNoSymlinkPath(packDir, target);
  const fileStat = await lstat(target);
  if (!fileStat.isFile()) {
    throw new Error('referenced path is not a regular file');
  }
  if (fileStat.size > maxBytes) {
    throw new Error(`file exceeds limit of ${maxBytes} bytes`);
  }
  return readFile(target);
}

function safePackTarget(packDir: string, path: string): string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..')
  ) {
    throw new Error(`unsafe relative path: ${String(path)}`);
  }
  const target = resolve(packDir, path);
  const rel = relative(packDir, target);
  if (rel.startsWith('..') || rel === '..' || rel.includes(`${sep}..`)) {
    throw new Error(`path escapes selected pack: ${path}`);
  }
  return target;
}

async function assertNoSymlinkPath(packDir: string, target: string): Promise<void> {
  const rel = relative(packDir, target);
  const parts = rel.split(sep).filter((part) => part.length > 0);
  let current = packDir;
  for (const part of parts) {
    current = join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic link is not allowed: ${rel}`);
    }
  }
}

function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) {
      throw new Error('truncated PNG chunk');
    }
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) {
      throw new Error('PNG chunk exceeds file length');
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      throw new Error(`PNG CRC mismatch in ${type}`);
    }
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) {
        throw new Error('invalid PNG IHDR');
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      if (width <= 0 || height <= 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        throw new Error(`PNG dimensions exceed ${MAX_IMAGE_DIMENSION}px limit`);
      }
      if (width * height > MAX_IMAGE_PIXELS) {
        throw new Error(`PNG pixel count exceeds ${MAX_IMAGE_PIXELS}`);
      }
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('unsupported PNG compression, filter, or interlace method');
      }
      interlace = data[12] ?? 0;
      if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType)) {
        throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (!sawHeader) {
      throw new Error('PNG IHDR must be first');
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0) {
        throw new Error('invalid PNG palette');
      }
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      if (length !== 0) {
        throw new Error('invalid PNG IEND');
      }
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawEnd || offset !== buffer.length || idat.length === 0) {
    throw new Error('incomplete PNG');
  }
  if (colorType === 3 && !palette) {
    throw new Error('indexed PNG is missing PLTE');
  }
  if (interlace !== 0) {
    throw new Error('interlaced PNGs are not supported by the fixture validator');
  }

  let channels: number;
  switch (colorType) {
    case 0: channels = 1; break;
    case 2: channels = 3; break;
    case 3: channels = 1; break;
    case 4: channels = 2; break;
    case 6: channels = 4; break;
    default: throw new Error('unsupported PNG color type');
  }
  const rowBytes = width * channels;
  const expectedInflatedBytes = height * (rowBytes + 1);
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length !== expectedInflatedBytes) {
    throw new Error(`PNG scanline length mismatch (got ${inflated.length}, expected ${expectedInflatedBytes})`);
  }
  const raw = unfilterScanlines(inflated, width, height, channels, rowBytes);
  return { width, height, rgba: expandToRgba(raw, width, height, colorType, palette, transparency) };
}

function unfilterScanlines(data: Buffer, width: number, height: number, channels: number, rowBytes: number): Uint8Array {
  const result = new Uint8Array(width * height * channels);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[inputOffset++] ?? 255;
    if (filter > 4) {
      throw new Error(`unsupported PNG row filter ${filter}`);
    }
    const rowOffset = y * rowBytes;
    const previousOffset = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = data[inputOffset++] ?? 0;
      const left = x >= channels ? result[rowOffset + x - channels] ?? 0 : 0;
      const up = y > 0 ? result[previousOffset + x] ?? 0 : 0;
      const upperLeft = y > 0 && x >= channels ? result[previousOffset + x - channels] ?? 0 : 0;
      let value = source;
      if (filter === 1) value = (source + left) & 0xff;
      if (filter === 2) value = (source + up) & 0xff;
      if (filter === 3) value = (source + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) value = (source + paeth(left, up, upperLeft)) & 0xff;
      result[rowOffset + x] = value;
    }
  }
  return result;
}

function expandToRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Buffer | undefined,
  transparency: Buffer | undefined,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 2 ? 3 : 4;
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    if (colorType === 6) {
      rgba[target] = raw[source] ?? 0;
      rgba[target + 1] = raw[source + 1] ?? 0;
      rgba[target + 2] = raw[source + 2] ?? 0;
      rgba[target + 3] = raw[source + 3] ?? 0;
    } else if (colorType === 4) {
      const gray = raw[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = raw[source + 1] ?? 0;
    } else if (colorType === 2) {
      rgba[target] = raw[source] ?? 0;
      rgba[target + 1] = raw[source + 1] ?? 0;
      rgba[target + 2] = raw[source + 2] ?? 0;
      rgba[target + 3] = transparency && transparency.length >= 6 &&
        raw[source] === transparency.readUInt16BE(0) &&
        raw[source + 1] === transparency.readUInt16BE(2) &&
        raw[source + 2] === transparency.readUInt16BE(4) ? 0 : 255;
    } else if (colorType === 3) {
      const paletteIndex = raw[source] ?? 0;
      const paletteOffset = paletteIndex * 3;
      if (!palette || paletteOffset + 2 >= palette.length) {
        throw new Error(`PNG palette index ${paletteIndex} is out of range`);
      }
      rgba[target] = palette[paletteOffset] ?? 0;
      rgba[target + 1] = palette[paletteOffset + 1] ?? 0;
      rgba[target + 2] = palette[paletteOffset + 2] ?? 0;
      rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
    } else {
      const gray = raw[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = transparency && transparency.length >= 2 && gray === transparency.readUInt16BE(0) ? 0 : 255;
    }
  }
  return rgba;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function parseArgs(argv: string[]): ParsedArgs {
  let packDir = process.env['CONTENT_PACK_DIR'] ?? DEFAULT_PACK_DIR;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--pack-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('--pack-dir requires a directory');
      packDir = value;
      index += 1;
    } else if (argument?.startsWith('--pack-dir=')) {
      packDir = argument.slice('--pack-dir='.length);
      if (!packDir) throw new Error('--pack-dir requires a directory');
    } else if (argument && !argument.startsWith('-') && packDir === (process.env['CONTENT_PACK_DIR'] ?? DEFAULT_PACK_DIR)) {
      packDir = argument;
    } else {
      throw new Error(`unknown argument: ${argument ?? ''}`);
    }
  }
  return { packDir, help };
}

function printUsage(): void {
  console.log('Usage: npm run content:validate -- --pack-dir <directory>');
  console.log('       npm run content:validate -- <directory>');
  console.log(`Default directory: ${DEFAULT_PACK_DIR}`);
  console.log('The validator stays inside the selected directory, rejects symlinks and traversal, decodes PNGs, and checks Pack v2 references.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issueText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(`content:validate failed: ${issueText(error)}`);
  process.exitCode = 1;
});
