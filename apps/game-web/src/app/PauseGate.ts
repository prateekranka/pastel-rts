export type PauseReason = 'native' | 'background';

export type PauseTransition = 'paused' | 'held';
export type ResumeTransition = 'resumed' | 'held' | 'idle';

export class PauseGate {
  private readonly reasons = new Set<PauseReason>();

  pause(reason: PauseReason): PauseTransition {
    const wasPaused = this.reasons.size > 0;
    this.reasons.add(reason);
    return wasPaused ? 'held' : 'paused';
  }

  resume(reason: PauseReason): ResumeTransition {
    if (!this.reasons.has(reason)) {
      return this.reasons.size > 0 ? 'held' : 'idle';
    }
    this.reasons.delete(reason);
    return this.reasons.size > 0 ? 'held' : 'resumed';
  }

  isPaused(): boolean {
    return this.reasons.size > 0;
  }

  has(reason: PauseReason): boolean {
    return this.reasons.has(reason);
  }
}

/** Drop the rAF gap after a true resume, and after a visibility resume that
 *  stays held by another reason. Browsers freeze rAF while hidden; the next
 *  tick would otherwise sample a multi-second dt into FrameTracker. */
export function shouldResetFrameClock(transition: ResumeTransition, reason: PauseReason): boolean {
  return transition === 'resumed' || reason === 'background';
}
