'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { fillDrive, planDrive, type Plan } from '../../src/run/drive.js';
import {
  applyChanges,
  type Change,
  fat16Drive,
  Fat16Changes,
  sameChanges,
} from '../../src/run/changes.js';

/**
 * What programs write on the TypeScript engine's C: drive, told against the
 * drive as the page planned it, and put back on a drive made afresh: the
 * FAT16 volume written through its own calls, as DOS writes it. The Rust
 * engine's drive is tested as its crate is (`MemoryDrive::changes_from`),
 * to the same order and form.
 */

/** When the installation's files were last written: 10:10:02, 10 March 1992. */
const AT = Date.UTC(1992, 2, 10, 3, 10, 2) / 1000;

/** When the programs here write: noon, 2 January 1993. */
const NOON = Date.UTC(1993, 0, 2, 12, 0, 0) / 1000;

/** A file bigger than a cluster, 32 KB, so a write in its second is one cluster's. */
const BIG = new Uint8Array(40000).map((_, at) => at & 0xff);

function plan(): Plan {
  return planDrive([], {
    name: 'win31.zip',
    entries: [
      { path: 'WIN.INI', data: new TextEncoder().encode('[windows]\r\n'), modified: AT },
      { path: 'SYSTEM/VGASYS.FON', data: new Uint8Array([1, 2, 3]), modified: AT },
      { path: 'SYSTEM/BIG.DAT', data: BIG, modified: AT },
      { path: 'SYSTEM/SAME.DAT', data: new Uint8Array([7, 7, 7]), modified: AT },
    ],
  });
}

/** A machine's C: filled from the plan, marked, and what was kept put back. */
async function made(kept: Change[] = []) {
  const machine: any = new Machine();
  const drive = await fillDrive(machine, plan());
  const changes = new Fat16Changes(drive.fileSystem, plan());

  await changes.mark();
  await applyChanges(kept, fat16Drive(drive.fileSystem));

  return { fileSystem: drive.fileSystem, changes };
}

/** Every entry on the volume, a folder before what is in it, with what it holds. */
async function listing(fileSystem: any) {
  const found: string[] = [];
  const visit = async (directory: any, prefix: string) => {
    for (const item of await directory.list()) {
      const { name, directory: folder, size, time, date } = item.info;

      if (name === '.' || name === '..') {
        continue;
      }

      const bytes = folder ? '' : Array.from(new Uint8Array(await item.read(0, size))).join(',');

      found.push(`${prefix}${name} ${JSON.stringify({ time, date })} ${bytes}`);

      if (folder) {
        await visit(item, `${prefix}${name}\\`);
      }
    }
  };

  await visit(await fileSystem.open([]), '');
  return found.sort();
}

const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('the changes kept of a FAT16 volume', () => {
  it('tells nothing of a drive only read', async () => {
    const { fileSystem, changes } = await made();
    const file = await fileSystem.open(['WINDOWS', 'WIN.INI']);

    await file.read(0, 4);
    expect(await changes.changes()).toEqual([]);
  });

  it('tells what was written, made and let go of, in the order it is put back', async () => {
    const { fileSystem, changes } = await made();

    /* WIN.INI written in place, its size the same; a cluster of BIG.DAT
     * written, past its first; SAME.DAT written back as it was. */
    await (
      await fileSystem.open(['WINDOWS', 'WIN.INI'])
    ).write(0, new TextEncoder().encode('[WINDOWS]'));
    await (
      await fileSystem.open(['WINDOWS', 'SYSTEM', 'BIG.DAT'])
    ).write(39000, new Uint8Array([9]));
    await (await fileSystem.open(['WINDOWS', 'SYSTEM', 'SAME.DAT'])).write(0, new Uint8Array([7]));

    /* A folder made at the root, a file in it; a file let go of. */
    await fileSystem.makeDirectory(await fileSystem.open([]), 'GAMES', NOON);
    await fileSystem.map(['GAMES', 'SKI.INI'], new DataView(new Uint8Array([0x5b]).buffer), {
      modified: NOON,
    });
    await fileSystem.unlink(await fileSystem.open(['WINDOWS', 'SYSTEM']), 'VGASYS.FON');

    const told = await changes.changes();
    const big = BIG.slice();

    big[39000] = 9;
    /* Each folder's in the order of their names, as the Rust engine tells
     * them, a folder's before what follows it. */
    expect(told).toEqual([
      { kind: 'removed', path: 'WINDOWS\\SYSTEM\\VGASYS.FON' },
      { kind: 'folder', path: 'GAMES', modified: NOON },
      { kind: 'file', path: 'GAMES\\SKI.INI', data: new Uint8Array([0x5b]), modified: NOON },
      { kind: 'file', path: 'WINDOWS\\SYSTEM\\BIG.DAT', data: big, modified: AT },
      { kind: 'file', path: 'WINDOWS\\WIN.INI', data: expect.any(Uint8Array), modified: AT },
    ]);
    expect(text((told[4] as any).data)).toBe('[WINDOWS]\r\n');

    /* Put back on a drive made afresh: told the same, and the same drive. */
    const again = await made(told);

    expect(sameChanges(await again.changes.changes(), told)).toBe(true);
    expect(await listing(again.fileSystem)).toEqual(await listing(fileSystem));
  });

  it('tells a folder let go of once, with everything in it, and a file in its place', async () => {
    const { fileSystem, changes } = await made();
    const windows = await fileSystem.open(['WINDOWS']);
    const system = await fileSystem.open(['WINDOWS', 'SYSTEM']);

    for (const name of ['VGASYS.FON', 'BIG.DAT', 'SAME.DAT']) {
      await fileSystem.unlink(system, name);
    }

    await fileSystem.unlink(windows, 'SYSTEM');
    await fileSystem.map(['WINDOWS', 'SYSTEM'], new DataView(new Uint8Array([1]).buffer), {
      modified: NOON,
    });

    const told = await changes.changes();

    expect(told).toEqual([
      { kind: 'removed', path: 'WINDOWS\\SYSTEM' },
      { kind: 'file', path: 'WINDOWS\\SYSTEM', data: new Uint8Array([1]), modified: NOON },
    ]);

    const again = await made(told);

    expect(await listing(again.fileSystem)).toEqual(await listing(fileSystem));
  });

  it('puts back changes as the Rust engine tells them, in whatever order they come', async () => {
    /* As `MemoryDrive::changes_from` tells them, a file before its folder
     * here to show the order is the one put back in, whatever is given. */
    const told: Change[] = [
      { kind: 'file', path: 'ORACLE\\STRINGS.OUT', data: new Uint8Array([65]), modified: NOON },
      { kind: 'folder', path: 'ORACLE', modified: NOON },
      { kind: 'folder', path: 'WINDOWS\\SYSTEM', modified: NOON },
      { kind: 'removed', path: 'WINDOWS\\SYSTEM\\BIG.DAT' },
    ];
    const { fileSystem, changes } = await made(told);
    const oracle = (await fileSystem.open(['ORACLE'])).info;

    expect(oracle.directory).toBe(true);
    expect(oracle.date).toEqual({ year: 1993, month: 1, day: 2 });
    expect(await fileSystem.open(['WINDOWS', 'SYSTEM', 'BIG.DAT'])).toBeNull();
    expect((await fileSystem.open(['WINDOWS', 'SYSTEM'])).info.time).toEqual({
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(await changes.changes()).toEqual([
      { kind: 'removed', path: 'WINDOWS\\SYSTEM\\BIG.DAT' },
      { kind: 'folder', path: 'ORACLE', modified: NOON },
      { kind: 'folder', path: 'WINDOWS\\SYSTEM', modified: NOON },
      { kind: 'file', path: 'ORACLE\\STRINGS.OUT', data: new Uint8Array([65]), modified: NOON },
    ]);
  });

  it('tells a file being written as it stands', async () => {
    const { fileSystem, changes } = await made();

    await fileSystem.create(['WINDOWS', 'NEW.TXT']);

    const file = await fileSystem.open(['WINDOWS', 'NEW.TXT']);

    await file.write(0, new Uint8Array(33000).fill(1));
    await fileSystem.open(['WINDOWS', 'NEW.TXT']);

    const [change] = (await changes.changes()).filter(({ path }) => path === 'WINDOWS\\NEW.TXT');

    expect(change.kind).toBe('file');
    expect((change as any).data.length).toBe(33000);
  });
});

describe('sameChanges', () => {
  it('compares paths, times and bytes', () => {
    const one: Change[] = [{ kind: 'file', path: 'A', data: new Uint8Array([1]), modified: 1 }];

    expect(sameChanges(one, [{ ...one[0] } as Change])).toBe(true);
    expect(
      sameChanges(one, [{ kind: 'file', path: 'A', data: new Uint8Array([2]), modified: 1 }])
    ).toBe(false);
    expect(sameChanges(one, [{ kind: 'removed', path: 'A' }])).toBe(false);
    expect(sameChanges(one, [])).toBe(false);
  });
});
