import { MAP_WORLD_SIZE, SOAK_CAMERA_PERIOD_MS } from '../config/constants';
import type { IsometricCamera } from '../camera/IsometricCamera';

/** Periodic camera motion for pan-stress and soak presets. No user input required. */
export class CameraDirector {
  private elapsed = 0;
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  reset(): void {
    this.elapsed = 0;
  }

  update(dtMs: number, camera: IsometricCamera): void {
    if (!this.enabled) {
      return;
    }
    this.elapsed += dtMs;
    const t = (this.elapsed % SOAK_CAMERA_PERIOD_MS) / SOAK_CAMERA_PERIOD_MS;
    const angle = t * Math.PI * 2;
    const radius = 18;
    camera.setLookAt(
      MAP_WORLD_SIZE * 0.52 + Math.cos(angle) * radius,
      MAP_WORLD_SIZE * 0.48 + Math.sin(angle) * radius * 0.7,
    );
  }
}
