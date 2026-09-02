import { describe, expect, it } from 'vitest';
import { validateJsToNative, validateNativeToJs } from './messages';

describe('native bridge validation', () => {
  it('accepts a well-formed gameReady message', () => {
    const message = validateJsToNative({
      type: 'gameReady',
      payload: { renderer: 'webgl', viewport: { width: 1280, height: 800 } },
    });
    expect(message.type).toBe('gameReady');
  });

  it('rejects malformed payloads', () => {
    expect(() => validateJsToNative({ type: 'gameReady', payload: { renderer: 'webgl' } })).toThrow();
    expect(() => validateJsToNative({ type: 'requestHaptic', payload: { style: 'nuke' } })).toThrow();
    expect(() => validateJsToNative({ type: 'perFrameEntities', payload: {} })).toThrow();
    expect(() => validateNativeToJs({ type: 'explode' })).toThrow();
    expect(() => validateNativeToJs({ type: 'setDeveloperConfiguration' })).toThrow();
  });
});
