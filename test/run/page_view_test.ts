import { type Disk, type DriveSet } from '../../src/run/drives.js';
import { type Program } from '../../src/run/drive.js';
import { leavesDesktop } from '../../src/run/page/leave.js';
import { Observable } from '../../src/run/page/observable.js';
import {
  changesView,
  displayKept,
  driveRows,
  engineView,
  fileRows,
  freeName,
  installView,
  keptRows,
  neededRows,
  offeredDisplays,
  programRows,
  traceRows,
  windowsText,
  type Needed,
} from '../../src/run/page/view.js';
import { type KeptProgram } from '../../src/run/store.js';

/**
 * What the run page shows, made from its state (`src/run/page/view.ts`):
 * each panel's rows and words, as the page's old `render` functions drew
 * them, and the published value its components read
 * (`src/run/page/observable.ts`).
 */

const program = (name: string, more: Partial<KeptProgram> = {}): KeptProgram => ({
  name,
  base: 'base:abc:vga',
  display: 'vga',
  layers: [`${name}-layer`],
  exes: [],
  orders: {},
  kept: 0,
  ...more,
});

const disk = (name: string, size = 1474560): Disk => ({
  name,
  size,
  modified: 0,
  bytes: new Uint8Array(0),
  written: false,
});

const exe = (path: string, kind: Program['kind'] = 'windows'): Program => ({
  path,
  parts: path.slice(3).split('\\'),
  kind,
});

describe('the run page, as it is shown', () => {
  it('tells listeners of each value set, until they leave', () => {
    const value = new Observable(1);
    const heard: number[] = [];
    const leave = value.subscribe(() => heard.push(value.get()));

    value.set(2);
    value.set(2);
    leave();
    value.set(3);

    expect(heard).toEqual([2, 2]);
    expect(value.get()).toBe(3);
  });

  it('offers the displays the bundle has a base for, and keeps the one chosen where it can', () => {
    const all = offeredDisplays(null, null, []);

    expect(all).toContain('vga');
    expect(all).toContain('ega');
    expect(offeredDisplays(null, { displays: ['vga', 'ega'] } as any, ['vga'])).toEqual(['vga']);
    expect(offeredDisplays({ name: 'win.zip', entries: [] }, null, [])).toEqual(all);

    expect(displayKept(['ega', 'vga'], 'ega')).toBe('ega');
    expect(displayKept(['ega', 'vga'], 'vga256')).toBe('vga');
    expect(displayKept(['ega'], 'vga256')).toBe('ega');
    expect(displayKept([], 'vga')).toBe('');
  });

  it('says what Windows it has', () => {
    expect(windowsText(null, null, null)).toMatch(/^No Windows\./);
    expect(windowsText({ name: 'win31.zip', entries: [] }, null, { windows: true } as any)).toBe(
      'Windows installation: win31.zip'
    );
    expect(windowsText({ name: 'win31.zip', entries: [] }, null, null)).toBe(
      'Windows installation: win31.zip (no SYSTEM fonts found in it)'
    );

    const manifest = {
      id: '0123456789abcdef',
      displays: ['vga', 'vga256'],
      sources: [{ known: true }, { known: false }],
    };

    expect(windowsText(null, { manifest } as any, null)).toBe(
      'Windows 3.1 from your setup disks: the asset bundle 0123456789ab, kept in this browser, ' +
        '2 displays. 1 of the 2 files it was made from are not of the retail disks WinBox knows.'
    );
  });

  it('lists the changes kept, a removal and a folder each told apart', () => {
    const view = changesView(
      [
        { kind: 'file', path: 'A.TXT', data: new Uint8Array(1), modified: 0 } as any,
        { kind: 'folder', path: 'DIR', modified: 0 } as any,
        { kind: 'removed', path: 'GONE.TXT' } as any,
      ],
      ['C:\\BIG.DAT']
    );

    expect(view.rows).toEqual(['C:\\A.TXT', 'C:\\DIR\\', 'C:\\GONE.TXT  (deleted)']);
    expect(view.forgettable).toBe(true);
    expect(view.text).toMatch(/^What programs wrote on C:/);
    expect(view.text).toMatch(/Not kept, being larger than 8 MB: C:\\BIG\.DAT\.$/);
    expect(changesView([], []).forgettable).toBe(false);
  });

  it('offers a kept program on the display it was made on, and closes the one open', () => {
    const here = program('here');
    const there = program('there', { display: 'ega' });
    const rows = keptRows([here, there], here, 'base:abc:vga', 'vga', () => null);

    expect(rows.map((row) => [row.label, row.here, row.shown, row.openLabel])).toEqual([
      ['here', true, true, 'Close here'],
      [
        expect.stringMatching(/^there \(EGA/),
        false,
        false,
        expect.stringMatching(/^there was made on the EGA.*, and is opened there$/),
      ],
    ]);
  });

  it('runs Windows programs, not DOS ones, and says why there are none', () => {
    const { rows, empty } = programRows(
      { programs: [exe('C:\\GAMES\\SKI.EXE'), exe('C:\\DOS\\EDIT.COM', 'dos')] } as any,
      [exe('A:\\SETUP.EXE')],
      true
    );

    expect(rows.map((row) => [row.label, row.runnable])).toEqual([
      ['Run C:\\GAMES\\SKI.EXE', true],
      ['C:\\DOS\\EDIT.COM is a DOS program, which is not run here', false],
      ['Run A:\\SETUP.EXE', true],
    ]);
    expect(empty).toBeNull();
    expect(programRows({ programs: [] } as any, [], false).empty).toBe(
      'Drop a zip of programs to run.'
    );
    expect(programRows({ programs: [] } as any, [], true).empty).toBe(
      'No programs in what was dropped.'
    );
    expect(programRows(null, [], false).empty).toBeNull();
  });

  it("lists C:'s files but Windows' own, with the names they had", () => {
    expect(
      fileRows({
        files: ['C:\\WINDOWS\\WIN.INI', 'C:\\GAMES\\LONGFI~1.TXT', 'C:\\GAMES\\SKI.EXE'],
        renamed: [{ from: 'Long File Name.txt', to: 'C:\\GAMES\\LONGFI~1.TXT' }],
      } as any)
    ).toEqual(['C:\\GAMES\\LONGFI~1.TXT  (was Long File Name.txt)', 'C:\\GAMES\\SKI.EXE']);
  });

  it("offers each drive's actions as it is", () => {
    const floppies: DriveSet = {
      letter: 'A',
      kind: 'floppy',
      disks: [disk('one.img'), disk('two.img')],
      current: 1,
      ejected: false,
    };
    const disc: DriveSet = {
      letter: 'D',
      kind: 'iso',
      disks: [disk('cd.iso')],
      current: 0,
      ejected: true,
    };
    const hard: DriveSet = {
      letter: 'E',
      kind: 'hdd',
      disks: [disk('hd.img')],
      current: 0,
      ejected: false,
    };
    const [a, d, e] = driveRows(
      [floppies, disc, hard],
      (letter) => (letter === 'A' ? [exe('A:\\SETUP.EXE')] : []),
      'base:abc:vga',
      false
    );

    expect(a).toMatchObject({
      text: 'A: Disk 2 of 2, two.img',
      label: 'A: floppy, Disk 2 of 2, two.img',
      disks: ['1: one.img', '2: two.img'],
      next: true,
      insert: false,
      eject: true,
      save: true,
      add: true,
    });
    expect(a.installer?.path).toBe('A:\\SETUP.EXE');
    expect(d).toMatchObject({
      kind: 'CD-ROM',
      next: false,
      insert: true,
      eject: false,
      save: false,
    });
    expect(e).toMatchObject({ kind: 'hard disk', eject: false, save: true, add: false });

    /* No installer offered while one runs, or with no Windows. */
    expect(driveRows([floppies], () => [exe('A:\\SETUP.EXE')], 'b', true)[0].installer).toBeNull();
    expect(
      driveRows([floppies], () => [exe('A:\\SETUP.EXE')], null, false)[0].installer
    ).toBeNull();
  });

  it("asks again for the images a kept program wants, and for a cue sheet's files", () => {
    const needed: Needed = {
      letter: 'D',
      kind: 'iso',
      name: 'imgcd.iso',
      size: 395264,
      key: 'k',
      program: 'cdgame',
      disk: null,
    };
    const rows = neededRows(
      [needed, { ...needed, name: 'had.iso', disk: disk('had.iso') }],
      [{ cue: disk('imgtrk.cue'), names: ['imgtrk.bin'], tracks: [null] } as any]
    );

    expect(rows.map((row) => [row.text, row.label, row.accept])).toEqual([
      ['D: imgcd.iso (386 KB) for cdgame', 'Choose imgcd.iso for D: again', '.iso'],
      ['imgtrk.bin for imgtrk.cue', 'Choose imgtrk.bin', '.bin'],
    ]);
  });

  it('offers to install an archive into a program of its own, or one kept here', () => {
    const archive = { name: 'instlay.zip', entries: [] };
    const kept = [program('instlay'), program('other')];
    const view = installView(archive, 'disk1/setup.exe', null, null, kept, kept, 'other');

    expect(view).toMatchObject({
      shown: true,
      install: true,
      keepAsProgram: true,
      keep: false,
      discard: false,
      into: 'other',
    });
    expect(view.note).toMatch(/^instlay\.zip holds an installer, SETUP\.EXE\./);
    expect(view.options).toEqual([
      { value: '', text: 'as instlay 2, a program of its own' },
      { value: 'instlay', text: 'into instlay' },
      { value: 'other', text: 'into other' },
    ]);

    /* A program to install into no longer offered: one of its own. */
    expect(installView(archive, null, null, null, [], kept, 'other').into).toBe('');

    const running = {
      name: 'instlay',
      from: 'instlay.zip',
      media: null,
      drive: null,
      installer: '',
      into: null,
      ended: true,
    };

    expect(installView(null, null, null, running, [], [], '')).toMatchObject({
      shown: true,
      install: false,
      keep: true,
      discard: true,
      note: 'The installer has ended. Keep what it installed as a layer, or discard it.',
    });
    expect(installView(null, null, null, null, [], [], '').shown).toBe(false);
  });

  it('numbers a name a kept program has', () => {
    expect(freeName([program('a')], 'b')).toBe('b');
    expect(freeName([program('a'), program('a 2')], 'a')).toBe('a 3');
  });

  it('names the engine, with the way to the other', () => {
    expect(engineView(true, false)).toEqual({
      text: 'Rust engine (WebAssembly). ',
      href: '?engine=ts',
      link: 'Use the TypeScript engine',
    });
    expect(engineView(false, true).text).toMatch(/the Rust engine is not built/);
  });

  it('lists the functions reaching nothing first, then the most called, then by name', () => {
    const rows = traceRows(
      new Map([
        ['KERNEL.lstrlen', { count: 3, stub: false }],
        ['USER.Nothing', { count: 1, stub: true }],
        ['GDI.Arc', { count: 3, stub: false }],
        ['USER.Often', { count: 9, stub: false }],
      ])
    );

    expect(rows.map((row) => row.text)).toEqual([
      'USER.Nothing ×1 — not implemented',
      'USER.Often ×9',
      'GDI.Arc ×3',
      'KERNEL.lstrlen ×3',
    ]);
  });

  it('leaves the desktop on Meta and Escape alone', () => {
    const key = (key: string, more: Partial<Parameters<typeof leavesDesktop>[0]> = {}) => ({
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...more,
    });

    expect(leavesDesktop(key('Escape', { metaKey: true }))).toBe(true);
    expect(leavesDesktop(key('Escape'))).toBe(false);
    expect(leavesDesktop(key('Tab', { metaKey: true }))).toBe(false);
    expect(leavesDesktop(key('Escape', { metaKey: true, ctrlKey: true }))).toBe(false);
    expect(leavesDesktop(key('Escape', { metaKey: true, altKey: true }))).toBe(false);
  });
});
