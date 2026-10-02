/**
 * The Rust core's throughput, compiled to WebAssembly, on the JavaScript
 * core's own benchmark: `bench/cpu.ts`'s workloads, the same bytes, the same
 * registers and segments, the same batches and the same two seconds each, so
 * the two reports stand side by side.
 *
 *   pnpm bench:wasm
 *
 * It loads `target/wasm32-unknown-unknown/release/winbox_wasm.wasm`, which
 * `pnpm build:wasm` makes, straight into Node's WebAssembly.
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

const { instance } = await WebAssembly.instantiate(readFileSync(WASM));
const core = instance.exports;

/** A descriptor as `bench/cpu.ts` writes it: present, writable data. */
function writeDescriptor(memory, index, base, limit) {
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

function prepare(workload, protectedMode) {
  core.machine_new(0x100000);

  /* The machine's memory, viewed after it was made: making it can grow
   * WebAssembly's memory, and a view of the old buffer would be detached. */
  const memory = new Uint8Array(core.memory.buffer, core.memory_ptr(), 0x100000);
  let [code, data, stack] = [CODE_SEGMENT, DATA_SEGMENT, STACK_SEGMENT];

  if (protectedMode) {
    writeDescriptor(memory, 1, CODE_SEGMENT << 4, 0xffff);
    writeDescriptor(memory, 2, DATA_SEGMENT << 4, 0xffff);
    writeDescriptor(memory, 3, STACK_SEGMENT << 4, 0xffff);
    core.set_protected(1, GDT_BASE);
    [code, data, stack] = [0x08, 0x10, 0x18];
  }

  workload.code.forEach((byte, index) => {
    memory[(CODE_SEGMENT << 4) + index] = byte;
  });

  core.load_segment(CS, code);
  core.load_segment(DS, data);
  core.load_segment(ES, data);
  core.load_segment(SS, stack);
  core.set_ip(0);

  for (const [register, value] of [
    [SP, 0x1000],
    [BP, 0x0800],
    [BX, 0x0100],
    [AX, 0x1234],
    [CX, 0x00ff],
    [DX, 0x5678],
  ]) {
    core.set_reg(register, value);
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
