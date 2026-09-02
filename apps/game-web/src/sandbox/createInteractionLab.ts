import type { Scene } from 'three';
import type { CommandResult, MapDef, MoveFormation, MoveFormationKind, PackV2 } from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { runSimulationReplay } from '@pastel-rts/simulation';
import { MatchRuntime } from '../app/MatchRuntime';
import type { IsometricCamera } from '../camera/IsometricCamera';
import { CommandClient } from '../input/CommandClient';
import { InteractionController } from '../input/InteractionController';
import type { PointerCameraControls } from '../input/PointerCameraControls';
import { SelectionController } from '../selection/SelectionController';
import { HitTestService } from '../selection/HitTestService';
import type { PickableEntity } from '../selection/types';
import { MatchHud, aggregateSelection } from '../ui/MatchHud';
import { Minimap, buildMinimapMarkers, minimapModelFromCamera } from '../ui/Minimap';
import { isMatchUiTarget } from '../ui/touchTargets';
import { BuildingRenderSystem } from '../buildings/BuildingRenderSystem';
import { validateBuildingPlacement } from '../buildings/placementValidation';
import { DebugOverlayState } from '../qa/DebugOverlayState';
import { seedFor } from '../qa/deterministicSeeds';
import { EntityRegistry } from './EntityRegistry';
import { NavigationDebugRenderer } from './NavigationDebugRenderer';
import { ScenarioController } from './ScenarioController';
import { UnitRenderSystem } from './UnitRenderSystem';
import { BuildingPlacementController } from './placement/BuildingPlacementController';
import { CommandRecorder, ReplayInspector } from './replay/CommandRecorder';
import { SpawnPalette, BuildPalette } from './palettes/SpawnPalette';
import { alienFantasyProtectedCells, INTERACTION_LAB_ALIEN_FANTASY_ID } from './mapPresets';
import {
  entityIdKey,
  parseSnapshotEntity,
  resolveArchetypeId,
  snapshotToPickable,
} from './snapshot';
import { DEFAULT_DEBUG_OVERLAYS } from './types';

export type InteractionLabHapticReason = 'selection' | 'move' | 'place' | 'invalid';

export type InteractionLabOptions = {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: IsometricCamera;
  cameraControls: PointerCameraControls;
  pack: PackV2;
  packBaseUrl?: string;
  hudRoot?: HTMLElement;
  seed?: number;
  scenarioId?: string;
  spawnUnitId?: string;
  spawnBuildingId?: string;
  requestHaptic?: (reason: InteractionLabHapticReason) => void;
  loadScenarioJson?: (path: string) => Promise<unknown>;
  loadMapJson?: (path: string) => Promise<unknown>;
};

export type InteractionLab = {
  runtime: MatchRuntime;
  commandClient: CommandClient;
  interaction: InteractionController;
  selection: SelectionController;
  scenario: ScenarioController;
  units: UnitRenderSystem;
  buildings: BuildingRenderSystem;
  navDebug: NavigationDebugRenderer;
  placement: BuildingPlacementController;
  recorder: CommandRecorder;
  replay: ReplayInspector;
  spawnPalette: SpawnPalette;
  buildPalette: BuildPalette;
  registry: EntityRegistry;
  matchHud: MatchHud | null;
  minimap: Minimap | null;
  debugOverlays: DebugOverlayState;
  ready: Promise<void>;
  tick: () => void;
  dispose: () => void;
  loadScenario: (scenarioId: string) => Promise<void>;
  getPickableEntities: () => readonly PickableEntity[];
  isReady: () => boolean;
};

function isInteractionLabMode(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('mode') === 'interaction-lab';
}

function hapticStyleToReason(style: 'light' | 'medium' | 'heavy'): InteractionLabHapticReason {
  if (style === 'light') {
    return 'selection';
  }
  if (style === 'heavy') {
    return 'invalid';
  }
  return 'move';
}

/** Factory for Milestone 1 interaction sandbox — GameApp calls with one line. */
export function createInteractionLab(options: InteractionLabOptions): InteractionLab {
  const seed = options.seed ?? seedFor('interactionLab');
  const packBaseUrl = options.packBaseUrl ?? './content/dev-pack-v2/';
  const registry = new EntityRegistry();
  const selection = new SelectionController();
  const hitTest = new HitTestService();
  /** Occupancy queries only — never requestPath on the main thread. */
  const previewNav = new NavigationService();
  const protectedCells = alienFantasyProtectedCells();
  const pendingSpawns = new Map<string, { archetypeId: string; kind: 'unit' | 'building' }>();
  let formationKind: MoveFormationKind = 'none';
  let selectModeActive = false;
  let readyResolved = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const recorder = new CommandRecorder();
  recorder.start();

  const units = new UnitRenderSystem({
    scene: options.scene,
    pack: options.pack,
    packBaseUrl,
  });
  const buildings = new BuildingRenderSystem({ scene: options.scene, pack: options.pack });
  const debugOverlays = new DebugOverlayState(DEFAULT_DEBUG_OVERLAYS);
  const navDebug = new NavigationDebugRenderer(options.scene, debugOverlays.getFlags());

  function handleCommandResult(result: CommandResult): void {
    recorder.onResult(result);
    if (result.status === 'accepted' && result.spawnedId) {
      const pending = pendingSpawns.get(result.commandId);
      if (pending) {
        registry.set(result.spawnedId, pending);
        if (pending.kind === 'unit') {
          units.registerEntityArchetype(entityIdKey(result.spawnedId), pending.archetypeId);
        } else {
          buildings.registerEntityArchetype(entityIdKey(result.spawnedId), pending.archetypeId);
        }
        pendingSpawns.delete(result.commandId);
      }
    }
  }

  const runtime = new MatchRuntime({ maxEntities: 512 }, handleCommandResult, (checksums) => {
    recorder.onChecksums(checksums);
    scenario.recordChecksums(checksums);
  });
  const buffer = runtime.createInterpolationBuffer();

  const commandClient = new CommandClient({
    port: {
      postMessage(message) {
        runtime.postCommand(message.envelope);
        recorder.onCommand(message.envelope);
        scenario.recordCommand(message.envelope);
        const payload = message.envelope.payload;
        if (payload.kind === 'spawnUnit') {
          pendingSpawns.set(message.envelope.commandId, {
            archetypeId: payload.archetypeId,
            kind: 'unit',
          });
        }
        if (payload.kind === 'placeBuilding') {
          pendingSpawns.set(message.envelope.commandId, {
            archetypeId: payload.archetypeId,
            kind: 'building',
          });
        }
      },
    },
  });

  const initRuntime = (params: {
    seed: number;
    pack: PackV2;
    scenario?: import('@pastel-rts/content-schema').ScenarioDef;
    map?: MapDef;
  }): void => {
    registry.clear();
    pendingSpawns.clear();
    runtime.reinit({
      type: 'initLab',
      seed: params.seed,
      pack: params.pack,
      ...(params.scenario ? { scenario: params.scenario } : {}),
      ...(params.map ? { map: params.map } : {}),
    });
    if (params.map) {
      previewNav.applyMapDef(params.map);
    }
    const firstUnit = params.scenario?.units[0];
    if (firstUnit) {
      options.camera.setLookAt(firstUnit.position.x / 1024, firstUnit.position.z / 1024);
    }
  };

  const scenario = new ScenarioController({
    pack: options.pack,
    loadScenarioJson:
      options.loadScenarioJson ??
      (async (path) => {
        const response = await fetch(`${packBaseUrl}${path}`);
        return response.json() as Promise<unknown>;
      }),
    loadMapJson:
      options.loadMapJson ??
      (async (path) => {
        const response = await fetch(`${packBaseUrl}${path}`);
        return response.json() as Promise<unknown>;
      }),
    onInitLab: (params) => initRuntime(params),
  });
  scenario.setSeed(seed);

  const replay = new ReplayInspector({
    replay: (commands, totalTicks) => {
      const current = scenario.getCurrentScenario();
      const map = scenario.getCurrentMap();
      return runSimulationReplay({
        pack: options.pack,
        navFactory: () => new NavigationService(),
        commands,
        totalTicks,
        simulationConfig: { seed },
        ...(current ? { scenario: current } : {}),
        ...(map ? { map } : {}),
      }).checksums;
    },
  });

  const requestHaptic = (reason: InteractionLabHapticReason): void => {
    options.requestHaptic?.(reason);
  };

  const placement = new BuildingPlacementController({
    scene: options.scene,
    pack: options.pack,
    onPlace: (archetypeId, originCell) => {
      commandClient.issuePlaceBuilding({
        archetypeId,
        originCell,
        issuedAtTick: runtime.getLatestTick(),
        executeTick: runtime.getLatestTick(),
      });
      requestHaptic('place');
    },
    validate: (archetypeId, originCell) =>
      validateBuildingPlacement({
        pack: options.pack,
        nav: previewNav,
        archetypeId,
        originCell,
        protectedCells,
      }),
  });

  const hydrateFromSnapshot = (count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const parsed = parseSnapshotEntity(buffer, index);
      if (parsed.id.generation === 0 || registry.get(parsed.id)) {
        continue;
      }
      const archetypeId = resolveArchetypeId(options.pack, parsed.kind, parsed.archetypeIndex);
      if (!archetypeId) {
        continue;
      }
      registry.set(parsed.id, { archetypeId, kind: parsed.kind });
      if (parsed.kind === 'unit') {
        units.registerEntityArchetype(entityIdKey(parsed.id), archetypeId);
      } else {
        buildings.registerEntityArchetype(entityIdKey(parsed.id), archetypeId);
      }
    }
  };

  const getPickableEntities = (): readonly PickableEntity[] => {
    const count = runtime.getEntityCount();
    const entities: PickableEntity[] = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = parseSnapshotEntity(buffer, index);
      if (parsed.id.generation === 0) {
        continue;
      }
      let record = registry.get(parsed.id);
      if (!record) {
        const archetypeId = resolveArchetypeId(options.pack, parsed.kind, parsed.archetypeIndex);
        if (!archetypeId) {
          continue;
        }
        record = { archetypeId, kind: parsed.kind };
      }
      const unitArchetype = options.pack.units.find((unit) => unit.id === record.archetypeId);
      const buildingArchetype = options.pack.buildings.find(
        (building) => building.id === record.archetypeId,
      );
      const radius =
        record.kind === 'unit'
          ? (unitArchetype?.selectionRadius ?? 0.6)
          : Math.max(buildingArchetype?.footprint.cellsW ?? 1, buildingArchetype?.footprint.cellsH ?? 1) / 2;
      const worldHeight = unitArchetype?.worldHeight ?? buildingArchetype?.worldHeight;
      entities.push(snapshotToPickable(parsed, record.archetypeId, radius, worldHeight));
    }
    return entities;
  };

  const getFormation = (): MoveFormation | undefined => {
    if (formationKind === 'none') {
      return undefined;
    }
    return { kind: formationKind, spacingSubunits: 512 };
  };

  const interaction = new InteractionController({
    canvas: options.canvas,
    camera: options.camera,
    cameraControls: options.cameraControls,
    selection,
    commandClient,
    hitTest,
    getEntities: getPickableEntities,
    getCurrentTick: () => runtime.getLatestTick(),
    isUiPointerTarget: isMatchUiTarget,
    requestHaptic: (style) => requestHaptic(hapticStyleToReason(style)),
    getFormation,
    selectModeActive: () => selectModeActive,
    onEmptyGroundTap: (world) => {
      if (!placement.isActive()) {
        return false;
      }
      const originCell = { cx: Math.floor(world.x), cz: Math.floor(world.z) };
      const result = placement.tapPlace(originCell);
      if (!result.valid) {
        requestHaptic('invalid');
      }
      return true;
    },
  });

  let matchHud: MatchHud | null = null;
  let minimap: Minimap | null = null;
  let toolsRoot: HTMLDivElement | null = null;
  const spawnPalette = new SpawnPalette(options.pack, 'sunweaver');
  const buildPalette = new BuildPalette(options.pack, 'sunweaver');
  if (options.hudRoot) {
    matchHud = new MatchHud(options.hudRoot);
    matchHud.setHandlers({
      onStop: () => {
        commandClient.issueStop({
          entityIds: selection.getSelected(),
          issuedAtTick: runtime.getLatestTick(),
          executeTick: runtime.getLatestTick(),
        });
      },
      onFormationChange: (kind) => {
        formationKind = kind;
      },
      onSelectModeToggle: () => {
        selectModeActive = !selectModeActive;
      },
    });
    minimap = new Minimap(options.hudRoot);
    minimap.setHandlers({
      onCameraMove: (worldX, worldZ) => {
        options.camera.setLookAt(worldX, worldZ);
      },
    });
    toolsRoot = mountLabTools(options.hudRoot, {
      spawnPalette,
      buildPalette,
      onSpawn: (archetypeId) => {
        const look = options.camera.lookAt;
        commandClient.issueSpawnUnit({
          archetypeId,
          position: { x: Math.round(look.x * 1024), z: Math.round(look.z * 1024) },
          issuedAtTick: runtime.getLatestTick(),
          executeTick: runtime.getLatestTick(),
        });
      },
      onBuild: (archetypeId) => {
        placement.enterPlacement(archetypeId);
      },
      onNavDebug: (enabled) => {
        debugOverlays.set('paths', enabled);
        debugOverlays.set('staticBlockers', enabled);
      },
    });
  }

  debugOverlays.subscribe((flags) => {
    navDebug.setFlags(flags);
    runtime.setNavDebug(flags.paths || flags.navCells || flags.staticBlockers);
  });

  const tick = (): void => {
    const count = runtime.interpolate(buffer, performance.now());
    hydrateFromSnapshot(count);
    units.applySnapshot(buffer, count);
    buildings.applySnapshot(buffer, count);
    navDebug.update(runtime.getNavDebug());
    if (!readyResolved && count > 0) {
      readyResolved = true;
      resolveReady();
    }
    const pickable = getPickableEntities();
    if (matchHud) {
      matchHud.render({
        aggregates: aggregateSelection(
          pickable.map((entity) => ({ id: entity.id, archetypeId: entity.archetypeId })),
          selection.getSelected(),
        ),
        totalSelected: selection.getSelected().length,
        formationKind,
        selectModeActive,
      });
    }
    if (minimap) {
      minimap.render(minimapModelFromCamera(options.camera, buildMinimapMarkers(pickable)));
    }
  };

  const dispose = (): void => {
    interaction.dispose();
    runtime.stop();
    units.dispose();
    buildings.dispose();
    navDebug.dispose();
    placement.dispose();
    matchHud?.dispose();
    minimap?.dispose();
    toolsRoot?.remove();
  };

  const loadScenario = async (scenarioId: string): Promise<void> => {
    await scenario.loadNamedScenario(scenarioId);
  };

  const boot = async (): Promise<void> => {
    await loadScenario(options.scenarioId ?? INTERACTION_LAB_ALIEN_FANTASY_ID);
    if (options.spawnUnitId) {
      const look = options.camera.lookAt;
      commandClient.issueSpawnUnit({
        archetypeId: options.spawnUnitId,
        position: { x: Math.round(look.x * 1024 + 1024), z: Math.round(look.z * 1024) },
        issuedAtTick: runtime.getLatestTick(),
        executeTick: runtime.getLatestTick(),
      });
    }
    if (options.spawnBuildingId) {
      placement.enterPlacement(options.spawnBuildingId);
    }
  };

  void boot().catch((error: unknown) => {
    console.warn('Interaction lab failed to load scenario', error);
    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }
  });

  return {
    runtime,
    commandClient,
    interaction,
    selection,
    scenario,
    units,
    buildings,
    navDebug,
    placement,
    recorder,
    replay,
    spawnPalette,
    buildPalette,
    registry,
    matchHud,
    minimap,
    debugOverlays,
    ready,
    tick,
    dispose,
    loadScenario,
    getPickableEntities,
    isReady: () => readyResolved,
  };
}

function mountLabTools(
  host: HTMLElement,
  options: {
    spawnPalette: SpawnPalette;
    buildPalette: BuildPalette;
    onSpawn: (archetypeId: string) => void;
    onBuild: (archetypeId: string) => void;
    onNavDebug: (enabled: boolean) => void;
  },
): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'pastel-lab-tools';
  root.innerHTML = `
    <style>
      .pastel-lab-tools { position:fixed; left:12px; top:12px; z-index:21; display:flex; gap:6px; flex-wrap:wrap; max-width:42vw; }
      .pastel-lab-tools button, .pastel-lab-tools select {
        min-height:44px; min-width:44px; pointer-events:auto; border:1px solid rgba(255,255,255,.18);
        border-radius:10px; background:rgba(12,36,40,.88); color:#e8f4f2; font:13px/1.2 ui-sans-serif,system-ui,sans-serif;
      }
    </style>
    <select data-role="spawn" aria-label="Spawn unit"></select>
    <button type="button" data-action="spawn">Spawn</button>
    <select data-role="build" aria-label="Place building"></select>
    <button type="button" data-action="build">Place</button>
    <button type="button" data-action="nav">Nav debug</button>
  `;
  const spawnSelect = root.querySelector('[data-role="spawn"]') as HTMLSelectElement;
  const buildSelect = root.querySelector('[data-role="build"]') as HTMLSelectElement;
  for (const entry of options.spawnPalette.list()) {
    const option = document.createElement('option');
    option.value = entry.archetypeId;
    option.textContent = entry.displayName;
    spawnSelect.append(option);
  }
  for (const entry of options.buildPalette.list()) {
    const option = document.createElement('option');
    option.value = entry.archetypeId;
    option.textContent = entry.displayName;
    buildSelect.append(option);
  }
  root.querySelector('[data-action="spawn"]')?.addEventListener('click', () => {
    if (spawnSelect.value) {
      options.onSpawn(spawnSelect.value);
    }
  });
  root.querySelector('[data-action="build"]')?.addEventListener('click', () => {
    if (buildSelect.value) {
      options.onBuild(buildSelect.value);
    }
  });
  let navOn = false;
  root.querySelector('[data-action="nav"]')?.addEventListener('click', () => {
    navOn = !navOn;
    options.onNavDebug(navOn);
  });
  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  host.append(root);
  return root;
}

export { isInteractionLabMode, INTERACTION_LAB_ALIEN_FANTASY_ID };
