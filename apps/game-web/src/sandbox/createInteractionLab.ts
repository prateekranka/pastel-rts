import {
  runtimeContentFromBundle,
  type ContentClientStatus,
  type ContentInstallReason,
  type LoadedRuntimeContent,
} from '../content/PublishedContentClient';
import type { Scene } from 'three';
import type {
  CommandResult,
  MapDef,
  MoveFormation,
  MoveFormationKind,
  PackV2,
} from '@pastel-rts/content-schema';
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
import { InteractionFeedback } from './InteractionFeedback';
import { NavigationDebugRenderer } from './NavigationDebugRenderer';
import { ScenarioController } from './ScenarioController';
import { UnitRenderSystem } from './UnitRenderSystem';
import { BuildingPlacementController } from './placement/BuildingPlacementController';
import { CommandRecorder, ReplayInspector } from './replay/CommandRecorder';
import { SpawnPalette, BuildPalette, refreshPaletteOptions } from './palettes/SpawnPalette';
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
  content?: LoadedRuntimeContent;
  contentStatus?: () => ContentClientStatus | null;
  onSelectRevision?: (revision: string) => Promise<void>;
  onRestartRevision?: () => Promise<void>;
  onAcknowledge?: () => Promise<void>;
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
  applyContent: (content: LoadedRuntimeContent, reason?: ContentInstallReason) => Promise<void>;
  getContent: () => LoadedRuntimeContent;
  getPickableEntities: () => readonly PickableEntity[];
  getDiagnostics: () => InteractionLabDiagnostics;
  isReady: () => boolean;
};

export type InteractionLabDiagnostics = {
  content: LoadedRuntimeContent['identity'];
  scenarioId: string | null;
  seed: number;
  tick: number;
  entityCount: number;
  commandCount: number;
  checksumCount: number;
  missingUnitAssets: number;
  missingBuildingAssets: number;
  error: string | null;
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
  let activePack = options.pack;
  let activePackBaseUrl = options.packBaseUrl ?? './content/dev-pack-v2/';
  let activeContent = options.content ?? runtimeContentFromBundle(activePack, activePackBaseUrl);
  const registry = new EntityRegistry();
  const selection = new SelectionController();
  const hitTest = new HitTestService();
  /** Occupancy queries only — never requestPath on the main thread. */
  const previewNav = new NavigationService();
  const protectedCells = alienFantasyProtectedCells();
  const pendingSpawns = new Map<
    string,
    { archetypeId: string; kind: 'unit' | 'building'; originCell?: { cx: number; cz: number } }
  >();
  let formationKind: MoveFormationKind = 'none';
  let selectModeActive = false;
  let readyResolved = false;
  let labDisposed = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const recorder = new CommandRecorder();
  recorder.start();

  const units = new UnitRenderSystem({
    scene: options.scene,
    pack: activePack,
    packBaseUrl: activePackBaseUrl,
  });
  const buildings = new BuildingRenderSystem({
    scene: options.scene,
    pack: activePack,
    packBaseUrl: activePackBaseUrl,
  });
  const debugOverlays = new DebugOverlayState(DEFAULT_DEBUG_OVERLAYS);
  const navDebug = new NavigationDebugRenderer(options.scene, debugOverlays.getFlags());
  const feedback = new InteractionFeedback(options.canvas);
  feedback.setCamera(options.camera);

  function applyPreviewOccupancy(
    archetypeId: string,
    originCell: { cx: number; cz: number },
    blocked: boolean,
  ): void {
    const archetype = activePack.buildings.find((building) => building.id === archetypeId);
    if (!archetype) {
      return;
    }
    previewNav.setFootprintBlocked(
      originCell,
      archetype.footprint.cellsW,
      archetype.footprint.cellsH,
      blocked,
      archetype.blockedCellMask,
    );
  }

  function resetPreviewOccupancy(
    map?: import('@pastel-rts/content-schema').MapDef,
    scenario?: import('@pastel-rts/content-schema').ScenarioDef,
    extraPlaces?: Array<{ archetypeId: string; originCell: { cx: number; cz: number } }>,
  ): void {
    if (map) {
      previewNav.applyMapDef(map);
    }
    for (const building of scenario?.buildings ?? []) {
      applyPreviewOccupancy(building.archetypeId, building.originCell, true);
    }
    for (const place of extraPlaces ?? []) {
      applyPreviewOccupancy(place.archetypeId, place.originCell, true);
    }
  }

  function handleCommandResult(result: CommandResult): void {
    recorder.onResult(result);
    scenario.recordCommandResult(result);
    const pending = pendingSpawns.get(result.commandId);
    if (result.status === 'accepted' && result.spawnedId && pending) {
      registry.set(result.spawnedId, pending);
      if (pending.kind === 'unit') {
        units.registerEntityArchetype(entityIdKey(result.spawnedId), pending.archetypeId);
      } else {
        buildings.registerEntityArchetype(entityIdKey(result.spawnedId), pending.archetypeId);
        if (pending.originCell) {
          applyPreviewOccupancy(pending.archetypeId, pending.originCell, true);
        }
      }
    }
    if (pending) {
      pendingSpawns.delete(result.commandId);
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
            originCell: payload.originCell,
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
    commandLog?: import('@pastel-rts/content-schema').CommandEnvelopeV1[];
    replayToTick?: number;
  }): void => {
    activePack = params.pack;
    registry.clear();
    pendingSpawns.clear();
    selection.clear();
    recorder.start();
    runtime.reinit({
      type: 'initLab',
      seed: params.seed,
      pack: params.pack,
      ...(params.scenario ? { scenario: params.scenario } : {}),
      ...(params.map ? { map: params.map } : {}),
      ...(params.commandLog ? { commandLog: params.commandLog } : {}),
      ...(params.replayToTick !== undefined ? { replayToTick: params.replayToTick } : {}),
    });
    const extraPlaces = (params.commandLog ?? [])
      .filter((envelope) => envelope.payload.kind === 'placeBuilding')
      .map((envelope) => ({
        archetypeId: envelope.payload.kind === 'placeBuilding' ? envelope.payload.archetypeId : '',
        originCell: envelope.payload.kind === 'placeBuilding' ? envelope.payload.originCell : { cx: 0, cz: 0 },
      }))
      .filter((place) => place.archetypeId.length > 0);
    resetPreviewOccupancy(params.map, params.scenario, extraPlaces);
    const firstUnit = params.scenario?.units[0];
    if (firstUnit) {
      options.camera.setLookAt(firstUnit.position.x / 1024, firstUnit.position.z / 1024);
    }
  };

  const scenario = new ScenarioController({
    pack: activePack,
    packBaseUrl: activePackBaseUrl,
    contentIdentity: activeContent.identity,
    loadScenarioJson:
      options.loadScenarioJson ??
      (async (path) => {
        const response = await fetch(`${activePackBaseUrl}${path}`);
        if (!response.ok) {
          throw new Error(`Scenario asset failed to load (${String(response.status)})`);
        }
        return response.json() as Promise<unknown>;
      }),
    loadMapJson:
      options.loadMapJson ??
      (async (path) => {
        const response = await fetch(`${activePackBaseUrl}${path}`);
        if (!response.ok) {
          throw new Error(`Map asset failed to load (${String(response.status)})`);
        }
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
        pack: activePack,
        navFactory: () => new NavigationService(),
        commands,
        totalTicks,
        simulationConfig: { seed: scenario.getSeed() },
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
    pack: activePack,
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
        pack: activePack,
        nav: previewNav,
        archetypeId,
        originCell,
        protectedCells,
      }),
  });

  const hydrateFromSnapshot = (count: number): void => {
    const liveIds = [] as Array<import('@pastel-rts/content-schema').EntityId>;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseSnapshotEntity(buffer, index);
      if (parsed.id.generation === 0) {
        continue;
      }
      liveIds.push(parsed.id);
      if (registry.get(parsed.id)) {
        continue;
      }
      const archetypeId = resolveArchetypeId(activePack, parsed.kind, parsed.archetypeIndex);
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
    for (const key of registry.reconcile(liveIds)) {
      units.unregisterEntity(key);
      buildings.unregisterEntity(key);
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
        const archetypeId = resolveArchetypeId(activePack, parsed.kind, parsed.archetypeIndex);
        if (!archetypeId) {
          continue;
        }
        record = { archetypeId, kind: parsed.kind };
        registry.set(parsed.id, record);
        if (record.kind === 'unit') {
          units.registerEntityArchetype(entityIdKey(parsed.id), record.archetypeId);
        } else {
          buildings.registerEntityArchetype(entityIdKey(parsed.id), record.archetypeId);
        }
      }
      const unitArchetype = activePack.units.find((unit) => unit.id === record.archetypeId);
      const buildingArchetype = activePack.buildings.find(
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
    onDestinationMarker: (marker) => feedback.setDestination(marker),
    onFormationPreview: (preview) => feedback.setFormation(preview),
    onLassoRect: (rect) => feedback.setLasso(rect),
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
  const spawnPalette = new SpawnPalette(activePack, 'sunweaver');
  const buildPalette = new BuildPalette(activePack, 'sunweaver');
  let contentError: string | null = null;
  let refreshTools = (): void => undefined;
  let nextToolsRefreshAt = 0;

  const applyContent = async (
    content: LoadedRuntimeContent,
    reason: ContentInstallReason = 'refresh',
  ): Promise<void> => {
    if (labDisposed) {
      throw new Error('Interaction lab is disposed');
    }
    const previous = activeContent;
    const previousPack = activePack;
    const previousBaseUrl = activePackBaseUrl;
    try {
      activePack = content.pack;
      activePackBaseUrl = content.assetBaseUrl;
      if (reason === 'restart') {
        scenario.setContent(content);
        await scenario.reloadCurrentScenario();
      } else {
        scenario.setContent(content);
      }
      if (labDisposed) {
        throw new Error('Interaction lab is disposed');
      }
      activeContent = content;
      activePack = content.pack;
      activePackBaseUrl = content.assetBaseUrl;
      units.hotReload(content.pack, content.assetBaseUrl);
      buildings.hotReload(content.pack, content.assetBaseUrl);
      spawnPalette.setPack(content.pack);
      buildPalette.setPack(content.pack);
      placement.setPack(content.pack);
      resetPreviewOccupancy(scenario.getCurrentMap() ?? undefined, scenario.getCurrentScenario() ?? undefined);
      contentError = null;
      refreshTools();
    } catch (error) {
      contentError = error instanceof Error ? error.message : String(error);
      // Candidate replacement is transactional. Restore the last good visual
      // and content lookup state. A restart candidate may already have reinit'd
      // the worker, so reload the prior immutable scenario as well.
      try {
        scenario.setContent(previous);
        activeContent = previous;
        activePack = previousPack;
        activePackBaseUrl = previousBaseUrl;
        if (reason === 'restart') {
          await scenario.reloadCurrentScenario();
        }
        units.hotReload(previousPack, previousBaseUrl);
        buildings.hotReload(previousPack, previousBaseUrl);
        spawnPalette.setPack(previousPack);
        buildPalette.setPack(previousPack);
        placement.setPack(previousPack);
        resetPreviewOccupancy(scenario.getCurrentMap() ?? undefined, scenario.getCurrentScenario() ?? undefined);
      } catch (rollbackError) {
        contentError = `${contentError}; rollback failed`;
        throw rollbackError;
      } finally {
        refreshTools();
      }
      throw error;
    }
  };
  const loadScenario = async (scenarioId: string): Promise<void> => {
    await scenario.loadNamedScenario(scenarioId);
    contentError = null;
    refreshTools();
  };

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
    const toolHandle = mountLabTools(options.hudRoot, {
      spawnPalette,
      buildPalette,
      scenario,
      getContent: () => activeContent,
      contentStatus: options.contentStatus,
      onSelectRevision: options.onSelectRevision,
      onRestartRevision: options.onRestartRevision,
      onAcknowledge: options.onAcknowledge,
      onLoadScenario: loadScenario,
      onSeed: (nextSeed) => {
        scenario.setSeed(nextSeed);
        scenario.reset();
      },
      onSave: () => {
        scenario.setReplayToTick(runtime.getLatestTick());
        downloadJson('pastel-rts-save.json', scenario.exportSaveDocument());
      },
      onImport: (value) => {
        scenario.importSaveDocument(value);
        replay.setRecorded([...scenario.getCommandLog()], [...scenario.getChecksums()]);
        contentError = null;
      },
      onReplay: () => {
        scenario.setReplayToTick(runtime.getLatestTick());
        replay.setRecorded([...scenario.getCommandLog()], [...scenario.getChecksums()]);
        return replay.runReplay(runtime.getLatestTick());
      },
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
    toolsRoot = toolHandle.root;
    refreshTools = toolHandle.refresh;
  }

  debugOverlays.subscribe((flags) => {
    navDebug.setFlags(flags);
    runtime.setNavDebug(flags.paths || flags.navCells || flags.staticBlockers);
  });

  const tick = (): void => {
    const now = performance.now();
    const count = runtime.interpolate(buffer, now);
    hydrateFromSnapshot(count);
    units.applySnapshot(buffer, count);
    buildings.applySnapshot(buffer, count);
    navDebug.update(runtime.getNavDebug());
    feedback.update();
    if (!readyResolved && count > 0) {
      readyResolved = true;
      resolveReady();
    }
    const pickable = getPickableEntities();
    scenario.setReplayToTick(runtime.getLatestTick());
    if (now >= nextToolsRefreshAt) {
      nextToolsRefreshAt = now + 250;
      refreshTools();
    }
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
    if (labDisposed) {
      return;
    }
    labDisposed = true;
    interaction.dispose();
    runtime.stop();
    units.dispose();
    buildings.dispose();
    navDebug.dispose();
    placement.dispose();
    feedback.dispose();
    matchHud?.dispose();
    minimap?.dispose();
    toolsRoot?.remove();
  };

  const boot = async (): Promise<void> => {
    await loadScenario(options.scenarioId ?? INTERACTION_LAB_ALIEN_FANTASY_ID);
    if (!readyResolved) {
      readyResolved = true;
      resolveReady();
    }
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
    contentError = error instanceof Error ? error.message : String(error);
    console.warn('Interaction lab failed to load scenario', error);
    refreshTools();
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
    applyContent,
    getContent: () => activeContent,
    getPickableEntities,
    getDiagnostics: () => {
      const unitArt = units.getArtDiagnostics();
      const buildingArt = buildings.getArtDiagnostics();
      return {
        content: { ...activeContent.identity },
        scenarioId: scenario.getCurrentScenario()?.id ?? null,
        seed: scenario.getSeed(),
        tick: runtime.getLatestTick(),
        entityCount: runtime.getEntityCount(),
        commandCount: scenario.getCommandLog().length,
        checksumCount: scenario.getChecksums().length,
        missingUnitAssets: unitArt.assets.filter((asset) => asset.state === 'missing').length,
        missingBuildingAssets: buildingArt.filter((asset) => asset.state === 'missing').length,
        error: contentError,
      };
    },
    isReady: () => readyResolved,
  };
}

type LabToolsHandle = {
  root: HTMLDivElement;
  refresh: () => void;
};

function mountLabTools(
  host: HTMLElement,
  options: {
    spawnPalette: SpawnPalette;
    buildPalette: BuildPalette;
    scenario: ScenarioController;
    getContent: () => LoadedRuntimeContent;
    contentStatus: (() => ContentClientStatus | null) | undefined;
    onSelectRevision: ((revision: string) => Promise<void>) | undefined;
    onRestartRevision: (() => Promise<void>) | undefined;
    onAcknowledge: (() => Promise<void>) | undefined;
    onLoadScenario: (scenarioId: string) => Promise<void>;
    onSeed: (seed: number) => void;
    onSave: () => void;
    onImport: (value: unknown) => void;
    onReplay: () => boolean;
    onSpawn: (archetypeId: string) => void;
    onBuild: (archetypeId: string) => void;
    onNavDebug: (enabled: boolean) => void;
  },
): LabToolsHandle {
  const root = document.createElement('div');
  root.className = 'pastel-lab-tools';
  root.innerHTML = `
    <style>
      .pastel-lab-tools { position:fixed; left:12px; top:12px; z-index:21; display:grid; gap:6px; max-width:min(520px,92vw); color:#e8f4f2; font:13px/1.2 ui-sans-serif,system-ui,sans-serif; }
      .pastel-lab-tools .lab-row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
      .pastel-lab-tools button, .pastel-lab-tools select, .pastel-lab-tools input {
        min-height:44px; min-width:44px; pointer-events:auto; border:1px solid rgba(255,255,255,.18);
        border-radius:10px; background:rgba(12,36,40,.9); color:#e8f4f2; font:13px/1.2 ui-sans-serif,system-ui,sans-serif; padding:0 9px;
      }
      .pastel-lab-tools input[type=number] { width:100px; }
      .pastel-lab-tools input[data-role=revision] { width:150px; }
      .pastel-lab-tools .lab-status { max-width:520px; padding:7px 9px; border-radius:10px; background:rgba(12,36,40,.9); white-space:pre-wrap; }
      .pastel-lab-tools .lab-status[data-state=error] { border-color:#ff6b8a; color:#ffd9e2; }
      .pastel-lab-tools .lab-status[data-state=warn] { border-color:#f5c56b; color:#ffe8b3; }
    </style>
    <div class="lab-status" data-role="status" aria-live="polite"></div>
    <div class="lab-row">
      <select data-role="scenario" aria-label="Scenario preset"></select>
      <button type="button" data-action="load-scenario">Load scenario</button>
      <input data-role="seed" type="number" step="1" aria-label="Scenario seed" />
      <button type="button" data-action="apply-seed">Apply seed</button>
    </div>
    <div class="lab-row">
      <select data-role="spawn" aria-label="Spawn unit"></select>
      <button type="button" data-action="spawn">Spawn</button>
      <select data-role="build" aria-label="Place building"></select>
      <button type="button" data-action="build">Place</button>
      <button type="button" data-action="nav">Nav debug</button>
    </div>
    <div class="lab-row">
      <button type="button" data-action="reset">Reset match</button>
      <button type="button" data-action="save">Export save</button>
      <button type="button" data-action="import">Import save</button>
      <input data-role="import-file" type="file" accept="application/json,.json" hidden />
      <button type="button" data-action="replay">Replay check</button>
    </div>
    <div class="lab-row">
      <input data-role="revision" type="text" placeholder="revision" aria-label="Content revision" />
      <button type="button" data-action="select-revision">Select revision</button>
      <button type="button" data-action="restart-revision">Restart pending</button>
      <button type="button" data-action="ack">Acknowledge</button>
    </div>
  `;
  const spawnSelect = root.querySelector('[data-role="spawn"]') as HTMLSelectElement;
  const buildSelect = root.querySelector('[data-role="build"]') as HTMLSelectElement;
  const scenarioSelect = root.querySelector('[data-role="scenario"]') as HTMLSelectElement;
  const seedInput = root.querySelector('[data-role="seed"]') as HTMLInputElement;
  const revisionInput = root.querySelector('[data-role="revision"]') as HTMLInputElement;
  const importFile = root.querySelector('[data-role="import-file"]') as HTMLInputElement;
  const status = root.querySelector('[data-role="status"]') as HTMLDivElement;
  let notice = '';

  const setNotice = (message: string): void => {
    notice = message;
    refresh();
  };

  const runAsync = (action: () => Promise<void>, success: string): void => {
    void action()
      .then(() => setNotice(success))
      .catch((error: unknown) => {
        setNotice(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const refresh = (): void => {
    refreshPaletteOptions(spawnSelect, options.spawnPalette.list());
    refreshPaletteOptions(buildSelect, options.buildPalette.list());
    const selectedScenario = scenarioSelect.value;
    scenarioSelect.replaceChildren();
    for (const preset of options.scenario.getScenarioPresets()) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.id;
      scenarioSelect.append(option);
    }
    if ([...scenarioSelect.options].some((option) => option.value === selectedScenario)) {
      scenarioSelect.value = selectedScenario;
    } else if (options.scenario.getCurrentScenario()) {
      scenarioSelect.value = options.scenario.getCurrentScenario()!.id;
    }
    seedInput.value = String(options.scenario.getSeed());

    const content = options.getContent();
    const clientStatus = options.contentStatus?.();
    const phase = clientStatus?.phase ?? 'ready';
    const revision = clientStatus?.activeRevision ?? content.identity.revision;
    const lines = [
      `content ${content.identity.source}  revision ${revision}`,
      `hash ${shortHash(content.identity.contentHash)}  rules ${shortHash(content.identity.simulationRulesHash)}`,
      `scenario ${options.scenario.getCurrentScenario()?.id ?? 'none'}  seed ${String(options.scenario.getSeed())}`,
    ];
    let state: 'normal' | 'warn' | 'error' = 'normal';
    if (phase === 'restart-required') {
      state = 'warn';
      lines.push(`restart required for revision ${clientStatus?.pendingRevision ?? clientStatus?.availableRevision ?? 'unknown'}`);
    } else if (phase === 'reconnecting') {
      state = 'warn';
      lines.push(`content stream reconnecting (attempt ${String(clientStatus?.reconnectAttempt ?? 0)})`);
    } else if (phase === 'failed') {
      state = 'error';
    }
    if (clientStatus?.error) {
      state = 'error';
      lines.push(`content error: ${clientStatus.error}`);
    }
    if (notice) {
      lines.push(notice);
    }
    status.textContent = lines.join('\n');
    status.dataset['state'] = state;
    const restartButton = root.querySelector('[data-action="restart-revision"]');
    if (restartButton instanceof HTMLButtonElement) {
      restartButton.disabled = options.onRestartRevision === undefined || phase !== 'restart-required';
    }
    const selectButton = root.querySelector('[data-action="select-revision"]');
    if (selectButton instanceof HTMLButtonElement) {
      selectButton.disabled = options.onSelectRevision === undefined;
    }
    const ackButton = root.querySelector('[data-action="ack"]');
    if (ackButton instanceof HTMLButtonElement) {
      ackButton.disabled = options.onAcknowledge === undefined;
    }
  };

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
  root.querySelector('[data-action="load-scenario"]')?.addEventListener('click', () => {
    if (scenarioSelect.value) {
      runAsync(() => options.onLoadScenario(scenarioSelect.value), `Loaded ${scenarioSelect.value}`);
    }
  });
  root.querySelector('[data-action="apply-seed"]')?.addEventListener('click', () => {
    const nextSeed = Number(seedInput.value);
    if (!Number.isSafeInteger(nextSeed)) {
      setNotice('Seed must be a safe integer');
      return;
    }
    try {
      options.onSeed(nextSeed);
      setNotice(`Applied seed ${String(nextSeed)}`);
    } catch (error) {
      setNotice(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  root.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    try {
      options.scenario.reset();
      setNotice('Match reset');
    } catch (error) {
      setNotice(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  root.querySelector('[data-action="save"]')?.addEventListener('click', () => {
    try {
      options.onSave();
      setNotice('Save exported with exact revision and map identity');
    } catch (error) {
      setNotice(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  root.querySelector('[data-action="import"]')?.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) {
      return;
    }
    void file.text()
      .then((text) => {
        const parsed: unknown = JSON.parse(text) as unknown;
        options.onImport(parsed);
        setNotice('Save imported and runtime reinitialized from recorded inputs');
      })
      .catch((error: unknown) => {
        setNotice(`Import rejected: ${error instanceof Error ? error.message : String(error)}`);
      });
  });
  root.querySelector('[data-action="replay"]')?.addEventListener('click', () => {
    try {
      setNotice(options.onReplay() ? 'Replay check passed' : 'Replay check failed');
    } catch (error) {
      setNotice(`Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  root.querySelector('[data-action="select-revision"]')?.addEventListener('click', () => {
    const revision = revisionInput.value.trim();
    if (!revision || !options.onSelectRevision) {
      setNotice('Enter a revision before selecting');
      return;
    }
    runAsync(() => options.onSelectRevision!(revision), `Revision ${revision} loaded or queued`);
  });
  root.querySelector('[data-action="restart-revision"]')?.addEventListener('click', () => {
    if (options.onRestartRevision) {
      runAsync(options.onRestartRevision, 'Pending revision restarted and installed');
    }
  });
  root.querySelector('[data-action="ack"]')?.addEventListener('click', () => {
    if (options.onAcknowledge) {
      runAsync(options.onAcknowledge, 'Revision acknowledgement sent');
    }
  });
  let navOn = false;
  root.querySelector('[data-action="nav"]')?.addEventListener('click', () => {
    navOn = !navOn;
    options.onNavDebug(navOn);
    setNotice(`Navigation debug ${navOn ? 'on' : 'off'}`);
  });
  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  host.append(root);
  refresh();
  return { root, refresh };
}

function shortHash(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export { isInteractionLabMode, INTERACTION_LAB_ALIEN_FANTASY_ID };
