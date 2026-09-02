import { describe, expect, it } from 'vitest';
import { STRESS_COUNTS } from '../config/constants';
import { BENCHMARKS, parseRuntimeConfig } from './config';

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
});
