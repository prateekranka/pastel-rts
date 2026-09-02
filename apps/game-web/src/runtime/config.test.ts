import { describe, expect, it } from 'vitest';
import { STRESS_COUNTS } from '../config/constants';
import { BENCHMARKS, developerConfigQueryPatch, packV2PublicBaseUrl, parseRuntimeConfig } from './config';

describe('runtime config', () => {
  it('defaults to WebGL with the dense-battle stress preset', () => {
    const config = parseRuntimeConfig('');
    expect(config.renderer).toBe('webgl');
    expect(config.benchmark).toBe('dense-battle');
    expect(config.mode).toBe('benchmark');
    expect(BENCHMARKS[config.benchmark].counts.combat).toBeGreaterThanOrEqual(STRESS_COUNTS.combat);
  });

  it('opts into interaction-lab without renaming M0 flags', () => {
    const config = parseRuntimeConfig(
      '?mode=interaction-lab&seed=42&renderer=webgl&dpr=1&zoom=70-percent&spawnUnit=sunweaver-infantry',
    );
    expect(config.mode).toBe('interaction-lab');
    expect(config.seed).toBe(42);
    expect(config.renderer).toBe('webgl');
    expect(config.dprPreset).toBe(1);
    expect(config.zoomStop).toBe('70-percent');
    expect(config.spawnUnitId).toBe('sunweaver-infantry');
  });

  it('selects WebGPU and 2x stress from the query string', () => {
    const config = parseRuntimeConfig('?renderer=webgpu&benchmark=2x-stress&dpr=1');
    expect(config.renderer).toBe('webgpu');
    expect(config.benchmark).toBe('2x-stress');
    expect(config.dprPreset).toBe(1);
    expect(BENCHMARKS['2x-stress'].counts.combat).toBe(240);
  });

  it('exposes every required benchmark preset', () => {
    for (const name of [
      'idle-base',
      'normal-midgame',
      'dense-battle',
      'camera-pan-stress',
      'maximum-population',
      '2x-stress',
      '20-minute-soak',
    ] as const) {
      expect(BENCHMARKS[name]).toBeDefined();
    }
    expect(BENCHMARKS['20-minute-soak'].autoPan).toBe(true);
    expect(BENCHMARKS['camera-pan-stress'].autoPan).toBe(true);
    expect(BENCHMARKS['idle-base'].counts.combat).toBeLessThan(STRESS_COUNTS.combat);
  });

  it('does not reload when native developer config already matches', () => {
    const current = parseRuntimeConfig('?renderer=webgl&dpr=1.5&benchmark=dense-battle');
    expect(
      developerConfigQueryPatch(current, { renderer: 'webgl', haptics: true }),
    ).toBeNull();
    expect(
      developerConfigQueryPatch(current, {
        renderer: 'webgpu',
      })?.['renderer'],
    ).toBe('webgpu');
    expect(developerConfigQueryPatch(current, { dprPreset: 1 })?.['dpr']).toBe('1');
  });

  it('builds a relative Pack v2 URL for bundled iOS loads', () => {
    expect(packV2PublicBaseUrl()).toMatch(/content\/dev-pack-v2\/$/);
  });
});
