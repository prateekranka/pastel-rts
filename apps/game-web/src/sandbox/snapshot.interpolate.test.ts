import { describe, expect, it } from 'vitest';
import { INTERACTION_SNAPSHOT_STRIDE, interpolateSnapshotRows } from './snapshot';

function row(
  payload: Float32Array,
  index: number,
  values: { x: number; z: number; idIndex: number; generation: number },
): void {
  const offset = index * INTERACTION_SNAPSHOT_STRIDE;
  payload[offset] = values.x;
  payload[offset + 1] = values.z;
  payload[offset + 6] = values.idIndex;
  payload[offset + 7] = values.generation;
}

describe('interpolateSnapshotRows', () => {
  it('matches rows by entity id rather than array index', () => {
    const prev = new Float32Array(2 * INTERACTION_SNAPSHOT_STRIDE);
    const curr = new Float32Array(2 * INTERACTION_SNAPSHOT_STRIDE);
    const out = new Float32Array(2 * INTERACTION_SNAPSHOT_STRIDE);
    row(prev, 0, { x: 0, z: 0, idIndex: 0, generation: 1 });
    row(prev, 1, { x: 10, z: 10, idIndex: 1, generation: 1 });
    row(curr, 0, { x: 20, z: 20, idIndex: 1, generation: 1 });
    row(curr, 1, { x: 4, z: 4, idIndex: 2, generation: 1 });
    interpolateSnapshotRows(out, prev, curr, 2, 2, 0.5);
    expect(out[0]).toBeCloseTo(15);
    expect(out[1]).toBeCloseTo(15);
    expect(out[INTERACTION_SNAPSHOT_STRIDE]).toBeCloseTo(4);
    expect(out[INTERACTION_SNAPSHOT_STRIDE + 1]).toBeCloseTo(4);
  });
});
