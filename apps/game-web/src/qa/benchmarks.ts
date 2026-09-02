/** M1 benchmark presets as data (not wired to GameApp benchmark mode). */
export type M1BenchmarkPreset = {
  id: string;
  displayName: string;
  description: string;
  unitCount: number;
  formationSize?: number;
  dynamicBlockers?: number;
  animationStress?: boolean;
};

export const M1_BENCHMARK_PRESETS: readonly M1BenchmarkPreset[] = [
  {
    id: '120-unit-crossing',
    displayName: '120-unit crossing',
    description: 'Dense unit stream crossing map center with nav replans',
    unitCount: 120,
  },
  {
    id: '40-unit-formation',
    displayName: '40-unit formation',
    description: 'Line formation move with distinct slot spacing',
    unitCount: 40,
    formationSize: 40,
  },
  {
    id: 'dynamic-blocker-replan',
    displayName: 'Dynamic blocker replan',
    description: 'Units reroute when buildings placed on active paths',
    unitCount: 24,
    dynamicBlockers: 3,
  },
  {
    id: 'selection-stress',
    displayName: 'Selection stress',
    description: 'Rapid lasso and tap selection on mixed unit groups',
    unitCount: 80,
  },
  {
    id: 'animation-stress',
    displayName: 'Animation stress',
    description: 'Mixed idle/move directional sprites under camera pan',
    unitCount: 64,
    animationStress: true,
  },
] as const;

export function getBenchmarkPreset(id: string): M1BenchmarkPreset | undefined {
  return M1_BENCHMARK_PRESETS.find((preset) => preset.id === id);
}
