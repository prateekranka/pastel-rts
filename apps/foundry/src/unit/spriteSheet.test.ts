import { describe, expect, it } from 'vitest';
import { chooseBestSheetConfig } from './spriteSheet';

describe('sprite sheet inference', () => {
  it('chooses the authored 32px grid for the 128x256 fixture sheet', () => {
    const config = chooseBestSheetConfig(128, 256);

    expect(config.layout).toBe('grid');
    expect(config.frameWidth).toBe(32);
    expect(config.frameHeight).toBe(32);
    expect(config.columns).toBe(4);
    expect(config.rows).toBe(8);
  });

  it('keeps a square upload as one explicit frame until the author chooses a grid', () => {
    const config = chooseBestSheetConfig(64, 64);

    expect(config.layout).toBe('single');
    expect(config.frameWidth).toBe(64);
    expect(config.frameHeight).toBe(64);
    expect(config.columns).toBe(1);
    expect(config.rows).toBe(1);
  });
});
