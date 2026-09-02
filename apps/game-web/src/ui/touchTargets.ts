import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';

/** Ensures an element meets the minimum 44×44 CSS point touch target. */
export function applyTouchTargetSize(element: HTMLElement, sizeCss = MIN_TOUCH_TARGET_CSS): void {
  element.style.minWidth = `${sizeCss}px`;
  element.style.minHeight = `${sizeCss}px`;
}

/** Returns true when the event target is inside a match HUD or minimap region. */
export function isMatchUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('.pastel-match-hud, .pastel-minimap, .pastel-lab-tools'));
}

export function assertTouchTarget(element: HTMLElement): boolean {
  const style = element.style;
  const minW = Number.parseFloat(style.minWidth);
  const minH = Number.parseFloat(style.minHeight);
  if (Number.isFinite(minW) && Number.isFinite(minH)) {
    return minW >= MIN_TOUCH_TARGET_CSS && minH >= MIN_TOUCH_TARGET_CSS;
  }
  const rect = element.getBoundingClientRect();
  return rect.width >= MIN_TOUCH_TARGET_CSS && rect.height >= MIN_TOUCH_TARGET_CSS;
}
