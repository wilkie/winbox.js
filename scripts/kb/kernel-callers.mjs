#!/usr/bin/env node
/**
 * Who calls each of KERNEL's exports: a census of the modules that import them.
 *
 * Many of KERNEL's exports are there only for Windows' own parts -- USER,
 * GDI, the drivers, WINOLDAP, TOOLHELP -- and the SDK says nothing of them.
 * Which part calls which is written in each module's own file: an `NE`
 * module names every function it takes from another in its relocation
 * records, by the other module's ordinal or by its name (the module
 * reference table and the imported names table say which). This reads those
 * records from every `NE` file under the folders it is given and counts, for
 * each KERNEL export, the files that import it.
 *
 * A program can also reach an export with `GetProcAddress`, which no
 * relocation records. Where a file imports `GetProcAddress` and holds an
 * export's name as a string of its own, the census notes the name as a hint,
 * kept apart from the imports: the string may be there for another reason, and
 * a call by ordinal through `GetProcAddress` leaves no name at all.
 *
 * Only names and ordinals are written, never a file's bytes. `LE` files (the
 * virtual device drivers, `WIN386.EXE`) import nothing from KERNEL; they are
 * listed by name apart from the rest.
 *
 *   node scripts/kb/kernel-callers.mjs --exports kb/data/exports-3.1.json \
 *     --windows oracle/build/drive-c [--windows oracle/build/drive-c-svga ...] \
 *     --corpus corpus/programs --headers oracle/.cache/watcom/h/win \
 *     --out kb/data/kernel-callers.json [--module USER]
 *
 * `--module` names the module whose exports are counted (KERNEL unless
 * given): `--module USER --out kb/data/user-callers.json` makes the same
 * census of USER's exports, and so for SHELL or MMSYSTEM. The hints are
 * still taken from files importing KERNEL's `GetProcAddress`.
 *
 * `--headers` names a folder of the SDK's C headers for Windows 3.x (Open
 * Watcom's, which follow the Windows 3.1 SDK's): an export a header declares
 * as a function (`WINAPI Name(`, `FAR PASCAL Name(`) is marked with the header
 * that declares it, as the census's rule for "documented for applications".
 *
 * Every `--windows` folder is one installation of Windows; a file found in
 * several is listed once, by its path under the installation, with the
 * installations it differs in noted. Every folder directly under `--corpus` is
 * one program. Nothing is run; the files are only read.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/** The arguments: each option once, `--windows` as often as there are installations. */
function options(argv) {
  const out = {
    windows: [],
    corpus: null,
    exports: null,
    out: null,
    headers: null,
    module: 'KERNEL',
  };

  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];

    if (value === undefined) {
      throw new Error(`${flag} wants a value`);
    }

    if (flag === '--windows') {
      out.windows.push(value);
    } else if (flag === '--corpus') {
      out.corpus = value;
    } else if (flag === '--exports') {
      out.exports = value;
    } else if (flag === '--headers') {
      out.headers = value;
    } else if (flag === '--out') {
      out.out = value;
    } else if (flag === '--module') {
      out.module = value.toUpperCase();
    } else {
      throw new Error(`unknown option ${flag}`);
    }
  }

  if (!out.exports || !out.out || (!out.windows.length && !out.corpus)) {
    throw new Error('usage: --exports FILE --out FILE --windows DIR... [--corpus DIR]');
  }

  return out;
}

/** Every file under a folder, symbolic links not followed into. */
function filesUnder(folder) {
  const out = [];

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);

    if (entry.isDirectory()) {
      out.push(...filesUnder(path));
    } else if (entry.isFile()) {
      out.push(path);
    }
  }

  return out.sort();
}

/**
 * What kind of executable a file is: `NE`, `LE` (or `LX`, `W3`, `PE`), or
 * nothing when it has no new header past its `MZ` one.
 */
function kindOf(bytes) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return null;
  }

  const at = bytes.readUInt32LE(0x3c);

  if (at < 0x40 || at + 0x40 > bytes.length) {
    return null;
  }

  const signature = bytes.toString('latin1', at, at + 2);
  return ['NE', 'LE', 'LX', 'W3', 'PE'].includes(signature) ? signature : null;
}

/** Each function name a folder of C headers declares, upper-cased, and the header. */
function declarations(folder) {
  const out = new Map();

  for (const file of readdirSync(folder).sort()) {
    const text = readFileSync(join(folder, file), 'latin1');

    for (const match of text.matchAll(/\b(?:WINAPI|PASCAL|CALLBACK)\s+(\w+)\s*\(/g)) {
      const name = match[1].toUpperCase();

      if (!out.has(name)) out.set(name, file);
    }
  }

  return out;
}

/** A length-prefixed string in a name table. */
function pascal(bytes, at) {
  return bytes.toString('latin1', at + 1, at + 1 + bytes[at]);
}

/**
 * The functions an `NE` module imports, as `MODULE.ordinal` or `MODULE.NAME`,
 * read from every segment's relocation records, and its own module name.
 */
function importsOf(bytes) {
  const at = bytes.readUInt32LE(0x3c);
  const word = (offset) => bytes.readUInt16LE(at + offset);
  const unit = 1 << word(0x32);
  const segmentTable = at + word(0x22);
  const moduleTable = at + word(0x28);
  const importedNames = at + word(0x2a);
  const moduleCount = word(0x1e);
  const modules = [];

  for (let i = 0; i < moduleCount; i++) {
    modules.push(
      pascal(bytes, importedNames + bytes.readUInt16LE(moduleTable + i * 2)).toUpperCase()
    );
  }

  const name = pascal(bytes, at + word(0x26)).toUpperCase();
  const byOrdinal = new Map();
  const byName = new Map();

  for (let i = 0; i < word(0x1c); i++) {
    const entry = segmentTable + i * 8;
    const sector = bytes.readUInt16LE(entry);
    const length = bytes.readUInt16LE(entry + 2) || (sector ? 0x10000 : 0);
    const flags = bytes.readUInt16LE(entry + 4);

    if (!sector || !(flags & 0x0100)) {
      continue;
    }

    let p = sector * unit + length;

    if (p + 2 > bytes.length) {
      continue;
    }

    const count = bytes.readUInt16LE(p);
    p += 2;

    for (let r = 0; r < count && p + 8 <= bytes.length; r++, p += 8) {
      const type = bytes[p + 1] & 3;
      const module = modules[bytes.readUInt16LE(p + 4) - 1];
      const target = bytes.readUInt16LE(p + 6);

      if (!module || (type !== 1 && type !== 2)) {
        continue;
      }

      if (type === 1) {
        if (!byOrdinal.has(module)) byOrdinal.set(module, new Set());
        byOrdinal.get(module).add(target);
      } else {
        if (!byName.has(module)) byName.set(module, new Set());
        byName.get(module).add(pascal(bytes, importedNames + target).toUpperCase());
      }
    }
  }

  return { name, modules, byOrdinal, byName };
}

/**
 * KERNEL export names that appear in a file as strings of their own: a
 * run of name characters bounded by anything else, matched without regard
 * to case. Short names are left out, as they turn up by chance.
 */
function namedStrings(bytes, names) {
  const found = new Set();
  const text = bytes.toString('latin1');

  for (const token of text.match(/[A-Za-z_][A-Za-z0-9_]{5,}/g) ?? []) {
    const upper = token.toUpperCase();

    if (names.has(upper)) {
      found.add(upper);
    }
  }

  return found;
}

function main() {
  const args = options(process.argv.slice(2));
  const surveyed = JSON.parse(readFileSync(args.exports, 'utf8'));
  const kernel = surveyed.modules.find((m) => m.name === 'KERNEL');
  const target = surveyed.modules.find((m) => m.name === args.module);
  // An export with no name (SHELL's 104 to 128) can be imported only by its ordinal.
  const ordinalOf = new Map(
    target.exports.filter((e) => e.name).map((e) => [e.name.toUpperCase(), e.ordinal])
  );
  const getProcAddress = kernel.exports.find(
    (e) => e.name.toUpperCase() === 'GETPROCADDRESS'
  ).ordinal;

  /** For each ordinal: the callers that import it, and those holding its name. */
  const census = new Map(
    target.exports.map((e) => [
      e.ordinal,
      { windows: new Set(), corpus: new Set(), windowsHint: new Set(), corpusHint: new Set() },
    ])
  );
  const unknown = [];
  const others = { LE: new Set(), LX: new Set(), W3: new Set(), PE: new Set() };
  const counts = { windowsFiles: 0, corpusFiles: 0, corpusPrograms: 0 };

  /** One NE file: its imports from the module, by ordinal and by name, and its hints. */
  const survey = (path, caller, where) => {
    const bytes = readFileSync(path);
    const kind = kindOf(bytes);

    if (kind !== 'NE') {
      if (kind) others[kind].add(`${where}:${caller}`);
      return false;
    }

    let imports;

    try {
      imports = importsOf(bytes);
    } catch {
      unknown.push(`${where}:${caller}`);
      return false;
    }

    if (imports.name === args.module) {
      // The module's own builds call themselves directly.
      return false;
    }

    const ordinals = new Set(imports.byOrdinal.get(args.module) ?? []);
    const kernelOrdinals = new Set(imports.byOrdinal.get('KERNEL') ?? []);

    if (imports.byName.get('KERNEL')?.has('GETPROCADDRESS')) {
      kernelOrdinals.add(getProcAddress);
    }

    for (const name of imports.byName.get(args.module) ?? []) {
      if (ordinalOf.has(name)) ordinals.add(ordinalOf.get(name));
    }

    for (const ordinal of ordinals) {
      if (census.has(ordinal)) census.get(ordinal)[where].add(caller);
    }

    if (kernelOrdinals.has(getProcAddress)) {
      for (const name of namedStrings(bytes, ordinalOf)) {
        const ordinal = ordinalOf.get(name);

        if (!ordinals.has(ordinal)) census.get(ordinal)[`${where}Hint`].add(caller);
      }
    }

    return true;
  };

  // Windows: a file is named by its path under its installation.
  const seen = new Map();
  const neFiles = new Set();

  for (const install of args.windows) {
    for (const path of filesUnder(install)) {
      const caller = relative(install, path).split('\\').join('/').toUpperCase();
      const hash = createHash('sha1').update(readFileSync(path)).digest('hex');

      if (!seen.has(caller)) seen.set(caller, new Set());
      if (seen.get(caller).has(hash)) continue;

      seen.get(caller).add(hash);

      if (survey(path, caller, 'windows')) {
        if (!neFiles.has(caller)) counts.windowsFiles++;
        neFiles.add(caller);
      }
    }
  }

  // The corpus: a file is named by its program, then its path in it.
  if (args.corpus) {
    for (const program of readdirSync(args.corpus).sort()) {
      const folder = join(args.corpus, program);

      if (!statSync(folder).isDirectory()) continue;

      counts.corpusPrograms++;

      for (const path of filesUnder(folder)) {
        if (survey(path, `${program}/${relative(folder, path).toUpperCase()}`, 'corpus')) {
          counts.corpusFiles++;
        }
      }
    }
  }

  const sorted = (set) => [...set].sort();
  const declared = args.headers ? declarations(args.headers) : new Map();
  const exports = target.exports.map((e) => {
    const c = census.get(e.ordinal);

    return {
      ordinal: e.ordinal,
      name: e.name,
      declaredIn: (e.name && declared.get(e.name.toUpperCase())) ?? null,
      windows: sorted(c.windows),
      corpus: sorted(c.corpus),
      windowsByName: sorted(c.windowsHint),
      corpusByName: sorted(c.corpusHint),
    };
  });

  const out = {
    generated: 'scripts/kb/kernel-callers.mjs',
    module: args.module,
    about:
      `For each ${args.module} export, the NE files that import it (by ordinal or by name) in the Windows installations and in the corpus programs. ` +
      '`windowsByName` and `corpusByName` are hints only: files importing GetProcAddress that hold the export name as a string of their own.',
    installations: args.windows.map((w) => basename(w)),
    surveyed: counts,
    variants: Object.fromEntries(
      [...seen]
        .filter(([caller, hashes]) => neFiles.has(caller) && hashes.size > 1)
        .map(([caller, hashes]) => [caller, hashes.size])
    ),
    notNE: Object.fromEntries(
      Object.entries(others)
        .map(([kind, set]) => [kind, sorted(set)])
        .filter(([, list]) => list.length)
    ),
    unreadable: unknown.sort(),
    exports,
  };

  writeFileSync(args.out, JSON.stringify(out, null, 1) + '\n');

  const internal = exports.filter((e) => e.windows.length || e.corpus.length).length;
  console.log(
    `${exports.length} exports; ${internal} imported by some file; ${counts.windowsFiles} Windows NE files, ${counts.corpusFiles} corpus NE files`
  );
}

main();
