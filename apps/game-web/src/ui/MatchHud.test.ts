// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MatchHud, aggregateSelection } from './MatchHud';
import { assertTouchTarget } from './touchTargets';
import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';

describe('MatchHud', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders army rail aggregates and keeps 44pt stop target', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const hud = new MatchHud(host);
    const root = hud.getElement();
    const stopBtn = root.querySelector('[data-action="stop"]') as HTMLButtonElement;
    const selectBtn = root.querySelector('[data-action="select-mode"]') as HTMLButtonElement;
    const formation = root.querySelector('[data-role="formation"]') as HTMLSelectElement;
    expect(assertTouchTarget(stopBtn)).toBe(true);
    expect(assertTouchTarget(selectBtn)).toBe(true);
    expect(assertTouchTarget(formation)).toBe(true);

    hud.render({
      aggregates: [{ archetypeId: 'spear', count: 3 }],
      totalSelected: 3,
      formationKind: 'line',
      selectModeActive: false,
    });
    expect(hud.getElement().textContent).toContain('spear ×3');
    expect(hud.getElement().textContent).toContain('3');
    hud.dispose();
  });

  it('aggregateSelection groups large selections by archetype', () => {
    const entities = [
      { id: { index: 0, generation: 1 }, archetypeId: 'spear' },
      { id: { index: 1, generation: 1 }, archetypeId: 'spear' },
      { id: { index: 2, generation: 1 }, archetypeId: 'bow' },
      { id: { index: 0, generation: 2 }, archetypeId: 'spear' },
    ];
    const selected = [
      { index: 0, generation: 1 },
      { index: 1, generation: 1 },
      { index: 2, generation: 1 },
    ];
    expect(aggregateSelection(entities, selected)).toEqual([
      { archetypeId: 'spear', count: 2 },
      { archetypeId: 'bow', count: 1 },
    ]);
  });
});

describe('touch targets', () => {
  it('minimum touch target is 44 CSS points', () => {
    expect(MIN_TOUCH_TARGET_CSS).toBe(44);
  });
});
