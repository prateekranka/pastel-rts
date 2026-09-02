import type { TouchDebugSnapshot } from './PointerCameraControls';

export class TouchDebugOverlay {
  private readonly root: HTMLDivElement;
  private visible = false;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'pastel-touch-debug';
    this.root.style.cssText = [
      'position:absolute',
      'left:12px',
      'bottom:12px',
      'max-width:min(360px,92vw)',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(12,28,30,0.82)',
      'color:#f2e6d0',
      'font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      'white-space:pre-wrap',
      'display:none',
      'pointer-events:none',
    ].join(';');
    host.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(snapshot: TouchDebugSnapshot): void {
    if (!this.visible) {
      return;
    }
    const pointers = snapshot.pointers
      .map((pointer) => `#${pointer.id} ${pointer.type} (${pointer.x.toFixed(0)},${pointer.y.toFixed(0)})`)
      .join('\n  ');
    this.root.textContent = [
      `gesture: ${snapshot.gesture}`,
      `lookAt: ${snapshot.lookAtX.toFixed(2)}, ${snapshot.lookAtZ.toFixed(2)}`,
      `zoom: ${snapshot.zoomCells.toFixed(1)} cells (${snapshot.zoomStop})`,
      `pan Δ: ${snapshot.recentPanDelta.x.toFixed(3)}, ${snapshot.recentPanDelta.z.toFixed(3)}`,
      `pinch scale: ${snapshot.recentPinchScale.toFixed(3)}`,
      `pointers (${snapshot.pointers.length}):`,
      `  ${pointers || 'none'}`,
    ].join('\n');
  }

  dispose(): void {
    this.root.remove();
  }
}
