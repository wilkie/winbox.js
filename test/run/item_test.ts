'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOS } from '../../src/dos.js';
import { Executable } from '../../src/executable.js';
import { Machine } from '../../src/emulator/machine.js';
import { Win16 } from '../../src/win16.js';

/**
 * A group's item started as the page's launcher starts it on the
 * TypeScript engine (`src/run/engines/ts.ts`, `kb/guides/launcher.md`):
 * `Win16.run` given the command line, current directory and show command
 * Program Manager gives the program, first and beside a program running.
 * The twin of `crates/winbox-web/tests/item.rs`. The program is the
 * `pmitem` probe's child, which writes what it was given to
 * `C:\ORACLE\PMITEM.TXT`; each line is the one `pmitem` recorded under
 * Windows for the same item.
 */

const ROOT = join(__dirname, '..', '..');
const IMAGE = join(ROOT, 'oracle', 'build', 'win31.img');
const CHILD = join(ROOT, 'oracle', 'build', 'probes', 'PMITEMC.EXE');
const PATH = 'C:\\WINDOWS\\PMITEMC.EXE';

const whenBuilt = existsSync(IMAGE) && existsSync(CHILD) ? describe : describe.skip;

whenBuilt("a group's item started on the TypeScript engine", () => {
  it('is given its command line, directory and show command', async () => {
    const machine = new Machine();
    const fileSystem: any = await machine.mountImage(new Uint8Array(readFileSync(IMAGE)));
    let pending: any = null;
    let stoppedBy: string | null = null;
    const win16: any = new Win16(new DOS(machine), machine, {
      nextFrame: (callback: any) => {
        pending = callback;
      },
      onError: (error: any) => {
        stoppedBy = stoppedBy ?? String(error?.message ?? error);
      },
    });
    const root = await fileSystem.open([]);

    if (!(await fileSystem.open(['ORACLE']))) {
      await fileSystem.makeDirectory(root, 'ORACLE');
    }

    await fileSystem.makeDirectory(await fileSystem.open(['ORACLE']), 'PMDIR');
    await fileSystem.map(
      ['WINDOWS', 'PMITEMC.EXE'],
      new DataView(Uint8Array.from(readFileSync(CHILD)).buffer)
    );
    await win16.boot();

    const log = async () => {
      const file = await fileSystem.open(['ORACLE', 'PMITEM.TXT']);

      return file ? Buffer.from(await file.read(0, file.info.size)).toString('latin1') : '';
    };
    const until = async (lines: number) => {
      for (let frame = 0; frame < 5000 && !stoppedBy; frame++) {
        if ((await log()).split('\r\n').length > lines) {
          return;
        }

        if (pending) {
          const callback = pending;

          pending = null;
          callback();
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const start = async (commandLine: string, directory: string, show: number) => {
      const executable: any = new Executable(
        'PMITEMC',
        PATH,
        await fileSystem.open(['WINDOWS', 'PMITEMC.EXE'])
      );

      await executable.parse();

      const handle = await win16.load(executable);

      win16.link(handle);
      win16.run(handle, { commandLine, show, directory });
    };

    await start('one two', 'C:\\WINDOWS', 1);
    await until(1);
    await start('dir', 'C:\\ORACLE\\PMDIR', 1);
    await until(2);
    await start('Low Case', 'C:\\ORACLE\\PMDIR', 1);
    await until(3);
    await start('min', 'C:\\WINDOWS', 7);
    await until(4);

    expect(stoppedBy).toBeNull();
    expect(await log()).toBe(
      'args=one two|cwd=C:\\WINDOWS|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n' +
        'args=dir|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n' +
        'args=Low Case|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n' +
        'args=min|cwd=C:\\WINDOWS|show=7|path=C:\\WINDOWS\\PMITEMC.EXE\r\n'
    );
  }, 60000);
});
