'use strict';

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GroupFile, storeCommand } from '../../src/layers/groups.js';
import {
  launchGroups,
  stackPath,
  type KeptStack,
  type LaunchGroup,
} from '../../src/layers/launch.js';
import { findIn, putValue } from '../../src/win16/shell/reg-api.js';
import { HKEY_CLASSES_ROOT, RegistryDatabase } from '../../src/win16/shell/registry.js';

/**
 * The launcher's list (`src/layers/launch.ts`), held to `launch.json`,
 * which the Rust engine's twin is held to as well
 * (`crates/winbox-win16/tests/launch.rs`). Synthetic stacks: group files
 * made by Program Manager's own operations (`GroupFile`) from made-up
 * items, profiles and a registration database written here. `stacks` and
 * `expected` are written by this test with `LAUNCH_UPDATE=1`; the
 * expectations below say what each item is to show, so the file is not
 * merely what the code made.
 */

const FIXTURE = join(__dirname, 'launch.json');

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');
const unhex = (text: string) => new Uint8Array(Buffer.from(text, 'hex'));

/** An 8 by 8 icon, as `groups.json`'s `a`. */
const ICON = {
  header: unhex('000000000800080002000101'),
  and: unhex('ff00ff00c300c300c300c300ff00ff00'),
  xor: unhex('00007e0042005a005a0042007e000000'),
};

interface Made {
  name: string;
  command: string;
  directory: string | null;
  hotKey?: number;
  minimized?: boolean;
}

/** A group file made as Program Manager makes one, item by item. */
function group(name: string, items: Made[]) {
  const file = GroupFile.create(name, { cx: 8, cy: 8, bitsPixel: 1, planes: 1 });

  for (const [at, item] of items.entries()) {
    const { stored, programDirectory } = storeCommand(item.command, item.directory);
    const made = file.addItem({
      name: item.name,
      stored,
      programDirectory,
      iconPath: item.command.split(' ')[0],
      iconIndex: 0,
      ...ICON,
      x: 21 + 75 * at,
      y: 0,
      hotKey: item.hotKey ?? 0,
      minimized: item.minimized ?? false,
    });

    if ('error' in made) {
      throw new Error(`item ${item.name}: ${made.error}`);
    }
  }

  return file.bytes();
}

/** A registration database with `.DOC` opened by `C:\GAMES\VIEW.EXE %1`. */
function registry() {
  const db = RegistryDatabase.empty();
  const set = (key: string, value: string) => {
    const found = findIn(db, HKEY_CLASSES_ROOT, key, 'create');

    if ('error' in found) {
      throw new Error(key);
    }

    putValue(db, found.at, value);
  };

  set('.doc', 'docfile');
  set('docfile', 'Document');
  set('docfile\\shell\\open\\command', 'C:\\GAMES\\VIEW.EXE %1');

  return db.serialize();
}

const WIN_INI = [
  '[windows]',
  'Programs=com exe bat pif',
  '',
  '[Extensions]',
  'wri=write.exe ^.wri',
  'txt=notepad.exe ^.txt',
  'hlp=winhelp.exe ^.hlp',
  '',
].join('\r\n');

/** The base: what every stack is made on. */
const BASE: Record<string, string> = {
  'WINDOWS\\WIN.INI': WIN_INI,
  'WINDOWS\\NOTEPAD.EXE': 'MZ',
  'WINDOWS\\SOL.EXE': 'MZ',
  'WINDOWS\\SYSTEM\\USER.EXE': 'MZ',
  'WINDOWS\\PROGMAN.INI': '[Groups]\r\nGroup1=C:\\WINDOWS\\MAIN.GRP\r\n',
};

interface StackInput {
  name: string;
  /** Every file of the stack, the base's and its own, by its path, in hexadecimal. */
  files: Record<string, string>;
  /** The paths its own layers carry. */
  own: string[];
  exes: string[];
  path: string[];
}

function made(): StackInput[] {
  const games = group('Games', [
    { name: 'Game', command: 'C:\\GAMES\\GAME.EXE /fast', directory: null },
    { name: 'Read Me', command: 'C:\\GAMES\\README.WRI', directory: null },
    { name: 'Help', command: 'WINHELP.EXE C:\\GAMES\\GAME.HLP', directory: 'C:\\GAMES' },
    { name: 'Notes', command: 'C:\\GAMES\\NOTES.TXT', directory: null },
    {
      name: 'Small',
      command: 'C:\\GAMES\\GAME.EXE',
      directory: 'c:\\games',
      minimized: true,
      hotKey: 0x0347,
    },
    { name: 'Solitaire', command: 'SOL.EXE', directory: '' },
    { name: 'Odd', command: 'C:\\GAMES\\DATA.ZQX', directory: null },
    { name: 'Manual', command: 'C:\\GAMES\\MANUAL.DOC', directory: null },
    { name: 'Elsewhere', command: 'C:\\GAMES\\GAME.EXE', directory: 'C:\\NOWHERE' },
    { name: 'Gone', command: 'C:\\GAMES\\GONE.EXE', directory: null },
    { name: 'No path', command: 'C:\\NOFOLDER\\GAME.EXE', directory: null },
    { name: 'Floppy', command: 'A:\\SETUP.EXE', directory: null },
    { name: 'Bare', command: 'GAME', directory: 'C:\\GAMES' },
  ]);
  const own: Record<string, Uint8Array> = {
    'WINDOWS\\PROGMAN.INI': bytes(
      '[Settings]\r\nOrder= 2 1\r\n[Groups]\r\nGroup1=C:\\WINDOWS\\MAIN.GRP\r\nGroup2=C:\\WINDOWS\\GAMES.GRP\r\nGroup3=C:\\WINDOWS\\BROKEN.GRP\r\n'
    ),
    'WINDOWS\\GAMES.GRP': games,
    'WINDOWS\\BROKEN.GRP': bytes('PMCC not a group'),
    'WINDOWS\\REG.DAT': registry(),
    'GAMES\\GAME.EXE': bytes('MZ'),
    'GAMES\\VIEW.EXE': bytes('MZ'),
    'GAMES\\README.WRI': bytes('write'),
    'GAMES\\GAME.HLP': bytes('help'),
    'GAMES\\NOTES.TXT': bytes('notes'),
    'GAMES\\DATA.ZQX': bytes('zqx'),
    'GAMES\\MANUAL.DOC': bytes('doc'),
  };
  const base = Object.fromEntries(
    Object.entries(BASE).map(([path, text]) => [path, hex(bytes(text))])
  );

  return [
    {
      name: 'Games',
      files: {
        ...base,
        ...Object.fromEntries(Object.entries(own).map(([path, data]) => [path, hex(data)])),
      },
      own: Object.keys(own),
      exes: ['C:\\GAMES\\GAME.EXE', 'C:\\GAMES\\VIEW.EXE'],
      path: [],
    },
    {
      name: 'Tower',
      files: {
        ...base,
        'TOWER\\TOWER.EXE': hex(bytes('MZ')),
        'TOWER\\INFO.EXE': hex(bytes('MZ')),
        'TOWER\\README.WRI': hex(bytes('w')),
      },
      own: ['TOWER\\TOWER.EXE', 'TOWER\\INFO.EXE', 'TOWER\\README.WRI'],
      exes: ['C:\\TOWER\\INFO.EXE', 'C:\\TOWER\\TOWER.EXE'],
      path: ['C:\\TOWER'],
    },
  ];
}

/** A stack input as the launcher reads it. */
export function keptStack(input: StackInput): KeptStack {
  const files = new Map(Object.entries(input.files).map(([path, data]) => [path, unhex(data)]));
  const folders = new Set<string>();

  for (const path of files.keys()) {
    const parts = path.split('\\');

    for (let at = 1; at < parts.length; at++) {
      folders.add(parts.slice(0, at).join('\\'));
    }
  }

  const own = new Set(input.own);

  return {
    name: input.name,
    read: (path) => files.get(path),
    kind: (path) => (files.has(path) ? 'file' : folders.has(path) ? 'folder' : null),
    own: (path) => own.has(path),
    exes: input.exes,
    path: input.path,
  };
}

/** The list as JSON, both engines' alike. */
function plain(groups: LaunchGroup[]) {
  return groups.map((one) => ({
    install: one.install,
    name: one.name,
    winbox: one.winbox,
    file: one.file,
    refusal: one.refusal,
    items: one.items.map((item) => ({
      name: item.name,
      command: item.command,
      directory: item.directory,
      iconPath: item.iconPath,
      iconIndex: item.iconIndex,
      hotKey: item.hotKey,
      minimized: item.minimized,
      run: { ...item.run },
    })),
  }));
}

describe("the launcher's list", () => {
  const stacks = made();
  const computed = plain(launchGroups(stacks.map(keptStack)));

  if (process.env.LAUNCH_UPDATE) {
    writeFileSync(
      FIXTURE,
      `${JSON.stringify(
        {
          about:
            "The launcher's list as both engines make it (src/layers/launch.ts, crates/winbox-win16/src/launch.rs; test/layers/launch_test.ts, crates/winbox-win16/tests/launch.rs). Synthetic stacks: files in hexadecimal, a group made by Program Manager's own operations. Written by the TypeScript test with LAUNCH_UPDATE=1.",
          stacks,
          expected: computed,
        },
        null,
        1
      )}\n`
    );
  }

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  it('reads the stacks the fixture holds', () => {
    expect(stacks).toEqual(fixture.stacks);
    expect(computed).toEqual(fixture.expected);
  });

  it("lists an install's own groups and a loose program's WinBox group", () => {
    expect(
      computed.map((one) => [one.install, one.name, one.winbox, one.file, one.refusal])
    ).toEqual([
      ['Games', 'Games', false, 'WINDOWS\\GAMES.GRP', null],
      ['Games', '', false, 'WINDOWS\\BROKEN.GRP', expect.any(String)],
      ['Tower', 'Tower', true, null, null],
    ]);
    expect(computed[2].items.map((item) => [item.name, item.command, item.directory])).toEqual([
      ['Info', 'C:\\TOWER\\INFO.EXE', 'C:\\TOWER'],
      ['Tower', 'C:\\TOWER\\TOWER.EXE', 'C:\\TOWER'],
    ]);
  });

  it('finds each item as Program Manager and SHELL find it, or says why not', () => {
    const runs = Object.fromEntries(computed[0].items.map((item) => [item.name, item.run]));
    const short = (name: string) => {
      const run = runs[name];

      return [run.program, run.commandLine, run.show, run.error, run.reason];
    };

    expect(short('Game')).toEqual(['C:\\GAMES\\GAME.EXE', '/fast', 1, 0, null]);
    expect(runs.Game.directory).toBe('C:\\GAMES');
    expect(short('Read Me')).toEqual([
      null,
      'C:\\GAMES\\README.wri',
      1,
      2,
      'needs WRITE.EXE, which is not in this Windows',
    ]);
    expect(short('Help')).toEqual([
      null,
      '',
      1,
      2,
      'needs WINHELP.EXE, which is not in this Windows',
    ]);
    expect(short('Notes')).toEqual([
      'C:\\WINDOWS\\NOTEPAD.EXE',
      'C:\\GAMES\\NOTES.txt',
      1,
      0,
      null,
    ]);
    expect(short('Small')).toEqual(['C:\\GAMES\\GAME.EXE', '', 7, 0, null]);
    expect(runs.Small.directory).toBe('C:\\GAMES');
    expect(short('Solitaire')).toEqual(['C:\\WINDOWS\\SOL.EXE', '', 1, 0, null]);
    expect(short('Odd')).toEqual([null, '', 1, 31, 'nothing in this Windows opens .ZQX files']);
    expect(short('Manual')).toEqual(['C:\\GAMES\\VIEW.EXE', 'C:\\GAMES\\MANUAL.DOC', 1, 0, null]);
    expect([runs.Elsewhere.directoryThere, runs.Elsewhere.program]).toEqual([
      false,
      'C:\\GAMES\\GAME.EXE',
    ]);
    expect(short('Gone')).toEqual([null, '', 1, 2, 'needs GONE.EXE, which is not in this Windows']);
    expect(runs['No path'].error).toBe(3);
    expect(runs.Floppy.error).toBe(3);
    expect(short('Bare')).toEqual(['C:\\GAMES\\GAME.EXE', '', 1, 0, null]);
  });

  it('makes paths whole as DOS does', () => {
    expect(stackPath('c:\\games\\..\\windows\\.\\win.ini')).toBe('WINDOWS\\WIN.INI');
    expect(stackPath('GAME.EXE', 'C:\\GAMES')).toBe('GAMES\\GAME.EXE');
    expect(stackPath('C:GAME.EXE', 'C:\\GAMES')).toBe('GAMES\\GAME.EXE');
    expect(stackPath('\\ROOT.TXT', 'C:\\GAMES')).toBe('ROOT.TXT');
    expect(stackPath('D:\\X.EXE')).toBeNull();
  });
});

/** The corpus's SimTower: its files' names as the archive has them, none of their bytes read. */
const SIMTOWER = join(__dirname, '..', '..', 'corpus', 'programs', 'simtower');

(existsSync(SIMTOWER) ? describe : describe.skip)('SimTower kept loose', () => {
  it("is WinBox's group of its programs, each found", () => {
    const own = readdirSync(SIMTOWER)
      .map((name) => name.toUpperCase())
      .filter((name) => /^[A-Z0-9_]{1,8}\.[A-Z0-9]{1,3}$/.test(name))
      .map((name) => `SIMTOWER\\${name}`);
    const exes = own
      .filter((path) => path.endsWith('.EXE'))
      .map((path) => `C:\\${path}`)
      .sort();
    const files = Object.fromEntries([
      ...Object.entries(BASE).map(([path, text]) => [path, hex(bytes(text))]),
      ...own.map((path) => [path, '']),
    ]);
    const groups = plain(
      launchGroups([keptStack({ name: 'SimTower', files, own, exes, path: [] })])
    );

    expect(groups.map((one) => [one.name, one.winbox, one.file])).toEqual([
      ['SimTower', true, null],
    ]);
    expect(groups[0].items.map((item) => [item.command, item.run.program, item.run.error])).toEqual(
      exes.map((exe) => [exe, exe, 0])
    );
    expect(groups[0].items.map((item) => item.name)).toContain('Simtower');
  });
});
