import type { CommandEnvelopeV1, MapDef, PackV2, ScenarioDef } from '@pastel-rts/content-schema';
import { validateMapDef, validateScenarioDef } from '@pastel-rts/content-schema';
import type { StateChecksum } from '@pastel-rts/simulation';
import type { ScenarioSaveDocument } from './types';
import { applyAlienFantasyObstacles, INTERACTION_LAB_ALIEN_FANTASY_ID } from './mapPresets';

export type ScenarioControllerOptions = {
  pack: PackV2;
  loadScenarioJson: (path: string) => Promise<unknown>;
  loadMapJson: (path: string) => Promise<unknown>;
  onInitLab: (params: {
    seed: number;
    pack: PackV2;
    scenario?: ScenarioDef;
    map?: MapDef;
    commandLog?: CommandEnvelopeV1[];
    replayToTick?: number;
  }) => void;
};

/** Loads named lab scenarios, save/load JSON, and reset helpers. */
export class ScenarioController {
  private readonly pack: PackV2;
  private readonly loadScenarioJson: (path: string) => Promise<unknown>;
  private readonly loadMapJson: (path: string) => Promise<unknown>;
  private readonly onInitLab: ScenarioControllerOptions['onInitLab'];
  private seed = 1;
  private currentScenario: ScenarioDef | null = null;
  private currentMap: MapDef | null = null;
  private commandLog: CommandEnvelopeV1[] = [];
  private checksums: StateChecksum[] = [];

  constructor(options: ScenarioControllerOptions) {
    this.pack = options.pack;
    this.loadScenarioJson = options.loadScenarioJson;
    this.loadMapJson = options.loadMapJson;
    this.onInitLab = options.onInitLab;
  }

  getSeed(): number {
    return this.seed;
  }

  setSeed(seed: number): void {
    this.seed = seed;
  }

  getCurrentScenario(): ScenarioDef | null {
    return this.currentScenario;
  }

  getCurrentMap(): MapDef | null {
    return this.currentMap;
  }

  recordCommand(envelope: CommandEnvelopeV1): void {
    this.commandLog.push(envelope);
  }

  recordChecksums(checksums: readonly StateChecksum[]): void {
    this.checksums = [...checksums];
  }

  getCommandLog(): readonly CommandEnvelopeV1[] {
    return this.commandLog;
  }

  async loadNamedScenario(scenarioId: string): Promise<ScenarioDef> {
    const ref = this.pack.scenarios?.find((entry) => entry.id === scenarioId);
    if (!ref) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
    const raw = await this.loadScenarioJson(ref.path);
    const scenario = validateScenarioDef(raw);
    let map: MapDef | undefined;
    const mapRef = this.pack.maps?.find((entry) => entry.id === scenario.mapId);
    if (mapRef) {
      const mapRaw = await this.loadMapJson(mapRef.path);
      map = validateMapDef(mapRaw);
      if (scenarioId === INTERACTION_LAB_ALIEN_FANTASY_ID) {
        map = applyAlienFantasyObstacles(map);
      }
    }
    this.currentScenario = scenario;
    this.currentMap = map ?? null;
    this.commandLog = [];
    this.checksums = [];
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario,
      ...(map !== undefined ? { map } : {}),
    });
    return scenario;
  }

  reset(): void {
    if (!this.currentScenario) {
      return;
    }
    this.commandLog = [];
    this.checksums = [];
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario: this.currentScenario,
      ...(this.currentMap ? { map: this.currentMap } : {}),
    });
  }

  exportSaveDocument(): ScenarioSaveDocument {
    if (!this.currentScenario) {
      throw new Error('No scenario loaded');
    }
    return {
      schemaVersion: 1,
      scenario: this.currentScenario,
      seed: this.seed,
      packId: this.pack.id,
      packHash: this.pack.contentHash,
      commandLog: [...this.commandLog],
      checksums: [...this.checksums],
    };
  }

  importSaveDocument(doc: ScenarioSaveDocument): void {
    if (doc.schemaVersion !== 1) {
      throw new Error('Unsupported save schema');
    }
    this.seed = doc.seed;
    this.currentScenario = doc.scenario;
    this.commandLog = [...doc.commandLog];
    this.checksums = [...doc.checksums];
    const lastChecksumTick = doc.checksums[doc.checksums.length - 1]?.tick;
    const lastExecuteTick = doc.commandLog.reduce(
      (max, envelope) => Math.max(max, envelope.executeTick),
      0,
    );
    this.onInitLab({
      seed: this.seed,
      pack: this.pack,
      scenario: doc.scenario,
      ...(this.currentMap ? { map: this.currentMap } : {}),
      commandLog: doc.commandLog,
      replayToTick: (lastChecksumTick ?? lastExecuteTick) + 1,
    });
  }
}
