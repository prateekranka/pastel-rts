import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { IsometricCamera } from '../camera/IsometricCamera';
import { TerrainSystem } from './TerrainSystem';
import { TOTAL_CHUNKS } from './chunks';

describe('terrain chunk lifecycle', () => {
  it('allocates 100 chunk meshes, culls by ground AABB, and disposes GPU resources', () => {
    const scene = new Scene();
    const terrain = new TerrainSystem(scene, 1);
    expect(terrain.getTotalChunks()).toBe(TOTAL_CHUNKS);
    expect(scene.children.length).toBe(TOTAL_CHUNKS);

    const camera = new IsometricCamera();
    camera.setViewport(1280, 800);
    camera.applyNamedPreset('70-percent');
    camera.setLookAt(80, 80);
    terrain.updateVisibility(camera);
    expect(terrain.getVisibleChunkCount()).toBeGreaterThan(0);
    expect(terrain.getVisibleChunkCount()).toBeLessThan(TOTAL_CHUNKS);

    terrain.dispose();
    expect(terrain.getTotalChunks()).toBe(0);
    expect(scene.children.length).toBe(0);
  });
});
