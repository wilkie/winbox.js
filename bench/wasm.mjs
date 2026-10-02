/**
 * The Rust core's throughput, compiled to WebAssembly, on the JavaScript
 * core's own benchmark: `bench/cpu.ts`'s workloads, the same bytes, the same
 * registers and segments, the same batches and the same two seconds each, so
 * the two reports stand side by side.
 *
 *   pnpm bench:wasm
 *
 * It loads `target/wasm32-unknown-unknown/release/winbox_wasm.wasm`, which
 * `pnpm build:wasm` makes, straight into Node's WebAssembly, on a memory laid
 * out as the machine's is, and sets the registers through the state block
 * the two cores pass between them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WASM = join(ROOT, 'target', 'wasm32-unknown-unknown', 'release', 'winbox_wasm.wasm');

/** As `bench/cpu.ts`. */
const DURATION = 2000;
const BATCH = 20000;
const CODE_SEGMENT = 0x1000;
const DATA_SEGMENT = 0x2000;
const STACK_SEGMENT = 0x3000;
const GDT_BASE = 0x80000;

const ES = 0;
const CS = 1;
const SS = 2;
const DS = 3;
const [AX, CX, DX, BX, SP, BP] = [0, 1, 2, 3, 4, 5];

// prettier-ignore
const WORKLOADS = [
  { name: 'alu', what: 'register-only arithmetic, no memory operands',
    code: [0x01, 0xd8, 0x29, 0xc8, 0x31, 0xd0, 0x21, 0xd8, 0x09, 0xc8, 0xd1, 0xe0, 0x40, 0x48, 0xeb, 0xf0] },
  { name: 'memory', what: 'byte and word loads and stores through a base register',
    code: [0x8a, 0x07, 0x88, 0x07, 0x8b, 0x07, 0x89, 0x07, 0x8b, 0x47, 0x10, 0x89, 0x47, 0x20, 0xeb, 0xf0] },
  { name: 'stack', what: 'pushes and pops, the shape of a call frame',
    code: [0x50, 0x53, 0x51, 0x59, 0x5b, 0x58, 0xeb, 0xf8] },
  { name: 'mixed', what: 'arithmetic against memory, the shape of compiled code',
    code: [0x8b, 0x07, 0x03, 0x47, 0x02, 0x89, 0x47, 0x04, 0x2b, 0x47, 0x06, 0x89, 0x07, 0x43, 0x4b, 0xeb, 0xef] },
];

/**
 * The machine's memory, laid out as `src/emulator/memory.ts` lays it out:
 * the module's own below 128 KiB, the block table at 128 KiB, the blocks
 * from 256 KiB. Block 0, the first mebibyte, is all the workloads use.
 */
const TABLE_AT = 0x20000;
const BLOCK_AT = 0x40000;
const wasmMemory = new WebAssembly.Memory({ initial: (BLOCK_AT + 0x100000) >>> 16 });
const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {
  env: { memory: wasmMemory },
});
const core = instance.exports;
const table = new Uint32Array(wasmMemory.buffer, TABLE_AT, 4096);
const memory = new Uint8Array(wasmMemory.buffer, BLOCK_AT, 0x100000);
const state = new DataView(wasmMemory.buffer, core.state_ptr(), 144);

table[0] = BLOCK_AT;

/** A descriptor as `bench/cpu.ts` writes it: present, writable data. */
function writeDescriptor(index, base, limit) {
  const at = GDT_BASE + index * 8;

  memory[at] = limit & 0xff;
  memory[at + 1] = (limit >> 8) & 0xff;
  memory[at + 2] = base & 0xff;
  memory[at + 3] = (base >> 8) & 0xff;
  memory[at + 4] = (base >> 16) & 0xff;
  memory[at + 5] = 0x92;
  memory[at + 6] = (limit >> 16) & 0x0f;
  memory[at + 7] = (base >> 24) & 0xff;
}

/** A segment register's cache in the state: selector, base, limit. */
function segment(index, selector, protectedMode) {
  const at = 48 + index * 16;
  const base = protectedMode
    ? [CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT][(selector >> 3) - 1] << 4
    : selector << 4;

  state.setUint32(at, selector, true);
  state.setUint32(at + 4, base, true);
  state.setUint32(at + 8, 0x10000, true);
}

function prepare(workload, protectedMode) {
  memory.fill(0);
  let [code, data, stack] = [CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT];

  if (protectedMode) {
    writeDescriptor(1, CODE_SEGMENT << 4, 0xffff);
    writeDescriptor(2, DATA_SEGMENT << 4, 0xffff);
    writeDescriptor(3, STACK_SEGMENT << 4, 0xffff);
    [code, data, stack] = [0x08, 0x10, 0x18];
  }

  state.setUint32(40, protectedMode ? 1 : 0, true);
  state.setUint32(44, GDT_BASE, true);

  workload.code.forEach((byte, index) => {
    memory[(CODE_SEGMENT << 4) + index] = byte;
  });

  segment(CS, code, protectedMode);
  segment(DS, data, protectedMode);
  segment(ES, data, protectedMode);
  segment(SS, stack, protectedMode);
  state.setUint32(32, 0, true);
  state.setUint32(36, 2, true);

  for (const [register, value] of [
    [SP, 0x1000],
    [BP, 0x0800],
    [BX, 0x0100],
    [AX, 0x1234],
    [CX, 0x00ff],
    [DX, 0x5678],
  ]) {
    state.setUint32(register * 4, value, true);
  }
}

/** Runs one workload for DURATION and returns instructions per second. */
function measure(workload, protectedMode) {
  prepare(workload, protectedMode);

  // Let the engine settle before the clock starts.
  core.run(BATCH);

  const started = performance.now();
  let executed = 0;
  let elapsed;

  do {
    const ran = core.run(BATCH);

    if (ran !== BATCH) {
      throw new Error(
        `${workload.name} stopped: exit ${core.last_exit().toString(16)} after ${ran}`
      );
    }

    executed += BATCH;
    elapsed = performance.now() - started;
  } while (elapsed < DURATION);

  return (executed / elapsed) * 1000;
}

const format = (rate) => `${(rate / 1e6).toFixed(2)}M`.padStart(8);

console.log('\nCPU throughput -- Rust core, WebAssembly');
console.log(`${''.padEnd(9)}${'real'.padStart(8)}${'protected'.padStart(11)}   overhead`);

for (const workload of WORKLOADS) {
  const real = measure(workload, false);
  const protectedRate = measure(workload, true);
  const overhead = ((real / protectedRate - 1) * 100).toFixed(1);

  console.log(
    `${workload.name.padEnd(9)}${format(real)}${format(protectedRate).padStart(11)}` +
      `${`${overhead}%`.padStart(11)}   ${workload.what}`
  );
}

console.log('\ninstructions per second, higher is better\n');
