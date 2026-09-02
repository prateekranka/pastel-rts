import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  Scene,
  WireframeGeometry,
} from 'three';
import type { NavDebugSnapshot } from '@pastel-rts/navigation';
import { CELL_SIZE, MAP_CELLS } from '../config/constants';
import type { DebugOverlayFlags } from './types';

/** Draws cached nav debug payloads from the worker — no pathfinding on main thread. */
export class NavigationDebugRenderer {
  private readonly scene: Scene;
  private readonly group = new Group();
  private readonly pathMaterial = new LineBasicMaterial({ color: 0x44ff88, linewidth: 1 });
  private readonly blockedMaterial = new MeshBasicMaterial({
    color: 0xff4444,
    transparent: true,
    opacity: 0.25,
    side: DoubleSide,
    depthWrite: false,
  });
  private flags: DebugOverlayFlags;
  private lastSnapshot: NavDebugSnapshot | null = null;

  constructor(scene: Scene, flags: DebugOverlayFlags) {
    this.scene = scene;
    this.flags = flags;
    this.group.name = 'nav-debug';
    this.scene.add(this.group);
  }

  setFlags(flags: DebugOverlayFlags): void {
    this.flags = flags;
    this.rebuild();
  }

  update(snapshot: NavDebugSnapshot | null): void {
    this.lastSnapshot = snapshot;
    this.rebuild();
  }

  dispose(): void {
    this.clearGroup();
    this.scene.remove(this.group);
    this.pathMaterial.dispose();
    this.blockedMaterial.dispose();
  }

  private rebuild(): void {
    this.clearGroup();
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }
    if (this.flags.paths) {
      this.drawPaths(snapshot);
    }
    if (this.flags.staticBlockers || this.flags.dynamicBlockers || this.flags.navCells) {
      this.drawBlocked(snapshot);
    }
  }

  private drawPaths(snapshot: NavDebugSnapshot): void {
    for (const path of snapshot.paths) {
      if (path.cells.length < 2) {
        continue;
      }
      const points: number[] = [];
      for (const cell of path.cells) {
        points.push(cell.cx + 0.5, 0.05, cell.cz + 0.5);
      }
      const geometry = new WireframeGeometry(new BoxGeometry(0.01, 0.01, 0.01));
      void geometry;
      const positions = new Float32Array(points.length);
      for (let i = 0; i < path.cells.length; i += 1) {
        const cell = path.cells[i]!;
        positions[i * 3] = (cell.cx + 0.5) * CELL_SIZE;
        positions[i * 3 + 1] = 0.08;
        positions[i * 3 + 2] = (cell.cz + 0.5) * CELL_SIZE;
      }
      const lineGeom = new WireframeGeometry(new BoxGeometry(0.2, 0.02, 0.2));
      void lineGeom;
      const material = this.pathMaterial.clone();
      material.color = new Color(0x44ff88);
      for (let i = 0; i < path.cells.length - 1; i += 1) {
        const a = path.cells[i]!;
        const b = path.cells[i + 1]!;
        const seg = new LineSegments(
          new WireframeGeometry(new BoxGeometry(Math.abs(b.cx - a.cx) + 0.2, 0.02, Math.abs(b.cz - a.cz) + 0.2)),
          material,
        );
        seg.position.set((a.cx + b.cx) / 2 + 0.5, 0.06, (a.cz + b.cz) / 2 + 0.5);
        this.group.add(seg);
      }
    }
  }

  private drawBlocked(snapshot: NavDebugSnapshot): void {
    const side = Math.sqrt(snapshot.blocked.length);
    const cells = side > 0 ? side : MAP_CELLS;
    for (let cz = 0; cz < cells; cz += 1) {
      for (let cx = 0; cx < cells; cx += 1) {
        const index = cz * cells + cx;
        if ((snapshot.blocked[index] ?? 0) === 0) {
          continue;
        }
        const mesh = new Mesh(new BoxGeometry(CELL_SIZE * 0.95, 0.04, CELL_SIZE * 0.95), this.blockedMaterial);
        mesh.position.set(cx + 0.5, 0.02, cz + 0.5);
        this.group.add(mesh);
      }
    }
  }

  private clearGroup(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0]!;
      this.group.remove(child);
      if ('geometry' in child) {
        const geometry = (child as { geometry?: { dispose: () => void } }).geometry;
        geometry?.dispose();
      }
      if ('material' in child) {
        const mat = (child as { material?: Material | Material[] }).material;
        if (Array.isArray(mat)) {
          mat.forEach((entry) => entry.dispose());
        } else {
          mat?.dispose();
        }
      }
    }
  }
}
