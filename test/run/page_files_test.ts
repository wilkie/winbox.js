import { type Change } from '../../src/run/changes.js';
import {
  dosDate,
  dosSize,
  dosStamp,
  driveTree,
  type FileEntry,
  isWindowsProgram,
  nodeAt,
  pathParts,
  pathText,
  sortEntries,
  volumeEntries,
} from '../../src/run/page/files.js';

/**
 * The files on the page's drives as its file browser lists them
 * (`src/run/page/files.ts`): DOS's names, sizes and dates, sorted, C: as
 * the plan and the changes make it, and a disk's folder as its image lists
 * it, each marked where programs changed it.
 */

const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  Date.UTC(year, month - 1, day, hour, minute, second) / 1000;

const entry = (name: string, more: Partial<FileEntry> = {}): FileEntry => ({
  name,
  folder: false,
  size: 0,
  modified: at(1992, 3, 10),
  mark: null,
  ...more,
});

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('what DOS shows of a file', () => {
  it('writes a date and time as DIR does', () => {
    expect(dosDate(at(1992, 3, 10, 3, 10))).toBe('03-10-92  3:10a');
    expect(dosDate(at(1992, 3, 10, 0, 5))).toBe('03-10-92 12:05a');
    expect(dosDate(at(2020, 1, 6, 10, 20, 40))).toBe('01-06-20 10:20a');
    expect(dosDate(at(1999, 12, 31, 12, 0))).toBe('12-31-99 12:00p');
    expect(dosDate(at(1993, 11, 12, 23, 59))).toBe('11-12-93 11:59p');
  });

  it('gives a folder <DIR> for its size, and a file its bytes', () => {
    expect(dosSize(entry('A', { folder: true }))).toBe('<DIR>');
    expect(dosSize(entry('B', { size: 180688 }))).toBe('180688');
  });

  it('stamps to two seconds from 1980, and gives what has no stamp the volume’s own', () => {
    expect(dosStamp(at(1992, 3, 10, 3, 10, 41))).toBe(at(1992, 3, 10, 3, 10, 40));
    expect(dosStamp(at(1970, 1, 1))).toBe(at(1980, 1, 1));
    expect(dosStamp()).toBe(at(2020, 1, 6, 10, 20, 40));
  });

  it('writes and reads paths as DOS does', () => {
    expect(pathText('C', [])).toBe('C:\\');
    expect(pathText('C', ['WINDOWS', 'SYSTEM'])).toBe('C:\\WINDOWS\\SYSTEM');
    expect(pathParts('C:\\WINDOWS\\SOL.EXE')).toEqual({
      letter: 'C',
      parts: ['WINDOWS', 'SOL.EXE'],
    });
    expect(pathParts('a:\\install\\')).toEqual({ letter: 'A', parts: ['INSTALL'] });
    expect(pathParts('D:')).toEqual({ letter: 'D', parts: [] });
  });

  it('tells a Windows program by its MZ stub and NE header', () => {
    const program = new Uint8Array(0x60);

    program.set([0x4d, 0x5a]);
    program[0x3c] = 0x40;
    program.set([0x4e, 0x45], 0x40);
    expect(isWindowsProgram(program)).toBe(true);

    const dos = program.slice();

    dos.set([0x50, 0x45], 0x40);
    expect(isWindowsProgram(dos)).toBe(false);
    expect(isWindowsProgram(new Uint8Array(0x20))).toBe(false);
  });
});

describe('a folder sorted', () => {
  const entries = [
    entry('WIN.INI', { size: 3294, modified: at(1992, 3, 10) }),
    entry('SYSTEM', { folder: true, modified: at(1993, 1, 1) }),
    entry('APPS', { folder: true, modified: at(1991, 1, 1) }),
    entry('SOL.EXE', { size: 180688, modified: at(1991, 6, 1) }),
    entry('_DEFAULT.PIF', { size: 545, modified: at(1992, 3, 10) }),
  ];
  const names = (sorted: FileEntry[]) => sorted.map((one) => one.name);

  it('puts folders first, then sorts by name as DOS compares names', () => {
    expect(names(sortEntries(entries, { key: 'name', ascending: true }))).toEqual([
      'APPS',
      'SYSTEM',
      'SOL.EXE',
      'WIN.INI',
      '_DEFAULT.PIF',
    ]);
    expect(names(sortEntries(entries, { key: 'name', ascending: false }))).toEqual([
      'SYSTEM',
      'APPS',
      '_DEFAULT.PIF',
      'WIN.INI',
      'SOL.EXE',
    ]);
  });

  it('sorts by size and by date, ties by name', () => {
    expect(names(sortEntries(entries, { key: 'size', ascending: false }))).toEqual([
      'APPS',
      'SYSTEM',
      'SOL.EXE',
      'WIN.INI',
      '_DEFAULT.PIF',
    ]);
    expect(names(sortEntries(entries, { key: 'modified', ascending: true }))).toEqual([
      'APPS',
      'SYSTEM',
      'SOL.EXE',
      'WIN.INI',
      '_DEFAULT.PIF',
    ]);
  });

  it('leaves the entries given as they were', () => {
    const copy = [...entries];

    sortEntries(entries, { key: 'size', ascending: true });
    expect(entries).toEqual(copy);
  });
});

describe('C: as the plan and the changes make it', () => {
  const plan = {
    folders: [{ parts: ['WINDOWS', 'TEMP'], modified: at(1992, 3, 10) }],
    placements: [
      {
        parts: ['WINDOWS', 'WIN.INI'],
        data: bytes(1, 2, 3),
        original: 'w/WIN.INI',
        modified: at(1992, 3, 10, 3, 10),
      },
      {
        parts: ['GAMES', 'LONGFI~1.TXT'],
        data: bytes(4),
        original: 'Games.zip/Long File Name.txt',
        modified: at(1993, 1, 2),
      },
      {
        parts: ['GAMES', 'SKI.EXE'],
        data: bytes(5, 6),
        original: 'Games.zip/SKI.EXE',
        modified: at(1993, 1, 2),
      },
    ],
    stamps: [{ parts: ['GAMES'], modified: at(1994, 4, 4) }],
    renamed: [{ from: 'Long File Name.txt', to: 'C:\\GAMES\\LONGFI~1.TXT' }],
  };
  const list = (root: ReturnType<typeof driveTree>, path: string[]) =>
    [...nodeAt(root, path)!.children!.values()].map((node) => node.entry);

  it('holds the plan’s folders and files, the folders on the way the volume’s stamp', () => {
    const root = driveTree(plan, []);

    expect(list(root, [])).toEqual([
      entry('WINDOWS', { folder: true, modified: dosStamp() }),
      entry('GAMES', { folder: true, modified: at(1994, 4, 4) }),
    ]);
    expect(list(root, ['WINDOWS'])).toEqual([
      entry('TEMP', { folder: true, modified: at(1992, 3, 10) }),
      entry('WIN.INI', { size: 3, modified: at(1992, 3, 10, 3, 10) }),
    ]);
    expect(list(root, ['games'])).toEqual([
      entry('LONGFI~1.TXT', { size: 1, modified: at(1993, 1, 2), was: 'Long File Name.txt' }),
      entry('SKI.EXE', { size: 2, modified: at(1993, 1, 2) }),
    ]);
    expect(nodeAt(root, ['GAMES', 'SKI.EXE'])!.data).toEqual(bytes(5, 6));
    expect(nodeAt(root, ['NOPE'])).toBeNull();
  });

  it('puts the changes on it: kept where put back as they were, changed where not', () => {
    const kept: Change = {
      kind: 'file',
      path: 'WINDOWS\\WIN.INI',
      data: bytes(9),
      modified: at(1995, 5, 5),
    };
    const given: Change[] = [kept, { kind: 'removed', path: 'GAMES\\SKI.EXE' }];
    const told: Change[] = [
      { kind: 'removed', path: 'GAMES\\SKI.EXE' },
      { kind: 'folder', path: 'GAMES\\SAVES', modified: at(1996, 6, 6) },
      kept,
      { kind: 'file', path: 'GAMES\\SAVES\\ONE.SAV', data: bytes(7, 7), modified: at(1996, 6, 6) },
      /* Written again since it was put back: changed. */
      { kind: 'file', path: 'GAMES\\LONGFI~1.TXT', data: bytes(8), modified: at(1993, 1, 2) },
    ];
    const root = driveTree(plan, told, given);

    expect(list(root, ['GAMES']).map((one) => [one.name, one.mark])).toEqual([
      ['LONGFI~1.TXT', 'changed'],
      ['SAVES', 'changed'],
    ]);
    expect(nodeAt(root, ['WINDOWS', 'WIN.INI'])!.entry).toMatchObject({
      size: 1,
      modified: at(1995, 5, 5),
      mark: 'kept',
    });
    expect(list(root, ['GAMES', 'SAVES'])).toEqual([
      entry('ONE.SAV', { size: 2, modified: at(1996, 6, 6), mark: 'changed' }),
    ]);
    /* What was there and is not, a folder with all in it. */
    expect(
      list(driveTree(plan, [{ kind: 'removed', path: 'GAMES' }]), []).map((one) => one.name)
    ).toEqual(['WINDOWS']);
  });
});

describe("a disk's folder as its image lists it", () => {
  const info = (name: string, more: object = {}) => ({
    name,
    size: 10,
    time: { hour: 3, minute: 10, second: 0 },
    date: { year: 1992, month: 3, day: 10 },
    ...more,
  });

  it('passes over . and .. and the volume’s label, names upper case, stamps as DOS reads them', () => {
    expect(
      volumeEntries(
        [
          info('.', { directory: true }),
          info('..', { directory: true }),
          info('LABEL', { volume: true }),
          info('SUBDIR', { directory: true }),
          info('readme.txt', { size: 38 }),
        ],
        null
      )
    ).toEqual([
      entry('SUBDIR', { folder: true, modified: at(1992, 3, 10, 3, 10) }),
      entry('README.TXT', { size: 38, modified: at(1992, 3, 10, 3, 10) }),
    ]);
  });

  it('marks what differs from the disk as it was put in: new, written, or stamped anew', () => {
    const before = [info('README.TXT'), info('SAME.TXT'), info('STAMP.TXT')];
    const now = [
      info('README.TXT', { size: 11 }),
      info('SAME.TXT'),
      info('STAMP.TXT', { time: { hour: 4, minute: 0, second: 0 } }),
      info('ZEBRA.TXT'),
    ];

    expect(volumeEntries(now, before).map((one) => [one.name, one.mark])).toEqual([
      ['README.TXT', 'changed'],
      ['SAME.TXT', null],
      ['STAMP.TXT', 'changed'],
      ['ZEBRA.TXT', 'changed'],
    ]);
  });
});
