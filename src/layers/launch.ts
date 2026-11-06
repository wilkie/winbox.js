/**
 * The launcher's list (`kb/guides/launcher.md`): every kept program's
 * Program Manager groups, as one list each front end reads, and for each
 * item what running it does -- the program found as Program Manager and
 * SHELL find it, or why there is none -- as pure code: no task, no disk.
 *
 * - `launchGroups`: for each kept program, in the order given, the groups
 *   its install made, in the order Program Manager loads them at start-up
 *   (`groupsFrom`, `PROGMAN.EXE` seg3 `06c1`-`08a3`), from the
 *   `PROGMAN.INI` its own layers keep (the owner's decision of
 *   2026-11-06: each install keeps its own) and only the group files its
 *   layers carry; each group's items in the order Program Manager lists
 *   them, slot order (seg4 `1735`-`1777`). A program kept loose, whose
 *   layers keep no `PROGMAN.INI`, has WinBox's own group instead: its
 *   `.EXE` files, marked as WinBox's.
 * - `itemRun`: an item run as File Open runs it (seg5 `03e7`, read out in
 *   `kb/topics/program-manager-dde.md`, "Running an item"): its command
 *   and working directory, the directory made upper case, the Windows
 *   directory current where it has none; its first word the file and the
 *   rest the parameters, by `ShellExecute` (seg5 `01b3`) shown normally,
 *   or minimized (7) for an item marked so; the file found, a program
 *   itself or a document opened by the program the registration database
 *   or `WIN.INI`'s `[extensions]` names (`ShellExecute`, SHELL seg4
 *   `082e`); then that program found as `WinExec` finds it (KERNEL's
 *   search: the current directory, the Windows directory, the system
 *   directory, the task's -- Program Manager's, the Windows directory --
 *   then `PATH`'s).
 *
 * Assumed, as a stack seen from outside a machine cannot know it: no
 * environment variable is put into a command (`DoEnvironmentSubst`), PATH
 * is what the caller passes (none by default), and only drive C: -- the
 * stack -- is there. The Rust engine's twin is
 * `crates/winbox-win16/src/launch.rs`; the two are held to
 * `test/layers/launch.json`.
 */

import { Profile } from '../win16/profile.js';
import { findIn } from '../win16/shell/reg-api.js';
import { HKEY_CLASSES_ROOT, RegistryDatabase } from '../win16/shell/registry.js';
import { ansiLowerByte, ansiUpperByte } from '../win16/user/ansi.js';
import { groupsFrom, PROGMAN_INI } from './groups.js';
import { type Flat } from './layer.js';

/** The Windows directory, current as Program Manager runs an item (seg5 `03f5`-`03f9`). */
const WINDOWS = 'C:\\WINDOWS';
/** The system directory, KERNEL's third place. */
const SYSTEM = 'C:\\WINDOWS\\SYSTEM';

/** A kept program's stack, as the launcher sees it. */
export interface KeptStack {
  /** The kept program's name: its install's. */
  name: string;
  /**
   * A file of the whole stack -- the base, then the program's layers --
   * by its path on the flattened drive (`WINDOWS\WIN.INI`); undefined
   * where there is none. Read for `PROGMAN.INI`, group files, `WIN.INI`
   * and `REG.DAT`.
   */
  read: (path: string) => Uint8Array | undefined;
  /** What a path on the flattened drive is: a file, a folder, or nothing. */
  kind: (path: string) => 'file' | 'folder' | null;
  /** Whether the program's own layers carry a file, by its path on the flattened drive. */
  own: (path: string) => boolean;
  /** The `.EXE` files its layers hold, as C: names them (`C:\SIMTOWER\SIMTOWER.EXE`). */
  exes: string[];
  /** `PATH`'s directories, as C: names them; none where not given. */
  path?: string[];
}

/** What running an item does. */
export interface ItemRun {
  /** What `ShellExecute` is given: the file, its parameters, the directory and the show command. */
  file: string;
  parameters: string;
  directory: string;
  show: number;
  /** Whether the directory is there; an empty one is. Program Manager asks whether to go on where it is not (seg5 `04c3`-`04f5`). */
  directoryThere: boolean;
  /** The program `WinExec` starts, as C: names it, and the command line it is given; null where there is none. */
  program: string | null;
  commandLine: string;
  /** `ShellExecute`'s answer below 32 -- 2 no file, 3 no path, 31 nothing associated -- or nought where it runs. */
  error: number;
  /** The program or file it needs and does not find; null where none is missing. */
  missing: string | null;
  /** Why it cannot run, in words; null where it can. */
  reason: string | null;
}

/** An item as the launcher lists it. */
export interface LaunchItem {
  name: string;
  /** The command as Program Manager runs it, and its working directory (seg4 `2967`). */
  command: string;
  directory: string;
  iconPath: string;
  iconIndex: number;
  hotKey: number;
  minimized: boolean;
  run: ItemRun;
}

/** A group as the launcher lists it. */
export interface LaunchGroup {
  /** The kept program whose install made it. */
  install: string;
  name: string;
  /** WinBox's own group of a program kept loose, not one an install made. */
  winbox: boolean;
  /** Its file on the flattened drive; null for WinBox's own. */
  file: string | null;
  /** Why Program Manager would not load its file; null where it would. */
  refusal: string | null;
  items: LaunchItem[];
}

/** Bytes as a string, one character to a byte. */
function text(bytes: Uint8Array) {
  let result = '';

  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }

  return result;
}

/** `AnsiUpper` or `AnsiLower` of a string. */
function ansiCase(value: string, convert: (byte: number) => number) {
  let result = '';

  for (let at = 0; at < value.length; at++) {
    result += String.fromCharCode(convert(value.charCodeAt(at) & 0xff));
  }

  return result;
}

function ansiUpper(value: string) {
  return ansiCase(value, ansiUpperByte);
}

/**
 * A DOS path, upper case, made whole from the current directory: its path
 * on the flattened drive (`WINDOWS\WIN.INI`, the root empty); null for a
 * drive other than C:.
 */
export function stackPath(path: string, current: string = WINDOWS) {
  let rest = ansiUpper(path);
  let base = ansiUpper(current);

  if (/^[A-Z]:/.test(rest)) {
    if (rest[0] !== 'C') {
      return null;
    }

    rest = rest.slice(2);

    if (!rest.startsWith('\\')) {
      base = base.startsWith('C:') ? base : 'C:\\';
    }
  }

  const names: string[] = [];

  if (!rest.startsWith('\\')) {
    for (const name of base.replace(/^[A-Z]:/, '').split('\\')) {
      if (name) {
        names.push(name);
      }
    }
  }

  for (const name of rest.split('\\')) {
    if (name === '' || name === '.') {
      continue;
    }

    if (name === '..') {
      names.pop();
    } else {
      names.push(name);
    }
  }

  return names.join('\\');
}

/** A path on the flattened drive as C: names it. */
function dosPath(path: string) {
  return `C:\\${path}`;
}

/** The last part of a path, after its last `\` or `:`. */
function lastPart(path: string) {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf(':')) + 1);
}

/** KERNEL's places, the first given, those the same as one before left out, then PATH's. */
function places(first: string, path: string[]) {
  const kept: string[] = [];

  for (const place of [first, WINDOWS, SYSTEM, WINDOWS]) {
    const it = place.replace(/\\$/, '');

    if (!kept.includes(it)) {
      kept.push(it);
    }
  }

  return [...kept, ...path.map((place) => ansiUpper(place).replace(/\\$/, ''))];
}

type Found = { path: string } | { error: number };

/**
 * A file found as `OpenFile` finds it (SHELL's `locate`, KERNEL's
 * `searchFile`): a name with a directory where it says, else in the places,
 * `current` first; or 2 for no file, 3 for no path.
 */
function locate(stack: KeptStack, name: string, current: string): Found {
  if (/[\\:]/.test(name)) {
    const path = stackPath(name, current);

    if (path !== null && stack.kind(path) === 'file') {
      return { path: dosPath(path) };
    }

    const folder = path === null ? null : path.slice(0, Math.max(path.lastIndexOf('\\'), 0));

    return { error: folder !== null && (folder === '' || stack.kind(folder) === 'folder') ? 2 : 3 };
  }

  for (const place of places(current, stack.path ?? [])) {
    const path = stackPath(`${place}\\${name}`, current);

    if (path !== null && stack.kind(path) === 'file') {
      return { path: dosPath(path) };
    }
  }

  return { error: 2 };
}

/** `WIN.INI` on the stack. */
function winIni(stack: KeptStack) {
  const bytes = stack.read('WINDOWS\\WIN.INI');

  return new Profile(bytes ? text(bytes) : '');
}

/** A key's value in the registration database, `HKEY_CLASSES_ROOT`'s; null where there is none. */
function registryValue(db: RegistryDatabase | null, key: string) {
  if (!db) {
    return null;
  }

  const found = findIn(db, HKEY_CLASSES_ROOT, key, 'open');

  return 'error' in found ? null : (db.textOf(db.entries[found.at][3]) ?? '');
}

/**
 * The command `ShellExecute` starts for a file, as SHELL's `commandFor`
 * finds it (seg4 `082e`): the file found -- with no extension, each of
 * `Programs=`'s tried -- itself where it is a program, else the
 * registration database's `shell\open\command` for its extension's class,
 * `%1` its path, else `[extensions]`', each `^` its path less the
 * extension; or the error.
 */
function commandFor(
  stack: KeptStack,
  file: string,
  current: string,
  parameters: string
): { command: string } | { error: number; missing: string } {
  const name = ansiUpper(file);
  const part = lastPart(name);
  const dot = part.lastIndexOf('.');
  let extension = dot >= 0 ? part.slice(dot + 1, dot + 4) : '';
  const profile = winIni(stack);
  const programs = String(profile.get('windows', 'Programs') ?? 'exe com bat pif')
    .split(/ +/)
    .filter(Boolean)
    .map((each) => ansiUpper(each));
  let path: string;

  if (extension) {
    const found = locate(stack, name, current);

    if ('error' in found) {
      return { error: found.error, missing: part };
    }

    path = found.path;
  } else {
    let found: string | null = null;

    for (const each of programs) {
      const tried = locate(stack, `${name}.${each}`, current);

      if ('path' in tried) {
        found = tried.path;
        extension = each;
        break;
      }
    }

    if (!found) {
      return { error: 2, missing: `${part}.${programs[0] ?? 'EXE'}` };
    }

    path = found;
  }

  if (programs.includes(extension)) {
    return { command: `${path} ${parameters}` };
  }

  const reg = stack.read('WINDOWS\\REG.DAT');
  const parsed = reg ? RegistryDatabase.parse(reg) : null;
  const db = parsed instanceof RegistryDatabase ? parsed : null;
  const klass = registryValue(db, `.${extension}`);

  if (klass !== null) {
    const command = registryValue(db, `${klass ? `${klass}\\` : ''}shell\\open\\command`);

    if (command) {
      const words = parameters.split(/ +/).filter(Boolean);

      return {
        command: command.replace(/%([0-9])/g, (_, digit) =>
          digit === '0' || digit === '1' ? path : (words[Number(digit) - 2] ?? '')
        ),
      };
    }
  }

  const entry = profile.get('extensions', extension) ?? '';

  if (!entry) {
    return { error: klass !== null ? 27 : 31, missing: `.${extension}` };
  }

  return { command: entry.replace(/\^/g, path.replace(/\.[^.\\:]*$/, '')) };
}

/**
 * An item run as Program Manager's File Open runs it (seg5 `03e7`), on a
 * stack: what `ShellExecute` is given, and the program `WinExec` then
 * starts, or why there is none.
 */
export function itemRun(
  stack: KeptStack,
  item: { command: string; directory: string; minimized: boolean }
): ItemRun {
  const directory = ansiUpper(item.directory);
  const directoryPath = directory ? stackPath(directory) : '';
  const directoryThere =
    !directory ||
    (directoryPath !== null && (directoryPath === '' || stack.kind(directoryPath) === 'folder'));
  /* `ShellExecute` makes the directory current where it is there; else the
   * Windows directory, Program Manager's, stays current. */
  const current = directory && directoryThere ? directory : WINDOWS;
  const command = item.command.replace(/^ +/, '');
  const space = command.indexOf(' ');
  const file = space < 0 ? command : command.slice(0, space);
  const parameters = space < 0 ? '' : command.slice(space + 1);
  const run: ItemRun = {
    file,
    parameters,
    directory,
    show: item.minimized ? 7 : 1,
    directoryThere,
    program: null,
    commandLine: '',
    error: 0,
    missing: null,
    reason: null,
  };
  const found = commandFor(stack, file, directory || WINDOWS, parameters);

  if ('error' in found) {
    run.error = found.error;
    run.missing = found.missing;
    run.reason =
      found.error === 31 || found.error === 27
        ? `nothing in this Windows opens ${found.missing} files`
        : `needs ${found.missing}, which is not in this Windows`;
    return run;
  }

  /* `WinExec`: its first word the program, `.EXE` added where it has no
   * extension, found from the directory current. */
  const line = found.command.replace(/^ +/, '');
  const at = line.indexOf(' ');
  let name = ansiUpper(at < 0 ? line : line.slice(0, at));

  run.commandLine = at < 0 ? '' : line.slice(at + 1);

  if (!lastPart(name).includes('.')) {
    name += '.EXE';
  }

  const program = locate(stack, name, current);

  if ('error' in program) {
    run.error = program.error;
    run.missing = lastPart(name);
    run.reason = `needs ${run.missing}, which is not in this Windows`;
    return run;
  }

  run.program = program.path;
  return run;
}

/**
 * The name Program Manager gives an item made from a command alone (seg5
 * `00ed`): the file's name after the last `\`, to its last dot, its first
 * letter upper case and the rest lower.
 */
export function itemName(command: string) {
  const file = command.lastIndexOf('\\') + 1;
  const dot = command.lastIndexOf('.');
  const name = (dot >= file ? command.slice(file, dot) : command.slice(file)).slice(0, 40);

  return ansiUpper(name.slice(0, 1)) + ansiCase(name.slice(1), ansiLowerByte);
}

/** The directory of a path, as C: names it, its last `\` dropped but a root's. */
function directoryOf(path: string) {
  const slash = path.lastIndexOf('\\');

  return slash <= 2 ? path.slice(0, slash + 1) : path.slice(0, slash);
}

/** A kept program's groups as the launcher lists them. */
export function stackGroups(stack: KeptStack): LaunchGroup[] {
  if (!stack.own(PROGMAN_INI)) {
    return [
      {
        install: stack.name,
        name: stack.name,
        winbox: true,
        file: null,
        refusal: null,
        items: stack.exes.map((exe) => {
          const item = {
            name: itemName(exe),
            command: exe,
            directory: directoryOf(exe),
            iconPath: exe,
            iconIndex: 0,
            hotKey: 0,
            minimized: false,
          };

          return { ...item, run: itemRun(stack, item) };
        }),
      },
    ];
  }

  return groupsFrom(stack.read)
    .groups.filter((group) => group.file !== null && stack.own(group.file))
    .map((group) => ({
      install: stack.name,
      name: group.group?.name ?? '',
      winbox: false,
      file: group.file,
      refusal: group.refusal,
      items: (group.group?.items ?? []).map((item) => ({
        name: item.name,
        command: item.command,
        directory: item.directory,
        iconPath: item.iconPath,
        iconIndex: item.iconIndex,
        hotKey: item.hotKey,
        minimized: item.minimized,
        run: itemRun(stack, item),
      })),
    }));
}

/** Every kept program's groups, in the order the programs are given, as one list. */
export function launchGroups(stacks: KeptStack[]): LaunchGroup[] {
  return stacks.flatMap(stackGroups);
}

/**
 * A flattened stack's files, and which its program's own layers carry, as a
 * `KeptStack`'s `read`, `kind` and `own` (`FlatFiles` in Rust).
 */
export function flatFiles(flat: Flat, own: Iterable<string>) {
  const files = new Map(flat.files.map((file) => [file.path, file.data]));
  const folders = new Set(flat.folders.map((folder) => folder.path));
  const owned = new Set(own);

  return {
    read: (path: string) => files.get(path),
    kind: (path: string): 'file' | 'folder' | null =>
      files.has(path) ? 'file' : folders.has(path) ? 'folder' : null,
    own: (path: string) => owned.has(path),
  };
}
