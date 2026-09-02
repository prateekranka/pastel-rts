import { createMulberry32 } from '../util/seededRng';
import { CELL_SIZE, MAP_CELLS } from '../config/constants';
import {
  ENTITY_KIND,
  FACTION,
  SNAPSHOT_STRIDE,
  totalEntities,
  type SimCounts,
} from './types';

type SimEntity = {
  kind: number;
  faction: number;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  heading: number;
  anim: number;
  radius: number;
  speed: number;
  phase: number;
};

const DENSE_ORIGIN_X = 72;
const DENSE_ORIGIN_Z = 68;
const DENSE_SPAN = 36;

function emptyEntity(): SimEntity {
  return {
    kind: 0,
    faction: 0,
    homeX: 0,
    homeZ: 0,
    x: 0,
    z: 0,
    heading: 0,
    anim: 0,
    radius: 0,
    speed: 0,
    phase: 0,
  };
}

export class Simulation {
  /** Reused entity records. `live` is the active count; the rest stay pooled. */
  private readonly pool: SimEntity[] = [];
  private live = 0;
  private tick = 0;
  private simTimeMs = 0;
  private rng: () => number = () => 0.5;
  private cpuSink = 0;

  init(seed: number, counts: SimCounts, concentrate: boolean, freezeMotion = false): void {
    this.rng = createMulberry32(seed >>> 0);
    this.tick = 0;
    this.simTimeMs = 0;
    this.live = 0;
    this.spawn(counts.combat, ENTITY_KIND.combat, concentrate, freezeMotion ? 0 : 1.7, freezeMotion ? 0 : 0.22);
    this.spawn(counts.workers, ENTITY_KIND.worker, concentrate, freezeMotion ? 0 : 1.1, freezeMotion ? 0 : 0.28);
    this.spawn(counts.buildings, ENTITY_KIND.building, true, 0, 0);
    this.spawn(counts.props, ENTITY_KIND.prop, false, 0, 0);
  }

  getLiveCount(): number {
    return this.live;
  }

  getPoolCapacity(): number {
    return this.pool.length;
  }

  getCounts(): SimCounts {
    const counts: SimCounts = { combat: 0, workers: 0, buildings: 0, props: 0 };
    for (let i = 0; i < this.live; i += 1) {
      const entity = this.pool[i];
      if (!entity) {
        continue;
      }
      if (entity.kind === ENTITY_KIND.combat) {
        counts.combat += 1;
      } else if (entity.kind === ENTITY_KIND.worker) {
        counts.workers += 1;
      } else if (entity.kind === ENTITY_KIND.building) {
        counts.buildings += 1;
      } else {
        counts.props += 1;
      }
    }
    return counts;
  }

  step(dtMs: number): { tickDurationMs: number } {
    const started = nowMs();
    const dt = dtMs / 1000;
    this.tick += 1;
    this.simTimeMs += dtMs;
    for (let i = 0; i < this.live; i += 1) {
      const entity = this.pool[i];
      if (!entity) {
        continue;
      }
      if (entity.speed <= 0) {
        entity.anim = (entity.anim + dt * 0.6) % 1;
        continue;
      }
      entity.phase += dt * entity.speed;
      const orbit = entity.radius;
      const angle = entity.phase;
      entity.x = wrap(entity.homeX + Math.cos(angle) * orbit);
      entity.z = wrap(entity.homeZ + Math.sin(angle) * orbit);
      entity.heading = angle + Math.PI / 2;
      entity.anim = (entity.anim + dt * (1.6 + entity.speed)) % 1;
    }
    // Lightweight deterministic CPU work so the worker is not empty.
    let acc = 0;
    for (let i = 0; i < this.live; i += 1) {
      const entity = this.pool[i];
      if (!entity) {
        continue;
      }
      acc += entity.x * 0.0001 + entity.z * 0.0001;
    }
    this.cpuSink = acc;
    return { tickDurationMs: nowMs() - started };
  }

  writeSnapshot(target: Float32Array): void {
    for (let i = 0; i < this.live; i += 1) {
      const entity = this.pool[i];
      if (!entity) {
        continue;
      }
      const o = i * SNAPSHOT_STRIDE;
      target[o] = entity.x;
      target[o + 1] = entity.z;
      target[o + 2] = entity.heading;
      target[o + 3] = entity.anim;
      target[o + 4] = entity.kind;
      target[o + 5] = entity.faction;
      target[o + 6] = entity.radius;
      target[o + 7] = entity.speed;
    }
  }

  getTick(): number {
    return this.tick;
  }

  getSimTimeMs(): number {
    return this.simTimeMs;
  }

  requiredPayloadLength(counts = this.getCounts()): number {
    return totalEntities(counts) * SNAPSHOT_STRIDE;
  }

  private spawn(
    count: number,
    kind: number,
    concentrate: boolean,
    radius: number,
    speed: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const clustered = concentrate || kind !== ENTITY_KIND.prop;
      const x = clustered
        ? DENSE_ORIGIN_X + this.rng() * DENSE_SPAN
        : 4 + this.rng() * (MAP_CELLS - 8);
      const z = clustered
        ? DENSE_ORIGIN_Z + this.rng() * DENSE_SPAN
        : 4 + this.rng() * (MAP_CELLS - 8);
      const faction =
        kind === ENTITY_KIND.prop
          ? FACTION.neutral
          : this.rng() < 0.55
            ? FACTION.friendly
            : FACTION.opposing;
      const homeX = x * CELL_SIZE;
      const homeZ = z * CELL_SIZE;
      const entity = this.pool[this.live] ?? (this.pool[this.live] = emptyEntity());
      entity.kind = kind;
      entity.faction = faction;
      entity.homeX = homeX;
      entity.homeZ = homeZ;
      entity.x = homeX;
      entity.z = homeZ;
      entity.heading = this.rng() * Math.PI * 2;
      entity.anim = this.rng();
      entity.radius =
        kind === ENTITY_KIND.building || kind === ENTITY_KIND.prop ? 0 : radius * (0.7 + this.rng() * 0.8);
      entity.speed =
        kind === ENTITY_KIND.building || kind === ENTITY_KIND.prop ? 0 : speed * (0.65 + this.rng() * 0.7);
      entity.phase = this.rng() * Math.PI * 2;
      this.live += 1;
    }
  }
}

function wrap(value: number): number {
  const max = MAP_CELLS * CELL_SIZE;
  if (value < 1) {
    return 1;
  }
  if (value > max - 1) {
    return max - 1;
  }
  return value;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
