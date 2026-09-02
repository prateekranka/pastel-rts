/** Deterministic seeds for M1 Playwright and vitest coverage. */
export const M1_DETERMINISTIC_SEEDS = {
  interactionLab: 42,
  visualCapture: 7,
  replay: 1001,
  spawnTest: 314,
} as const;

export type M1SeedKey = keyof typeof M1_DETERMINISTIC_SEEDS;

export function seedFor(key: M1SeedKey): number {
  return M1_DETERMINISTIC_SEEDS[key];
}
