/**
 * Each kept program's groups as the launcher lists them (`launchGroups`,
 * `src/layers/launch.ts`; `kb/guides/launcher.md`): its stack -- the base
 * it was made on, then its layers -- read from the store once, only the
 * files the list reads (`PROGMAN.INI`, its group files, `WIN.INI` and
 * `REG.DAT`) taken from the layers' blobs; each item with its icon from the
 * group file's own bits. Shown under each kept program (its own groups)
 * and in the launcher's menu (every group, WinBox's own of a program kept
 * loose too). Null while being read.
 */

import { type Assets } from '../../assets/bundle.js';
import { groupFiles, groupsFrom, type Icon, PROGMAN_INI } from '../../layers/groups.js';
import {
  type KeptStack,
  type LaunchGroup,
  type LaunchItem,
  stackGroups,
} from '../../layers/launch.js';
import { baseName, flattenStack, type Layer } from '../../layers/layer.js';
import { type Archive, planDrive, planManifest } from '../drive.js';
import { type KeptProgram, recallBlobs, recallManifests } from '../store.js';

/** An item as the page shows it: the launcher's, with its icon from the group file. */
export interface KeptItem extends LaunchItem {
  icon: Icon | null;
}

/** A group as the page shows it. */
export interface KeptGroup extends Omit<LaunchGroup, 'items'> {
  items: KeptItem[];
}

/** A kept program's groups as read: and whether the Windows it was made on is here, its items' runs read against it. */
export interface KeptGroups {
  groups: KeptGroup[];
  /** Whether the base it was made on is the Windows dropped, so its items' runs were read on it. */
  based: boolean;
}

/** What the base of C: may be had from: the installation dropped, or the asset bundle. */
export interface Bases {
  windows: Archive | null;
  installation: string | null;
  assets: Assets | null;
}

const groupsKept = new Map<string, KeptGroups | null>();

/** The bases read, by their names (`baseNow`'s), each its files and folders by their paths. */
const basesRead = new Map<string, Layer>();

/** A prefix no layer's hash has, for the base's files, which have their bytes. */
const BASE = 'base:';

/**
 * The base a program was made on, as a layer whose files have their bytes,
 * from the Windows dropped; null where it is not that Windows.
 */
function baseLayer(program: KeptProgram, bases: Bases): Layer | null {
  const { windows, installation, assets } = bases;
  const install = windows && installation ? `install:${installation}` : null;
  const display = program.display;
  const named = install ?? (assets ? baseName(assets.id, display) : null);

  if (program.base !== named) {
    return null;
  }

  const read = basesRead.get(named);

  if (read) {
    return read;
  }

  const plan = install ? planDrive([], windows) : planDrive([], null, assets!.compose(display));
  const manifest = planManifest(plan, named);
  const blobs = new Map<string, Uint8Array>();

  for (const placement of plan.placements) {
    blobs.set(`${BASE}${placement.parts.join('\\')}`, placement.data);
  }

  const layer: Layer = {
    manifest: {
      ...manifest,
      entries: manifest.entries.map((entry) =>
        entry.kind === 'file' ? { ...entry, sha256: `${BASE}${entry.path}` } : entry
      ),
    },
    blobs,
  };

  basesRead.set(named, layer);
  return layer;
}

/**
 * A kept program's groups as read; null until then, the reading begun,
 * `read` told once they are. Read again where the Windows it can be read
 * on changes.
 */
export function keptGroups(program: KeptProgram, bases: Bases, read: () => void) {
  const base = baseLayer(program, bases);
  const key = `${program.name}\n${program.layers.join(' ')}\n${base ? program.base : ''}`;

  if (!groupsKept.has(key)) {
    groupsKept.set(key, null);
    readGroups(program, base)
      .then((groups) => {
        groupsKept.set(key, groups);
        read();
      })
      .catch((error) => console.error(error));
  }

  return groupsKept.get(key) ?? null;
}

/**
 * A kept program's groups: its layers' manifests flattened over its base
 * -- or, where the Windows it was made on is not here, an empty one of its
 * name -- and the files the launcher's list reads taken from the blobs.
 */
async function readGroups(program: KeptProgram, base: Layer | null): Promise<KeptGroups> {
  const manifests = await recallManifests(program);
  const empty = new Uint8Array(0);
  const beneath: Layer = base ?? {
    manifest: {
      format: 1,
      id: manifests[0]?.over[0] ?? program.base,
      over: [],
      made: { by: 'WinBox' },
      entries: [],
    },
    blobs: new Map(),
  };
  const hollow = manifests.map((manifest): Layer => ({
    manifest,
    blobs: new Map(
      manifest.entries.flatMap((entry) =>
        entry.kind === 'file' ? [[entry.sha256, empty] as [string, Uint8Array]] : []
      )
    ),
  }));
  const flat = flattenStack([beneath, ...hollow]);
  const files = new Map(flat.files.map((file) => [file.path, file]));
  const folders = new Set(flat.folders.map((folder) => folder.path));
  const bytes = new Map<string, Uint8Array>();
  const own = (path: string) => {
    const file = files.get(path);

    return Boolean(file && !file.sha256.startsWith(BASE));
  };
  const fetch = async (paths: string[]) => {
    const wanted = paths.filter((path) => own(path));
    const blobs = await recallBlobs(wanted.map((path) => files.get(path)!.sha256));

    for (const path of wanted) {
      const data = blobs.get(files.get(path)!.sha256);

      if (data) {
        bytes.set(path, data);
      }
    }
  };
  const readFile = (path: string) => {
    const file = files.get(path);

    return !file ? undefined : own(path) ? bytes.get(path) : file.data;
  };

  await fetch([PROGMAN_INI, 'WINDOWS\\WIN.INI', 'WINDOWS\\REG.DAT']);

  const ini = readFile(PROGMAN_INI);

  if (ini) {
    await fetch(groupFiles(ini));
  }

  const stack: KeptStack = {
    name: program.name,
    read: readFile,
    kind: (path) => (files.has(path) ? 'file' : folders.has(path) || path === '' ? 'folder' : null),
    own,
    exes: program.exes,
  };
  const loaded = new Map(groupsFrom(readFile).groups.map((group) => [group.file, group.group]));

  return {
    based: Boolean(base),
    groups: stackGroups(stack).map((group) => ({
      ...group,
      items: group.items.map((item, at) => ({
        ...item,
        icon: loaded.get(group.file)?.items[at]?.icon ?? null,
      })),
    })),
  };
}
