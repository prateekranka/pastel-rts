import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize, computeContentHash } from './contentHash';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches NIST test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes unicode the same way as node crypto utf8', () => {
    const text = 'sunweaver-é — 🌲';
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
  });
});

describe('computeContentHash', () => {
  it('matches node crypto sha256 of canonical JSON', () => {
    const value = { z: 1, a: { c: 3, b: 2 }, n: [1, 2], note: 'café' };
    const expected = createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
    expect(computeContentHash(value)).toBe(expected);
  });
});
