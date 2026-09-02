import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { LandmarkSystem } from '../world/LandmarkSystem';

describe('render resource disposal', () => {
  it('removes landmark instanced meshes on dispose', () => {
    const scene = new Scene();
    const landmarks = new LandmarkSystem(scene, 3);
    expect(scene.children.length).toBe(1);
    landmarks.dispose();
    expect(scene.children.length).toBe(0);
  });
});
