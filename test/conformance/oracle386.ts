/**
 * The CPU conformance oracle for the 386: the hardware-generated real-mode
 * tests of https://github.com/SingleStepTests/80386, captured from an Intel
 * 386EX with every opcode under every operand- and address-size prefix it
 * takes. What a program running on Windows in protected mode asks of the
 * processor is the same instructions; only segment checks differ, and those
 * are tested elsewhere.
 *
 * Each test's state is set, one instruction is executed, and the 32-bit
 * registers, the memory and the flags are compared with what the part left,
 * under the masks the suite gives for what it leaves undefined, and the
 * flags compared under its table's mask of those each opcode defines. As for the
 * 286's tests (`oracle.ts`), the part ends each test on a HALT, and its final
 * EIP is one past it.
 *
 *   node scripts/fetch-cpu-tests.mjs --cpu 386          # a subset
 *   node scripts/fetch-cpu-tests.mjs --cpu 386 --all    # all 941 files, ~600 MiB
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CPU, InvalidInstruction } from '../../src/emulator/cpu.js';
import { Memory } from '../../src/emulator/memory.js';
import { wasmModule } from '../wasm-core.js';
import { differingFlags, FLAG_MASK, type FailureKind, type OpcodeSummary } from './oracle.js';
import { parseMoo, type MooTest, type Register32 } from './moo.js';

/** Where `scripts/fetch-cpu-tests.mjs --cpu 386` keeps the suite's files. */
export const VECTOR_DIR_386 = join(__dirname, 'vectors386');

/** The registers compared, in the index order `writeRegister32` takes. */
const GENERAL: [Register32, number][] = [
  ['eax', 0],
  ['ecx', 1],
  ['edx', 2],
  ['ebx', 3],
  ['esp', 4],
  ['ebp', 5],
  ['esi', 6],
  ['edi', 7],
];

const SEGMENTS: Register32[] = ['cs', 'ss', 'ds', 'es', 'fs', 'gs'];

/** Tests the suite has since found bad, by hash. */
function revoked(): Set<string> {
  const path = join(VECTOR_DIR_386, 'revocation_list.txt');

  if (!existsSync(path)) {
    return new Set();
  }

  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#'))
  );
}

/**
 * The flags each opcode leaves undefined, as masks of those to compare: the
 * suite's table, `80386.csv`, keyed by opcode and, for a group, the member
 * (`C1.4`), as the files are named without their prefixes.
 */
function undefinedFlags(): Map<string, number> {
  const path = join(VECTOR_DIR_386, '80386.csv');
  const masks = new Map<string, number>();

  if (!existsSync(path)) {
    return masks;
  }

  const [head, ...rows] = readFileSync(path, 'utf8').split(/\r?\n/);
  const columns = head.split(',');
  const at = (name: string) => columns.indexOf(name);

  for (const row of rows) {
    const cells = row.split(',');
    const mask = cells[at('f_umask')];

    if (!cells[at('op')] || !mask) {
      continue;
    }

    const member = cells[at('ex')];
    const key = member ? `${cells[at('op')]}.${member}` : cells[at('op')];

    masks.set(key.toUpperCase(), parseInt(mask, 16));
  }

  return masks;
}

/** A file's name without its size prefixes: `6766C1.4` is `C1.4`. */
export function baseOf(stem: string) {
  return stem.toUpperCase().replace(/^(?:6[67])+(?=..)/, '');
}

/**
 * The instructions set aside: IN, OUT, INS and OUTS read and write ports,
 * and what they read comes from the bus the tests capture, which this
 * harness does not model; HLT stops the part, which the tests end on. In a
 * program on Windows each is privileged, and Windows traps it.
 */
const SET_ASIDE = new Set([
  0x6c, 0x6d, 0x6e, 0x6f, 0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef, 0xf4,
]);

/** The instruction's opcode, past its prefixes. */
function opcodeOf(bytes: number[]) {
  const prefixes = new Set([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0x66, 0x67, 0xf0, 0xf2, 0xf3]);

  return bytes.find((byte) => !prefixes.has(byte));
}

export interface VectorResult386 {
  passed: boolean;
  kind?: FailureKind;
  detail?: string;
  flags?: string[];
}

/** Runs one test on a fresh core. */
export function runTest386(
  test: MooTest,
  fileMasks: Partial<Record<Register32, number>>,
  definedFlags = 0xffff
): VectorResult386 {
  const memory = new Memory();
  const cpu = new CPU(memory);

  if (wasmModule) {
    cpu.useWasm(wasmModule);
  }
  const core: any = cpu.core;
  const initial = test.initial.regs;

  for (const [address, value] of test.initial.ram) {
    memory.write8(address, value);
  }

  for (const name of SEGMENTS) {
    core[name] = (initial[name] ?? 0) & 0xffff;
  }

  for (const [name, index] of GENERAL) {
    core.writeRegister32(index, (initial[name] ?? 0) >>> 0);
  }

  core.ip = (initial.eip ?? 0) & 0xffff;
  core.f = (initial.eflags ?? 0) & 0xffff;

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
        detail: `no decoding for ${test.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);

    return {
      passed: false,
      kind: 'exception',
      detail: message || `threw ${Object.prototype.toString.call(error)}`,
    };
  }

  const final = test.final.regs;
  const mask = (name: Register32) =>
    (test.final.masks[name] ?? fileMasks[name] ?? 0xffffffff) >>> 0;

  for (const [name, index] of GENERAL) {
    if (final[name] === undefined) {
      continue;
    }

    const expected = (final[name]! & mask(name)) >>> 0;
    const actual = (core.readRegister32(index) & mask(name)) >>> 0;

    if (actual !== expected) {
      return {
        passed: false,
        kind: 'register',
        detail: `${name}: expected ${expected.toString(16)}, got ${actual.toString(16)}`,
      };
    }
  }

  for (const name of SEGMENTS) {
    if (final[name] === undefined) {
      continue;
    }

    const expected = final[name]! & 0xffff;
    const actual = core[name] & 0xffff;

    if (actual !== expected) {
      return {
        passed: false,
        kind: 'register',
        detail: `${name}: expected ${expected.toString(16)}, got ${actual.toString(16)}`,
      };
    }
  }

  if (final.eip !== undefined) {
    const expected = (final.eip - 1) & 0xffff;
    const actual = core.ip & 0xffff;

    if (actual !== expected) {
      return {
        passed: false,
        kind: 'register',
        detail: `eip: expected ${expected.toString(16)}, got ${actual.toString(16)}`,
      };
    }
  }

  for (const [address, expected] of test.final.ram) {
    const actual = memory.read8(address);

    if (actual !== expected) {
      return {
        passed: false,
        kind: 'memory',
        detail: `[${address.toString(16)}]: expected ${expected.toString(16)}, got ${(actual ?? 0).toString(16)}`,
      };
    }
  }

  if (final.eflags !== undefined) {
    const kept = FLAG_MASK & mask('eflags') & definedFlags;
    const expected = final.eflags & kept;
    const actual = core.f & kept;

    if (expected !== actual) {
      return {
        passed: false,
        kind: 'flags',
        detail: differingFlags(expected, actual).join(', '),
        flags: differingFlags(expected, actual),
      };
    }
  }

  return { passed: true };
}

/** The suite's files present, by name without `.MOO.gz`: `01`, `6601`, `80.4`, `0FA0`. */
export function availableFiles386(): string[] {
  try {
    return readdirSync(VECTOR_DIR_386)
      .filter((name) => name.toUpperCase().endsWith('.MOO.GZ'))
      .map((name) => name.replace(/\.MOO\.gz$/i, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Runs a file's tests, `sample` of them at most, less any revoked. */
export function runFile386(stem: string, sample = Infinity): OpcodeSummary {
  const file = parseMoo(readFileSync(join(VECTOR_DIR_386, `${stem}.MOO.gz`)));
  const bad = revoked();
  const defined = undefinedFlags().get(baseOf(stem)) ?? 0xffff;
  const tests = file.tests.filter((test) => !bad.has(test.hash));
  const selected = Number.isFinite(sample) ? tests.slice(0, sample) : tests;

  const summary: OpcodeSummary = {
    opcode: stem,
    total: 0,
    passed: 0,
    skipped: file.tests.length - tests.length,
    byKind: { unimplemented: 0, exception: 0, register: 0, flags: 0, memory: 0 },
    flagBits: {},
    examples: {},
  };

  for (const test of selected) {
    if (SET_ASIDE.has(opcodeOf(test.bytes) ?? -1)) {
      summary.skipped += 1;
      continue;
    }

    const result = runTest386(test, file.masks, defined);

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
      summary.examples[kind] = `${test.name} (${test.bytes
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')}): ${result.detail}`;
    }
  }

  return summary;
}
