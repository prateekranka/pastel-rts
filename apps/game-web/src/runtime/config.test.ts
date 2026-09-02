import { describe, expect, it } from 'vitest';
import { STRESS_COUNTS } from '../config/constants';
import { BENCHMARKS, developerConfigQueryPatch, parseRuntimeConfig } from './config';

describe('runtime config', () => {
  it('defaults to WebGL with the dense-battle stress preset', () => {
    const config = parseRuntimeConfig('');
    expect(config.renderer).toBe('webgl');
    expect(config.benchmark).toBe('dense-battle');
    expect(BENCHMARKS[config.benchmark].counts.combat).toBeGreaterThanOrEqual(STRESS_COUNTS.combat);
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
    expect(developerConfigQueryPatch(current, { renderer: 'webgpu' })?.['renderer']).toBe('webgpu');
    expect(developerConfigQueryPatch(current, { dprPreset: 1 })?.['dpr']).toBe('1');
  });
});
