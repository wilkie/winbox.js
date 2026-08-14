'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOS } from '../../src/dos.js';
import { Executable } from '../../src/executable.js';
import { Machine } from '../../src/emulator/machine.js';
import { Win16 } from '../../src/win16.js';

/**
 * Running Windows' own applications.
 *
 * The probes are programs we wrote, which makes them a soft test: they use the
 * API the way we expected it to be used. These are not ours. Clock and Program
 * Manager came off the installation the oracle builds, they are loaded out of
 * our own FAT16 image by the ordinary loader, and they ask for whatever they
 * were written in 1992 to ask for.
 *
 * What they get through is the useful measurement, and the trace of what they
 * called is the work list -- a far shorter list than the API contains, and in
 * the order a real program needs it.
 *
 * Neither runs to completion yet. Both reach the point of registering a window
 * class and then stop, which is where the message loop would begin.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** Loads an application off the drive image and runs it, collecting its calls. */
async function runApplication(name: string, frames = 300) {
  const machine = new Machine();
  const fileSystem: any = await machine.mountImage(new Uint8Array(readFileSync(IMAGE)));

  const calls: string[] = [];

  let pending: any = null;

  const win16: any = new Win16(
    new DOS(machine),
    machine,
    { width: 640, height: 480 },
    {
      nextFrame: (callback: any) => {
        pending = callback;
      },
      onCall: (call: any) => calls.push(`${call.module}.${call.name}`),
    }
  );

  const file = await fileSystem.open(['WINDOWS', `${name}.EXE`]);
  const executable: any = new Executable(name, `C:\\WINDOWS\\${name}.EXE`, file);

  await executable.parse();

  const handle = await win16.load(executable);
  win16.link(handle);

  /* Neither application runs to completion, so how it stops is part of the
   * measurement rather than a failure. It matters that this is recorded rather
   * than thrown: the scheduler gives each frame a slice of wall time, so how
   * far the guest gets varies with how busy the machine is, and a test that
   * insisted on a particular ending would pass alone and fail in company.
   */
  let stoppedBy: string | null = null;

  try {
    win16.run(handle);
  } catch (error: any) {
    stoppedBy = error?.constructor?.name ?? String(error);
  }

  for (let frame = 0; frame < frames && !stoppedBy; frame++) {
    try {
      if (pending) {
        const callback = pending;
        pending = null;
        callback();
      }
    } catch (error: any) {
      stoppedBy = error?.constructor?.name ?? String(error);
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  return { machine, win16, calls, stoppedBy };
}

/** The drive is built rather than committed. */
const whenBuilt = existsSync(IMAGE) ? describe : describe.skip;

whenBuilt('running Windows applications', () => {
  /* What each one is known to ask for. They are not the same: Clock reads its
   * settings out of WIN.INI and asks the display about itself, where Program
   * Manager -- being the shell -- does neither at this stage.
   */
  describe.each([
    [
      'CLOCK',
      40,
      ['KERNEL.GetProfileInt', 'USER.LoadCursor', 'USER.RegisterClass', 'GDI.GetDeviceCaps'],
    ],
    ['PROGMAN', 40, ['USER.LoadCursor', 'USER.RegisterClass']],
  ])('%s', (name, expected, expectedCalls) => {
    let result: any;

    beforeAll(async function () {
      result = await runApplication(name as string);
    }, 120000);

    it('loads out of our own filesystem and starts', function () {
      /* Nothing here is a stand-in: the executable is read through FAT16 off
       * the image, parsed as an NE, relocated, and executed.
       */
      expect(result.calls.length).toBeGreaterThan(expected as number);
    });

    it('goes through the startup every Windows program goes through', function () {
      expect(result.calls.slice(0, 6)).toEqual(
        expect.arrayContaining(['KERNEL.InitTask', 'USER.InitApp'])
      );
    });

    it('gets as far as registering a window class', function () {
      const called = new Set(result.calls);

      /* Registering a class is the first thing a program does that is about
       * itself rather than about starting up, and it means the resource
       * loading before it worked.
       */
      for (const call of expectedCalls as string[]) {
        expect(`${call}: ${called.has(call)}`).toEqual(`${call}: true`);
      }
    });

    it('stops for a reason worth knowing', function () {
      /* None of these reach a message loop yet, and what stops them is the
       * useful part. A ReferenceError is the window chrome asking for a DOM,
       * which is as far as a headless run can go by design -- the frame and
       * the caption are DOM, and only the client area is pixels. An
       * InvalidInstruction is the CPU meeting an opcode it cannot decode, and
       * null means it was still going when the frames ran out.
       */
      expect([null, 'InvalidInstruction', 'ReferenceError']).toContain(result.stoppedBy);
    });
  });
});
