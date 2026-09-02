// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { assertWebGpuAvailable, replaceCanvasPreservingIdentity } from './adapter';

describe('renderer adapter fallback helpers', () => {
  it('throws when WebGPU is missing so callers can fall back to WebGL', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    await expect(assertWebGpuAvailable()).rejects.toThrow(/WebGPU/i);
  });

  it('replaces a canvas that can no longer provide a different context', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.setAttribute('data-test', '1');
    host.append(canvas);
    document.body.append(host);
    const next = replaceCanvasPreservingIdentity(canvas);
    expect(next.id).toBe('game-canvas');
    expect(next.getAttribute('data-test')).toBe('1');
    expect(host.contains(canvas)).toBe(false);
    expect(host.contains(next)).toBe(true);
  });
});
