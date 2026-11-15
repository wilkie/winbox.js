#!/usr/bin/env node
/**
 * The runtimes the first pass places for programs that do not bring them:
 * Visual Basic's, Klik & Play's and Borland's controls, as an installed copy
 * of Windows would have had them in `WINDOWS\SYSTEM` (`kb/guides/compatibility.md`,
 * "Runtimes").
 *
 *   node scripts/catalog/runtimes.mjs --fetch   # each runtime into corpus/cache/catalog/runtimes/, checked
 *   node scripts/catalog/runtimes.mjs --write   # catalog/runtimes.json: hashes, versions, the programs that need each
 *
 * Each comes from archive.org (`SOURCES`): an item that is the runtime
 * itself where there is one, else the product that shipped it. The files
 * are third-party binaries and are never committed: `catalog/runtimes.json`
 * says where each is published and how to check its bytes, and the files
 * are fetched into the gitignored `corpus/cache/catalog/runtimes/<module>/`.
 *
 * Polite to archive.org as `fetch.mjs` is: one request at a time, a second
 * apart, the User-Agent "WinBox catalog", no credentials. A download is
 * untrusted: it is held to archive.org's SHA-1 where archive.org gives one
 * (a whole file), and to the SHA-1 and SHA-256 the manifest records; it is
 * read only as data (its header, its version resource), and runs only
 * inside WinBox.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROGRAMS, catalogItems, stateOf } from './fetch.mjs';
import { filesOf, neImports } from './needs.mjs';
import { blockOf, namesOf, resourceOf, versionOf } from './titles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIMES = join(ROOT, 'corpus', 'cache', 'catalog', 'runtimes');
const MANIFEST = join(ROOT, 'catalog', 'runtimes.json');
const USER_AGENT = 'WinBox catalog';
const DELAY = 1000;

/**
 * Where each runtime is fetched from: the archive.org item, the file of it,
 * and, where the runtime is a member of an archive or a disc's image, the
 * member's path in it (fetched through archive.org's view of the archive).
 * `distribution` names the publisher's own redistributable in the same
 * item, where its member was found to be the same bytes.
 */
export const SOURCES = [
  {
    module: 'VBRUN100',
    file: 'VBRUN100.DLL',
    title: 'Visual Basic 1.0 runtime',
    publisher: 'Microsoft',
    item: 'vbrunDLL',
    path: 'VBRUN100.DLL',
    distribution: { path: 'vbrun100.exe', member: 'VBRUN100.DLL' },
  },
  {
    module: 'VBRUN200',
    file: 'VBRUN200.DLL',
    title: 'Visual Basic 2.0 runtime',
    publisher: 'Microsoft',
    item: 'vbrunDLL',
    path: 'VBRUN200.DLL',
    distribution: { path: 'vbrun200.exe', member: 'VBRUN200.DLL' },
  },
  {
    module: 'VBRUN300',
    file: 'VBRUN300.DLL',
    title: 'Visual Basic 3.0 runtime',
    publisher: 'Microsoft',
    item: 'vbrunDLL',
    path: 'VBRUN300.DLL',
    distribution: { path: 'vbrun300.exe', member: 'VBRUN300.DLL' },
  },
  {
    module: 'KNPG',
    file: 'KNPG.DLL',
    title: 'Klik & Play game library',
    publisher: 'Europress Software',
    item: 'cdrom_klik_and_play',
    path: 'KNP.iso',
    member: 'KNPG.DLL',
  },
  {
    module: 'KNPS',
    file: 'KNPS.DLL',
    title: 'Klik & Play graphic library',
    publisher: 'Europress Software',
    item: 'klikplay_12PL',
    path: 'Klikplay.zip',
    member: 'Klikplay/KNPS.DLL',
  },
  {
    module: 'BWCC',
    file: 'BWCC.DLL',
    title: 'Borland Windows Custom Controls',
    publisher: 'Borland',
    item: 'BWCC_ZIP',
    path: 'BWCC.ZIP',
    member: 'BWCC.DLL',
  },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (kind, bytes) => createHash(kind).update(bytes).digest('hex');

/** The committed manifest, by module; empty before `--write` has made it. */
export function manifest() {
  if (!existsSync(MANIFEST)) {
    return new Map();
  }

  return new Map(
    JSON.parse(readFileSync(MANIFEST, 'utf8')).runtimes.map((each) => [each.module, each])
  );
}

/** A runtime's file in the cache. */
export function runtimePath(module) {
  const source = SOURCES.find((each) => each.module === module);

  return source ? join(RUNTIMES, module, source.file) : null;
}

/**
 * The runtimes placed for the modules a program lacks, and the modules
 * still lacking: each lacking module there is a runtime of, and in turn
 * the modules those runtimes import that are runtimes too (`KNPG` imports
 * `KNPS`) and that the program does not bring. A runtime must have been
 * fetched (`--fetch`) for its imports to be read.
 */
export function runtimesFor(lacking, brought = new Set()) {
  const runtimes = [];
  const libraries = [];
  const pending = [...lacking];

  while (pending.length) {
    const module = pending.shift();

    if (runtimes.includes(module) || libraries.includes(module)) {
      continue;
    }

    if (!SOURCES.some((source) => source.module === module)) {
      libraries.push(module);
      continue;
    }

    const bytes = runtimeBytes(module);

    if (!bytes) {
      throw new Error(`the runtime ${module} is not fetched: scripts/catalog/runtimes.mjs --fetch`);
    }

    runtimes.push(module);
    pending.push(
      ...(neImports(bytes)?.modules ?? []).filter(
        (each) => SOURCES.some((source) => source.module === each) && !brought.has(each)
      )
    );
  }

  return { runtimes: runtimes.sort(), libraries: libraries.sort() };
}

/** Each runtime's bytes once read and checked. */
const checked = new Map();

/** A runtime's bytes, checked against the manifest; null where not fetched. */
export function runtimeBytes(module) {
  const file = runtimePath(module);

  if (!file || !existsSync(file)) {
    return null;
  }

  if (!checked.has(module)) {
    const bytes = readFileSync(file);
    const entry = manifest().get(module);

    if (entry?.sha256 && sha('sha256', bytes) !== entry.sha256) {
      throw new Error(`${file}: its SHA-256 is not the manifest's`);
    }

    checked.set(module, bytes);
  }

  return checked.get(module);
}

/**
 * The ordinals a New Executable exports, from its entry table (its offset
 * at 04h in the header, its length at 06h): bundles of a count and a
 * segment's indicator, nought for ordinals left unused, FFh for movable
 * entries of six bytes, else fixed entries of three.
 */
export function exportedOrdinals(bytes) {
  const ne = bytes.readUInt32LE(0x3c);
  let at = ne + bytes.readUInt16LE(ne + 0x04);
  const end = at + bytes.readUInt16LE(ne + 0x06);
  const ordinals = new Set();
  let ordinal = 1;

  while (at < end) {
    const count = bytes[at];

    if (!count) {
      break;
    }

    const segment = bytes[at + 1];

    at += 2;

    if (segment === 0) {
      ordinal += count;
      continue;
    }

    for (let index = 0; index < count; index++) {
      ordinals.add(ordinal++);
    }

    at += count * (segment === 0xff ? 6 : 3);
  }

  return ordinals;
}

/**
 * A file's version: the fixed part of its version resource (type 16; its
 * value begins FEEF04BDh, the file's version at 08h, high word first), and
 * the strings of its first table.
 */
export function fileVersion(bytes) {
  const data = resourceOf(bytes, 16);
  let fixed = null;

  if (data && data.length >= 8) {
    try {
      const value = blockOf(data, 0).value;

      if (value.length >= 16 && value.readUInt32LE(0) === 0xfeef04bd) {
        const high = value.readUInt32LE(8);
        const low = value.readUInt32LE(12);

        fixed = `${high >>> 16}.${high & 0xffff}.${low >>> 16}.${low & 0xffff}`;
      }
    } catch {
      /* No version resource that can be read. */
    }
  }

  const strings = versionOf(bytes);

  return {
    version: fixed,
    ...(strings?.FileVersion ? { fileVersion: strings.FileVersion } : {}),
    ...(strings?.FileDescription ? { fileDescription: strings.FileDescription } : {}),
    ...(strings?.CompanyName ? { companyName: strings.CompanyName } : {}),
  };
}

/** The URL of an item's file, or of a member of it. */
function urlOf(source, path = source.path, member = source.member) {
  return `https://archive.org/download/${encodeURIComponent(source.item)}/${[
    ...path.split('/'),
    ...(member ? member.split('/') : []),
  ]
    .map(encodeURIComponent)
    .join('/')}`;
}

async function get(url) {
  await wait(DELAY);

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (!response.ok) {
    throw new Error(`${url}: archive.org answered ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/** archive.org's SHA-1 of an item's file, from its metadata. */
async function archiveSha1(source) {
  const metadata = JSON.parse(
    (await get(`https://archive.org/metadata/${encodeURIComponent(source.item)}`)).toString('utf8')
  );

  return metadata.files?.find((file) => file.name === source.path)?.sha1 ?? null;
}

/** Each runtime fetched into its own folder of the cache, and checked. */
async function fetchAll() {
  const known = manifest();

  for (const source of SOURCES) {
    const file = runtimePath(source.module);
    const entry = known.get(source.module);

    if (existsSync(file)) {
      runtimeBytes(source.module);
      console.log(`${source.module}\talready fetched`);
      continue;
    }

    const bytes = await get(urlOf(source));

    if (!source.member) {
      const expected = await archiveSha1(source);

      if (expected && sha('sha1', bytes) !== expected) {
        throw new Error(
          `${source.path}: SHA-1 ${sha('sha1', bytes)}, archive.org says ${expected}`
        );
      }
    }

    if (entry?.sha1 && sha('sha1', bytes) !== entry.sha1) {
      throw new Error(
        `${source.module}: SHA-1 ${sha('sha1', bytes)}, the manifest says ${entry.sha1}`
      );
    }

    if (entry?.sha256 && sha('sha256', bytes) !== entry.sha256) {
      throw new Error(`${source.module}: its SHA-256 is not the manifest's`);
    }

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.part`, bytes);
    renameSync(`${file}.part`, file);
    console.log(`${source.module}\t${bytes.length} bytes\t${sha('sha1', bytes)}`);
  }
}

/**
 * The ordinals of a module that programs import, each with how many of
 * them import it: from every New Executable of each program's folder that
 * imports the module (its relocation records, `neImports`).
 */
function importedOrdinals(module, ids) {
  const counts = new Map();

  for (const id of ids) {
    const seen = new Set();

    for (const file of filesOf(join(PROGRAMS, id))) {
      if (!/\.(exe|dll|vbx|drv)$/i.test(file)) {
        continue;
      }

      const found = neImports(readFileSync(file));

      for (const each of found?.functions ?? []) {
        if (each.startsWith(`${module}.@`)) {
          seen.add(Number(each.slice(module.length + 2)));
        }
      }
    }

    for (const ordinal of seen) {
      counts.set(ordinal, (counts.get(ordinal) ?? 0) + 1);
    }
  }

  return new Map([...counts].sort((a, b) => a[0] - b[0]));
}

/** The manifest written from the files fetched and the pass's needs. */
function write() {
  const items = catalogItems();
  const needing = new Map(SOURCES.map((source) => [source.module, []]));

  for (const item of items) {
    const { needs, result } = stateOf(item.id);

    for (const module of result?.runtimes ?? needs?.runtimes ?? []) {
      needing.get(module)?.push(item.id);
    }
  }

  const runtimes = SOURCES.map((source) => {
    const file = runtimePath(source.module);

    if (!existsSync(file)) {
      throw new Error(`${source.module} is not fetched: --fetch first`);
    }

    const bytes = readFileSync(file);
    const imports = neImports(bytes);
    const exported = exportedOrdinals(bytes);
    const ordinals = importedOrdinals(source.module, needing.get(source.module));

    return {
      module: source.module,
      file: source.file,
      title: source.title,
      publisher: source.publisher,
      archiveOrg: {
        item: source.item,
        file: source.path,
        ...(source.member ? { member: source.member } : {}),
        ...(source.distribution ? { distribution: source.distribution } : {}),
        url: urlOf(source),
      },
      size: bytes.length,
      sha1: sha('sha1', bytes),
      sha256: sha('sha256', bytes),
      ...fileVersion(bytes),
      description: namesOf(bytes).description,
      imports: imports?.modules ?? [],
      exports: exported.size,
      /* The ordinals the programs import of it, by how many programs; any it does not export. */
      ordinals: Object.fromEntries(ordinals),
      unexported: [...ordinals.keys()].filter((ordinal) => !exported.has(ordinal)),
      programs: needing.get(source.module).sort(),
    };
  });

  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        about:
          'The runtimes the compatibility catalog\'s first pass places in a run\'s WINDOWS\\SYSTEM for programs that import them and do not bring them: where each is published on archive.org, its hashes, size and version, and the programs that need it (kb/guides/compatibility.md, "Runtimes"). The files are third-party binaries, never committed: scripts/catalog/runtimes.mjs --fetch fetches them into the gitignored corpus/cache/catalog/runtimes/. Made by scripts/catalog/runtimes.mjs --write.',
        runtimes,
      },
      null,
      1
    )}\n`
  );

  for (const each of runtimes) {
    console.log(`${each.module}\t${each.version}\t${each.sha1}\t${each.programs.length} programs`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--fetch')) {
    await fetchAll();
  }

  if (args.includes('--write')) {
    write();
  }

  if (!args.includes('--fetch') && !args.includes('--write')) {
    console.error('node scripts/catalog/runtimes.mjs --fetch | --write');
    process.exitCode = 1;
  }
}
