#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_ROOT = resolve(process.env['PACK_V2_DIR'] ?? join(REPO_ROOT, 'content/dev-pack-v2'));
const PACK_JSON = join(PACK_ROOT, 'pack.json');
const FIXTURE_MAP_ID = 'm11-fixture-gallery';
const FIXTURE_SCENARIO_ID = 'm11-fixture-gallery';
const FRAME_SIZE = 32;
const UNIT_SHEET_WIDTH = FRAME_SIZE * 4;
const UNIT_SHEET_HEIGHT = FRAME_SIZE * 8;

const COLORS = {
  ink: rgba('#243344'),
  inkViolet: rgba('#2b203e'),
  sunDark: rgba('#3a5c78'),
  sunMid: rgba('#79d1c3'),
  sunLight: rgba('#d7f5dd'),
  sunGold: rgba('#ffcf70'),
  sunGlow: rgba('#ffefb0'),
  gravemarkDark: rgba('#57446f'),
  gravemarkMid: rgba('#a883cf'),
  gravemarkLight: rgba('#f0c5ee'),
  gravemarkAqua: rgba('#7de1d1'),
  gravemarkRose: rgba('#e98cae'),
  groundSun: rgba('#79d1c3', 90),
  groundGravemark: rgba('#a883cf', 90),
};

const CRC_TABLE = makeCrcTable();

function main() {
  const baseline = readJson(PACK_JSON);
  if (baseline.schemaVersion !== 2 || baseline.id !== 'dev-pack-v2') {
    throw new Error(`Expected the existing Pack v2 baseline at ${PACK_JSON}`);
  }

  const assets = [
    {
      path: 'units/sunweaver-scout/sheet.png',
      pixels: makeAnimatedSheet('sunweaver'),
    },
    {
      path: 'units/gravemark-stalker/sheet.png',
      pixels: makeAnimatedSheet('gravemark'),
    },
    {
      path: 'units/sunweaver-walker-proxy/sheet.png',
      pixels: makeWalkerProxy('sunweaver'),
    },
    {
      path: 'units/gravemark-walker-proxy/sheet.png',
      pixels: makeWalkerProxy('gravemark'),
    },
    {
      path: 'buildings/sunweaver-sanctum/sprite.png',
      pixels: makeSanctum(),
    },
    {
      path: 'buildings/gravemark-bastion/sprite.png',
      pixels: makeBastion(),
    },
    {
      path: 'buildings/neutral-cyan-beacon/sprite.png',
      pixels: makeBeacon(),
    },
  ];

  for (const asset of assets) {
    const output = join(PACK_ROOT, asset.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, encodePng(asset.pixels.width, asset.pixels.height, asset.pixels.rgba));
  }

  const animatedSunweaver = animatedUnit({
    id: 'sunweaver-scout',
    displayName: 'Sunweaver Scout',
    factionId: 'sunweaver',
    assetPath: 'units/sunweaver-scout/sheet.png',
    tags: ['infantry', 'scout', 'original-fixture', 'animated'],
    worldHeight: 1.5,
    selectionRadius: 0.6,
    collisionRadius: 0.42,
  });
  const animatedSunweaverInfantry = animatedUnit({
    ...animatedSunweaver,
    id: 'sunweaver-infantry',
    displayName: 'Sunweaver Infantry',
    tags: ['infantry', 'original-fixture', 'animated'],
  });
  const animatedGravemark = animatedUnit({
    id: 'gravemark-stalker',
    displayName: 'Gravemark Stalker',
    factionId: 'gravemark',
    assetPath: 'units/gravemark-stalker/sheet.png',
    tags: ['infantry', 'stalker', 'original-fixture', 'animated'],
    worldHeight: 1.55,
    selectionRadius: 0.65,
    collisionRadius: 0.5,
  });
  const animatedGravemarkInfantry = animatedUnit({
    ...animatedGravemark,
    id: 'gravemark-infantry',
    displayName: 'Gravemark Infantry',
    tags: ['infantry', 'original-fixture', 'animated'],
  });
  const sunweaverWalker = walkerProxy({
    id: 'sunweaver-walker',
    displayName: 'Sunweaver Walker (Proxy)',
    factionId: 'sunweaver',
    assetPath: 'units/sunweaver-walker-proxy/sheet.png',
    tags: ['walker', 'proxy', 'missing-directional-frames', 'original-fixture'],
  });
  const gravemarkWalker = walkerProxy({
    id: 'gravemark-walker',
    displayName: 'Gravemark Walker (Proxy)',
    factionId: 'gravemark',
    assetPath: 'units/gravemark-walker-proxy/sheet.png',
    tags: ['walker', 'proxy', 'missing-directional-frames', 'original-fixture'],
  });

  const buildings = [
    building({
      id: 'sunweaver-sanctum',
      displayName: 'Sunweaver Sanctum',
      factionId: 'sunweaver',
      assetPath: 'buildings/sunweaver-sanctum/sprite.png',
      sourceWidth: 128,
      sourceHeight: 128,
      bounds: { minX: 8, minY: 14, maxX: 120, maxY: 122 },
      worldHeight: 3.2,
      cellsW: 3,
      cellsH: 3,
      tags: ['original-fixture', 'building'],
    }),
    building({
      id: 'gravemark-bastion',
      displayName: 'Gravemark Bastion',
      factionId: 'gravemark',
      assetPath: 'buildings/gravemark-bastion/sprite.png',
      sourceWidth: 96,
      sourceHeight: 96,
      bounds: { minX: 6, minY: 10, maxX: 90, maxY: 94 },
      worldHeight: 2.4,
      cellsW: 2,
      cellsH: 2,
      tags: ['original-fixture', 'building'],
    }),
    building({
      id: 'neutral-cyan-beacon',
      displayName: 'Cyan Beacon',
      factionId: 'neutral',
      assetPath: 'buildings/neutral-cyan-beacon/sprite.png',
      sourceWidth: 64,
      sourceHeight: 64,
      bounds: { minX: 7, minY: 4, maxX: 57, maxY: 62 },
      worldHeight: 1.8,
      cellsW: 2,
      cellsH: 2,
      tags: ['original-fixture', 'building'],
    }),
  ];

  const fixtureMap = {
    schemaVersion: 1,
    id: FIXTURE_MAP_ID,
    displayName: 'M1.1 Fixture Gallery Map',
    cellsX: 64,
    cellsZ: 64,
    chunkSize: 16,
  };
  const fixtureScenario = {
    schemaVersion: 1,
    id: FIXTURE_SCENARIO_ID,
    displayName: 'M1.1 Original Fixture Gallery',
    mapId: FIXTURE_MAP_ID,
    units: [
      {
        archetypeId: 'sunweaver-scout',
        position: { x: 8192, z: 8192 },
        headingMilli: 0,
        factionId: 'sunweaver',
      },
      {
        archetypeId: 'gravemark-stalker',
        position: { x: 49152, z: 49152 },
        headingMilli: 3142,
        factionId: 'gravemark',
      },
      {
        archetypeId: 'sunweaver-walker',
        position: { x: 32768, z: 32768 },
        headingMilli: 1571,
        factionId: 'sunweaver',
      },
    ],
    buildings: [
      {
        archetypeId: 'sunweaver-sanctum',
        originCell: { cx: 4, cz: 4 },
        factionId: 'sunweaver',
      },
      {
        archetypeId: 'gravemark-bastion',
        originCell: { cx: 52, cz: 52 },
        factionId: 'gravemark',
      },
    ],
  };

  writeJson(join(PACK_ROOT, 'maps', `${FIXTURE_MAP_ID}.json`), fixtureMap);
  writeJson(join(PACK_ROOT, 'scenarios', `${FIXTURE_SCENARIO_ID}.json`), fixtureScenario);

  const generatedUnits = [
    animatedSunweaver,
    animatedSunweaverInfantry,
    sunweaverWalker,
    animatedGravemark,
    animatedGravemarkInfantry,
    gravemarkWalker,
  ];
  for (const unit of generatedUnits) {
    writeJson(join(PACK_ROOT, 'units', unit.id, 'manifest.json'), unit);
  }
  for (const buildingEntry of buildings) {
    writeJson(join(PACK_ROOT, 'buildings', buildingEntry.id, 'manifest.json'), buildingEntry);
  }
  const generatedMaps = upsertReference(baseline.maps, {
    id: FIXTURE_MAP_ID,
    path: `maps/${FIXTURE_MAP_ID}.json`,
  });
  const generatedScenarios = upsertReference(baseline.scenarios, {
    id: FIXTURE_SCENARIO_ID,
    path: `scenarios/${FIXTURE_SCENARIO_ID}.json`,
    mapId: FIXTURE_MAP_ID,
  });
  const packWithoutHash = {
    schemaVersion: 2,
    id: baseline.id,
    revision: '3',
    factions: baseline.factions,
    units: mergeById(baseline.units, generatedUnits),
    buildings: mergeById(baseline.buildings, buildings),
    maps: generatedMaps,
    scenarios: generatedScenarios,
  };
  const pack = {
    ...packWithoutHash,
    contentHash: computeContentHash(packWithoutHash),
  };
  writeJson(PACK_JSON, pack);

  console.log(`Generated original M1.1 fixture pack at ${PACK_ROOT}`);
  console.log(`  units: ${pack.units.length}; buildings: ${pack.buildings.length}`);
  console.log(`  animated sheets: units/sunweaver-scout/sheet.png, units/gravemark-stalker/sheet.png`);
  console.log('  proxy sheets: units/sunweaver-walker-proxy/sheet.png, units/gravemark-walker-proxy/sheet.png');
  console.log(`  deterministic scenario: ${FIXTURE_SCENARIO_ID}`);
  console.log(`  content hash: ${pack.contentHash}`);
}

function animatedUnit({
  id,
  displayName,
  factionId,
  assetPath,
  tags,
  worldHeight,
  selectionRadius,
  collisionRadius,
}) {
  return {
    schemaVersion: 2,
    id,
    displayName,
    enabled: true,
    factionId,
    assetPath,
    sourceWidth: UNIT_SHEET_WIDTH,
    sourceHeight: UNIT_SHEET_HEIGHT,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    margin: { x: 0, y: 0 },
    spacing: { x: 0, y: 0 },
    bounds: { minX: 4, minY: 3, maxX: 28, maxY: 31 },
    anchor: { x: 0.5, y: 1 },
    worldHeight,
    selectionRadius,
    collisionRadius,
    animation: {
      directions: 4,
      directionOrder: ['n', 'e', 's', 'w'],
      mirrored: false,
      clips: {
        idle: { frames: { kind: 'range', start: 0, end: 15 }, fps: 8, looping: true, assetPath },
        move: { frames: { kind: 'range', start: 16, end: 31 }, fps: 12, looping: true, assetPath },
      },
    },
    movement: {
      speedSubunitsPerTick: factionId === 'sunweaver' ? 64 : 72,
      accelerationRate: factionId === 'sunweaver' ? 1 : 1.2,
      turnRateMilli: factionId === 'sunweaver' ? 3000 : 2500,
      footprintCategory: 'unit-1x1',
    },
    tags,
  };
}

function walkerProxy({ id, displayName, factionId, assetPath, tags }) {
  return {
    schemaVersion: 2,
    id,
    displayName,
    enabled: true,
    factionId,
    assetPath,
    sourceWidth: 64,
    sourceHeight: 64,
    frameWidth: 64,
    frameHeight: 64,
    margin: { x: 0, y: 0 },
    spacing: { x: 0, y: 0 },
    bounds: { minX: 5, minY: 5, maxX: 59, maxY: 62 },
    anchor: { x: 0.5, y: 1 },
    worldHeight: 3.2,
    selectionRadius: 1.1,
    collisionRadius: 0.85,
    animation: {
      directions: 1,
      mirrored: false,
      fallbackRules: { missingDirection: 'proxy-omnidirectional' },
      clips: {
        idle: { frames: { kind: 'indexes', indexes: [0] }, fps: 1, looping: true, assetPath },
        move: { frames: { kind: 'indexes', indexes: [0] }, fps: 1, looping: true, assetPath },
      },
    },
    movement: {
      speedSubunitsPerTick: 48,
      accelerationRate: 0.8,
      turnRateMilli: 2000,
      footprintCategory: 'unit-1x1',
    },
    tags,
  };
}

function building({
  id,
  displayName,
  factionId,
  assetPath,
  sourceWidth,
  sourceHeight,
  bounds,
  worldHeight,
  cellsW,
  cellsH,
  tags,
}) {
  return {
    schemaVersion: 2,
    id,
    displayName,
    enabled: true,
    factionId,
    assetPath,
    sourceWidth,
    sourceHeight,
    bounds,
    anchor: { x: 0.5, y: 1 },
    worldHeight,
    footprint: { kind: 'rect', cellsW, cellsH },
    selectionFootprint: { kind: 'rect', cellsW, cellsH },
    tags,
  };
}

function makeAnimatedSheet(faction) {
  const width = UNIT_SHEET_WIDTH;
  const height = UNIT_SHEET_HEIGHT;
  const rgbaPixels = createPixels(width, height);
  for (let direction = 0; direction < 4; direction += 1) {
    for (let phase = 0; phase < 4; phase += 1) {
      const idleFrame = direction * 4 + phase;
      const moveFrame = 16 + direction * 4 + phase;
      drawUnitFrame(rgbaPixels, width, direction, phase, false, faction, idleFrame);
      drawUnitFrame(rgbaPixels, width, direction, phase, true, faction, moveFrame);
    }
  }
  return { width, height, rgba: rgbaPixels };
}

function drawUnitFrame(pixels, sheetWidth, direction, phase, moving, faction, frameIndex) {
  const ox = (frameIndex % 4) * FRAME_SIZE;
  const oy = Math.floor(frameIndex / 4) * FRAME_SIZE;
  const palette = faction === 'sunweaver'
    ? { outline: COLORS.ink, dark: COLORS.sunDark, mid: COLORS.sunMid, light: COLORS.sunLight, accent: COLORS.sunGold, glow: COLORS.sunGlow, ground: COLORS.groundSun }
    : { outline: COLORS.inkViolet, dark: COLORS.gravemarkDark, mid: COLORS.gravemarkMid, light: COLORS.gravemarkLight, accent: COLORS.gravemarkAqua, glow: COLORS.gravemarkRose, ground: COLORS.groundGravemark };
  const step = moving ? [-2, 0, 2, 0][phase] : [0, 0, 1, 0][phase];
  const bob = moving ? [1, 0, -1, 0][phase] : [0, 0, 0, -1][phase];
  const pixel = (x, y, w, h, color) => rect(pixels, sheetWidth, UNIT_SHEET_HEIGHT, ox + x, oy + y + bob, w, h, color);

  rect(pixels, sheetWidth, UNIT_SHEET_HEIGHT, ox + 8, oy + 28, 16, 2, palette.ground);
  if (faction === 'sunweaver') {
    drawScout(pixel, direction, step, phase, palette, moving);
  } else {
    drawStalker(pixel, direction, step, phase, palette, moving);
  }
}

function drawScout(pixel, direction, step, phase, palette, moving) {
  const legY = 20;
  const leftLeg = 11 + step;
  const rightLeg = 18 - step;
  pixel(leftLeg, legY, 5, 8, palette.outline);
  pixel(leftLeg + 1, legY, 3, 6, palette.dark);
  pixel(leftLeg - (moving && step < 0 ? 1 : 0), 27, 6, 2, palette.outline);
  pixel(rightLeg, legY, 5, 8, palette.outline);
  pixel(rightLeg + 1, legY, 3, 6, palette.mid);
  pixel(rightLeg + (moving && step > 0 ? 1 : 0), 27, 6, 2, palette.outline);

  pixel(8, 11, 16, 11, palette.outline);
  pixel(10, 12, 12, 8, palette.mid);
  pixel(11, 13, 10, 4, palette.light);
  pixel(12, 17, 8, 4, palette.dark);
  pixel(10, 20, 12, 3, palette.outline);
  pixel(9, 14 + (phase === 2 ? 1 : 0), 3, 5, palette.accent);
  pixel(20, 14 + (phase === 1 ? 1 : 0), 3, 5, palette.accent);

  if (direction === 0) {
    pixel(11, 5, 10, 7, palette.outline);
    pixel(13, 6, 6, 4, palette.dark);
    pixel(14, 7, 4, 2, palette.accent);
    pixel(15, 3, 2, 3, palette.outline);
    pixel(15, 2, 2, 1, palette.glow);
    pixel(12, 22, 8, 2, palette.light);
  } else if (direction === 2) {
    pixel(10, 5, 12, 7, palette.outline);
    pixel(12, 6, 8, 4, palette.light);
    pixel(13, 7, 2, 2, palette.outline);
    pixel(17, 7, 2, 2, palette.outline);
    pixel(14 + (phase % 2), 9, 4, 2, palette.accent);
    pixel(15, 3, 2, 3, palette.outline);
    pixel(15, 2, 2, 1, palette.glow);
    pixel(12, 22, 8, 2, palette.light);
  } else {
    const west = direction === 3;
    const headX = west ? 5 : 14;
    const visorX = west ? 7 : 18;
    const noseX = west ? 3 : 24;
    pixel(headX, 5, 10, 7, palette.outline);
    pixel(headX + 2, 6, 6, 4, palette.light);
    pixel(visorX, 7 + (phase === 3 ? 1 : 0), 4, 2, palette.accent);
    pixel(noseX, 8, 3, 3, palette.outline);
    pixel(west ? 9 : 21, 3, 2, 3, palette.outline);
    pixel(west ? 9 : 21, 2, 2, 1, palette.glow);
    pixel(west ? 17 : 7, 14, 3, 5, palette.accent);
  }

  if (moving) {
    pixel(7 + (phase % 2), 24, 2, 2, palette.glow);
    pixel(22 - (phase % 2), 24, 2, 2, palette.glow);
  } else {
    pixel(15 + phase % 2, 24, 2, 1, palette.glow);
  }
}

function drawStalker(pixel, direction, step, phase, palette, moving) {
  const legOffset = moving ? step : 0;
  const legY = 20;
  const legs = [7 + legOffset, 12 - legOffset, 19 + legOffset, 24 - legOffset];
  for (let index = 0; index < legs.length; index += 1) {
    const x = legs[index];
    pixel(x, legY + (index % 2), 3, 8, palette.outline);
    pixel(x + 1, legY + (index % 2), 1, 6, palette.dark);
    pixel(x - (index % 2 === 0 ? 1 : 0), 27, 4, 2, palette.outline);
  }
  pixel(7, 12, 19, 10, palette.outline);
  pixel(9, 13, 15, 7, palette.mid);
  pixel(11, 14, 11, 3, palette.light);
  pixel(12, 18, 9, 3, palette.dark);
  pixel(8, 15 + (phase === 1 ? 1 : 0), 3, 4, palette.accent);
  pixel(22, 15 + (phase === 3 ? 1 : 0), 3, 4, palette.accent);

  if (direction === 0) {
    pixel(10, 5, 13, 8, palette.outline);
    pixel(12, 6, 9, 5, palette.dark);
    pixel(14, 7, 5, 2, palette.accent);
    pixel(8, 8, 3, 3, palette.outline);
    pixel(22, 8, 3, 3, palette.outline);
  } else if (direction === 2) {
    pixel(9, 5, 15, 8, palette.outline);
    pixel(11, 6, 11, 5, palette.light);
    pixel(13, 8, 2, 2, palette.outline);
    pixel(18, 8, 2, 2, palette.outline);
    pixel(15 + (phase % 2), 10, 4, 2, palette.accent);
  } else {
    const west = direction === 3;
    const headX = west ? 4 : 16;
    const noseX = west ? 1 : 26;
    pixel(headX, 6, 11, 7, palette.outline);
    pixel(headX + 2, 7, 7, 4, palette.light);
    pixel(west ? 6 : 21, 8, 4, 2, palette.accent);
    pixel(noseX, 9, 3, 3, palette.outline);
    pixel(west ? 13 : 4, 4, 2, 3, palette.outline);
  }
  pixel(15 + (phase % 2), 3, 2, 3, palette.outline);
  pixel(15 + (phase % 2), 2, 2, 1, palette.glow);
  if (moving) {
    pixel(4 + (phase % 2), 24, 2, 2, palette.glow);
    pixel(26 - (phase % 2), 24, 2, 2, palette.glow);
  } else {
    pixel(15, 24 + (phase % 2), 3, 1, palette.glow);
  }
}

function makeWalkerProxy(faction) {
  const width = 64;
  const height = 64;
  const pixels = createPixels(width, height);
  const palette = faction === 'sunweaver'
    ? { outline: COLORS.ink, dark: COLORS.sunDark, mid: COLORS.sunMid, light: COLORS.sunLight, accent: COLORS.sunGold, glow: COLORS.sunGlow, ground: COLORS.groundSun }
    : { outline: COLORS.inkViolet, dark: COLORS.gravemarkDark, mid: COLORS.gravemarkMid, light: COLORS.gravemarkLight, accent: COLORS.gravemarkAqua, glow: COLORS.gravemarkRose, ground: COLORS.groundGravemark };
  rect(pixels, width, height, 10, 58, 44, 4, palette.ground);
  rect(pixels, width, height, 17, 38, 10, 20, palette.outline);
  rect(pixels, width, height, 37, 38, 10, 20, palette.outline);
  rect(pixels, width, height, 20, 39, 4, 16, palette.dark);
  rect(pixels, width, height, 40, 39, 4, 16, palette.mid);
  rect(pixels, width, height, 14, 54, 16, 4, palette.outline);
  rect(pixels, width, height, 34, 54, 16, 4, palette.outline);
  rect(pixels, width, height, 13, 20, 38, 22, palette.outline);
  rect(pixels, width, height, 17, 24, 30, 14, palette.mid);
  rect(pixels, width, height, 21, 27, 22, 7, palette.dark);
  rect(pixels, width, height, 26, 29, 12, 4, palette.light);
  rect(pixels, width, height, 22, 22, 20, 4, palette.accent);
  rect(pixels, width, height, 27, 11, 10, 10, palette.outline);
  rect(pixels, width, height, 29, 13, 6, 5, palette.light);
  rect(pixels, width, height, 31, 14, 3, 2, palette.glow);
  rect(pixels, width, height, 31, 4, 2, 8, palette.outline);
  rect(pixels, width, height, 30, 2, 4, 2, palette.glow);
  line(pixels, width, height, 18, 29, 9, 20, palette.light);
  line(pixels, width, height, 46, 29, 37, 20, palette.light);
  return { width, height, rgba: pixels };
}

function makeSanctum() {
  const width = 128;
  const height = 128;
  const pixels = createPixels(width, height);
  const p = { outline: COLORS.ink, dark: COLORS.sunDark, mid: COLORS.sunMid, light: COLORS.sunLight, accent: COLORS.sunGold, glow: COLORS.sunGlow };
  rect(pixels, width, height, 14, 110, 100, 10, rgba('#79d1c3', 80));
  rect(pixels, width, height, 10, 94, 108, 18, p.outline);
  rect(pixels, width, height, 16, 90, 96, 18, p.dark);
  rect(pixels, width, height, 24, 48, 80, 48, p.outline);
  rect(pixels, width, height, 30, 52, 68, 40, p.mid);
  rect(pixels, width, height, 36, 58, 56, 26, p.light);
  rect(pixels, width, height, 44, 28, 40, 34, p.outline);
  rect(pixels, width, height, 50, 32, 28, 26, p.dark);
  rect(pixels, width, height, 56, 38, 16, 15, p.accent);
  rect(pixels, width, height, 61, 42, 6, 7, p.glow);
  rect(pixels, width, height, 18, 56, 10, 34, p.outline);
  rect(pixels, width, height, 22, 60, 6, 24, p.accent);
  rect(pixels, width, height, 100, 56, 10, 34, p.outline);
  rect(pixels, width, height, 104, 60, 6, 24, p.accent);
  for (const x of [30, 42, 86, 98]) {
    rect(pixels, width, height, x, 66, 6, 5, p.dark);
    rect(pixels, width, height, x + 2, 68, 2, 10, p.outline);
  }
  rect(pixels, width, height, 56, 82, 16, 26, p.outline);
  rect(pixels, width, height, 61, 86, 6, 22, p.dark);
  rect(pixels, width, height, 63, 96, 2, 12, p.accent);
  line(pixels, width, height, 24, 48, 64, 20, p.light);
  line(pixels, width, height, 104, 48, 64, 20, p.light);
  return { width, height, rgba: pixels };
}

function makeBastion() {
  const width = 96;
  const height = 96;
  const pixels = createPixels(width, height);
  const p = { outline: COLORS.inkViolet, dark: COLORS.gravemarkDark, mid: COLORS.gravemarkMid, light: COLORS.gravemarkLight, accent: COLORS.gravemarkAqua, glow: COLORS.gravemarkRose };
  rect(pixels, width, height, 8, 80, 80, 10, rgba('#a883cf', 80));
  rect(pixels, width, height, 6, 68, 84, 22, p.outline);
  rect(pixels, width, height, 12, 64, 72, 22, p.dark);
  rect(pixels, width, height, 20, 28, 56, 40, p.outline);
  rect(pixels, width, height, 25, 32, 46, 31, p.mid);
  rect(pixels, width, height, 31, 38, 34, 16, p.dark);
  rect(pixels, width, height, 38, 42, 20, 9, p.light);
  rect(pixels, width, height, 43, 45, 10, 4, p.accent);
  rect(pixels, width, height, 12, 36, 13, 32, p.outline);
  rect(pixels, width, height, 16, 40, 5, 22, p.accent);
  rect(pixels, width, height, 71, 36, 13, 32, p.outline);
  rect(pixels, width, height, 75, 40, 5, 22, p.accent);
  rect(pixels, width, height, 40, 18, 16, 14, p.outline);
  rect(pixels, width, height, 44, 22, 8, 8, p.light);
  rect(pixels, width, height, 47, 24, 3, 3, p.glow);
  for (const x of [28, 64]) {
    rect(pixels, width, height, x, 54, 5, 8, p.outline);
    rect(pixels, width, height, x + 1, 55, 3, 4, p.glow);
  }
  line(pixels, width, height, 20, 28, 48, 12, p.light);
  line(pixels, width, height, 76, 28, 48, 12, p.light);
  return { width, height, rgba: pixels };
}

function makeBeacon() {
  const width = 64;
  const height = 64;
  const pixels = createPixels(width, height);
  const p = { outline: COLORS.ink, dark: rgba('#2a8f94'), mid: COLORS.sunMid, light: COLORS.sunLight, accent: rgba('#5ce1e6'), glow: COLORS.sunGlow };
  rect(pixels, width, height, 10, 54, 44, 5, rgba('#5ce1e6', 80));
  rect(pixels, width, height, 8, 47, 48, 10, p.outline);
  rect(pixels, width, height, 13, 44, 38, 10, p.dark);
  fillPolygon(pixels, width, height, [[16, 44], [32, 8], [48, 44]], p.outline);
  fillPolygon(pixels, width, height, [[22, 42], [32, 15], [42, 42]], p.accent);
  line(pixels, width, height, 32, 14, 32, 42, p.light);
  rect(pixels, width, height, 28, 27, 8, 7, p.glow);
  rect(pixels, width, height, 30, 29, 4, 3, p.light);
  return { width, height, rgba: pixels };
}

function createPixels(width, height) {
  return new Uint8Array(width * height * 4);
}

function rgba(hex, alpha = 255) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    alpha,
  ];
}

function rect(pixels, width, height, x, y, w, h, color) {
  const minX = Math.max(0, Math.floor(x));
  const minY = Math.max(0, Math.floor(y));
  const maxX = Math.min(width, Math.ceil(x + w));
  const maxY = Math.min(height, Math.ceil(y + h));
  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const index = (py * width + px) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function line(pixels, width, height, x0, y0, x1, y1, color) {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const sx = ax < bx ? 1 : -1;
  const dy = -Math.abs(by - ay);
  const sy = ay < by ? 1 : -1;
  let error = dx + dy;
  while (true) {
    rect(pixels, width, height, ax, ay, 1, 1, color);
    if (ax === bx && ay === by) {
      break;
    }
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      ax += sx;
    }
    if (twice <= dx) {
      error += dx;
      ay += sy;
    }
  }
}

function fillPolygon(pixels, width, height, points, color) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      if ((first[1] <= y && second[1] > y) || (second[1] <= y && first[1] > y)) {
        const x = first[0] + ((y - first[1]) * (second[0] - first[0])) / (second[1] - first[1]);
        intersections.push(x);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      rect(pixels, width, height, Math.floor(intersections[index]), y, Math.ceil(intersections[index + 1] - intersections[index]) + 1, 1, color);
    }
  }
}

function encodePng(width, height, pixels) {
  const scanlineLength = width * 4 + 1;
  const scanlines = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    scanlines[rowOffset] = 0;
    const sourceOffset = y * width * 4;
    Buffer.from(pixels.buffer, pixels.byteOffset + sourceOffset, width * 4).copy(scanlines, rowOffset + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return result;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
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

function mergeById(existing, generated) {
  const replacements = new Map(generated.map((entry) => [entry.id, entry]));
  const result = Array.isArray(existing)
    ? existing.map((entry) => replacements.get(entry.id) ?? entry)
    : [];
  const present = new Set(result.map((entry) => entry.id));
  for (const entry of generated) {
    if (!present.has(entry.id)) {
      result.push(entry);
    }
  }
  return result;
}

function upsertReference(existing, reference) {
  const result = Array.isArray(existing) ? [...existing] : [];
  const index = result.findIndex((entry) => entry.id === reference.id);
  if (index >= 0) {
    result[index] = reference;
  } else {
    result.push(reference);
  }
  return result;
}

function computeContentHash(content) {
  const canonical = canonicalize(content);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === 'object') {
    const record = value;
    const result = {};
    for (const key of Object.keys(record).filter((entry) => record[entry] !== undefined && entry !== 'contentHash').sort()) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  throw new Error('Unsupported value in canonical content');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(`Fixture generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
