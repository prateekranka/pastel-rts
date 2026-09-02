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

  it('accepts every coarse JS→native and native→JS message', () => {
    expect(
      validateJsToNative({
        type: 'requestHaptic',
        payload: { style: 'light', reason: 'selection' },
      }),
    ).toEqual({
      type: 'requestHaptic',
      payload: { style: 'light', reason: 'selection' },
    });
    expect(
      validateJsToNative({
        type: 'requestHaptic',
        payload: { style: 'medium', reason: 'move' },
      }).type,
    ).toBe('requestHaptic');
    expect(
      validateJsToNative({
        type: 'performanceReport',
        payload: { schemaVersion: 1 },
      }).type,
    ).toBe('performanceReport');
    const runtimeError = validateJsToNative({
      type: 'runtimeError',
      payload: { message: 'boom', stack: 'trace' },
    });
    expect(runtimeError.type).toBe('runtimeError');
    if (runtimeError.type === 'runtimeError') {
      expect(runtimeError.payload.message).toBe('boom');
    }
    expect(validateNativeToJs({ type: 'pause' }).type).toBe('pause');
    expect(validateNativeToJs({ type: 'resume' }).type).toBe('resume');
    expect(
      validateNativeToJs({
        type: 'setDeveloperConfiguration',
        payload: { renderer: 'webgpu', haptics: false },
      }).type,
    ).toBe('setDeveloperConfiguration');
  });
});
