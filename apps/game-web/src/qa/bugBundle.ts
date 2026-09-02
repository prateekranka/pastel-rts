import type { CommandEnvelopeV1 } from '@pastel-rts/content-schema';
import type { StateChecksum } from '@pastel-rts/simulation';
import { REQUIRED_PERFORMANCE_REPORT_KEYS } from '../diagnostics/report';

export type BugBundle = {
  schemaVersion: 1;
  exportedAt: string;
  scenarioId: string | null;
  seed: number;
  packId: string;
  packHash: string;
  commandLog: CommandEnvelopeV1[];
  checksums: StateChecksum[];
  runtime: {
    renderer: string;
    viewport: { width: number; height: number };
    dpr: number;
    mode: string;
  };
  diagnostics: Record<string, unknown>;
};

export type BugBundleInput = {
  scenarioId: string | null;
  seed: number;
  packId: string;
  packHash: string;
  commandLog: CommandEnvelopeV1[];
  checksums: StateChecksum[];
  renderer: string;
  viewport: { width: number; height: number };
  dpr: number;
  diagnostics: Record<string, unknown>;
};

/** Export reproducible bug bundle without private files. */
export function exportBugBundle(input: BugBundleInput): BugBundle {
  const bundle: BugBundle = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scenarioId: input.scenarioId,
    seed: input.seed,
    packId: input.packId,
    packHash: input.packHash,
    commandLog: input.commandLog,
    checksums: input.checksums,
    runtime: {
      renderer: input.renderer,
      viewport: input.viewport,
      dpr: input.dpr,
      mode: 'interaction-lab',
    },
    diagnostics: sanitizeDiagnostics(input.diagnostics),
  };
  return bundle;
}

function sanitizeDiagnostics(raw: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set<string>([...REQUIRED_PERFORMANCE_REPORT_KEYS, 'tick', 'entityCount', 'checksum']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.has(key) && typeof value !== 'object') {
      out[key] = value;
    }
    if (allowed.has(key) && (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')) {
      out[key] = value;
    }
  }
  return out;
}

export function downloadBugBundle(bundle: BugBundle, filename = 'pastel-lab-bug-bundle.json'): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
