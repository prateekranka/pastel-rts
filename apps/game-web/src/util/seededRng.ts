/** Mulberry32 — tiny deterministic RNG. */
export function createMulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, z: number, seed: number): number {
  let n = Math.imul(x + seed, 374761393) + Math.imul(z, 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function hash3(x: number, z: number, k: number, seed: number): number {
  return hash2(x * 73856093 ^ k, z * 19349663 ^ k, seed);
}
