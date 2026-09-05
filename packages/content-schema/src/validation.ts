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
const MAX_PATH_DECODE_PASSES = 8;

export function isValidContentId(id: string): boolean {
  return ID_PATTERN.test(id) && id.length <= 64;
}

export function requireContentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidContentId(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/**
 * Check the decoded form as well as the submitted form. This prevents a
 * caller from hiding traversal separators behind URI encoding.
 */
export function isSafeAssetPath(path: string): boolean {
  if (path.length === 0 || path.trim().length === 0 || path !== path.trim()) {
    return false;
  }
  let decoded = path;
  let stable = false;
  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) {
      stable = true;
      break;
    }
    decoded = next;
  }
  if (!stable) {
    return false;
  }
  if (
    decoded.length === 0 ||
    decoded.startsWith('/') ||
    decoded.includes(String.fromCharCode(92)) ||
    decoded.includes(String.fromCharCode(0)) ||
    decoded.includes(':')
  ) {
    return false;
  }
  const segments = decoded.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function requireSafeAssetPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSafeAssetPath(value)) {
    throw new Error(`${label} must be a safe relative asset path`);
  }
  return value;
}
