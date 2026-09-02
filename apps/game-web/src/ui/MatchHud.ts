import type { MoveFormationKind } from '@pastel-rts/content-schema';
import { MIN_TOUCH_TARGET_CSS } from '../input/gestureConstants';
import type { ArchetypeAggregate } from '../selection/types';
import { applyTouchTargetSize } from './touchTargets';

export type MatchHudHandlers = {
  onStop: () => void;
  onFormationChange: (kind: MoveFormationKind) => void;
  onSelectModeToggle: () => void;
};

export type MatchHudModel = {
  aggregates: ArchetypeAggregate[];
  totalSelected: number;
  formationKind: MoveFormationKind;
  selectModeActive: boolean;
};

const MATCH_HUD_STYLES = `
.pastel-match-hud {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.pastel-match-hud-rail {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(180deg, rgba(12, 36, 40, 0.0), rgba(12, 36, 40, 0.88));
  pointer-events: auto;
}
.pastel-match-hud-counts {
  display: flex;
  flex: 1;
  gap: 6px;
  overflow-x: auto;
}
.pastel-match-hud-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: ${MIN_TOUCH_TARGET_CSS}px;
  padding: 0 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: #e8f4f2;
  font-size: 13px;
}
.pastel-match-hud-btn,
.pastel-match-hud-select {
  pointer-events: auto;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: #e8f4f2;
  font-size: 13px;
  cursor: pointer;
}
.pastel-match-hud-btn:active,
.pastel-match-hud-select:active {
  background: rgba(255, 255, 255, 0.2);
}
.pastel-match-hud-select {
  padding: 0 8px;
}
.pastel-match-hud-total {
  min-width: ${MIN_TOUCH_TARGET_CSS}px;
  min-height: ${MIN_TOUCH_TARGET_CSS}px;
  display: grid;
  place-items: center;
  font-weight: 600;
}
`;

/**
 * Compact bottom Army Rail with archetype counts, stop, and formation controls.
 */
export class MatchHud {
  private readonly root: HTMLDivElement;
  private readonly counts: HTMLDivElement;
  private readonly total: HTMLSpanElement;
  private readonly formationSelect: HTMLSelectElement;
  private readonly selectModeBtn: HTMLButtonElement;
  private handlers: MatchHudHandlers | null = null;

  constructor(host: HTMLElement) {
    this.ensureStyles();
    this.root = document.createElement('div');
    this.root.className = 'pastel-match-hud';
    this.root.innerHTML = `
      <div class="pastel-match-hud-rail">
        <span class="pastel-match-hud-total pastel-match-hud-chip" data-role="total">0</span>
        <div class="pastel-match-hud-counts" data-role="counts"></div>
        <select class="pastel-match-hud-select" data-role="formation" aria-label="Formation">
          <option value="none">Formation: none</option>
          <option value="line">Formation: line</option>
          <option value="box">Formation: box</option>
        </select>
        <button type="button" class="pastel-match-hud-btn" data-action="select-mode">Select</button>
        <button type="button" class="pastel-match-hud-btn" data-action="stop">Stop</button>
      </div>
    `;
    host.appendChild(this.root);

    this.counts = this.root.querySelector('[data-role="counts"]') as HTMLDivElement;
    this.total = this.root.querySelector('[data-role="total"]') as HTMLSpanElement;
    this.formationSelect = this.root.querySelector('[data-role="formation"]') as HTMLSelectElement;
    this.selectModeBtn = this.root.querySelector('[data-action="select-mode"]') as HTMLButtonElement;
    const stopBtn = this.root.querySelector('[data-action="stop"]') as HTMLButtonElement;

    applyTouchTargetSize(stopBtn);
    applyTouchTargetSize(this.selectModeBtn);
    applyTouchTargetSize(this.formationSelect);

    this.formationSelect.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.formationSelect.addEventListener('change', () => {
      this.handlers?.onFormationChange(this.formationSelect.value as MoveFormationKind);
    });
    stopBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
    stopBtn.addEventListener('click', () => this.handlers?.onStop());
    this.selectModeBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.selectModeBtn.addEventListener('click', () => this.handlers?.onSelectModeToggle());
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  setHandlers(handlers: MatchHudHandlers): void {
    this.handlers = handlers;
  }

  render(model: MatchHudModel): void {
    this.total.textContent = String(model.totalSelected);
    this.counts.replaceChildren();
    for (const aggregate of model.aggregates) {
      const chip = document.createElement('span');
      chip.className = 'pastel-match-hud-chip';
      chip.textContent = `${aggregate.archetypeId} ×${aggregate.count}`;
      this.counts.appendChild(chip);
    }
    this.formationSelect.value = model.formationKind;
    this.selectModeBtn.textContent = model.selectModeActive ? 'Selecting' : 'Select';
  }

  getElement(): HTMLElement {
    return this.root;
  }

  dispose(): void {
    this.root.remove();
  }

  private ensureStyles(): void {
    if (document.getElementById('pastel-match-hud-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'pastel-match-hud-styles';
    style.textContent = MATCH_HUD_STYLES;
    document.head.appendChild(style);
  }
}

export function aggregateSelection(
  entities: ReadonlyArray<{ id: { index: number }; archetypeId: string }>,
  selected: ReadonlyArray<{ index: number }>,
): ArchetypeAggregate[] {
  const selectedSet = new Set(selected.map((id) => id.index));
  const counts = new Map<string, number>();
  for (const entity of entities) {
    if (!selectedSet.has(entity.id.index)) {
      continue;
    }
    counts.set(entity.archetypeId, (counts.get(entity.archetypeId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([archetypeId, count]) => ({ archetypeId, count }));
}
