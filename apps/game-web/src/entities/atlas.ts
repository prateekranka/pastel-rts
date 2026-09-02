import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';

export const ATLAS_SIZE = 512;
export const ATLAS_TILE = 64;
export const ATLAS_PAD = 4;
export const ATLAS_COLS = 8;

export const ATLAS_SLOT = {
  friendlyCombat: 0,
  opposingCombat: 1,
  friendlyWorker: 2,
  opposingWorker: 3,
  friendlyBuilding: 4,
  opposingBuilding: 5,
  mushroom: 6,
  crystal: 7,
  rock: 8,
} as const;

export function createPlaceholderAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not allocate atlas canvas');
  }
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  ctx.imageSmoothingEnabled = false;

  drawSlot(ctx, ATLAS_SLOT.friendlyCombat, '#f2e6d0', '#e07a3d', 'chevron');
  drawSlot(ctx, ATLAS_SLOT.opposingCombat, '#b9a0e0', '#6b4c9a', 'chevron');
  drawSlot(ctx, ATLAS_SLOT.friendlyWorker, '#f4d7b0', '#e07a3d', 'circle');
  drawSlot(ctx, ATLAS_SLOT.opposingWorker, '#cbb6ee', '#3d2a63', 'circle');
  drawSlot(ctx, ATLAS_SLOT.friendlyBuilding, '#efe0c4', '#c97a45', 'house');
  drawSlot(ctx, ATLAS_SLOT.opposingBuilding, '#d4c2f0', '#6b4c9a', 'house');
  drawSlot(ctx, ATLAS_SLOT.mushroom, '#4a8187', '#2f565b', 'mushroom');
  drawSlot(ctx, ATLAS_SLOT.crystal, '#5ce1e6', '#2a8f94', 'crystal');
  drawSlot(ctx, ATLAS_SLOT.rock, '#6d7c7e', '#3d4c4e', 'rock');

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function atlasUv(slot: number): { u: number; v: number; w: number; h: number } {
  const col = slot % ATLAS_COLS;
  const row = Math.floor(slot / ATLAS_COLS);
  const inner = ATLAS_TILE - ATLAS_PAD * 2;
  return {
    u: (col * ATLAS_TILE + ATLAS_PAD) / ATLAS_SIZE,
    v: 1 - (row * ATLAS_TILE + ATLAS_PAD + inner) / ATLAS_SIZE,
    w: inner / ATLAS_SIZE,
    h: inner / ATLAS_SIZE,
  };
}

function drawSlot(
  ctx: CanvasRenderingContext2D,
  slot: number,
  fill: string,
  stroke: string,
  shape: 'chevron' | 'circle' | 'house' | 'mushroom' | 'crystal' | 'rock',
): void {
  const col = slot % ATLAS_COLS;
  const row = Math.floor(slot / ATLAS_COLS);
  const x = col * ATLAS_TILE + ATLAS_PAD;
  const y = row * ATLAS_TILE + ATLAS_PAD;
  const s = ATLAS_TILE - ATLAS_PAD * 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (shape === 'chevron') {
    ctx.moveTo(s * 0.5, 4);
    ctx.lineTo(s - 4, s * 0.55);
    ctx.lineTo(s * 0.5, s * 0.42);
    ctx.lineTo(4, s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stroke;
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.16, s * 0.42);
  } else if (shape === 'circle') {
    ctx.arc(s * 0.5, s * 0.55, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'house') {
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.64, s * 0.46);
    ctx.beginPath();
    ctx.moveTo(s * 0.1, s * 0.46);
    ctx.lineTo(s * 0.5, s * 0.12);
    ctx.lineTo(s * 0.9, s * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'mushroom') {
    ctx.fillRect(s * 0.42, s * 0.48, s * 0.16, s * 0.4);
    ctx.beginPath();
    ctx.ellipse(s * 0.5, s * 0.42, s * 0.32, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'crystal') {
    ctx.moveTo(s * 0.5, 6);
    ctx.lineTo(s * 0.78, s * 0.55);
    ctx.lineTo(s * 0.5, s - 6);
    ctx.lineTo(s * 0.22, s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.moveTo(s * 0.2, s * 0.7);
    ctx.lineTo(s * 0.18, s * 0.45);
    ctx.lineTo(s * 0.4, s * 0.28);
    ctx.lineTo(s * 0.72, s * 0.38);
    ctx.lineTo(s * 0.82, s * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
