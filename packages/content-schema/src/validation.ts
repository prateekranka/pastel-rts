export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

export function requirePositiveInt(value: unknown, label: string): number {
  const n = requireInt(value, label);
  if (n <= 0) {
    throw new Error(`${label} must be > 0`);
  }
  return n;
}

export function requireNonNegativeInt(value: unknown, label: string): number {
  const n = requireInt(value, label);
  if (n < 0) {
    throw new Error(`${label} must be >= 0`);
  }
  return n;
}

export function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

export function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isValidContentId(id: string): boolean {
  return ID_PATTERN.test(id) && id.length <= 64;
}

export function requireContentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidContentId(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function isSafeAssetPath(path: string): boolean {
  return (
    path.trim().length > 0 &&
    !path.includes('..') &&
    !path.startsWith('/') &&
    !path.includes('\\')
  );
}

export function requireSafeAssetPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafeAssetPath(value)) {
    throw new Error(`${label} must be a safe relative asset path`);
  }
  return value;
}
