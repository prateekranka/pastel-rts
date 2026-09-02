/** 1 map cell = 1024 subunits. Sim and nav use integers only. */
export const SUBUNITS_PER_CELL = 1024;

/** Monotonic simulation tick. Incremented once per 50 ms step. 0 before the first step. */
export type Tick = number;

export type CellCoord = {
  cx: number;
  cz: number;
};

export type SubunitCoord = {
  x: number;
  z: number;
};

export function subunitToWorldFloat(subunit: number): number {
  return subunit / SUBUNITS_PER_CELL;
}

export function worldFloatToSubunit(world: number): number {
  return Math.round(world * SUBUNITS_PER_CELL);
}

export function subunitToCell(subunit: number): number {
  return Math.floor(subunit / SUBUNITS_PER_CELL);
}
