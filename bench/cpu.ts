'use strict';

import { Machine } from '../src/emulator/machine.js';

/**
 * A throughput benchmark for the execution core.
 *
 * Run it with `pnpm bench`. It reports instructions per second for a handful
 * of loops chosen to weight the paths differently: one that never touches
 * memory, one that is nothing but memory, and one shaped like the register
 * spill and reload that compiled code actually does.
 *
 * The numbers are only meaningful against each other on the same machine on
 * the same day. What they are for is answering "did that change cost us
 * anything", which is a question about a ratio.
 */

/** How long to run each workload before reporting, in milliseconds. */
const DURATION = 2000;

/** Instructions executed between clock reads, to keep timing off the hot path. */
const BATCH = 20000;

const CODE_SEGMENT = 0x1000;
const DATA_SEGMENT = 0x2000;
const STACK_SEGMENT = 0x3000;

const GDT_BASE = 0x80000;

interface Workload {
  name: string;
  what: string;
  code: number[];
}

/**
 * Each workload is a straight run of instructions ending in a jump back to the
 * top, so the core executes it forever without any host involvement.
 */
// prettier-ignore
const WORKLOADS: Workload[] = [
  {
    name: 'alu',
    what: 'register-only arithmetic, no memory operands',
    code: [
      0x01, 0xd8,        // add ax, bx
      0x29, 0xc8,        // sub ax, cx
      0x31, 0xd0,        // xor ax, dx
      0x21, 0xd8,        // and ax, bx
      0x09, 0xc8,        // or  ax, cx
      0xd1, 0xe0,        // shl ax, 1
      0x40,              // inc ax
      0x48,              // dec ax
      0xeb, 0xf1,        // jmp back to the top
    ],
  },
  {
    name: 'memory',
    what: 'byte and word loads and stores through a base register',
    code: [
      0x8a, 0x07,        // mov al, [bx]
      0x88, 0x07,        // mov [bx], al
      0x8b, 0x07,        // mov ax, [bx]
      0x89, 0x07,        // mov [bx], ax
      0x8b, 0x47, 0x10,  // mov ax, [bx+0x10]
      0x89, 0x47, 0x20,  // mov [bx+0x20], ax
      0xeb, 0xf1,        // jmp back to the top
    ],
  },
  {
    name: 'stack',
    what: 'pushes and pops, the shape of a call frame',
    code: [
      0x50,              // push ax
      0x53,              // push bx
      0x51,              // push cx
      0x59,              // pop  cx
      0x5b,              // pop  bx
      0x58,              // pop  ax
      0xeb, 0xf8,        // jmp back to the top
    ],
  },
  {
    name: 'mixed',
    what: 'arithmetic against memory, the shape of compiled code',
    code: [
      0x8b, 0x07,        // mov ax, [bx]
      0x03, 0x47, 0x02,  // add ax, [bx+2]
      0x89, 0x47, 0x04,  // mov [bx+4], ax
      0x2b, 0x47, 0x06,  // sub ax, [bx+6]
      0x89, 0x07,        // mov [bx], ax
      0x43,              // inc bx
      0x4b,              // dec bx
      0xeb, 0xef,        // jmp back to the top
    ],
  },
];

/**
 * Writes a descriptor covering the whole of low memory.
 *
 * A flat four-gigabyte segment would make every limit comparison trivially
 * true, which is not what the guest looks like, so these are sized the way a
 * Win16 selector is: one segment, one object, a real limit to compare against.
 */
function writeDescriptor(memory: any, index: number, base: number, limit: number) {
  const at = GDT_BASE + index * 8;

  memory.write16(at + 0, limit & 0xffff);
  memory.write16(at + 2, base & 0xffff);
  memory.write8(at + 4, (base >>> 16) & 0xff);
  memory.write8(at + 5, 0x92); // Present, DPL 0, data, read/write.
  memory.write8(at + 6, (limit >>> 16) & 0x0f);
  memory.write8(at + 7, (base >>> 24) & 0xff);
}

/** Builds a machine with the workload loaded and the registers pointed at it. */
function prepare(workload: Workload, protectedMode: boolean) {
  const machine = new Machine();
  const core = machine.cpu.core as any;

  let code = CODE_SEGMENT;
  let data = DATA_SEGMENT;
  let stack = STACK_SEGMENT;

  if (protectedMode) {
    core.gdtBase = GDT_BASE;
    core.gdtLimit = 0xff;

    writeDescriptor(machine.memory, 1, CODE_SEGMENT << 4, 0xffff);
    writeDescriptor(machine.memory, 2, DATA_SEGMENT << 4, 0xffff);
    writeDescriptor(machine.memory, 3, STACK_SEGMENT << 4, 0xffff);

    code = 0x08;
    data = 0x10;
    stack = 0x18;
  }

  workload.code.forEach((byte, index) => {
    machine.memory.write8((CODE_SEGMENT << 4) + index, byte);
  });

  if (protectedMode) {
    core.msw = 1;
  }

  core.cs = code;
  core.ds = data;
  core.es = data;
  core.ss = stack;

  core.ip = 0;
  core.sp = 0x1000;
  core.bp = 0x0800;
  core.bx = 0x0100;
  core.ax = 0x1234;
  core.cx = 0x00ff;
  core.dx = 0x5678;

  return machine;
}

/** Runs one workload for DURATION and returns instructions per second. */
function measure(workload: Workload, protectedMode: boolean) {
  const machine = prepare(workload, protectedMode);
  const cpu = machine.cpu;

  // Let the JIT settle before the clock starts.
  for (let i = 0; i < BATCH; i++) {
    cpu.step();
  }

  const started = performance.now();
  let executed = 0;
  let elapsed = 0;

  do {
    for (let i = 0; i < BATCH; i++) {
      cpu.step();
    }

    executed += BATCH;
    elapsed = performance.now() - started;
  } while (elapsed < DURATION);

  return (executed / elapsed) * 1000;
}

function format(rate: number) {
  return `${(rate / 1e6).toFixed(2)}M`.padStart(8);
}

const label = process.argv[2] ?? 'core';

console.log(`\nCPU throughput -- ${label}`);
console.log(`${''.padEnd(9)}${'real'.padStart(8)}${'protected'.padStart(11)}   overhead`);

const rates: Record<string, number> = {};

for (const workload of WORKLOADS) {
  const real = measure(workload, false);
  const protectedRate = measure(workload, true);

  rates[`${workload.name}.real`] = real;
  rates[`${workload.name}.protected`] = protectedRate;

  const overhead = ((real / protectedRate - 1) * 100).toFixed(1);

  console.log(
    `${workload.name.padEnd(9)}${format(real)}${format(protectedRate).padStart(11)}` +
      `${`${overhead}%`.padStart(11)}   ${workload.what}`
  );
}

console.log('\ninstructions per second, higher is better\n');

if (process.env.BENCH_JSON) {
  console.log(JSON.stringify(rates, null, 2));
}
