import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';

export type TouchTargetDebugOptions = {
  /** CSS color for the debug outline. */
  color?: string;
};

/**
 * Dev-only overlay that outlines interactive regions to verify 44×44pt targets.
 */
export class TouchTargetDebug {
  private readonly layer: HTMLDivElement;
  private enabled = false;

  constructor(host: HTMLElement, options: TouchTargetDebugOptions = {}) {
    const color = options.color ?? 'rgba(127, 212, 195, 0.55)';
    this.layer = document.createElement('div');
    this.layer.className = 'pastel-touch-target-debug';
    this.layer.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 30;
      display: none;
    `;
    host.appendChild(this.layer);
    this.layer.dataset['color'] = color;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.layer.style.display = enabled ? 'block' : 'none';
    if (!enabled) {
      this.layer.replaceChildren();
    }
  }

  /** Outlines an element if it is smaller than the minimum touch target. */
  highlight(element: HTMLElement): void {
    if (!this.enabled) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const box = document.createElement('div');
    const size = Math.max(rect.width, rect.height, MIN_TOUCH_TARGET_CSS);
    box.style.cssText = `
      position: fixed;
      left: ${rect.left + rect.width / 2 - size / 2}px;
      top: ${rect.top + rect.height / 2 - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      border: 1px dashed ${this.layer.dataset['color'] ?? 'rgba(127,212,195,0.55)'};
      border-radius: 6px;
      box-sizing: border-box;
    `;
    this.layer.appendChild(box);
  }

  clear(): void {
    this.layer.replaceChildren();
  }

  dispose(): void {
    this.layer.remove();
  }
}
