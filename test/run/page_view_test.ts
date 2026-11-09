import { type Disk, type DriveSet } from '../../src/run/drives.js';
import { type Program } from '../../src/run/drive.js';
import { leavesDesktop } from '../../src/run/page/leave.js';
import { Observable } from '../../src/run/page/observable.js';
import {
  cDriveView,
  changesView,
  displayKept,
  driveRows,
  freeName,
  installView,
  keptRows,
  keptText,
  MODES,
  LAUNCHER_EMPTY,
  launcherView,
  type MachineFacts,
  machineName,
  neededRows,
  offeredDisplays,
  programRows,
  shownAfterClosing,
  tabsView,
  traceRows,
  windowsText,
  type Needed,
} from '../../src/run/page/view.js';
import { type KeptGroups } from '../../src/run/page/groups.js';
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

  it('opens a kept program on a machine of its own, on the display it was made on', () => {
    const here = program('here');
    const there = program('there', { display: 'ega', base: 'base:abc:ega' });
    const behind = program('behind');
    const gone = program('gone', { base: 'base:other:vga' });
    const unoffered = program('unoffered', { display: 'hercules', base: 'base:abc:hercules' });
    const rows = keptRows(
      [here, there, behind, gone, unoffered],
      (name) => (name === 'here' ? 'shown' : name === 'behind' ? 'behind' : null),
      (display) => `base:abc:${display}`,
      ['vga', 'ega'],
      'vga',
      () => null
    );

    expect(
      rows.map((row) => [row.label, row.here, row.shown, row.running, row.openText, row.openLabel])
    ).toEqual([
      ['here', true, true, true, 'Open', 'Open here'],
      [expect.stringMatching(/^there \(EGA/), true, false, false, 'Open', 'Open there'],
      ['behind', true, false, true, 'Show', 'Show behind'],
      ['gone', false, false, false, 'Open', 'gone was made on a Windows that is not here'],
      [
        expect.stringMatching(/^unoffered \(Hercules/),
        false,
        false,
        false,
        'Open',
        expect.stringMatching(
          /^unoffered was made on the Hercules.*, which this Windows does not offer$/
        ),
      ],
    ]);
  });

  it("names a kept program with its install's mode where the machine shown is in another", () => {
    const standard = program('standard');
    const older = program('older');
    const enhanced = program('enhanced', { mode: 'enhanced' });
    const labels = (mode: 'standard' | 'enhanced') =>
      keptRows(
        [standard, older, enhanced],
        () => null,
        (display) => `base:abc:${display}`,
        ['vga'],
        'vga',
        () => null,
        mode
      ).map((row) => [row.label, row.mode]);

    expect(labels('standard')).toEqual([
      ['standard', 'standard'],
      ['older', 'standard'],
      ['enhanced (386 enhanced mode)', 'enhanced'],
    ]);
    expect(labels('enhanced')).toEqual([
      ['standard (Standard mode)', 'standard'],
      ['older (Standard mode)', 'standard'],
      ['enhanced', 'enhanced'],
    ]);
    expect(MODES.map((mode) => mode.value)).toEqual(['standard', 'enhanced']);
  });

  it('names each machine by its install, and its tab with its display where two share a name', () => {
    const facts = (id: number, more: Partial<MachineFacts> = {}): MachineFacts => ({
      id,
      program: null,
      installing: null,
      display: 'vga',
      windows: true,
      ...more,
    });

    expect(machineName(facts(1, { program: 'pmitem' }))).toBe('pmitem');
    expect(machineName(facts(1))).toBe('Windows');
    expect(machineName(facts(1, { windows: false }))).toBe('No Windows');
    expect(machineName(facts(1, { program: 'pmitem', installing: 'pmitem' }))).toBe(
      'Installing pmitem'
    );

    const tabs = tabsView(
      [facts(1), facts(2, { program: 'clock' }), facts(3, { display: 'ega' })],
      2
    );

    expect(tabs.map((tab) => [tab.id, tab.name, tab.selected])).toEqual([
      [1, expect.stringMatching(/^Windows \(VGA/), false],
      [2, 'clock', true],
      [3, expect.stringMatching(/^Windows \(EGA/), false],
    ]);
  });

  it('shows the tab beside one closed, or keeps the one shown', () => {
    /* Another closed: the one shown stays. */
    expect(shownAfterClosing([1, 2, 3], 1, 2)).toBe(2);
    /* The one shown closed: the one after it, or before it where it was last. */
    expect(shownAfterClosing([1, 2, 3], 2, 2)).toBe(3);
    expect(shownAfterClosing([1, 2, 3], 3, 3)).toBe(2);
    expect(shownAfterClosing([1, 2, 3], 1, 1)).toBe(2);
    /* The only one: none. */
    expect(shownAfterClosing([4], 4, 4)).toBe(null);
  });

  it("lists every kept program's groups in the launcher, apart, and says why an item cannot run", () => {
    expect(launcherView([], () => null, ['vga'])).toEqual({ groups: [], empty: LAUNCHER_EMPTY });

    const run = (reason: string | null) => ({ reason, directoryThere: true }) as any;
    const item = (name: string, reason: string | null = null) =>
      ({
        name,
        command: `C:\\${name}.EXE`,
        directory: 'C:\\',
        icon: null,
        run: run(reason),
      }) as any;
    const group = (name: string, items: any[], more: object = {}) =>
      ({
        name,
        install: '',
        winbox: false,
        file: `WINDOWS\\${name}.GRP`,
        refusal: null,
        items,
        ...more,
      }) as any;
    const groups: Record<string, KeptGroups | null> = {
      maxis: {
        based: true,
        groups: [
          group('Maxis', [
            item('SimTower'),
            item('Read Me', 'needs WRITE.EXE, which is not in this Windows'),
          ]),
          group('Accessories', [item('Notes')]),
        ],
      },
      games: {
        based: true,
        groups: [
          group('Accessories', [item('Clock')]),
          group('Broken', [], { refusal: 'its checksum is wrong' }),
        ],
      },
      other: { based: false, groups: [group('Other', [item('Other')])] },
      ega: { based: true, groups: [group('Ega', [item('Ega')])] },
      reading: null,
    };
    const view = launcherView(
      [
        program('maxis'),
        program('games'),
        program('other'),
        program('ega', { display: 'ega' }),
        program('reading'),
      ],
      (one) => groups[one.name],
      ['vga']
    );

    expect(view.empty).toBeNull();
    expect(view.groups.map((one) => [one.label, one.install, one.note])).toEqual([
      ['Maxis', 'maxis', null],
      ['Accessories (maxis)', 'maxis', null],
      ['Accessories (games)', 'games', null],
      ['Broken', 'games', 'Program Manager would not load it: its checksum is wrong'],
      ['Other', 'other', null],
      ['Ega', 'ega', null],
      ['reading', 'reading', 'Being read…'],
    ]);
    expect(view.groups[0].items.map((one) => [one.name, one.reason, one.group, one.item])).toEqual([
      ['SimTower', null, 0, 0],
      ['Read Me', 'needs WRITE.EXE, which is not in this Windows', 0, 1],
    ]);
    expect(view.groups[2].items[0]).toMatchObject({ install: 'games', group: 0, item: 0 });
    expect(view.groups[4].items[0].reason).toBe('other was made on a Windows that is not here');
    expect(view.groups[5].items[0].reason).toMatch(
      /^ega was made on the EGA.*, which this Windows does not offer$/
    );
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
      label: 'A: floppy drive, Disk 2 of 2, two.img',
      kindText: 'floppy drive',
      state: 'Disk 2 of 2, two.img',
      readOnly: false,
      volume: null,
      set: [
        { name: 'one.img', inserted: false, written: false, kept: null, text: 'Disk 1, one.img' },
        {
          name: 'two.img',
          inserted: true,
          written: false,
          kept: null,
          text: 'Disk 2, two.img, in the drive',
        },
      ],
      kept: 'Not kept: for this visit only.',
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
      label: 'D: CD-ROM drive, Empty',
      readOnly: true,
      set: [{ name: 'cd.iso', inserted: false, written: false, text: 'cd.iso' }],
      removing: 'D: and its disc are let go of. To have it again, choose or drop its images again.',
      next: false,
      insert: true,
      eject: false,
      save: false,
    });
    expect(e).toMatchObject({ kind: 'hard disk', eject: false, save: true, add: false });
    expect(e.label).toBe('E: hard disk, hd.img');
    expect(a.removing).toBe(
      'A: and its disks are let go of, and what programs wrote to its disks this visit is ' +
        'discarded. Save the image first to keep it.'
    );

    /* No installer offered while one runs, or with no Windows. */
    expect(driveRows([floppies], () => [exe('A:\\SETUP.EXE')], 'b', true)[0].installer).toBeNull();
    expect(
      driveRows([floppies], () => [exe('A:\\SETUP.EXE')], null, false)[0].installer
    ).toBeNull();
  });

  it('says which disk is in a drive, which were written to, and how each is kept', () => {
    const floppies: DriveSet = {
      letter: 'A',
      kind: 'floppy',
      disks: [disk('one.img'), { ...disk('two.img'), written: true }],
      current: 0,
      ejected: false,
    };
    const disc: DriveSet = {
      letter: 'D',
      kind: 'iso',
      disks: [disk('cd.iso')],
      current: 0,
      ejected: false,
    };
    const [a, d] = driveRows([floppies, disc], () => [], 'b', false, {
      written: (letter, at) => letter === 'A' && at === 0,
      volume: (letter) => (letter === 'D' ? 'WINBOXCD' : 'NOLABEL'),
      kept: (one) => (one.name === 'cd.iso' ? keptText(true, false) : keptText(false, false)),
      program: 'cdgame',
    });

    expect(a.set.map((one) => one.text)).toEqual([
      'Disk 1, one.img, in the drive, written to',
      'Disk 2, two.img, written to',
    ]);
    expect(a.volume).toBeNull();
    expect(a.kept).toBe('Kept with cdgame: chosen again next visit.');
    expect(a.removing).toMatch(/ cdgame is no longer run with it\.$/);
    /* A disc is never written to, whatever is asked. */
    expect(d.set[0]).toMatchObject({
      inserted: true,
      written: false,
      text: 'cd.iso, in the drive',
    });
    expect(d.volume).toBe('WINBOXCD');
    expect(d.kept).toBe(
      'Kept with cdgame: opened again from its file next visit, the browser asking leave.'
    );
    expect(keptText(false, true)).toBe('a copy kept in this browser');
  });

  it('says what C: holds: Windows, the program kept or the archives dropped, and the changes kept', () => {
    expect(cDriveView(null, null, 'vga', null, 0, 0)).toEqual({
      windows: 'No Windows yet',
      programs: 'No program kept on it',
      changes: 'Nothing programs wrote kept yet',
      label: 'C: hard disk, No Windows yet',
    });
    expect(cDriveView(null, {}, 'ega', program('ski', { layers: ['a', 'b'] }), 0, 1)).toEqual({
      windows: 'Windows 3.1 from your setup disks (EGA, 640x350, 16 colours)',
      programs: 'ski, kept: 2 layers over Windows',
      changes: '1 change programs wrote, kept in this browser',
      label: 'C: hard disk, Windows 3.1 from your setup disks (EGA, 640x350, 16 colours)',
    });
    expect(cDriveView({ name: 'win31.zip' }, null, 'vga', null, 2, 3)).toMatchObject({
      windows: 'Windows 3.1 from win31.zip',
      programs: '2 archives dropped over Windows',
      changes: '3 changes programs wrote, kept in this browser',
    });
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
