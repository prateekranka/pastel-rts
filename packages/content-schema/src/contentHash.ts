import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== 'contentHash')
      .sort();
    const result: { [key: string]: JsonValue } = {};
    for (const key of keys) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  throw new Error('Unsupported value in canonical content');
}

export function computeContentHash(content: unknown): string {
  const canonical = canonicalize(content);
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

export function createInitialRevision(): string {
  return '1';
}

export function bumpRevision(current: string): string {
  const parsed = Number.parseInt(current, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return String(parsed + 1);
  }
  return `${current}-next`;
}

export function normalizeRevision(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return createInitialRevision();
}
