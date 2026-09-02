import { describe, expect, it } from 'vitest';
import { ZOOM_STOPS } from '../config/constants';
import { IsometricCamera } from '../camera/IsometricCamera';

describe('zoom stops', () => {
  it('settles to the nearest named stop after a free zoom', () => {
    const camera = new IsometricCamera();
    camera.setViewport(1280, 800);
    camera.setVisibleCellsX(46);
    camera.settleToNearestStop();
    expect(camera.nearestZoomStop()).toBe('70-percent');
    expect(camera.getVisibleCellsX()).toBe(
      ZOOM_STOPS.find((stop) => stop.name === '70-percent')?.visibleCellsX,
    );
  });
});
