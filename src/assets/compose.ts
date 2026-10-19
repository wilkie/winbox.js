/**
 * The base of drive C: for a display, composed from the asset bundle's pool
 * as Windows 3.1's Setup laid it out on the oracle's installation for that
 * display (`crates/winbox-win16/data/setup.json`, written by
 * `scripts/assets/survey-installs.mjs`): the fonts and data files where
 * Setup put them, `WIN.INI` and `SYSTEM.INI` as Setup wrote them, and
 * `REG.DAT` made from `SETUP.REG` as Setup makes it (`regedit.ts`).
 *
 * The Rust engine's twin is `crates/winbox-win16/src/assets.rs`'s
 * `compose`; the two give the same placements, byte for byte.
 *
 * Only data: no code of Windows' is placed. The bundle's modules are not
 * files on C: at all.
 */

import setup from '../../crates/winbox-win16/data/setup.json';
import { regDatFrom } from './regedit.js';

/**
 * When the files WinBox writes were last written: the stamp the page's FAT16
 * volume gives everything it makes (`src/run/drive.ts`), 10:20:40 on 6
 * January 2020, local time read as universal.
 */
export const STAMP = Date.UTC(2020, 0, 6, 10, 20, 40) / 1000;

/** A pool file, with the DOS date and time of the file on the disk it came from. */
export interface PoolFile {
  data: Uint8Array;
  date: number;
  time: number;
}

/** A file put on C:, its path below the root with `/`, and when it was last written. */
export interface Placement {
  path: string;
  data: Uint8Array;
  /** Seconds since 1970, local time read as universal, as DOS keeps it. */
  modified: number;
}

export interface Composed {
  /** The folders, made whether or not anything is placed in them: `WINDOWS/TEMP`. */
  directories: string[];
  /** Sorted by path. */
  files: Placement[];
}

interface SetupDisplay {
  directories: string[];
  files: [string, string][];
  profiles: Record<string, string>;
  registry?: { path: string; script: string };
}

interface SetupProfile {
  end: string;
  lines: [string, string][];
}

const DISPLAYS = setup.displays as unknown as Record<string, SetupDisplay>;
const PROFILES = setup.profiles as unknown as Record<string, SetupProfile>;

/** The display modes there is a composition for. */
export function composedDisplays() {
  return Object.keys(DISPLAYS);
}

/** A DOS date and time as seconds since 1970, local time read as universal. */
export function dosSeconds(date: number, time: number) {
  return (
    Date.UTC(
      1980 + (date >> 9),
      ((date >> 5) & 0x0f) - 1,
      date & 0x1f,
      time >> 11,
      (time >> 5) & 0x3f,
      (time & 0x1f) * 2
    ) / 1000
  );
}

/** A profile's text, line for line as Setup wrote it. */
export function profileText(key: string) {
  const profile = PROFILES[key];

  return Uint8Array.from(
    profile.lines.map(([line]) => line).join('\r\n') + profile.end,
    (character) => character.charCodeAt(0) & 0xff
  );
}

/** What goes on C: for a display, from the pool's files by name. */
export function composeBase(
  pool: (name: string) => PoolFile | undefined,
  display: string
): Composed {
  const layout = DISPLAYS[display];

  if (!layout) {
    throw new Error(`no composition for the display ${display}`);
  }

  const take = (name: string) => {
    const file = pool(name);

    if (!file) {
      throw new Error(`${name} is not in the asset bundle's pool`);
    }

    return file;
  };
  const files: Placement[] = [];

  for (const [path] of layout.files) {
    const file = take(path.slice(path.lastIndexOf('/') + 1));

    files.push({ path, data: file.data, modified: dosSeconds(file.date, file.time) });
  }

  for (const [path, key] of Object.entries(layout.profiles)) {
    files.push({ path, data: profileText(key), modified: STAMP });
  }

  if (layout.registry) {
    files.push({
      path: layout.registry.path,
      data: regDatFrom(take(layout.registry.script).data),
      modified: STAMP,
    });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { directories: [...layout.directories], files };
}
