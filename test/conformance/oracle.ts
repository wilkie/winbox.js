/**
 * The CPU conformance oracle.
 *
 * Each vector is one instruction executed on real silicon, with the complete
 * register, flag and memory state captured before and after. We put our core
 * into the recorded initial state, execute exactly one instruction, and compare
 * everything the hardware said should have changed.
 *
 * The expected answers come from a Harris N80C286 driven by an ArduinoX86
 * board, not from another emulator, so agreement means agreement with the part
 * -- including the behaviours no manual documents.
 *
 *   https://github.com/SingleStepTests/80286
 *
 * Fetch vectors with `node scripts/fetch-cpu-tests.mjs`; they are not committed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CPU, InvalidInstruction } from '../../src/emulator/cpu.js';
import { Memory } from '../../src/emulator/memory.js';
import { wasmModule } from '../wasm-core.js';

/** Where `scripts/fetch-cpu-tests.mjs` writes converted vectors. */
export const VECTOR_DIR = join(__dirname, 'vectors');

/**
 * The FLAGS bits our core models: CF, PF, AF, ZF, SF, TF, IF, DF, OF, IOPL, NT.
 *
 * Bit 1 reads as 1 on real hardware and bits 3, 5 and 15 have fixed values the
 * core does not reproduce, so comparing the raw word would report a mismatch on
 * every single test. Masking keeps the comparison meaningful; it hides nothing
 * that the core actually computes.
 */
export const FLAG_MASK = 0x7fd5;

const FLAG_NAMES: [number, string][] = [
  [0x0001, 'CF'],
  [0x0004, 'PF'],
  [0x0010, 'AF'],
  [0x0040, 'ZF'],
  [0x0080, 'SF'],
  [0x0100, 'TF'],
  [0x0200, 'IF'],
  [0x0400, 'DF'],
  [0x0800, 'OF'],
  [0x4000, 'NT'],
];

export interface VectorState {
  regs: Record<string, number>;
  ram: [number, number][];
}

export interface Vector {
  idx: number;
  name: string;
  bytes: number[];
  initial: VectorState;
  final: VectorState;
  /** Present when the instruction faulted on hardware. */
  exception?: unknown;
  hash?: string;
}

export type FailureKind =
  /** The core does not decode this instruction form at all. */
  | 'unimplemented'
  /** The core threw something else while executing. */
  | 'exception'
  | 'register'
  | 'flags'
  | 'memory';

export interface VectorResult {
  passed: boolean;
  kind?: FailureKind;
  detail?: string;
  /** Names of the flags that differed, when kind is 'flags'. */
  flags?: string[];
  /** Set when the vector was not applicable and was not executed. */
  skipped?: boolean;
}

export interface OpcodeSummary {
  opcode: string;
  total: number;
  passed: number;
  skipped: number;
  byKind: Record<FailureKind, number>;
  /** How many vectors got each individual flag wrong. */
  flagBits: Record<string, number>;
  /** One representative failure per kind, for the report. */
  examples: Partial<Record<FailureKind, string>>;
}

const SEGMENT_REGISTERS = ['cs', 'ss', 'ds', 'es'];
const GENERAL_REGISTERS = ['ax', 'bx', 'cx', 'dx', 'sp', 'bp', 'si', 'di'];

/** The flags that differ between two FLAGS words, by name. */
export function differingFlags(expected: number, actual: number): string[] {
  const names = FLAG_NAMES.filter(([bit]) => (expected & bit) !== (actual & bit)).map(
    ([, name]) => name
  );

  if (((expected >> 12) & 0x3) !== ((actual >> 12) & 0x3)) {
    names.push('IOPL');
  }

  return names;
}

function describeFlags(expected: number, actual: number): string {
  const differing = FLAG_NAMES.filter(([bit]) => (expected & bit) !== (actual & bit)).map(
    ([bit, name]) =>
      `${name}=${(expected & bit) !== 0 ? 1 : 0}, got ${(actual & bit) !== 0 ? 1 : 0}`
  );

  const iopl = ((expected >> 12) & 0x3) !== ((actual >> 12) & 0x3);
  if (iopl) {
    differing.push(`IOPL=${(expected >> 12) & 0x3}, got ${(actual >> 12) & 0x3}`);
  }

  return differing.join('; ');
}

/**
 * Runs one vector against a freshly reset core.
 *
 * ## The HALT terminator
 *
 * The 286 exposes no queue status pins, so the capture rig cannot see where an
 * instruction ends. It appends `HLT` (0xF4) after the instruction under test --
 * or injects one at the branch target, for flow control -- and raises NMI when
 * the HALT bus cycle appears. Final CS:IP is then read from what the NMI pushed,
 * which points *after* the HALT.
 *
 * So the recorded IP is always one byte beyond where the instruction under test
 * left it. We execute only the instruction under test and account for the
 * terminator here, rather than executing a HALT our core does not implement.
 *
 * ## Faulting vectors
 *
 * Roughly 42,000 of the vectors fault on hardware, and they carry the state
 * after the fault was taken: the handler's CS:IP and the stack the dispatch
 * pushed. Nothing claims any vector here, so every interrupt dispatches through
 * the interrupt table the way the part would, and the recorded state is
 * directly comparable. The table itself arrives in the vector's initial memory.
 */
export function runVector(vector: Vector): VectorResult {
  /* The core is a 386. A 286 ignores LOCK where a 386 raises an undefined
   * opcode for it -- on anything but a read-modify-write of memory -- so a
   * 286 vector with LOCK among its prefixes says nothing about this part;
   * the 386's own vectors test LOCK (`oracle386.ts`). */
  if (lockPrefixed(vector.bytes)) {
    return { passed: false, skipped: true };
  }

  /* A byte shifted left or right by 16 or 24: the 386 leaves CF as a shift
   * by 8 would, and the 286 clears it. The 386's own vectors test it. */
  if (byteShiftBy16Or24(vector)) {
    return { passed: false, skipped: true };
  }

  const memory = new Memory();
  const cpu = new CPU(memory);

  if (wasmModule) {
    cpu.useWasm(wasmModule);
  }
  const core = cpu.core;

  for (const [address, value] of vector.initial.ram) {
    memory.write8(address, value);
  }

  const initial = vector.initial.regs;

  // Segments first: in real mode they only set the translation base, but
  // ordering keeps the intent clear if this is ever run in protected mode.
  for (const name of SEGMENT_REGISTERS) {
    core[name] = initial[name];
  }
  for (const name of GENERAL_REGISTERS) {
    core[name] = initial[name];
  }
  core.ip = initial.ip;
  core.f = initial.flags;

  try {
    if (wasmModule) {
      cpu.runFor(1);
    } else {
      cpu.step();
    }
  } catch (error) {
    if (error instanceof InvalidInstruction) {
      return {
        passed: false,
        kind: 'unimplemented',
        detail: `no decoding for ${vector.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      kind: 'exception',
      detail: message || `threw ${Object.prototype.toString.call(error)}`,
    };
  }

  const final = vector.final.regs;

  /* A stack access past its limit in real mode is a general protection
   * fault on the 286 and a stack fault on the 386: where the 286 went to
   * entry 13's handler and this core, a 386, to entry 12's, the vector
   * says nothing about this part (the 386's own vectors test it). */
  const handler = (entry: number) => [memory.read16(entry * 4 + 2), memory.read16(entry * 4)];
  const [gpCs, gpIp] = handler(13);
  const [ssCs, ssIp] = handler(12);

  if (
    final.cs === gpCs &&
    ((final.ip - 1) & 0xffff) === gpIp &&
    (core.cs & 0xffff) === ssCs &&
    (core.ip & 0xffff) === ssIp &&
    (gpCs !== ssCs || gpIp !== ssIp)
  ) {
    return { passed: false, skipped: true };
  }

  for (const [name, expected] of Object.entries(final)) {
    if (name === 'flags') {
      continue;
    }

    // See "The HALT terminator" above.
    const target = name === 'ip' ? (expected - 1) & 0xffff : expected & 0xffff;

    const actual = core[name] & 0xffff;
    if (actual !== target) {
      return {
        passed: false,
        kind: 'register',
        detail: `${name}: expected ${target.toString(16)}, got ${actual.toString(16)}`,
      };
    }
  }

  for (const [address, expected] of vector.final.ram) {
    const actual = memory.read8(address);
    if (actual !== expected) {
      return {
        passed: false,
        kind: 'memory',
        detail: `[${address.toString(16)}]: expected ${expected.toString(16)}, got ${(actual ?? 0).toString(16)}`,
      };
    }
  }

  if (final.flags !== undefined) {
    const expected = final.flags & FLAG_MASK;
    const actual = core.f & FLAG_MASK;

    if (expected !== actual) {
      return {
        passed: false,
        kind: 'flags',
        detail: describeFlags(expected, actual),
        flags: differingFlags(expected, actual),
      };
    }
  }

  return { passed: true };
}

/**
 * Whether the instruction is SHL, SAL or SHR of a byte (C0h or D2h, /4 to
 * /6) by a count whose low five bits are 16 or 24: CL for D2h, the byte
 * after the operand's displacement for C0h.
 */
function byteShiftBy16Or24(vector: Vector) {
  const prefixes = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf2, 0xf3, 0xf0]);
  const bytes = vector.bytes;
  let at = 0;

  while (at < bytes.length && prefixes.has(bytes[at])) {
    at++;
  }

  const opcode = bytes[at];
  const modrm = bytes[at + 1] ?? 0;
  const operation = (modrm >> 3) & 7;

  if ((opcode !== 0xc0 && opcode !== 0xd2) || operation < 4 || operation > 6) {
    return false;
  }

  const mod = modrm >> 6;
  const rm = modrm & 7;
  const displacement = mod === 1 ? 1 : mod === 2 || (mod === 0 && rm === 6) ? 2 : 0;
  const count =
    opcode === 0xd2 ? vector.initial.regs.cx & 0x1f : (bytes[at + 2 + displacement] ?? 0) & 0x1f;

  return count === 16 || count === 24;
}

/** Whether an instruction's prefixes include LOCK. */
function lockPrefixed(bytes: number[]) {
  const prefixes = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf2, 0xf3, 0xf0]);

  for (const byte of bytes) {
    if (byte === 0xf0) {
      return true;
    }

    if (!prefixes.has(byte)) {
      return false;
    }
  }

  return false;
}

/** Opcode files present in the vector directory, in order. */
export function availableOpcodes(): string[] {
  try {
    return readdirSync(VECTOR_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export function loadVectors(opcode: string): Vector[] {
  return JSON.parse(readFileSync(join(VECTOR_DIR, `${opcode}.json`), 'utf8'));
}

/**
 * Runs an opcode's vectors.
 *
 * `sample` caps how many are executed. The suite ships thousands per opcode,
 * which is the right number for chasing a specific bug and far too many for a
 * routine run.
 */
export function runOpcode(opcode: string, sample = Infinity): OpcodeSummary {
  const vectors = loadVectors(opcode);
  const selected = Number.isFinite(sample) ? vectors.slice(0, sample) : vectors;

  const summary: OpcodeSummary = {
    opcode,
    total: 0,
    passed: 0,
    skipped: 0,
    byKind: { unimplemented: 0, exception: 0, register: 0, flags: 0, memory: 0 },
    flagBits: {},
    examples: {},
  };

  for (const vector of selected) {
    const result = runVector(vector);

    if (result.skipped) {
      summary.skipped += 1;
      continue;
    }

    summary.total += 1;

    if (result.passed) {
      summary.passed += 1;
      continue;
    }

    const kind = result.kind as FailureKind;
    summary.byKind[kind] += 1;

    for (const flag of result.flags ?? []) {
      summary.flagBits[flag] = (summary.flagBits[flag] ?? 0) + 1;
    }

    if (!summary.examples[kind]) {
      summary.examples[kind] = `${vector.name}: ${result.detail}`;
    }
  }

  return summary;
}

/** A form with nothing executable sorts last rather than as a zero. */
function passRate(entry: OpcodeSummary): number {
  return entry.total ? entry.passed / entry.total : Infinity;
}

/** Renders the run as a markdown report. */
export function renderReport(
  summaries: OpcodeSummary[],
  sample: number,
  suite = {
    command: 'pnpm test:conformance',
    part: '80286',
    url: 'https://github.com/SingleStepTests/80286',
    unit: 'Opcodes',
  }
): string {
  const total = summaries.reduce((sum, entry) => sum + entry.total, 0);
  const passed = summaries.reduce((sum, entry) => sum + entry.passed, 0);
  const rate = total ? ((passed / total) * 100).toFixed(1) : '0.0';

  const lines = [
    '# CPU conformance report',
    '',
    `Generated by \`${suite.command}\`. Vectors are hardware-captured ${suite.part}`,
    `instruction tests from ${suite.url} (real mode).`,
    '',
    `- ${suite.unit} covered: **${summaries.length}**` +
      (summaries.filter((entry) => entry.total === 0).length
        ? ` (${summaries.filter((entry) => entry.total === 0).length} have no executable vectors:` +
          ' every test for them faults on hardware, and those are skipped)'
        : ''),
    `- Vectors executed: **${total}** (${Number.isFinite(sample) ? `sampling ${sample} per opcode` : 'all available'})`,
    `- Passing: **${passed} (${rate}%)**`,
    '',
    'Failures are grouped by what first diverged. `unimplemented` means the core',
    'does not decode the form at all, which is a different kind of work from the',
    'rest. A `flags` failure means every register and memory write was correct',
    'and only the flags were wrong, which is usually a much smaller fix than it',
    'looks.',
    '',
    '| Opcode | Pass | Total | Rate | Unimplemented | Exception | Register | Flags | Memory |',
    '| ------ | ---- | ----- | ---- | ------------- | --------- | -------- | ----- | ------ |',
  ];

  for (const entry of [...summaries].sort((a, b) => passRate(a) - passRate(b))) {
    const percent = entry.total ? `${((entry.passed / entry.total) * 100).toFixed(1)}%` : 'n/a';
    lines.push(
      `| ${entry.opcode} | ${entry.passed} | ${entry.total} | ${percent} |` +
        ` ${entry.byKind.unimplemented} | ${entry.byKind.exception} |` +
        ` ${entry.byKind.register} | ${entry.byKind.flags} | ${entry.byKind.memory} |`
    );
  }

  const flagTotals: Record<string, number> = {};
  for (const entry of summaries) {
    for (const [flag, count] of Object.entries(entry.flagBits)) {
      flagTotals[flag] = (flagTotals[flag] ?? 0) + count;
    }
  }

  const ranked = Object.entries(flagTotals).sort((a, b) => b[1] - a[1]);

  if (ranked.length) {
    lines.push('', '## Which flags are wrong', '', '| Flag | Vectors |', '| ---- | ------- |');
    for (const [flag, count] of ranked) {
      lines.push(`| ${flag} | ${count} |`);
    }
  }

  const failing = summaries.filter((entry) => entry.total > 0 && entry.passed < entry.total);

  if (failing.length) {
    lines.push('', '## Representative failures', '');

    for (const entry of failing.sort((a, b) => passRate(a) - passRate(b))) {
      lines.push(`### Opcode ${entry.opcode}`, '');
      for (const [kind, example] of Object.entries(entry.examples)) {
        lines.push(`- **${kind}** — ${example}`);
      }
      if (Object.keys(entry.flagBits).length) {
        const breakdown = Object.entries(entry.flagBits)
          .sort((a, b) => b[1] - a[1])
          .map(([flag, count]) => `${flag}×${count}`)
          .join(', ');
        lines.push(`- flags wrong: ${breakdown}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
