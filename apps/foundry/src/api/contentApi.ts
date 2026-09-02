import type { BuildingArchetype, PackV2, UnitArchetype, UnitManifest } from '@pastel-rts/content-schema';

const BASE = '/dev-content';

async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

function errorFromBody(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return 'Request failed';
}

export async function fetchPackV1(): Promise<{ schemaVersion: number; id: string; units: UnitManifest[] }> {
  const response = await fetch(`${BASE}/pack`);
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
  return (await parseJson(response)) as { schemaVersion: number; id: string; units: UnitManifest[] };
}

export async function fetchPackV2(): Promise<PackV2> {
  const response = await fetch(`${BASE}/pack?schema=2`);
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
  return (await parseJson(response)) as PackV2;
}

export async function fetchUnitsV2(): Promise<UnitArchetype[]> {
  const response = await fetch(`${BASE}/v2/units`);
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
  const body = (await parseJson(response)) as { units: UnitArchetype[] };
  return body.units;
}

export async function fetchBuildingsV2(): Promise<BuildingArchetype[]> {
  const response = await fetch(`${BASE}/v2/buildings`);
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
  const body = (await parseJson(response)) as { buildings: BuildingArchetype[] };
  return body.buildings;
}

export async function publishUnitV1(manifest: UnitManifest, pngBase64: string): Promise<void> {
  const response = await fetch(`${BASE}/units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest, pngBase64 }),
  });
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
}

export async function createUnitV2(archetype: UnitArchetype, pngBase64?: string): Promise<UnitArchetype> {
  const response = await fetch(`${BASE}/v2/units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archetype, pngBase64 }),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return (body as { archetype: UnitArchetype }).archetype;
}

export async function updateUnitV2(id: string, archetype: UnitArchetype, pngBase64?: string): Promise<UnitArchetype> {
  const response = await fetch(`${BASE}/v2/units/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archetype, pngBase64 }),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return (body as { archetype: UnitArchetype }).archetype;
}

export async function setUnitEnabledV2(id: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${BASE}/v2/units/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
}

export async function deleteUnitV2(id: string, force = false): Promise<{ warning?: string }> {
  const url = `${BASE}/v2/units/${encodeURIComponent(id)}${force ? '?force=true' : ''}`;
  const response = await fetch(url, { method: 'DELETE' });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return body as { warning?: string };
}

export async function createBuildingV2(
  archetype: BuildingArchetype,
  pngBase64?: string,
): Promise<BuildingArchetype> {
  const response = await fetch(`${BASE}/v2/buildings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archetype, pngBase64 }),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return (body as { archetype: BuildingArchetype }).archetype;
}

export async function updateBuildingV2(
  id: string,
  archetype: BuildingArchetype,
  pngBase64?: string,
): Promise<BuildingArchetype> {
  const response = await fetch(`${BASE}/v2/buildings/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archetype, pngBase64 }),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return (body as { archetype: BuildingArchetype }).archetype;
}

export async function setBuildingEnabledV2(id: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${BASE}/v2/buildings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(errorFromBody(await parseJson(response)));
  }
}

export async function deleteBuildingV2(id: string, force = false): Promise<{ warning?: string }> {
  const url = `${BASE}/v2/buildings/${encodeURIComponent(id)}${force ? '?force=true' : ''}`;
  const response = await fetch(url, { method: 'DELETE' });
  const body = await parseJson(response);
  if (!response.ok) {
    throw new Error(errorFromBody(body));
  }
  return body as { warning?: string };
}

export function assetUrl(assetPath: string): string {
  return `${BASE}/assets/${assetPath}`;
}

export function buildSandboxUrl(options: {
  archetypeId: string;
  kind: 'unit' | 'building';
  seed?: number;
  debug?: boolean;
}): string {
  const params = new URLSearchParams({
    mode: 'interaction-lab',
    seed: String(options.seed ?? 1),
  });
  if (options.debug) {
    params.set('touchDebug', '1');
  }
  params.set(options.kind === 'unit' ? 'spawnUnit' : 'spawnBuilding', options.archetypeId);
  return `http://127.0.0.1:4173/?${params.toString()}`;
}
