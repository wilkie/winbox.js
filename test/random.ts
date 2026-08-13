/**
 * Deterministic random numbers for the test suite.
 *
 * The emulator tests draw their operands randomly, which is a good way to
 * cover an instruction's input space. It is a bad way to report a failure: if
 * every run draws different values, a failing test cannot be reproduced from
 * the report, a baseline cannot be trusted, and "did that change fix
 * something?" has no answer.
 *
 * So the generator is seeded, and re-seeded before every test from the test's
 * own name. That has two useful consequences:
 *
 * * A whole run is reproducible from one number, printed at startup.
 * * A single test draws the same values whether it runs alone or in the middle
 *   of the full suite, so `-t 'name'` reproduces what CI saw.
 */

let state = 1;

/** mulberry32: small, fast, and good enough for choosing test operands. */
function next(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** FNV-1a, so a test name maps to a stable seed. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Sets the generator's state. */
export function seed(value: number): void {
  state = value >>> 0;
}

/** The base seed for this run, from WINBOX_TEST_SEED. */
export function baseSeed(): number {
  const configured = Number(process.env.WINBOX_TEST_SEED);
  return Number.isFinite(configured) && configured !== 0 ? configured >>> 0 : 1;
}

/** Seeds from the run's base seed combined with a test's name. */
export function seedForTest(name: string): void {
  seed((baseSeed() ^ hashSeed(name)) >>> 0);
}

/** A float in [0, 1), replacing Math.random in tests. */
export function random(): number {
  return next();
}
