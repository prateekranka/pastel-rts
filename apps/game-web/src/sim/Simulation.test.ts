import { describe, expect, it } from 'vitest';
import { STRESS_COUNTS, TICK_HZ } from '../config/constants';
import { Simulation } from './Simulation';
import { SNAPSHOT_STRIDE, totalEntities } from './types';

describe('stress simulation', () => {
  it('spawns at least the Milestone 0 stress population', () => {
    const sim = new Simulation();
    sim.init(0x51, { ...STRESS_COUNTS }, true);
    const counts = sim.getCounts();
    expect(counts.combat).toBeGreaterThanOrEqual(120);
    expect(counts.workers).toBeGreaterThanOrEqual(40);
    expect(counts.buildings).toBeGreaterThanOrEqual(30);
    expect(counts.props).toBeGreaterThanOrEqual(200);
  });

  it('advances moving units independently of a render clock at 20 Hz', () => {
    const sim = new Simulation();
    sim.init(0x51, { combat: 120, workers: 40, buildings: 30, props: 200 }, true);
    const first = new Float32Array(sim.requiredPayloadLength());
    sim.writeSnapshot(first);
    const dt = 1000 / TICK_HZ;
    for (let i = 0; i < 20; i += 1) {
      sim.step(dt);
    }
    const second = new Float32Array(sim.requiredPayloadLength());
    sim.writeSnapshot(second);
    expect(sim.getTick()).toBe(20);
    let moved = 0;
    for (let i = 0; i < 120; i += 1) {
      const o = i * SNAPSHOT_STRIDE;
      const dx = (second[o] ?? 0) - (first[o] ?? 0);
      const dz = (second[o + 1] ?? 0) - (first[o + 1] ?? 0);
      if (dx * dx + dz * dz > 1e-6) {
        moved += 1;
      }
    }
    expect(moved).toBeGreaterThan(80);
    expect(totalEntities(sim.getCounts())).toBe(390);
  });

  it('reuses pooled entity records across inits', () => {
    const sim = new Simulation();
    sim.init(1, { combat: 10, workers: 4, buildings: 2, props: 8 }, true);
    const firstCapacity = sim.getPoolCapacity();
    expect(firstCapacity).toBe(sim.getLiveCount());
    sim.init(2, { combat: 8, workers: 3, buildings: 2, props: 5 }, true);
    expect(sim.getPoolCapacity()).toBe(firstCapacity);
    expect(sim.getLiveCount()).toBe(18);
  });

  it('does not advance sim time unless step() runs (pause does not jump)', () => {
    const sim = new Simulation();
    sim.init(7, { combat: 4, workers: 2, buildings: 1, props: 2 }, true);
    const before = sim.getSimTimeMs();
    expect(sim.getTick()).toBe(0);
    expect(before).toBe(0);
    sim.step(50);
    expect(sim.getSimTimeMs()).toBe(50);
    const pausedAt = sim.getSimTimeMs();
    expect(sim.getTick()).toBe(1);
    expect(pausedAt).toBe(50);
  });

  it('is deterministic for a fixed seed', () => {
    const a = new Simulation();
    const b = new Simulation();
    a.init(99, { ...STRESS_COUNTS }, true);
    b.init(99, { ...STRESS_COUNTS }, true);
    a.step(50);
    b.step(50);
    const pa = new Float32Array(a.requiredPayloadLength());
    const pb = new Float32Array(b.requiredPayloadLength());
    a.writeSnapshot(pa);
    b.writeSnapshot(pb);
    expect(Array.from(pa)).toEqual(Array.from(pb));
  });
});
