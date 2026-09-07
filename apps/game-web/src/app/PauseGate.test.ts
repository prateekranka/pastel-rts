import { describe, expect, it } from 'vitest';
import { PauseGate, shouldResetFrameClock } from './PauseGate';

describe('PauseGate', () => {
  it('native pause then background pause then background resume stays paused until native resume', () => {
    const gate = new PauseGate();
    expect(gate.pause('native')).toBe('paused');
    expect(gate.pause('background')).toBe('held');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('background')).toBe('held');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('native')).toBe('resumed');
    expect(gate.isPaused()).toBe(false);
  });

  it('background-only pause and resume works', () => {
    const gate = new PauseGate();
    expect(gate.pause('background')).toBe('paused');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('background')).toBe('resumed');
    expect(gate.isPaused()).toBe(false);
  });

  it('native-only pause and resume works', () => {
    const gate = new PauseGate();
    expect(gate.pause('native')).toBe('paused');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('native')).toBe('resumed');
    expect(gate.isPaused()).toBe(false);
  });

  it('duplicate pause of the same reason is held', () => {
    const gate = new PauseGate();
    expect(gate.pause('native')).toBe('paused');
    expect(gate.pause('native')).toBe('held');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('native')).toBe('resumed');
    expect(gate.isPaused()).toBe(false);
  });

  it('resume of a reason that was never paused is idle when not paused', () => {
    const gate = new PauseGate();
    expect(gate.resume('native')).toBe('idle');
    expect(gate.isPaused()).toBe(false);
  });

  it('resume of a reason that was never paused is held when another reason remains', () => {
    const gate = new PauseGate();
    expect(gate.pause('native')).toBe('paused');
    expect(gate.resume('background')).toBe('held');
    expect(gate.isPaused()).toBe(true);
  });

  it('has() reflects held reasons', () => {
    const gate = new PauseGate();
    expect(gate.has('native')).toBe(false);
    expect(gate.has('background')).toBe(false);
    gate.pause('native');
    expect(gate.has('native')).toBe(true);
    expect(gate.has('background')).toBe(false);
    gate.pause('background');
    expect(gate.has('background')).toBe(true);
    gate.resume('native');
    expect(gate.has('native')).toBe(false);
    expect(gate.has('background')).toBe(true);
  });

  it('resets the frame clock on a true resume and on a held background resume', () => {
    expect(shouldResetFrameClock('resumed', 'native')).toBe(true);
    expect(shouldResetFrameClock('resumed', 'background')).toBe(true);
    expect(shouldResetFrameClock('held', 'background')).toBe(true);
    expect(shouldResetFrameClock('held', 'native')).toBe(false);
    expect(shouldResetFrameClock('idle', 'native')).toBe(false);
    expect(shouldResetFrameClock('idle', 'background')).toBe(true);
  });

  it('background then native stays paused until background resume', () => {
    const gate = new PauseGate();
    expect(gate.pause('background')).toBe('paused');
    expect(gate.pause('native')).toBe('held');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('native')).toBe('held');
    expect(gate.isPaused()).toBe(true);
    expect(gate.resume('background')).toBe('resumed');
    expect(gate.isPaused()).toBe(false);
  });
});
