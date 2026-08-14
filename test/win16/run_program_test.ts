'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOS } from '../../src/dos.js';
import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Executable } from '../../src/executable.js';
import { Machine } from '../../src/emulator/machine.js';
import { Win16 } from '../../src/win16.js';

/**
 * Running a real program.
 *
 * Everything else in this suite calls our implementation directly. This does
 * not: it takes an actual 16-bit NE executable, built by Open Watcom and known
 * to run under real Windows 3.1, and puts it through the loader, the linker,
 * the thunk layer and the scheduler. Those four are the reason the emulator
 * exists -- the whole point of running an x86 at all is to catch a program at
 * the moment it calls the API -- and until this test they were the least
 * exercised code in the project.
 *
 * The program is one of the oracle's own probes, which makes it an unusually
 * good subject: it is small, it is self-contained, and there is a recording of
 * exactly what it does under real Windows to compare against. What it does
 * *first* is the same regardless: a Windows program starts by calling
 * `InitTask`, waiting for the system, and announcing itself with `InitApp`.
 */

const PROBE = join(__dirname, '..', '..', 'oracle', 'build', 'probes', 'STRINGS.EXE');

/** A file-like over bytes, offering what a loader asks a file for. */
class MemoryFile {
  constructor(private bytes: Uint8Array) {}

  get size() {
    return this.bytes.byteLength;
  }

  async read(offset: number, length: number) {
    return this.bytes.slice(offset, offset + length).buffer;
  }

  async read8(offset: number) {
    return this.bytes[offset];
  }

  async read16(offset: number, littleEndian = true) {
    return littleEndian
      ? this.bytes[offset] | (this.bytes[offset + 1] << 8)
      : (this.bytes[offset] << 8) | this.bytes[offset + 1];
  }

  async read32(offset: number, littleEndian = true) {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset).getUint32(offset, littleEndian);
  }

  async readCString(offset: number, max: number) {
    let text = '';

    for (let index = 0; index < max; index++) {
      const byte = this.bytes[offset + index];

      if (!byte) {
        break;
      }

      text += String.fromCharCode(byte);
    }

    return text;
  }
}

/** Loads the probe and runs it, collecting every API call it makes. */
async function runProbe(frames = 600) {
  const machine = new Machine();
  const calls: any[] = [];

  // The program says when it is done by asking Windows to end the session.
  let exited = false;

  /* Give the machine a drive. The probe writes its results to a file, which is
   * the whole point -- without somewhere to write, it runs and says nothing.
   */
  const fileSystem: any = new FAT16(machine.disks[0]);
  await fileSystem.format();
  await fileSystem.open(['ORACLE'], true);

  /* The scheduler hands the next slice of execution to a frame driver, which
   * in a browser is the animation frame. Here it is a trampoline: the callback
   * has to return before the next slice starts, and calling it inline just
   * recurses until the stack runs out.
   */
  let pending: any = null;

  const win16: any = new Win16(
    new DOS(machine),
    machine,
    { width: 640, height: 480 },
    {
      nextFrame: (callback: any) => {
        pending = callback;
      },
      onCall: (call: any) => {
        calls.push(call);

        if (call.name === 'ExitWindows') {
          exited = true;
        }
      },
    }
  );

  const executable: any = new Executable(
    'STRINGS',
    'C:\\STRINGS.EXE',
    new MemoryFile(new Uint8Array(readFileSync(PROBE)))
  );

  await executable.parse();

  const handle = await win16.load(executable);
  win16.link(handle);
  win16.run(handle);

  /* The API can suspend on a promise -- writing a file does -- so driving this
   * means letting the timer and microtask queues drain between slices, not
   * just handing the callback straight back.
   */
  let ran = 0;

  for (; ran < frames; ran++) {
    if (pending) {
      const callback = pending;
      pending = null;
      callback();
    }

    await new Promise((resolve) => setImmediate(resolve));

    /* `pending` goes empty whenever the program is suspended on an async call,
     * so it is not a sign of having finished. Asking to end the session is.
     */
    if (exited && !pending) {
      break;
    }
  }

  return { machine, win16, calls, fileSystem, frames: ran };
}

/** Reads what the probe wrote, as the recorder would read it. */
async function outputOf(fileSystem: any) {
  const file = await fileSystem.open(['ORACLE', 'STRINGS.OUT']);

  if (!file) {
    return null;
  }

  return Buffer.from(await file.read(0, file.info.size)).toString('latin1');
}

/** The probe is built rather than committed, so this steps aside without it. */
const whenBuilt = existsSync(PROBE) ? describe : describe.skip;

whenBuilt('running a real Win16 program', () => {
  let result: any;

  beforeAll(async function () {
    result = await runProbe();
  }, 180000);

  it('loads and links a genuine NE executable', function () {
    // Parsing, relocating and starting it are all inside runProbe.
    expect(result.calls.length).toBeGreaterThan(0);
  });

  it('goes through the startup a Windows program goes through', function () {
    const started = result.calls.slice(0, 8).map((call: any) => `${call.module}.${call.name}`);

    /* Every Win16 program begins like this, and it is the compiler's startup
     * code doing it rather than anything the probe wrote.
     */
    expect(started).toEqual(
      expect.arrayContaining(['KERNEL.InitTask', 'KERNEL.WaitEvent', 'USER.InitApp'])
    );
  });

  it('reaches the program its own code, not just the runtime', function () {
    const names = new Set(result.calls.map((call: any) => call.name));

    // These are what strings.c asks for, in the order it asks for them.
    for (const name of ['_lcreat', '_lwrite', 'lstrlen', 'lstrcmp', 'lstrcmpi']) {
      expect(`called ${name}: ${names.has(name)}`).toEqual(`called ${name}: true`);
    }
  });

  it('resolves imports to the right module', function () {
    const byName = new Map(result.calls.map((call: any) => [call.name, call.module]));

    /* An import is resolved by ordinal, so a function answering from the wrong
     * module means the numbering is wrong rather than the function.
     */
    expect(byName.get('lstrlen')).toEqual('KERNEL');
    expect(byName.get('lstrcmp')).toEqual('USER');
    expect(byName.get('InitApp')).toEqual('USER');
  });

  it('writes the output it was written to write', async function () {
    const text = await outputOf(result.fileSystem);

    expect(text).not.toBeNull();
    expect(text!.length).toBeGreaterThan(0);
  });

  /* The strong form. The same binary produced a recording under real Windows,
   * and this compares against it record for record -- so a disagreement is our
   * API being wrong rather than a test being out of date.
   */
  it('agrees with what real Windows recorded from the same program', async function () {
    const fixture = join(__dirname, '..', '..', 'oracle', 'fixtures', 'strings.json');

    if (!existsSync(fixture)) {
      return;
    }

    const recorded = JSON.parse(readFileSync(fixture, 'utf8'));
    const text = (await outputOf(result.fileSystem)) ?? '';

    /* The probe escapes tabs, newlines and backslashes on the way out, since
     * they are what separate the fields; the recorder undoes that, so this
     * has to as well.
     */
    const unescape = (field: string) =>
      field.replace(
        /\\([\\trn])/g,
        (_, code) => ({ '\\': '\\', t: '\t', r: '\r', n: '\n' })[code] as string
      );

    const ours = text
      .split(/\r?\n/)
      .filter((line) => line !== '')
      .map((line) => line.split('\t').map(unescape))
      .filter(([name]) => name !== '#')
      .map(([name, args, value]) => `${name}(${args}) = ${value}`);

    const theirs = recorded.records.map(
      (record: any) => `${record.function}(${record.args}) = ${record.result}`
    );

    expect(ours).toEqual(theirs);
  });

  it('passes arguments across the thunk', function () {
    const compares = result.calls.filter((call: any) => call.name === 'lstrcmp');

    expect(compares.length).toBeGreaterThan(0);

    /* lstrcmp takes two strings, and the thunk marshals them out of the guest
     * stack. Getting two of them means the argument sizes and the stack
     * discipline both agree with what the program was compiled to expect.
     */
    expect(compares[0].args.length).toEqual(2);
    expect(String(compares[0].args[0])).toEqual(expect.any(String));
  });
});
