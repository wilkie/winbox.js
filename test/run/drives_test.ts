'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FATImage } from '../../src/file-systems/fat-image.js';
import {
  assignLetters,
  type DriveSet,
  imageKey,
  imageKind,
  installerOn,
  isKnownMedia,
  orderSet,
  programsOn,
  setText,
  volumeOf,
} from '../../src/run/drives.js';
import { classify } from '../../src/run/media.js';

/**
 * The page's drives of images (`src/run/drives.ts`): what an image dropped
 * is, the order a set dropped together is put in, the letters each set is
 * given as the owner chose and the native build gives them, whether a
 * floppy is one of Windows' own disks, and the programs on a drive.
 */

const ROOT = join(__dirname, '..', '..');
const IMAGES = join(ROOT, 'oracle', 'probes', 'images');
const image = (name: string) => new Uint8Array(readFileSync(join(IMAGES, name)));
const FLOPPIES = join(ROOT, 'oracle', '.cache', 'floppies');

/** The first Windows 3.1 setup disk's image under the oracle's cache, if it is there. */
function windowsDisk(): string | null {
  if (!existsSync(FLOPPIES)) {
    return null;
  }

  const walk = (at: string): string | null => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        const found = walk(path);

        if (found) {
          return found;
        }
      } else if (/disk0?1\.img$/i.test(entry.name)) {
        return path;
      }
    }

    return null;
  };

  return walk(FLOPPIES);
}

describe("The page's drives of images", () => {
  it('tells a floppy, a hard disk and a disc apart, as DOSBox would mount them', async () => {
    expect(await imageKind('imgflop.img', image('imgflop.img'))).toBe('floppy');
    expect(await imageKind('imghdd.img', image('imghdd.img'))).toBe('hdd');
    expect(await imageKind('imgcd.iso', image('imgcd.iso'))).toBe('iso');

    /* A disc by what it holds, whatever it is named; a FAT image named
     * `.iso` is no disc. */
    expect(await imageKind('imgcd.bin', image('imgcd.iso'))).toBe('iso');
    expect(await imageKind('floppy.iso', image('imgflop.img'))).toBeNull();
    expect(await imageKind('Disk01.img', new Uint8Array(16))).toBeNull();

    /* What classify makes of an image is unchanged: the page asks
     * `imageKind` first. */
    expect((await classify('Disk01.img', new Uint8Array(16))).kind).toBe('media');
  });

  it('puts a set dropped together in the order of its names, numbers as numbers', () => {
    const named = (...names: string[]) => names.map((name) => ({ name }));

    expect(
      orderSet(named('DISK10.IMG', 'disk2.img', 'Disk1.img', 'DISK3.IMG')).map((one) => one.name)
    ).toEqual(['Disk1.img', 'disk2.img', 'DISK3.IMG', 'DISK10.IMG']);
    expect(imageKey('GAME.ISO', 2048, 1700000000000)).toBe('GAME.ISO:2048:1700000000000');
  });

  it('gives each set its letter as the owner chose: floppies A: and B:, hard disks from D:, discs after them', () => {
    expect(
      assignLetters(
        [{ kind: 'iso' }, { kind: 'floppy' }, { kind: 'hdd' }, { kind: 'floppy' }, { kind: 'hdd' }],
        []
      )
    ).toEqual(['F', 'A', 'D', 'B', 'E']);

    /* A third floppy has no drive; a letter asked for, a kept program's,
     * is kept where it is free, and C: never is. */
    const given = assignLetters(
      [{ kind: 'floppy' }, { kind: 'iso', letter: 'q' }],
      [
        { kind: 'floppy', letter: 'A' },
        { kind: 'floppy', letter: 'B' },
      ]
    );

    expect(given[0]).toBeInstanceOf(Error);
    expect(given[1]).toBe('Q');
    expect(assignLetters([{ kind: 'hdd', letter: 'C' }], [])).toEqual(['D']);

    /* A disc after the hard disks there already. */
    expect(
      assignLetters(
        [{ kind: 'iso' }],
        [
          { kind: 'hdd', letter: 'D' },
          { kind: 'hdd', letter: 'E' },
        ]
      )
    ).toEqual(['F']);
    expect(assignLetters([{ kind: 'iso' }, { kind: 'iso' }], [])).toEqual(['D', 'E']);
  });

  it('says where a drive is: its disk of the set, or empty', () => {
    const disk = (name: string) => ({
      name,
      size: 0,
      modified: 0,
      bytes: new Uint8Array(),
      written: false,
    });
    const set: DriveSet = {
      letter: 'A',
      kind: 'floppy',
      disks: [disk('DISK1.IMG'), disk('DISK2.IMG')],
      current: 1,
      ejected: false,
    };

    expect(setText(set)).toBe('Disk 2 of 2, DISK2.IMG');
    expect(setText({ ...set, ejected: true })).toBe('Empty (2 disks)');
    expect(setText({ ...set, kind: 'iso', disks: [disk('GAME.ISO')], current: 0 })).toBe(
      'GAME.ISO'
    );
  });

  it("knows Windows' own setup disk from another floppy", async () => {
    const known = JSON.parse(
      readFileSync(join(ROOT, 'scripts', 'assets', 'known-media.json'), 'utf8')
    );

    expect(await isKnownMedia(image('imgflop.img'), known)).toBe(false);
    expect(await isKnownMedia(image('imgcd.iso'), known)).toBe(false);

    const disk = windowsDisk();

    if (disk) {
      expect(await isKnownMedia(new Uint8Array(readFileSync(disk)), known)).toBe(true);
    }
  });

  it("lists a drive's programs, and finds an installer on it", async () => {
    const flop = await FATImage.of(image('imgwrite.img'), true);
    const root = await flop.open([]);
    const program = new Uint8Array(0x60);

    /* An MZ stub pointing at an NE header: a Windows program. */
    program.set([0x4d, 0x5a]);
    program[0x3c] = 0x40;
    program.set([0x4e, 0x45], 0x40);

    await flop.makeDirectory(root, 'INSTALL');

    for (const [parts, data] of [
      [['INSTALL', 'SETUP.EXE'], program],
      [['INSTALL', 'TOOL.EXE'], program],
      [['DOSPROG.EXE'], Uint8Array.of(0x4d, 0x5a, ...new Array(0x40).fill(0))],
    ] as [string[], Uint8Array][]) {
      const file = await flop.create(parts);

      await file.write(0, data);
      file.close();
    }

    const programs = await programsOn(await volumeOf('floppy', flop.image()), 'A');

    expect(programs.map((one) => `${one.path} ${one.kind}`)).toEqual([
      'A:\\INSTALL\\SETUP.EXE windows',
      'A:\\INSTALL\\TOOL.EXE windows',
      'A:\\DOSPROG.EXE dos',
    ]);
    expect(installerOn(programs)?.path).toBe('A:\\INSTALL\\SETUP.EXE');
    expect(installerOn(programs.filter((one) => !/SETUP/.test(one.path)))).toBeNull();

    /* The disc's, read where it is. */
    expect(await programsOn(await volumeOf('iso', image('imgcd.iso')), 'D')).toEqual([]);
  });
});
