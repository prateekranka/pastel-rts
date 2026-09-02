import type { Scene } from 'three';
import type { CommandResult, MapDef, MoveFormationKind, PackV2 } from '@pastel-rts/content-schema';
import { NavigationService } from '@pastel-rts/navigation';
import { runSimulationReplay } from '@pastel-rts/simulation';
import type { IsometricCamera } from '../camera/IsometricCamera';
import { CommandClient } from '../input/CommandClient';
import { InteractionController } from '../input/InteractionController';
import type { PointerCameraControls } from '../input/PointerCameraControls';
import { SelectionController } from '../selection/SelectionController';
import { HitTestService } from '../selection/HitTestService';
import type { PickableEntity } from '../selection/types';
import { MatchHud, aggregateSelection } from '../ui/MatchHud';
import { Minimap, buildMinimapMarkers, minimapModelFromCamera } from '../ui/Minimap';
import { BuildingRenderSystem } from '../buildings/BuildingRenderSystem';
import { validateBuildingPlacement } from '../buildings/placementValidation';
import { DebugOverlayState } from '../qa/DebugOverlayState';
import { seedFor } from '../qa/deterministicSeeds';
import { EntityRegistry } from './EntityRegistry';
import { MatchRuntimeClient } from './MatchRuntimeClient';
import { NavigationDebugRenderer } from './NavigationDebugRenderer';
import { ScenarioController } from './ScenarioController';
import { UnitRenderSystem } from './UnitRenderSystem';
import { BuildingPlacementController } from './placement/BuildingPlacementController';
import { CommandRecorder, ReplayInspector } from './replay/CommandRecorder';
import { SpawnPalette, BuildPalette } from './palettes/SpawnPalette';
import { alienFantasyProtectedCells, INTERACTION_LAB_ALIEN_FANTASY_ID } from './mapPresets';
import { entityIdKey, parseSnapshotEntity, snapshotToPickable } from './snapshot';
import { DEFAULT_DEBUG_OVERLAYS } from './types';

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
  requestHaptic?: (style: 'light' | 'medium' | 'heavy') => void;
  loadScenarioJson?: (path: string) => Promise<unknown>;
  loadMapJson?: (path: string) => Promise<unknown>;
};

export type InteractionLab = {
  runtime: MatchRuntimeClient;
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
  tick: () => void;
  dispose: () => void;
  loadScenario: (scenarioId: string) => Promise<void>;
  getPickableEntities: () => readonly PickableEntity[];
};

function isInteractionLabMode(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('mode') === 'interaction-lab';
}

/** Factory for Milestone 1 interaction sandbox — GameApp calls with one line. */
export function createInteractionLab(options: InteractionLabOptions): InteractionLab {
  const seed = options.seed ?? seedFor('interactionLab');
  const registry = new EntityRegistry();
  const selection = new SelectionController();
  const hitTest = new HitTestService();
  const previewNav = new NavigationService();
  const protectedCells = alienFantasyProtectedCells();
  const pendingSpawns = new Map<string, { archetypeId: string; kind: 'unit' | 'building' }>();
  let formationKind: MoveFormationKind = 'none';
  let selectModeActive = false;

  const recorder = new CommandRecorder();
  const replay = new ReplayInspector({
    replay: (commands, totalTicks) =>
      runSimulationReplay({
        pack: options.pack,
        navFactory: () => new NavigationService(),
        commands,
        totalTicks,
      }).checksums,
  });

  const units = new UnitRenderSystem({
    scene: options.scene,
    pack: options.pack,
    ...(options.packBaseUrl !== undefined ? { packBaseUrl: options.packBaseUrl } : {}),
  });
  const buildings = new BuildingRenderSystem({ scene: options.scene, pack: options.pack });
  const debugOverlays = new DebugOverlayState(DEFAULT_DEBUG_OVERLAYS);
  const navDebug = new NavigationDebugRenderer(options.scene, debugOverlays.getFlags());

  const buffer = new MatchRuntimeClient().createInterpolationBuffer();

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

  const runtime = new MatchRuntimeClient({ maxEntities: 512 }, handleCommandResult);

  const commandClient = new CommandClient({
    port: {
      postMessage(message) {
        runtime.postCommand(message.envelope);
        recorder.onCommand(message.envelope);
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
  };

  const scenario = new ScenarioController({
    pack: options.pack,
    loadScenarioJson:
      options.loadScenarioJson ??
      (async (path) => {
        const response = await fetch(`${options.packBaseUrl ?? '/content/dev-pack-v2/'}${path}`);
        return response.json() as Promise<unknown>;
      }),
    loadMapJson:
      options.loadMapJson ??
      (async (path) => {
        const response = await fetch(`${options.packBaseUrl ?? '/content/dev-pack-v2/'}${path}`);
        return response.json() as Promise<unknown>;
      }),
    onInitLab: (params) => initRuntime(params),
  });
  scenario.setSeed(seed);

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

  const getPickableEntities = (): readonly PickableEntity[] => {
    const stride = 12;
    const maxEntities = Math.floor(buffer.length / stride);
    const entities: PickableEntity[] = [];
    for (let index = 0; index < maxEntities; index += 1) {
      const parsed = parseSnapshotEntity(buffer, index);
      if (parsed.id.generation === 0) {
        continue;
      }
      const record = registry.get(parsed.id);
      if (!record) {
        continue;
      }
      const unitArchetype = options.pack.units.find((unit) => unit.id === record.archetypeId);
      const buildingArchetype = options.pack.buildings.find((building) => building.id === record.archetypeId);
      const radius =
        record.kind === 'unit'
          ? (unitArchetype?.selectionRadius ?? 0.6)
          : Math.max(buildingArchetype?.footprint.cellsW ?? 1, buildingArchetype?.footprint.cellsH ?? 1) / 2;
      const worldHeight = unitArchetype?.worldHeight ?? buildingArchetype?.worldHeight;
      entities.push(snapshotToPickable(parsed, record.archetypeId, radius, worldHeight));
    }
    return entities;
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
    ...(options.requestHaptic !== undefined ? { requestHaptic: options.requestHaptic } : {}),
    selectModeActive: () => selectModeActive,
  });

  let matchHud: MatchHud | null = null;
  let minimap: Minimap | null = null;
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
  }

  debugOverlays.subscribe((flags) => {
    navDebug.setFlags(flags);
    runtime.setNavDebug(flags.paths || flags.navCells || flags.staticBlockers);
  });

  const tick = (): void => {
    const count = runtime.interpolate(buffer, performance.now());
    units.applySnapshot(buffer, count);
    buildings.applySnapshot(buffer, count);
    navDebug.update(runtime.getNavDebug());
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
  };

  const loadScenario = async (scenarioId: string): Promise<void> => {
    await scenario.loadNamedScenario(scenarioId);
  };

  if (options.scenarioId) {
    void loadScenario(options.scenarioId);
  } else if (typeof globalThis.location !== 'undefined' && isInteractionLabMode(globalThis.location.search)) {
    void loadScenario(INTERACTION_LAB_ALIEN_FANTASY_ID);
  }

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
    spawnPalette: new SpawnPalette(options.pack, 'sunweaver'),
    buildPalette: new BuildPalette(options.pack, 'sunweaver'),
    registry,
    matchHud,
    minimap,
    debugOverlays,
    tick,
    dispose,
    loadScenario,
    getPickableEntities,
  };
}

export { isInteractionLabMode, INTERACTION_LAB_ALIEN_FANTASY_ID };
