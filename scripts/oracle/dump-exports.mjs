#!/usr/bin/env node
/**
 * Checks our ordinal numbering against the Windows SDK's.
 *
 * An ordinal is not a detail we get to choose. A Win16 program does not import
 * `lstrcmpi` by name -- it imports USER.471, and the loader is expected to know
 * that 471 is `lstrcmpi`. If our table puts something else at 471, every call
 * lands in the wrong function, and nothing about the resulting failure points
 * at the numbering.
 *
 * The modules themselves are a poor authority here: `USER.EXE` names only a few
 * dozen of its exports in its name tables and exports the rest by number alone.
 * The import library is the complete record. `windows.lib` exists precisely to
 * turn a name into a module and an ordinal at link time, and it carries one
 * IMPDEF record per export to do it:
 *
 *     A0 01 01 <len> NAME <len> MODULE <ordinal:16>
 *
 * where A0 is a COMENT record of class IMPDEF, the second 01 says this import
 * is by ordinal, and the rest is the mapping.
 *
 *   node scripts/oracle/dump-exports.mjs                # check ours against it
 *   node scripts/oracle/dump-exports.mjs --find lstrcmpi
 *   node scripts/oracle/dump-exports.mjs --list USER
 *
 * Needs the toolchain from fetch-toolchain.mjs.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIBRARY = join(ROOT, 'oracle', '.cache', 'watcom', 'lib286', 'win', 'windows.lib');

/** Where our export tables live: the Rust engine's `KEPT`, one per module kept. */
const KEPT = join(ROOT, 'crates', 'winbox-win16', 'src', 'kept.rs');

/** The modules we reimplement, by the name `KEPT` keeps each under. */
export const MODULES = ['KERNEL', 'USER', 'GDI'];

function log(...args) {
  console.log(...args);
}

/**
 * Reads every name-to-ordinal mapping out of the import library.
 *
 * Scanning for the record signature rather than walking the OMF structure:
 * the library is a few hundred kilobytes of records in a dozen shapes, and the
 * three bytes that introduce an IMPDEF are distinctive enough that finding
 * them directly is both shorter and harder to get wrong than parsing around
 * everything else.
 */
export async function readLibrary() {
  const data = await readFile(LIBRARY).catch(() => {
    throw new Error(`no ${LIBRARY}; run scripts/oracle/fetch-toolchain.mjs first`);
  });

  const modules = new Map();

  for (let at = 0; at < data.length - 8; at++) {
    // COMENT, class IMPDEF, imported by ordinal.
    if (data[at] !== 0xa0 || data[at + 1] !== 0x01 || data[at + 2] !== 0x01) {
      continue;
    }

    const nameLength = data[at + 3];
    const nameAt = at + 4;
    const moduleLength = data[nameAt + nameLength];
    const moduleAt = nameAt + nameLength + 1;

    if (nameLength === 0 || moduleLength === 0 || moduleAt + moduleLength + 2 > data.length) {
      continue;
    }

    const name = data.subarray(nameAt, nameAt + nameLength).toString('ascii');
    const module = data.subarray(moduleAt, moduleAt + moduleLength).toString('ascii');
    const ordinal = data.readUInt16LE(moduleAt + moduleLength);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !/^[A-Z0-9]+$/.test(module)) {
      continue;
    }

    if (!modules.has(module)) {
      modules.set(module, new Map());
    }

    modules.get(module).set(ordinal, name);
  }

  return modules;
}

/**
 * Reads the ordinals one of our modules declares, from `KEPT` in
 * `crates/winbox-win16/src/kept.rs`.
 *
 * The table is positional: an entry's index in the module's `exports` is
 * its ordinal, `None` where the module has no export of that number (index
 * zero among them, as there is no ordinal zero), else `Some(Export { name:
 * "...", ... })`. Counting entries at the array's own depth rather than
 * parsing Rust keeps this out of the business of understanding it.
 */
export async function readOurs(module) {
  const source = await readFile(KEPT, 'utf8');
  const begin = source.indexOf('pub static KEPT');
  const end = source.indexOf('pub static', begin + 1);
  const table = source.slice(begin, end === -1 ? source.length : end);
  const named = table.indexOf(`name: ${JSON.stringify(module)},`);

  if (begin === -1 || named === -1) {
    throw new Error(`no module ${module} in KEPT in ${KEPT}`);
  }

  const open = table.indexOf('exports: &[', named);

  if (open === -1) {
    throw new Error(`no export array for ${module} in ${KEPT}`);
  }

  const ours = new Map();

  let at = open + 'exports: &['.length;
  let depth = 1;
  let ordinal = 0;
  let quote = false;
  let name = null;

  while (at < table.length && depth > 0) {
    const character = table[at];

    if (quote) {
      if (character === '"' && table[at - 1] !== '\\') {
        quote = false;
      }

      at++;
      continue;
    }

    if (character === '"') {
      quote = true;
      at++;
      continue;
    }

    if (character === '/' && table[at + 1] === '/') {
      at = table.indexOf('\n', at);
      continue;
    }

    if (depth === 3 && table.startsWith('name: "', at)) {
      const close = table.indexOf('"', at + 'name: "'.length);

      name = table.slice(at + 'name: "'.length, close);
      at = close + 1;
      continue;
    }

    if (character === '[' || character === '(' || character === '{') {
      depth++;
    } else if (character === ']' || character === ')' || character === '}') {
      depth--;
    } else if (character === ',' && depth === 1) {
      if (name !== null) {
        ours.set(ordinal, name);
      }

      ordinal++;
      name = null;
    }

    at++;
  }

  if (name !== null) {
    ours.set(ordinal, name);
  }

  return ours;
}

async function main() {
  const args = process.argv.slice(2);
  const library = await readLibrary();

  const findAt = args.indexOf('--find');

  if (findAt !== -1) {
    const wanted = args[findAt + 1]?.toLowerCase();
    let found = false;

    for (const [module, exports] of library) {
      for (const [ordinal, name] of exports) {
        if (name.toLowerCase() === wanted) {
          log(`${module}.${ordinal}  ${name}`);
          found = true;
        }
      }
    }

    if (!found) {
      log(`nothing named ${args[findAt + 1]}`);
    }

    return;
  }

  const listAt = args.indexOf('--list');

  if (listAt !== -1) {
    const module = args[listAt + 1]?.toUpperCase();
    const exports = library.get(module);

    if (!exports) {
      throw new Error(`no module ${module}; the library has ${[...library.keys()].join(', ')}`);
    }

    for (const ordinal of [...exports.keys()].sort((a, b) => a - b)) {
      log(`  ${String(ordinal).padStart(4)}  ${exports.get(ordinal)}`);
    }

    return;
  }

  let disagreed = 0;
  let checked = 0;
  let unknown = 0;

  for (const module of MODULES) {
    const theirs = library.get(module) ?? new Map();
    const ours = await readOurs(module);
    const wrong = [];

    for (const [ordinal, name] of ours) {
      const real = theirs.get(ordinal);

      // Plenty of ordinals the SDK never gave a name to; silence is not evidence.
      if (real === undefined) {
        unknown++;
        continue;
      }

      checked++;

      if (real.toLowerCase() !== name.toLowerCase()) {
        wrong.push(`  ${String(ordinal).padStart(4)}  we say ${name}, the SDK says ${real}`);
      }
    }

    log(`${module}: ${ours.size} declared, ${theirs.size} in the import library`);

    if (wrong.length > 0) {
      disagreed += wrong.length;
      log(wrong.join('\n'));
    }
  }

  log(`\n${checked} ordinals checked, ${disagreed} disagree (${unknown} unnamed by the SDK)`);

  if (disagreed > 0) {
    process.exitCode = 1;
  }
}

// Importing this for its parsers should not also run the comparison.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`dump-exports: ${error.message}`);
    process.exitCode = 1;
  });
}
