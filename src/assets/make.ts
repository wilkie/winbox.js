/**
 * Makes WinBox's asset bundle out of the user's own Windows 3.1 media: the
 * fonts, sounds and data files programs see, and the resources of `USER.EXE`,
 * `SHELL.DLL` and the display drivers with their code taken out
 * (`kb/topics/asset-bundle.md`).
 *
 * The same maker runs in Node (`scripts/assets/make-assets.mjs`) and, later,
 * in the browser. It takes what it is given -- floppy images, zips of them,
 * the disks' files, or an installed `WINDOWS` folder -- expands the
 * `COMPRESS`ed files as `LZEXPAND` does, and picks the files by Setup's own
 * lists in `SETUP.INF`:
 *
 * - The pool: the fonts of `[sysfonts]`, `[fixedfonts]`, `[oemfonts]`,
 *   `[fonts]` and `[ttfonts]` (stub and TrueType file); the DOS-window fonts
 *   of the grabbers' sections (`[VGA.3gr]` and the rest), their first column,
 *   and `[codepages]`' for 437, the code page Setup took for the oracle's
 *   installations (`DOSAPP.FON`, `CGA40WOA.FON` and the rest there);
 *   `MIDIMAP.CFG` and `SETUP.REG` of `[win.other]`; and the sounds of
 *   `[win.bmps]`.
 * - The modules: `USER.EXE` (`[windows.system]`), `SHELL.DLL`
 *   (`[win.other]`) and each display's driver (`[display]`, or a driver
 *   disk's `OEMSETUP.INF`), with their segments made nought (`ne.ts`).
 *
 * Nothing is written to C: here; which pool file goes where for a display
 * is the composer's (`compose.ts`).
 */

import { readZip } from '../zip.js';
import { readFat12 } from '../file-systems/fat12.js';
import { diskFile, readInf, section, type Inf } from './setup-inf.js';
import { expandSzdd, expandedName, isSzdd } from './szdd.js';
import { zeroSegments } from './ne.js';
import { writeStoredZip } from './zip.js';

export const FORMAT = 1;

/** The manifest's name in the bundle. */
export const MANIFEST = 'winbox-assets.json';

/** A file given to the maker: its name or path, and its bytes. */
export interface AssetInput {
  name: string;
  bytes: Uint8Array;
}

/** A file of the media the bundle was made from. */
export interface Source {
  /** The file's name as the medium has it: `ARIAL.FO_`. */
  name: string;
  /** The disk it is on, by the marker file Setup looks for (`disk3`), where it is a disk's. */
  disk?: string;
  size: number;
  sha256: string;
  /** Whether `known-media.json` has this file with this hash. */
  known: boolean;
}

export interface ManifestFile {
  /** `pool/ARIAL.FOT`, `modules/VGA.DRV`. */
  path: string;
  sha256: string;
  size: number;
  /** The DOS date and time of the file it came from: the disk's directory entry. */
  date: number;
  time: number;
  /** Where it came from: `disk5:ARIAL.FO_`. */
  from: string;
}

export interface Manifest {
  format: number;
  /** The sha256 of the files' hashes, sorted, one to a line. */
  id: string;
  made: { by: string; version?: string; commit?: string };
  sources: Source[];
  files: ManifestFile[];
  /** The display modes the bundle can serve, by WinBox's names. */
  displays: string[];
}

/** `known-media.json`: each medium's files and their hashes. */
export interface KnownMedia {
  media: { id: string; files: { disk?: string; name: string; size: number; sha256: string }[] }[];
}

export interface BundleFile {
  path: string;
  data: Uint8Array;
  date: number;
  time: number;
}

export interface Made {
  zip: Uint8Array;
  manifest: Manifest;
  /** The bundle's files, the manifest first, as the zip holds them. */
  files: BundleFile[];
}

/**
 * The display modes and the `SETUP.INF` profiles the oracle installed them
 * with (`scripts/oracle/install-windows.mjs`, `DISPLAYS`): the profile
 * itself, or for a display changed afterwards the profile of the
 * description it was changed to. The 256-colour one is the Driver
 * Library's, from its own `OEMSETUP.INF`.
 */
export const DISPLAY_PROFILES: Record<string, { profile: string; oem?: boolean }> = {
  vga: { profile: 'vga' },
  svga: { profile: 'svga' },
  ega: { profile: 'egahires' },
  hercules: { profile: 'hercules' },
  vga256: { profile: '8et4480', oem: true },
  8514: { profile: '8514' },
  '8514s': { profile: '8514s' },
  xga256: { profile: 'xgalg' },
  xga256s: { profile: 'xgasm' },
  xga640: { profile: 'xgalo' },
};

/** The data files of `[win.other]` the bundle keeps; the rest there is code. */
const OTHER_DATA = ['MIDIMAP.CFG', 'SETUP.REG'];

/** The code page whose fonts the oracle's installations have. */
const CODE_PAGE = '437';

/** A file found in what was given: expanded, under the name Setup gives it. */
interface Found {
  name: string;
  data: Uint8Array;
  date: number;
  time: number;
  from: string;
  source: Omit<Source, 'known'>;
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Seconds since 1970, local time read as universal, as DOS words. */
function dosWords(seconds: number | undefined) {
  if (seconds === undefined) {
    return { date: 0x0021, time: 0 };
  }

  const when = new Date(seconds * 1000);

  return {
    date:
      ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
  };
}

const FLOPPY_SIZES = [163840, 184320, 327680, 368640, 737280, 1228800, 1474560, 2949120];

function isFloppy(name: string, bytes: Uint8Array) {
  return (
    /\.(img|ima|dsk|vfd)$/i.test(name) ||
    (FLOPPY_SIZES.includes(bytes.length) && bytes[510] === 0x55 && bytes[511] === 0xaa)
  );
}

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Every file of what was given, opened up: images read, zips unpacked. */
async function gather(inputs: AssetInput[]) {
  const loose: { path: string; data: Uint8Array; date: number; time: number; disk?: string }[] = [];

  const take = async (name: string, bytes: Uint8Array, stamp: { date: number; time: number }) => {
    if (isZip(bytes)) {
      for (const entry of await readZip(bytes)) {
        await take(entry.path, entry.data, dosWords(entry.modified));
      }
    } else if (isFloppy(name, bytes)) {
      const files = readFat12(bytes);
      const marker = files.find((file) => /^DISK\d+$/i.test(file.path));
      const disk = marker?.path.toLowerCase();

      for (const file of files) {
        loose.push({ path: file.path, data: file.data, date: file.date, time: file.time, disk });
      }
    } else {
      loose.push({ path: name, data: bytes, ...stamp });
    }
  };

  for (const input of inputs) {
    await take(input.name, input.bytes, dosWords(undefined));
  }

  return loose;
}

/** The files by the names Setup gives them, the first found of each name kept. */
async function catalogue(inputs: AssetInput[]) {
  const found = new Map<string, Found>();

  for (const file of await gather(inputs)) {
    const medium = baseName(file.path).toUpperCase();
    let data = file.data;
    let name = medium;

    if (isSzdd(file.data)) {
      const expanded = expandSzdd(file.data);

      data = expanded.data;
      name = expandedName(medium, expanded.last);
    }

    if (found.has(name)) {
      continue;
    }

    found.set(name, {
      name,
      data,
      date: file.date,
      time: file.time,
      from: file.disk ? `${file.disk}:${medium}` : file.path,
      source: {
        name: medium,
        ...(file.disk ? { disk: file.disk } : {}),
        size: file.data.length,
        sha256: await sha256(file.data),
      },
    });
  }

  return found;
}

/** The file named by each field, where a field names one. */
function filesOf(lines: { fields: string[] }[], columns: number[]) {
  return lines.flatMap((line) =>
    columns
      .map((column) => diskFile(line.fields[column])?.name)
      .filter((name) => name !== undefined)
  );
}

/** The pool's names, by Setup's lists. */
export function poolNames(inf: Inf) {
  const names = new Set<string>();
  const add = (list: string[]) => list.forEach((name) => names.add(name));

  for (const fonts of ['sysfonts', 'fixedfonts', 'oemfonts', 'fonts']) {
    add(filesOf(section(inf, fonts), [0]));
  }

  add(filesOf(section(inf, 'ttfonts'), [0, 2]));

  for (const [name, lines] of inf) {
    if (name.endsWith('.3gr')) {
      add(filesOf(lines, [0]));
    }
  }

  add(
    filesOf(
      section(inf, 'codepages').filter((line) => line.key === CODE_PAGE),
      [2]
    )
  );
  add(filesOf(section(inf, 'win.other'), [0]).filter((name) => OTHER_DATA.includes(name)));
  add(filesOf(section(inf, 'win.bmps'), [0]).filter((name) => name.endsWith('.WAV')));

  return [...names].sort();
}

/** A display's driver file, from its profile's `[display]` line. */
export function driverOf(inf: Inf, profile: string) {
  const line = section(inf, 'display').find((entry) => entry.key === profile);

  return diskFile(line?.fields[0])?.name ?? null;
}

/** The bundle made from what was given. */
export async function makeAssets(
  inputs: AssetInput[],
  options: { known?: KnownMedia; made?: Manifest['made'] } = {}
): Promise<Made> {
  const found = await catalogue(inputs);
  const setupInf = found.get('SETUP.INF');

  if (!setupInf) {
    throw new Error("no SETUP.INF among the files given: it is on the setup disks' first disk");
  }

  const latin1 = (data: Uint8Array) =>
    Array.from(data, (byte) => String.fromCharCode(byte)).join('');
  const inf = readInf(latin1(setupInf.data));
  const oemInf = found.get('OEMSETUP.INF');
  const oem = oemInf ? readInf(latin1(oemInf.data)) : null;
  const missing: string[] = [];
  const used = new Map<string, Found>([['SETUP.INF', setupInf]]);
  const files: BundleFile[] = [];
  const entries: Omit<ManifestFile, 'sha256' | 'size'>[] = [];

  const add = (path: string, file: Found, data: Uint8Array) => {
    used.set(file.name, file);
    files.push({ path, data, date: file.date, time: file.time });
    entries.push({ path, date: file.date, time: file.time, from: file.from });
  };

  for (const name of poolNames(inf)) {
    const file = found.get(name);

    if (file) {
      add(`pool/${name}`, file, file.data);
    } else {
      missing.push(name);
    }
  }

  const modules = new Set(['USER.EXE', 'SHELL.DLL']);
  const displays: string[] = [];

  for (const [display, { profile, oem: fromOem }] of Object.entries(DISPLAY_PROFILES)) {
    const driver = driverOf(fromOem ? (oem ?? new Map()) : inf, profile);

    if (driver && found.has(driver)) {
      modules.add(driver);
      displays.push(display);
    }
  }

  for (const name of [...modules].sort()) {
    const file = found.get(name);

    if (file) {
      add(`modules/${name}`, file, zeroSegments(file.data));
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`these files are not in what was given: ${missing.join(', ')}`);
  }

  if (oemInf && displays.includes('vga256')) {
    used.set('OEMSETUP.INF', oemInf);
  }

  const known = new Set(
    (options.known?.media ?? []).flatMap((medium) =>
      medium.files.map((file) => `${file.name.toUpperCase()} ${file.sha256}`)
    )
  );
  const sources: Source[] = [...used.values()]
    .map((file) => ({
      ...file.source,
      known: known.has(`${file.source.name} ${file.source.sha256}`),
    }))
    .sort((a, b) => (a.disk ?? '').localeCompare(b.disk ?? '') || a.name.localeCompare(b.name));

  const order = files.map((_, i) => i).sort((a, b) => (files[a].path < files[b].path ? -1 : 1));
  const listed: ManifestFile[] = [];

  for (const i of order) {
    const entry = entries[i];

    listed.push({
      path: entry.path,
      sha256: await sha256(files[i].data),
      size: files[i].data.length,
      date: entry.date,
      time: entry.time,
      from: entry.from,
    });
  }

  const hashes = listed.map((file) => file.sha256).sort();
  const id = await sha256(new TextEncoder().encode(hashes.join('\n')));
  const manifest: Manifest = {
    format: FORMAT,
    id,
    made: options.made ?? { by: 'WinBox' },
    sources,
    files: listed,
    displays: displays.sort(),
  };
  const text = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const bundled: BundleFile[] = [
    { path: MANIFEST, data: text, ...dosWords(undefined) },
    ...order.map((i) => files[i]),
  ];

  return { zip: writeStoredZip(bundled), manifest, files: bundled };
}
