/**
 * @jest-environment jsdom
 */
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
 * These run in a DOM environment because a window has one: the frame, the
 * caption and the menu bar are elements, and only the client area is pixels.
 * That is the design rather than a concession to the test -- a caption that is
 * real text is a caption a screen reader can read -- so a run with no DOM at
 * all stops at `CreateWindow`, which is not a useful place to stop.
 *
 * Clock now gets the whole way to its message loop: it creates its window,
 * reads the locale out of `WIN.INI` and its own settings out of `CLOCK.INI`,
 * takes its `WM_TIMER` every half second and starts drawing the time.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** Loads an application off the drive image and runs it, collecting its calls. */
async function runApplication(name: string, frames = 2000) {
  const machine = new Machine();
  const fileSystem: any = await machine.mountImage(new Uint8Array(readFileSync(IMAGE)));

  const calls: string[] = [];

  let pending: any = null;

  /* How it stopped, rather than whether it stopped: the scheduler gives each
   * frame a slice of wall time, so how far the guest gets varies with how busy
   * the machine is, and a test that insisted on one ending would pass alone
   * and fail in company.
   */
  let stoppedBy: string | null = null;

  /* The desktop everything is parented to. A real element, because the window
   * chrome really is elements.
   */
  const desktop = document.createElement('div');
  document.body.appendChild(desktop);

  const win16: any = new Win16(new DOS(machine), machine, desktop, {
    nextFrame: (callback: any) => {
      pending = callback;
    },
    onCall: (call: any) => calls.push(`${call.module}.${call.name}`),

    /* An API that fails while the task is suspended has no caller to throw
     * to, so it is reported here instead of vanishing.
     */
    onError: (error: any) => {
      stoppedBy = stoppedBy ?? error?.constructor?.name ?? String(error);
    },
  });

  /* Starting the system before starting a program in it. The fonts come off
   * the same drive the program does, and a device context has the system font
   * in it from the moment it is handed out -- so a program that measures its
   * text before drawing it, which is most of them, needs this to have
   * happened.
   */
  await win16.boot();

  const file = await fileSystem.open(['WINDOWS', `${name}.EXE`]);
  const executable: any = new Executable(name, `C:\\WINDOWS\\${name}.EXE`, file);

  await executable.parse();

  const handle = await win16.load(executable);
  win16.link(handle);

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

    await new Promise((resolve) => setTimeout(resolve, 0));
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
      150,
      [
        'KERNEL.GetProfileInt',
        'USER.LoadCursor',
        'USER.RegisterClass',
        'GDI.GetDeviceCaps',
        // Its window exists, and it is pumping its own messages.
        'USER.CreateWindow',
        'USER.GetMessage',
        'USER.DispatchMessage',
        // And it is drawing the time into it.
        'GDI.GetTextExtent',
        'GDI.ExtTextOut',
      ],
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

    it('gets as far as it is known to get', function () {
      const called = new Set(result.calls);

      /* Each of these is a milestone the one before it has to have reached:
       * a class registered means the resources loaded, a window created means
       * the class was found, and a message dispatched means there is a message
       * loop running against a window that exists.
       */
      for (const call of expectedCalls as string[]) {
        expect(`${call}: ${called.has(call)}`).toEqual(`${call}: true`);
      }
    });

    it('stops for a reason worth knowing', function () {
      /* What stops them is the useful part. `null` means it was still running
       * when the frames ran out, which is what a program sitting in a message
       * loop should do. An `InvalidInstruction` is the CPU meeting an opcode
       * it cannot decode, and an `Error` is an API reaching something we have
       * not built -- Clock's font work stops there today.
       */
      expect([null, 'InvalidInstruction', 'Error']).toContain(result.stoppedBy);
    });
  });
});
