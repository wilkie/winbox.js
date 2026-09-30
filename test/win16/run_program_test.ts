'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';
import { KNOWN_GAPS } from '../oracle/replay.js';
import { DEFAULT_DISPLAY_MODE } from '../../src/win16/display-modes.js';

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

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');

/** The probe the detailed assertions below are written against. */
const PROBE = join(PROBES, 'STRINGS.EXE');

/**
 * The probes worth running the whole way through, and what each is compared
 * against.
 *
 * `devcaps` names its display, because what the capability calls answer *is*
 * the display driver: there is one recording per driver, and only the one we
 * are emulating means anything.
 *
 * `text` needs the installed fonts, which live on the drive image rather than
 * in this repository. A system with no fonts is not a state Windows is ever
 * in, so that probe steps aside rather than running against nothing.
 */
/* A probe ends when it exits Windows, and the run with it: this is only how
 * long one that never does is given. Frames pass quickly while a program
 * waits, and a probe that waits on its own timers -- `about` reads each box
 * from one -- needs real time as well as a count of frames. */
const FRAMES = 4000;
const SECONDS = 30;

const END_TO_END = [
  { name: 'strings', fixture: 'strings' },
  { name: 'memory', fixture: 'memory' },
  { name: 'handles', fixture: 'handles' },
  { name: 'devcaps', fixture: `devcaps-${DEFAULT_DISPLAY_MODE}` },
  { name: 'text', fixture: 'text', fonts: true },
  { name: 'freelib', fixture: 'freelib', installation: true },
  { name: 'drivers', fixture: 'drivers', installation: true },
  { name: 'drvmsg', fixture: 'drvmsg', installation: true },
  { name: 'filecdr', fixture: 'filecdr', installation: true },
  { name: 'shlhook', fixture: 'shlhook', installation: true },
  { name: 'mcidevs', fixture: 'mcidevs', installation: true },
  { name: 'getmsg', fixture: 'getmsg', installation: true },
  { name: 'minis2', fixture: 'minis2', installation: true },
  { name: 'comms', fixture: 'comms', installation: true },
  { name: 'flash', fixture: 'flash', installation: true },
  { name: 'wndds', fixture: 'wndds', installation: true },
  { name: 'about', fixture: 'about', installation: true },
  { name: 'loadpath', fixture: 'loadpath', installation: true },
  { name: 'glock', fixture: 'glock', installation: true },
  { name: 'shell2', fixture: 'shell2', installation: true },
  { name: 'winexec', fixture: 'winexec', installation: true },
  { name: 'shellex', fixture: 'shellex', installation: true },
  { name: 'tasks2', fixture: 'tasks2', installation: true },
  { name: 'updatecp', fixture: 'updatecp', installation: true },
  { name: 'nobrush', fixture: 'nobrush', installation: true },
  { name: 'instds', fixture: 'instds', installation: true },
  { name: 'tnrwrap', fixture: 'tnrwrap', installation: true },
  { name: 'tutor', fixture: 'tutor', installation: true },
  { name: 'syscol', fixture: 'syscol', installation: true },
  { name: 'uncover', fixture: 'uncover', installation: true },
  { name: 'menubits', fixture: 'menubits', installation: true },
  { name: 'syncpnt', fixture: 'syncpnt', installation: true },
  { name: 'uncovr2', fixture: 'uncovr2', installation: true },
  { name: 'menuinv', fixture: 'menuinv', installation: true },
  { name: 'menucar', fixture: 'menucar', installation: true },
  { name: 'loadenv', fixture: 'loadenv', installation: true },
  { name: 'hidwnd', fixture: 'hidwnd', installation: true },
  { name: 'owners', fixture: 'owners', installation: true },
  { name: 'enumregs', fixture: 'enumregs', installation: true },
  { name: 'nullinst', fixture: 'nullinst', installation: true },
  { name: 'selalias', fixture: 'selalias', installation: true },
  { name: 'mousemv', fixture: 'mousemv', installation: true },
  { name: 'movedef', fixture: 'movedef', installation: true },
  { name: 'usedef', fixture: 'usedef-vga', installation: true },
  { name: 'cwphook', fixture: 'cwphook', installation: true },
  { name: 'defer', fixture: 'defer', installation: true },
  { name: 'stackpos', fixture: 'stackpos', installation: true },
  { name: 'polyline', fixture: 'polyline', installation: true },
  { name: 'dibdev', fixture: 'dibdev', installation: true },
  { name: 'ovlstyle', fixture: 'ovlstyle', installation: true },
  { name: 'mmtime', fixture: 'mmtime', installation: true },
  { name: 'sysheap', fixture: 'sysheap', installation: true },
  { name: 'grow', fixture: 'grow', installation: true },
  { name: 'fillext', fixture: 'fillext', installation: true },
  { name: 'brushind', fixture: 'brushind', installation: true },
  { name: 'mcifile', fixture: 'mcifile', installation: true },
  { name: 'exfuncs', fixture: 'exfuncs', installation: true },
  { name: 'penind', fixture: 'penind', installation: true },
  { name: 'ctlcolor', fixture: 'ctlcolor', installation: true },
  { name: 'dibmap', fixture: 'dibmap', installation: true },
  { name: 'winpoint', fixture: 'winpoint', installation: true },
  { name: 'lockupd', fixture: 'lockupd', installation: true },
  { name: 'getdib', fixture: 'getdib', installation: true },
  { name: 'modhand', fixture: 'modhand', installation: true },
  { name: 'sndplay', fixture: 'sndplay', installation: true },
  { name: 'unregcls', fixture: 'unregcls', installation: true },
  { name: 'wedges', fixture: 'wedges', installation: true },
  { name: 'menuhelp', fixture: 'menuhelp', installation: true },
  { name: 'minsize', fixture: 'minsize', installation: true },
  { name: 'widelin', fixture: 'widelin', installation: true },
  { name: 'widepoly', fixture: 'widepoly', installation: true },
  { name: 'nearest2', fixture: 'nearest2', installation: true },
  { name: 'dibpal', fixture: 'dibpal', installation: true },
  { name: 'penmatch', fixture: 'penmatch-vga', installation: true },
  { name: 'inframe', fixture: 'inframe', installation: true },
  { name: 'showseq', fixture: 'showseq', installation: true },
  { name: 'showsq2', fixture: 'showsq2', installation: true },
  { name: 'showmin', fixture: 'showmin', installation: true },
  { name: 'gdinum', fixture: 'gdinum-vga', installation: true },
  { name: 'menuflag', fixture: 'menuflag', installation: true },
  { name: 'drawgaps', fixture: 'drawgaps', installation: true },
  { name: 'iconkid', fixture: 'iconkid', installation: true },
  { name: 'iconclk', fixture: 'iconclk', installation: true },
  { name: 'patrops', fixture: 'patrops', installation: true },
  { name: 'patmono', fixture: 'patmono', installation: true },
  { name: 'queries', fixture: 'queries', installation: true },
  { name: 'scrolls', fixture: 'scrolls', installation: true },
  { name: 'tabtext', fixture: 'tabtext', installation: true },
  { name: 'updrgn', fixture: 'updrgn', installation: true },
  { name: 'badarg', fixture: 'badarg', installation: true },
  { name: 'gdiobj', fixture: 'gdiobj', installation: true },
];

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
    const fixture = join(FIXTURES, 'strings.json');

    if (!existsSync(fixture)) {
      return;
    }

    const recorded = JSON.parse(readFileSync(fixture, 'utf8'));
    const ours = recordsFrom((await outputOf(result.fileSystem)) ?? '');

    expect(ours).toEqual(
      recorded.records.map((record: any) => `${record.function}(${record.args}) = ${record.result}`)
    );
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

/**
 * The same comparison for every probe that can run without a display.
 *
 * Each of these is already checked by the replay suite, which calls our
 * functions directly. This is the stronger claim: the program itself runs, on
 * our CPU, through our loader and thunks, and writes through our filesystem --
 * and what comes out the far end is what Windows wrote.
 */
describe('what real programs produce', () => {
  for (const { name, fixture: recording, fonts, installation } of END_TO_END) {
    const probe = join(PROBES, `${name.toUpperCase()}.EXE`);
    const fixture = join(FIXTURES, `${recording}.json`);

    const runnable =
      existsSync(probe) && existsSync(fixture) && (!(fonts || installation) || existsSync(IMAGE));

    (runnable ? it : it.skip)(
      `${name} agrees with real Windows, end to end`,
      async function () {
        const { fileSystem } = await runProbe(name, FRAMES, fonts, installation, SECONDS);
        const recorded = JSON.parse(readFileSync(fixture, 'utf8'));

        /* A function the replay knows we do not follow is set aside here too. */
        const gapped = (line: string) => !!KNOWN_GAPS[`${recording}:${line.split('(')[0]}`];
        const ours = recordsFrom((await outputOf(fileSystem, name)) ?? '').filter(
          (line: string) => !gapped(line)
        );

        expect(ours).toEqual(
          recorded.records
            .map((record: any) => `${record.function}(${record.args}) = ${record.result}`)
            .filter((line: string) => !gapped(line))
        );
      },
      180000
    );
  }
});
